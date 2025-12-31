import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserRole, AudioSource, TranscriptionItem, TranslationItem, VoiceName, STTEngine, TranslationEngine } from './types';
import { gemini, decode, decodeAudioData, SessionStatus } from './services/geminiService';
import { supabase, saveTranscript, fetchTranscripts, getUserProfile } from './lib/supabase';
import SessionControls from './components/SessionControls';
import LiveCaptions from './components/LiveCaptions';
import { Sparkles, Database, AlertCircle, X, Wifi, CloudLightning, Mic2, VolumeX, Key, User as UserIcon, Settings, Server, Globe, Cpu } from 'lucide-react';

const SYNC_DEBOUNCE_MS = 250;
const DEFAULT_ROOM = 'default-room';
const SPEAKER_TIMEOUT_MS = 3000;
const MAX_UNPUNCTUATED_LENGTH = 160;

// @ts-ignore
const aiStudio = window.aistudio;

const App: React.FC = () => {
  const [role, setRole] = useState<UserRole>(UserRole.IDLE);
  const [isActive, setIsActive] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource>(AudioSource.MIC);
  const [targetLang, setTargetLang] = useState('es-MX');
  const [voiceName, setVoiceName] = useState<VoiceName>(VoiceName.KORE);
  const [transcripts, setTranscripts] = useState<TranscriptionItem[]>([]);
  const [translations, setTranslations] = useState<TranslationItem[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>('Guest Speaker');
  const [activeSpeakerName, setActiveSpeakerName] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState<'connected' | 'error' | 'authenticating'>('authenticating');
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Advanced Configurations
  const [sttProvider, setSttProvider] = useState<STTEngine>(STTEngine.GEMINI);
  const [translationProvider, setTranslationProvider] = useState<TranslationEngine>(TranslationEngine.GEMINI);
  const [deepgramKey, setDeepgramKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434/api/generate');

  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionManagerRef = useRef<any>(null);
  const recognitionRef = useRef<any>(null);
  const dgSocketRef = useRef<WebSocket | null>(null);
  const wakeLockRef = useRef<any>(null);
  const speakerTimeoutRef = useRef<number | null>(null);
  
  const currentUtteranceIdRef = useRef<string>(crypto.randomUUID());
  const syncTimeoutRef = useRef<number | null>(null);
  const activeTtsCountRef = useRef<number>(0);
  const processedTextOffsetRef = useRef<Map<string, number>>(new Map());

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err: any) {}
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().then(() => {
        wakeLockRef.current = null;
      });
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        let user;
        if (session) {
          user = session.user;
        } else {
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error) throw error;
          user = data.user;
        }

        if (user) {
          setCurrentUserId(user.id);
          const { data: profile } = await getUserProfile(user.id);
          if (profile?.display_name) setDisplayName(profile.display_name);
          setDbStatus('connected');
        }
      } catch (err: any) {
        setDbStatus('error');
        setLastError(err.message || "Auth Error");
      }
    };
    initAuth();
  }, []);

  useEffect(() => {
    const checkKey = async () => {
      if (aiStudio && typeof aiStudio.hasSelectedApiKey === 'function') {
        const hasKey = await aiStudio.hasSelectedApiKey();
        setNeedsApiKey(!hasKey && sttProvider === STTEngine.GEMINI);
      }
    };
    checkKey();
  }, [sttProvider]);

  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    return () => {
      audioContextRef.current?.close();
      outputAudioContextRef.current?.close();
      releaseWakeLock();
    };
  }, []);

  const handleOpenKeyDialog = async () => {
    if (aiStudio && typeof aiStudio.openSelectKey === 'function') {
      await aiStudio.openSelectKey();
      setNeedsApiKey(false);
    }
  };

  const translateViaOllama = async (text: string, targetLang: string) => {
    try {
      const prompt = `Translate this text into ${targetLang}. Respond ONLY with the translation.\nText: ${text}`;
      const response = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemma:latest',
          prompt: prompt,
          stream: false
        })
      });
      const data = await response.json();
      return data.response?.trim() || "Translation failed";
    } catch (err) {
      console.error("Ollama Translation Error:", err);
      return "[Ollama Unavailable]";
    }
  };

  const processTranscriptItem = useCallback(async (item: any, playAudio: boolean = true) => {
    if (!item || !item.text) return;

    const speakerName = item.sender || displayName;
    setActiveSpeakerName(speakerName);
    
    if (speakerTimeoutRef.current) window.clearTimeout(speakerTimeoutRef.current);
    speakerTimeoutRef.current = window.setTimeout(() => setActiveSpeakerName(null), SPEAKER_TIMEOUT_MS);

    setTranscripts(prev => {
      const idx = prev.findIndex(t => t.id === item.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], text: item.text, isFinal: item.isFinal || true, speaker: speakerName };
        return updated;
      }
      return [...prev, { id: item.id, text: item.text, isFinal: item.isFinal || true, speaker: speakerName }];
    });

    const lastOffset = processedTextOffsetRef.current.get(item.id) || 0;
    const currentText = item.text;
    const newContent = currentText.substring(lastOffset);
    
    const sentenceRegex = /[^.!?\u3002\uff01\uff1f]+[.!?\u3002\uff01\uff1f]+(?=\s|$)/g;
    let match;
    const completedSentences: string[] = [];
    let lastFoundEnd = 0;

    while ((match = sentenceRegex.exec(newContent)) !== null) {
      const segment = match[0].trim();
      const isLikelyAbbrev = /\b(?:[A-Z][a-z]?|Prof|Dr|Mr|Ms|Mrs|St|U\.S)\.$/.test(segment);
      if (!isLikelyAbbrev) {
        completedSentences.push(segment);
        lastFoundEnd = match.index + match[0].length;
      }
    }

    const remaining = newContent.substring(lastFoundEnd).trim();
    if (remaining.length > MAX_UNPUNCTUATED_LENGTH || item.isFinal) {
      if (remaining.length > 0) {
        completedSentences.push(remaining);
        lastFoundEnd = newContent.length;
      }
    }

    if (completedSentences.length > 0) {
      processedTextOffsetRef.current.set(item.id, lastOffset + lastFoundEnd);
      for (const sentence of completedSentences) {
        try {
          const translated = translationProvider === TranslationEngine.GEMINI 
            ? await gemini.translate(sentence, 'auto', targetLang)
            : await translateViaOllama(sentence, targetLang);

          const transId = crypto.randomUUID();
          setTranslations(prev => [...prev, { 
            id: transId, 
            transcriptId: item.id, 
            text: translated, 
            lang: targetLang.toUpperCase() 
          }]);

          if (playAudio && outputAudioContextRef.current) {
            const audioData = await gemini.generateSpeech(translated, voiceName);
            if (audioData) {
              const ctx = outputAudioContextRef.current;
              if (ctx.state === 'suspended') await ctx.resume();
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              activeTtsCountRef.current++;
              setIsTtsPlaying(true);
              source.onended = () => {
                activeTtsCountRef.current--;
                if (activeTtsCountRef.current <= 0) { setIsTtsPlaying(false); }
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
            }
          }
        } catch (err) { console.error("Translation Pipeline Error:", err); }
      }
    }
  }, [targetLang, voiceName, displayName, translationProvider, ollamaUrl]);

  useEffect(() => {
    if (!isActive || role !== UserRole.LISTENER) return;
    const transcriptChannel = supabase.channel('public:transcriptions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transcriptions' }, (payload) => {
        processTranscriptItem(payload.new, true);
      }).subscribe();
    return () => { supabase.removeChannel(transcriptChannel); };
  }, [isActive, role, processTranscriptItem]);

  const syncToDatabase = useCallback(async (text: string, isFinal: boolean, speakerNameOverride?: string) => {
    if (!text.trim() || !currentUserId || role !== UserRole.SPEAKER) return;
    const utteranceId = currentUtteranceIdRef.current;
    const performSync = async () => {
      try {
        await saveTranscript({ id: utteranceId, user_id: currentUserId, room_id: DEFAULT_ROOM, speaker: speakerNameOverride || displayName, text });
        if (isFinal) { currentUtteranceIdRef.current = crypto.randomUUID(); }
      } catch (e: any) { setLastError(e.message); }
    };
    if (syncTimeoutRef.current) window.clearTimeout(syncTimeoutRef.current);
    if (isFinal) performSync();
    else syncTimeoutRef.current = window.setTimeout(performSync, SYNC_DEBOUNCE_MS);
  }, [role, currentUserId, displayName]);

  const toggleActive = useCallback(async () => {
    if (isActive) {
      setIsActive(false);
      setActiveSpeakerName(null);
      releaseWakeLock();
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      sessionManagerRef.current?.close();
      recognitionRef.current?.stop();
      dgSocketRef.current?.close();
      setAudioLevel(0);
      setTranscripts([]);
      setTranslations([]);
      processedTextOffsetRef.current.clear();
    } else {
      if (role === UserRole.IDLE) return;
      try {
        await requestWakeLock();
        if (role === UserRole.LISTENER) {
          setSessionStatus('connecting');
          const { data } = await fetchTranscripts(DEFAULT_ROOM);
          if (data) for (const item of data) await processTranscriptItem(item, false);
          setSessionStatus('connected');
        }

        let stream: MediaStream | null = null;
        if (role === UserRole.SPEAKER) {
          if (audioSource === AudioSource.MIC) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 } });
          } else {
            // Restore Tab/System audio capture logic
            try {
              stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                  sampleRate: 16000
                }
              });
              
              if (stream.getAudioTracks().length === 0) {
                stream.getTracks().forEach(t => t.stop());
                throw new Error("No audio track found. Please ensure you check 'Share audio' when choosing a tab or window.");
              }
            } catch (err: any) {
              if (err.name === 'NotAllowedError') return; // User cancelled
              throw err;
            }
          }
          streamRef.current = stream;
        }
        setIsActive(true);

        if (role === UserRole.SPEAKER && stream) {
          if (sttProvider === STTEngine.GEMINI) {
            const manager = await gemini.connectLive({
              onTranscription: (text, isFinal, speaker) => {
                const uid = currentUtteranceIdRef.current;
                const speakerName = speaker || displayName;
                syncToDatabase(text, isFinal, speakerName);
                if (isFinal) processTranscriptItem({ id: uid, text, sender: speakerName, isFinal: true }, false);
              },
              onStatusChange: setSessionStatus,
              onError: (e) => setLastError(e.message)
            }, displayName);
            sessionManagerRef.current = manager;

            const ctx = audioContextRef.current!;
            if (ctx.state === 'suspended') await ctx.resume();
            const source = ctx.createMediaStreamSource(stream);
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const data = e.inputBuffer.getChannelData(0);
              if (activeTtsCountRef.current > 0) { setAudioLevel(0); return; }
              let rms = 0; for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
              setAudioLevel(Math.min(Math.sqrt(rms / data.length) * 5, 1));
              sessionManagerRef.current?.processAudio(data);
            };
            source.connect(processor);
            processor.connect(ctx.destination);

          } else if (sttProvider === STTEngine.WEBSPEECH) {
            setSessionStatus('connected');
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (!SpeechRecognition) throw new Error("WebSpeech API not supported in this browser.");
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.onresult = (e: any) => {
              const text = Array.from(e.results).map((r: any) => r[0].transcript).join(' ');
              const isFinal = e.results[e.results.length - 1].isFinal;
              syncToDatabase(text, isFinal, displayName);
              if (isFinal) processTranscriptItem({ id: currentUtteranceIdRef.current, text, sender: displayName, isFinal: true }, false);
            };
            recognition.onerror = (e: any) => setLastError(e.error);
            recognition.start();
            recognitionRef.current = recognition;

          } else if (sttProvider === STTEngine.DEEPGRAM) {
            if (!deepgramKey) throw new Error("Deepgram API Key is required.");
            setSessionStatus('connecting');
            const socket = new WebSocket('wss://api.deepgram.com/v1/listen?smart_format=true&encoding=linear16&sample_rate=16000', ['token', deepgramKey]);
            socket.onopen = () => {
              setSessionStatus('connected');
              const mediaRecorder = new MediaRecorder(stream!, { mimeType: 'audio/webm' });
              mediaRecorder.addEventListener('dataavailable', (e) => {
                if (e.data.size > 0 && socket.readyState === 1) socket.send(e.data);
              });
              mediaRecorder.start(250);
            };
            socket.onmessage = (msg) => {
              const data = JSON.parse(msg.data);
              const transcript = data.channel.alternatives[0].transcript;
              if (transcript && data.is_final) {
                syncToDatabase(transcript, true, displayName);
                processTranscriptItem({ id: currentUtteranceIdRef.current, text: transcript, sender: displayName, isFinal: true }, false);
              }
            };
            socket.onerror = () => setSessionStatus('error');
            dgSocketRef.current = socket;
          }
        }
      } catch (err: any) { setLastError(err.message); setIsActive(false); }
    }
  }, [isActive, role, audioSource, displayName, syncToDatabase, processTranscriptItem, sttProvider, deepgramKey]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-950 text-slate-100 overflow-x-hidden relative font-inter">
      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-[2.5rem] w-full max-w-xl p-8 md:p-12 shadow-2xl animate-in zoom-in duration-300">
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-2xl font-black uppercase tracking-widest flex items-center gap-4">
                <Settings className="w-6 h-6 text-indigo-500" />
                Advanced Settings
              </h2>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-white/5 rounded-full"><X className="w-6 h-6" /></button>
            </div>
            
            <div className="space-y-8">
              <section>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 block">STT Provider</label>
                <div className="grid grid-cols-3 gap-3">
                  <SettingBtn active={sttProvider === STTEngine.GEMINI} onClick={() => setSttProvider(STTEngine.GEMINI)} icon={Sparkles} label="Gemini" />
                  <SettingBtn active={sttProvider === STTEngine.DEEPGRAM} onClick={() => setSttProvider(STTEngine.DEEPGRAM)} icon={Server} label="Deepgram" />
                  <SettingBtn active={sttProvider === STTEngine.WEBSPEECH} onClick={() => setSttProvider(STTEngine.WEBSPEECH)} icon={Globe} label="WebSpeech" />
                </div>
                {sttProvider === STTEngine.DEEPGRAM && (
                  <input 
                    type="password" placeholder="Deepgram API Key" value={deepgramKey} 
                    onChange={(e) => setDeepgramKey(e.target.value)}
                    className="w-full mt-4 bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all"
                  />
                )}
              </section>

              <section>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 block">Translation Engine</label>
                <div className="grid grid-cols-2 gap-3">
                  <SettingBtn active={translationProvider === TranslationEngine.GEMINI} onClick={() => setTranslationProvider(TranslationEngine.GEMINI)} icon={Sparkles} label="Gemini Flash" />
                  <SettingBtn active={translationProvider === TranslationEngine.OLLAMA_GEMMA} onClick={() => setTranslationProvider(TranslationEngine.OLLAMA_GEMMA)} icon={Cpu} label="Gemma (Ollama)" />
                </div>
                {translationProvider === TranslationEngine.OLLAMA_GEMMA && (
                  <input 
                    type="text" placeholder="Ollama API Endpoint (URL)" value={ollamaUrl} 
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    className="w-full mt-4 bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all"
                  />
                )}
              </section>
            </div>
            
            <button 
              onClick={() => setIsSettingsOpen(false)}
              className="w-full mt-12 bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 rounded-2xl uppercase tracking-widest text-sm transition-all"
            >
              Apply Configuration
            </button>
          </div>
        </div>
      )}

      {lastError && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] w-[95%] max-w-2xl animate-in slide-in-from-top duration-300">
          <div className="bg-rose-500/15 border border-rose-500/40 backdrop-blur-2xl p-5 rounded-3xl flex items-start gap-4 shadow-2xl">
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-1" />
            <div className="flex-1 min-w-0">
              <h4 className="text-rose-400 font-black text-xs uppercase tracking-widest mb-1">System Alert</h4>
              <p className="text-rose-100/80 text-sm line-clamp-3">{lastError}</p>
            </div>
            <button onClick={() => setLastError(null)} className="text-rose-500/50 hover:text-rose-400 p-1"><X className="w-5 h-5" /></button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-[1920px] mx-auto w-full px-4 md:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-black tracking-tighter uppercase tracking-widest leading-none">TTR <span className="text-indigo-500">/</span> Realtime</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">{displayName}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 hover:bg-white/5 rounded-xl text-slate-400 hover:text-indigo-400 transition-all flex items-center gap-2 border border-transparent hover:border-white/10"
            >
              <Settings className="w-5 h-5" />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Settings</span>
            </button>
            <StatusBadge 
              status={sessionStatus} 
              icon={role === UserRole.SPEAKER ? Wifi : CloudLightning} 
              label={sttProvider + " " + sessionStatus.toUpperCase()} 
              active={sessionStatus === 'connected'} 
            />
            <StatusBadge status={dbStatus} icon={Database} label="DATABASE" active={dbStatus === 'connected'} error={dbStatus === 'error'} />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1920px] mx-auto px-2 md:px-8 py-4 md:py-8 overflow-hidden flex flex-col items-center">
        <div className={`w-full h-full grid gap-3 md:gap-4 min-h-[calc(100vh-320px)] md:min-h-[calc(100vh-280px)] ${
          role === UserRole.SPEAKER ? 'grid-cols-1 max-w-5xl place-items-center' : 'grid-cols-1 md:grid-cols-2'
        }`}>
          <div className="flex w-full h-full animate-in fade-in duration-700">
            <LiveCaptions title={role === UserRole.SPEAKER ? "My Transcription (Broadcasting)" : "Original Transcription"} transcripts={transcripts} translations={[]} type="source" />
          </div>
          {role === UserRole.LISTENER && (
            <div className="flex w-full h-full animate-in slide-in-from-right duration-700">
              <LiveCaptions title="My Translation (Read Aloud)" transcripts={[]} translations={translations} type="target" />
            </div>
          )}
        </div>
      </main>

      <SessionControls 
        role={role} isActive={isActive} onToggleRole={setRole} onToggleActive={toggleActive}
        targetLang={targetLang} onTargetLangChange={setTargetLang} 
        audioSource={audioSource} onAudioSourceChange={setAudioSource}
        voiceName={voiceName} onVoiceNameChange={setVoiceName}
        audioLevel={audioLevel}
      />
    </div>
  );
};

const SettingBtn = ({ active, onClick, icon: Icon, label }: any) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all ${
      active ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' : 'bg-slate-800/40 border-white/5 text-slate-500 hover:bg-slate-800'
    }`}
  >
    <Icon className="w-5 h-5" />
    <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
  </button>
);

export const AudioLevelMeter = ({ level, variant = 'standard' }: { level: number, variant?: 'standard' | 'compact' | 'large' }) => {
  const segments = variant === 'compact' ? 8 : variant === 'large' ? 24 : 12;
  const activeSegments = Math.ceil(level * segments);
  return (
    <div className={`flex items-end gap-[2px] ${variant === 'compact' ? 'h-3' : variant === 'large' ? 'h-8' : 'h-5'}`}>
      {Array.from({ length: segments }).map((_, i) => (
        <div key={i} className={`w-1 rounded-full transition-all duration-75 ${i < activeSegments ? (i > (segments * 0.8) ? 'bg-rose-500 h-full' : i > (segments * 0.5) ? 'bg-amber-400 h-[75%]' : 'bg-emerald-500 h-[50%]') : 'bg-white/10 h-[20%]'}`} />
      ))}
    </div>
  );
};

const StatusBadge = ({ icon: Icon, label, active, error }: any) => (
  <div className={`flex items-center gap-2 px-3 py-1 rounded-lg border text-[10px] font-black tracking-widest transition-colors ${error ? 'border-rose-500/40 text-rose-400 bg-rose-500/5' : active ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5' : 'border-white/10 text-slate-500 bg-white/5'}`}>
    <Icon className="w-3 md:w-3.5 h-3 md:h-3.5" />
    <span className="whitespace-nowrap">{label}</span>
  </div>
);

export default App;