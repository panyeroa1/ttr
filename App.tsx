import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserRole, AudioSource, TranscriptionItem, TranslationItem, VoiceName, STTEngine, TranslationEngine, TTSEngine } from './types';
import { gemini, decode, decodeAudioData, SessionStatus, isDailyQuotaReached } from './services/geminiService';
import { supabase, saveTranscript, saveTranslation, fetchTranscripts, getUserProfile } from './lib/supabase';
import SessionControls from './components/SessionControls';
import LiveCaptions from './components/LiveCaptions';
import SubtitlesOverlay from './components/SubtitlesOverlay';
import { Sparkles, Database, AlertCircle, X, Wifi, CloudLightning, Mic2, VolumeX, Settings, Server, Globe, Cpu, Subtitles as SubtitlesIcon, Info, LayoutDashboard, SlidersHorizontal, MessageSquare, Volume2, AudioWaveform } from 'lucide-react';

const SYNC_DEBOUNCE_MS = 250;
const DEFAULT_ROOM = 'default-room';
const SPEAKER_TIMEOUT_MS = 3000;
const MAX_UNPUNCTUATED_LENGTH = 140;

// @ts-ignore
const aiStudio = window.aistudio;

const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<'live' | 'settings'>('live');
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
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [currentSubtitle, setCurrentSubtitle] = useState<{text: string, isFinal: boolean}>({text: '', isFinal: false});
  const [isRateLimited, setIsRateLimited] = useState(false);

  // Engines
  const [sttProvider, setSttProvider] = useState<STTEngine>(STTEngine.GEMINI);
  const [translationProvider, setTranslationProvider] = useState<TranslationEngine>(TranslationEngine.GEMINI);
  const [ttsProvider, setTtsProvider] = useState<TTSEngine>(TTSEngine.GEMINI);

  // API Keys
  const [deepgramKey, setDeepgramKey] = useState('');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [cartesiaKey, setCartesiaKey] = useState('');
  const [deepgramTtsKey, setDeepgramTtsKey] = useState('');
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
          const { data: profile, error } = await getUserProfile(user.id);
          if (profile?.display_name) setDisplayName(profile.display_name);
          setDbStatus(error ? 'error' : 'connected');
        }
      } catch (err: any) {
        setDbStatus('error');
        setLastError(err.message || "Auth Error");
      }
    };
    initAuth();
  }, []);

  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    return () => {
      audioContextRef.current?.close();
      outputAudioContextRef.current?.close();
      releaseWakeLock();
    };
  }, []);

  const translateViaOllama = async (text: string, target: string) => {
    try {
      const prompt = `Translate this text into ${target}. Respond ONLY with the translation.\nText: ${text}`;
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

  /**
   * Enhanced sentence boundary detection logic.
   * Uses a robust set of abbreviations and heuristics to determine when to split 
   * a stream of text into sentences for high-quality translation.
   */
  const segmentIntoSentences = (text: string, isFinal: boolean) => {
    const abbreviations = [
      'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'St', 'Co', 'Inc', 'Ltd', 
      'vs', 'approx', 'min', 'max', 'dept', 'univ', 'vol', 'ed', 'est', 'etc',
      'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      'U.S', 'U.K', 'E.U', 'B.C', 'A.D', 'p.m', 'a.m', 'i.e', 'e.g', 'c.f',
      'D.C', 'L.A', 'N.Y', 'Ph.D', 'M.D'
    ];
    
    // Pattern to catch sentence terminators (. ! ? Chinese equivalents)
    const sentenceRegex = /([.!?\u3002\uff01\uff1f]+|(?:\.\.\.))["'）)\]]*(\s+|$)/g;
    const sentences: string[] = [];
    let match;
    let start = 0;

    while ((match = sentenceRegex.exec(text)) !== null) {
      const punc = match[1];
      const puncEndIndex = match.index + punc.length;
      const fullSegment = text.substring(start, puncEndIndex).trim();
      
      // Look at the word preceding the punctuation
      const lastWordMatch = fullSegment.match(/(\S+)(?:[.!?\u3002\uff01\uff1f]+)$/);
      if (lastWordMatch) {
        const lastWord = lastWordMatch[1]; // e.g., "Mr" from "Mr."
        const isAbbrev = abbreviations.some(a => a.toLowerCase() === lastWord.toLowerCase()) || 
                        /^[A-Z]$/.test(lastWord); // Handle single letter initials like "J."
        
        if (isAbbrev && !isFinal) {
          // It's an abbreviation, don't split here yet unless the stream is finished
          continue;
        }
      }

      // Found a valid boundary
      sentences.push(text.substring(start, match.index + match[0].length).trim());
      start = match.index + match[0].length;
    }

    const remaining = text.substring(start).trim();
    
    // Handle the end of the input
    if (isFinal && remaining.length > 0) {
      sentences.push(remaining);
      return { sentences, lastIndex: text.length };
    }

    // Fallback for extremely long unpunctuated segments (VAD might be failing or speaker is non-stop)
    if (remaining.length > MAX_UNPUNCTUATED_LENGTH) {
      // Try to split on a comma first as a soft boundary
      const lastComma = remaining.lastIndexOf(',');
      if (lastComma > remaining.length * 0.6) {
        sentences.push(remaining.substring(0, lastComma + 1).trim());
        return { sentences, lastIndex: start + lastComma + 1 };
      }
      // If no comma, split on the last space to avoid cutting words
      const lastSpace = remaining.lastIndexOf(' ');
      if (lastSpace > remaining.length * 0.8) {
        sentences.push(remaining.substring(0, lastSpace).trim());
        return { sentences, lastIndex: start + lastSpace + 1 };
      }
    }

    return { sentences, lastIndex: start };
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
    
    if (newContent.trim()) {
      setCurrentSubtitle({ text: newContent.trim(), isFinal: item.isFinal });
    }

    if (role !== UserRole.LISTENER) return;
    if (isRateLimited || isDailyQuotaReached()) return;

    const { sentences, lastIndex } = segmentIntoSentences(newContent, item.isFinal);

    if (sentences.length > 0) {
      processedTextOffsetRef.current.set(item.id, lastOffset + lastIndex);
      for (const sentence of sentences) {
        try {
          const translated = translationProvider === TranslationEngine.GEMINI 
            ? await gemini.translate(sentence, 'auto', targetLang)
            : await translateViaOllama(sentence, targetLang);

          const transId = crypto.randomUUID();
          
          if (currentUserId) {
            await saveTranslation({
              id: transId,
              user_id: currentUserId,
              source_lang: 'auto',
              target_lang: targetLang,
              original_text: sentence,
              translated_text: translated
            });
          }

          setTranslations(prev => [...prev, { 
            id: transId, 
            transcriptId: item.id, 
            text: translated, 
            lang: targetLang.toUpperCase() 
          }]);

          if (playAudio && outputAudioContextRef.current) {
            let audioBuffer: AudioBuffer | null = null;
            const ctx = outputAudioContextRef.current;
            if (ctx.state === 'suspended') await ctx.resume();

            try {
              if (ttsProvider === TTSEngine.GEMINI) {
                const audioData = await gemini.generateSpeech(translated, voiceName);
                if (audioData) {
                  audioBuffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
                }
              } else if (ttsProvider === TTSEngine.ELEVENLABS && elevenLabsKey) {
                const data = await gemini.generateElevenLabsSpeech(translated, elevenLabsKey);
                audioBuffer = await ctx.decodeAudioData(data);
              } else if (ttsProvider === TTSEngine.DEEPGRAM && deepgramTtsKey) {
                const data = await gemini.generateDeepgramSpeech(translated, deepgramTtsKey);
                audioBuffer = await ctx.decodeAudioData(data);
              } else if (ttsProvider === TTSEngine.CARTESIA && cartesiaKey) {
                const data = await gemini.generateCartesiaSpeech(translated, cartesiaKey);
                audioBuffer = await ctx.decodeAudioData(data);
              }
            } catch (err) {
              console.warn("TTS Generation Failed:", err);
            }

            if (audioBuffer) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              activeTtsCountRef.current++;
              setIsTtsPlaying(true);
              source.onended = () => {
                activeTtsCountRef.current--;
                if (activeTtsCountRef.current <= 0) { setIsTtsPlaying(false); }
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
            }
          }
        } catch (err: any) {
          console.error("Translation Pipeline Error:", err);
          const errorMsg = err?.message || "";
          if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg === "DAILY_QUOTA_REACHED") {
            setIsRateLimited(true);
            setLastError("Gemini API Daily Quota Exceeded. Translation and TTS paused.");
            setTimeout(() => setIsRateLimited(false), 30000);
          }
        }
      }
    }
  }, [targetLang, voiceName, displayName, translationProvider, ttsProvider, elevenLabsKey, cartesiaKey, deepgramTtsKey, ollamaUrl, currentUserId, isRateLimited, role]);

  useEffect(() => {
    if (!isActive || role !== UserRole.LISTENER) return;
    const transcriptChannel = supabase.channel('public:transcriptions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transcriptions' }, (payload) => {
        processTranscriptItem(payload.new, true);
      }).subscribe();
    return () => { supabase.removeChannel(transcriptChannel); };
  }, [isActive, role, processTranscriptItem]);

  const syncToDatabase = useCallback(async (text: string, isFinal: boolean, senderOverride?: string) => {
    if (!text.trim() || !currentUserId || role !== UserRole.SPEAKER) return;
    const utteranceId = currentUtteranceIdRef.current;
    
    const performSync = async () => {
      const { error } = await saveTranscript({ 
        id: utteranceId, 
        user_id: currentUserId, 
        room_name: DEFAULT_ROOM, 
        sender: senderOverride || displayName, 
        text 
      });
      
      if (error) {
        setLastError(`Persistence Error: ${error.message || 'Check your internet connection.'}`);
      } else {
        if (isFinal) { currentUtteranceIdRef.current = crypto.randomUUID(); }
      }
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
      setCurrentSubtitle({text: '', isFinal: false});
      processedTextOffsetRef.current.clear();
    } else {
      if (role === UserRole.IDLE) return;
      try {
        await requestWakeLock();
        if (role === UserRole.LISTENER) {
          setSessionStatus('connecting');
          const { data, error } = await fetchTranscripts(DEFAULT_ROOM);
          if (error) throw error;
          if (data) for (const item of data) await processTranscriptItem(item, false);
          setSessionStatus('connected');
        }

        let stream: MediaStream | null = null;
        if (role === UserRole.SPEAKER) {
          if (audioSource === AudioSource.MIC) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 } });
          } else {
            try {
              stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 16000 }
              });
              if (stream.getAudioTracks().length === 0) {
                stream.getTracks().forEach(t => t.stop());
                throw new Error("No audio track found. Please share audio.");
              }
            } catch (err: any) {
              if (err.name === 'NotAllowedError') return;
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
                const senderName = speaker || displayName;
                setCurrentSubtitle({ text, isFinal });
                syncToDatabase(text, isFinal, senderName);
                if (isFinal) processTranscriptItem({ id: uid, text, sender: senderName, isFinal: true }, false);
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
            if (!SpeechRecognition) throw new Error("WebSpeech not supported.");
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.onresult = (e: any) => {
              const text = Array.from(e.results).map((r: any) => r[0].transcript).join(' ');
              const isFinal = e.results[e.results.length - 1].isFinal;
              setCurrentSubtitle({ text, isFinal });
              syncToDatabase(text, isFinal, displayName);
              if (isFinal) processTranscriptItem({ id: currentUtteranceIdRef.current, text, sender: displayName, isFinal: true }, false);
            };
            recognition.onerror = (e: any) => setLastError(e.error);
            recognition.start();
            recognitionRef.current = recognition;

          } else if (sttProvider === STTEngine.DEEPGRAM) {
            if (!deepgramKey) throw new Error("Deepgram Key required.");
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
              if (transcript) {
                setCurrentSubtitle({ text: transcript, isFinal: data.is_final });
                if (data.is_final) {
                  syncToDatabase(transcript, true, displayName);
                  processTranscriptItem({ id: currentUtteranceIdRef.current, text: transcript, sender: displayName, isFinal: true }, false);
                }
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
    <div className="min-h-[100dvh] h-[100dvh] flex flex-col bg-slate-950 text-slate-100 overflow-hidden relative font-inter">
      {isActive && showSubtitles && currentTab === 'live' && (currentSubtitle.text || role === UserRole.LISTENER) && (
        <SubtitlesOverlay 
          text={role === UserRole.SPEAKER ? currentSubtitle.text : (translations.length > 0 ? translations[translations.length - 1].text : '')} 
          isFinal={role === UserRole.SPEAKER ? currentSubtitle.isFinal : true}
          speakerName={role === UserRole.SPEAKER ? displayName : activeSpeakerName || 'Speaker'}
          type={role === UserRole.SPEAKER ? 'source' : 'target'}
        />
      )}

      {(isDailyQuotaReached() || isRateLimited) && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] w-[95%] max-w-2xl animate-in slide-in-from-top duration-300">
          <div className="bg-amber-500/15 border border-amber-500/40 backdrop-blur-2xl p-5 rounded-3xl flex items-start gap-4 shadow-2xl">
            <Info className="w-5 h-5 text-amber-500 shrink-0 mt-1" />
            <div className="flex-1 min-w-0">
              <h4 className="text-amber-400 font-black text-xs uppercase tracking-widest mb-1">Quota Warning</h4>
              <p className="text-amber-100/80 text-sm">Gemini API daily quota reached. Translation is currently paused. Please wait or upgrade your API plan.</p>
            </div>
          </div>
        </div>
      )}

      {lastError && !isDailyQuotaReached() && !isRateLimited && (
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

          <div className="flex items-center gap-1 bg-slate-900/60 p-1 rounded-2xl border border-white/5 shadow-inner">
            <TabBtn active={currentTab === 'live'} onClick={() => setCurrentTab('live')} icon={LayoutDashboard} label="Live" />
            <TabBtn active={currentTab === 'settings'} onClick={() => setCurrentTab('settings')} icon={SlidersHorizontal} label="Settings" />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <StatusBadge status={sessionStatus} icon={role === UserRole.SPEAKER ? Wifi : CloudLightning} label={sttProvider + " " + sessionStatus.toUpperCase()} active={sessionStatus === 'connected'} />
            <StatusBadge status={dbStatus} icon={Database} label="DATABASE" active={dbStatus === 'connected'} error={dbStatus === 'error'} />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1920px] mx-auto px-2 md:px-8 py-4 md:py-8 overflow-hidden flex flex-col items-center">
        {currentTab === 'live' ? (
          <div className={`w-full h-full grid gap-3 md:gap-4 ${
            role === UserRole.SPEAKER ? 'grid-cols-1 max-w-5xl' : 'grid-cols-1 md:grid-cols-2'
          }`}>
            <div className="flex w-full h-full animate-in fade-in duration-700 overflow-hidden">
              <LiveCaptions title={role === UserRole.SPEAKER ? "My Transcription (Broadcasting)" : "Original Transcription"} transcripts={transcripts} translations={[]} type="source" />
            </div>
            {role === UserRole.LISTENER && (
              <div className="flex w-full h-full animate-in slide-in-from-right duration-700 overflow-hidden">
                <LiveCaptions title="My Translation (Read Aloud)" transcripts={[]} translations={translations} type="target" />
              </div>
            )}
          </div>
        ) : (
          <div className="w-full max-w-4xl h-full animate-in zoom-in-95 duration-500 bg-slate-900/40 backdrop-blur-xl rounded-[2.5rem] border border-white/10 overflow-hidden flex flex-col">
            <div className="p-6 md:p-12 pb-4 shrink-0">
              <div className="flex items-center gap-4 mb-2">
                <div className="p-3 bg-indigo-600 rounded-2xl">
                  <SlidersHorizontal className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-widest">Configuration</h2>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Fine-tune your realtime pipeline</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 md:px-12 pb-32 scrollbar-hide">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 mt-6">
                
                {/* STT Section */}
                <SettingsSection icon={Mic2} title="Speech-to-Text (STT)" description="Choose your transcription engine">
                  <div className="grid grid-cols-1 gap-3">
                    <SettingBtn active={sttProvider === STTEngine.GEMINI} onClick={() => setSttProvider(STTEngine.GEMINI)} icon={Sparkles} label="Gemini Live" description="Best for natural context" />
                    <SettingBtn active={sttProvider === STTEngine.DEEPGRAM} onClick={() => setSttProvider(STTEngine.DEEPGRAM)} icon={Server} label="Deepgram" description="Ultra low latency" />
                    <SettingBtn active={sttProvider === STTEngine.WEBSPEECH} onClick={() => setSttProvider(STTEngine.WEBSPEECH)} icon={Globe} label="WebSpeech" description="Privacy-first, browser native" />
                  </div>
                  {sttProvider === STTEngine.DEEPGRAM && (
                    <div className="mt-4 animate-in slide-in-from-top-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Deepgram API Key</label>
                      <input 
                        type="password" placeholder="dg_xxxxxxxxxxxx" value={deepgramKey} 
                        onChange={(e) => setDeepgramKey(e.target.value)}
                        className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                  )}
                </SettingsSection>

                {/* Translation Section */}
                <SettingsSection icon={MessageSquare} title="Translation" description="AI powered chat completions">
                  <div className="grid grid-cols-1 gap-3">
                    <SettingBtn active={translationProvider === TranslationEngine.GEMINI} onClick={() => setTranslationProvider(TranslationEngine.GEMINI)} icon={Sparkles} label="Gemini Flash" description="Fastest cloud translation" />
                    <SettingBtn active={translationProvider === TranslationEngine.OLLAMA_GEMMA} onClick={() => setTranslationProvider(TranslationEngine.OLLAMA_GEMMA)} icon={Cpu} label="Gemma (Ollama)" description="Self-hosted local model" />
                  </div>
                  {translationProvider === TranslationEngine.OLLAMA_GEMMA && (
                    <div className="mt-4 animate-in slide-in-from-top-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Ollama Endpoint</label>
                      <input 
                        type="text" placeholder="http://localhost:11434" value={ollamaUrl} 
                        onChange={(e) => setOllamaUrl(e.target.value)}
                        className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                  )}
                </SettingsSection>

                {/* TTS Section */}
                <SettingsSection icon={Volume2} title="Text-to-Speech (TTS)" description="Speech synthesis engine">
                  <div className="grid grid-cols-1 gap-3">
                    <SettingBtn active={ttsProvider === TTSEngine.GEMINI} onClick={() => setTtsProvider(TTSEngine.GEMINI)} icon={Sparkles} label="Gemini TTS" description="Integrated high-quality" />
                    <SettingBtn active={ttsProvider === TTSEngine.ELEVENLABS} onClick={() => setTtsProvider(TTSEngine.ELEVENLABS)} icon={AudioWaveform} label="ElevenLabs" description="Ultra-realistic voices" />
                    <SettingBtn active={ttsProvider === TTSEngine.DEEPGRAM} onClick={() => setTtsProvider(TTSEngine.DEEPGRAM)} icon={Server} label="Deepgram TTS" description="Optimized low-latency" />
                    <SettingBtn active={ttsProvider === TTSEngine.CARTESIA} onClick={() => setTtsProvider(TTSEngine.CARTESIA)} icon={Cpu} label="Cartesia" description="State-of-the-art inference" />
                  </div>
                  
                  {ttsProvider === TTSEngine.ELEVENLABS && (
                    <div className="mt-4 animate-in slide-in-from-top-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">ElevenLabs API Key</label>
                      <input 
                        type="password" placeholder="xi-apiKey-xxxxxxxx" value={elevenLabsKey} 
                        onChange={(e) => setElevenLabsKey(e.target.value)}
                        className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                  )}
                  {ttsProvider === TTSEngine.DEEPGRAM && (
                    <div className="mt-4 animate-in slide-in-from-top-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Deepgram API Key (TTS)</label>
                      <input 
                        type="password" placeholder="dg_xxxxxxxxxxxx" value={deepgramTtsKey} 
                        onChange={(e) => setDeepgramTtsKey(e.target.value)}
                        className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                  )}
                  {ttsProvider === TTSEngine.CARTESIA && (
                    <div className="mt-4 animate-in slide-in-from-top-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Cartesia API Key</label>
                      <input 
                        type="password" placeholder="cartesia-apiKey-xxxx" value={cartesiaKey} 
                        onChange={(e) => setCartesiaKey(e.target.value)}
                        className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                  )}
                </SettingsSection>

                {/* Gemini Voice Sub-Section (Only for Gemini TTS) */}
                {ttsProvider === TTSEngine.GEMINI && (
                  <SettingsSection icon={AudioWaveform} title="Gemini Voice" description="Select pre-built voice">
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { id: VoiceName.KORE, name: 'Kore', desc: 'Soft & Friendly' },
                        { id: VoiceName.PUCK, name: 'Puck', desc: 'Deep & Resonant' },
                        { id: VoiceName.ZEPHYR, name: 'Zephyr', desc: 'Clear & Crisp' },
                        { id: VoiceName.FENRIR, name: 'Fenrir', desc: 'Bold & Direct' },
                        { id: VoiceName.CHARON, name: 'Charon', desc: 'Gravelly & Strong' }
                      ].map(v => (
                        <SettingBtn key={v.id} active={voiceName === v.id} onClick={() => setVoiceName(v.id as VoiceName)} icon={Volume2} label={v.name} description={v.desc} />
                      ))}
                    </div>
                  </SettingsSection>
                )}

                <SettingsSection icon={SubtitlesIcon} title="Interface" description="Realtime visual feedback">
                  <button 
                    onClick={() => setShowSubtitles(!showSubtitles)}
                    className={`flex items-center justify-between w-full p-4 rounded-2xl border transition-all ${showSubtitles ? 'bg-indigo-600/10 border-indigo-500/50 text-indigo-400' : 'bg-slate-800/40 border-white/5 text-slate-500'}`}
                  >
                    <div className="flex items-center gap-3">
                      <SubtitlesIcon className="w-5 h-5" />
                      <div>
                        <p className="text-xs font-black uppercase tracking-widest text-left">Overlay Subtitles</p>
                        <p className="text-[10px] opacity-60">Display floating captions during session</p>
                      </div>
                    </div>
                    <div className={`w-10 h-5 rounded-full relative transition-colors ${showSubtitles ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                      <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${showSubtitles ? 'left-6' : 'left-1'}`} />
                    </div>
                  </button>
                </SettingsSection>
              </div>
            </div>
          </div>
        )}
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

const TabBtn = ({ active, onClick, icon: Icon, label }: any) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
      active ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
    }`}
  >
    <Icon className="w-4 h-4" />
    <span>{label}</span>
  </button>
);

const SettingsSection = ({ icon: Icon, title, description, children }: any) => (
  <section className="space-y-4">
    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
      <div className="p-2 bg-slate-800/60 rounded-xl">
        <Icon className="w-4 h-4 text-indigo-400" />
      </div>
      <div>
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-200">{title}</h3>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">{description}</p>
      </div>
    </div>
    <div className="space-y-3">{children}</div>
  </section>
);

const SettingBtn = ({ active, onClick, icon: Icon, label, description }: any) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${
      active ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400 shadow-inner' : 'bg-slate-800/40 border-white/5 text-slate-500 hover:bg-slate-800/60 hover:border-white/10'
    }`}
  >
    <div className={`p-2 rounded-xl ${active ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-500'}`}>
      <Icon className="w-4 h-4" />
    </div>
    <div className="flex-1">
      <p className={`text-xs font-black uppercase tracking-widest ${active ? 'text-indigo-100' : 'text-slate-300'}`}>{label}</p>
      {description && <p className="text-[10px] opacity-60 font-bold uppercase tracking-tight line-clamp-1">{description}</p>}
    </div>
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