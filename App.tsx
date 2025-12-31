
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserRole, AudioSource, TranscriptionItem, TranslationItem, VoiceType } from './types';
import { gemini, decode, decodeAudioData, SessionStatus } from './services/geminiService';
import { supabase, saveTranscript, fetchTranscripts, getUserProfile } from './lib/supabase';
import SessionControls from './components/SessionControls';
import LiveCaptions from './components/LiveCaptions';
import { Sparkles, Database, AlertCircle, X, Wifi, CloudLightning, Mic2, VolumeX, Key } from 'lucide-react';

const SYNC_DEBOUNCE_MS = 250;
const DEFAULT_ROOM = 'default-room';

// @ts-ignore
const aiStudio = window.aistudio;

const App: React.FC = () => {
  const [role, setRole] = useState<UserRole>(UserRole.IDLE);
  const [isActive, setIsActive] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource>(AudioSource.MIC);
  const [targetLang, setTargetLang] = useState('es-MX');
  const [voiceType, setVoiceType] = useState<VoiceType>(VoiceType.FEMALE);
  const [transcripts, setTranscripts] = useState<TranscriptionItem[]>([]);
  const [translations, setTranslations] = useState<TranslationItem[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>('Guest Speaker');
  const [dbStatus, setDbStatus] = useState<'connected' | 'error' | 'authenticating'>('authenticating');
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionManagerRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);
  
  const currentUtteranceIdRef = useRef<string>(crypto.randomUUID());
  const syncTimeoutRef = useRef<number | null>(null);
  const activeTtsCountRef = useRef<number>(0);

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
        setNeedsApiKey(!hasKey);
      }
    };
    checkKey();
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

  const handleOpenKeyDialog = async () => {
    if (aiStudio && typeof aiStudio.openSelectKey === 'function') {
      await aiStudio.openSelectKey();
      setNeedsApiKey(false);
    }
  };

  const processTranscriptItem = useCallback(async (item: any, playAudio: boolean = true) => {
    if (!item || !item.text) return;

    setTranscripts(prev => {
      const idx = prev.findIndex(t => t.id === item.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], text: item.text, isFinal: true };
        return updated;
      }
      return [...prev, { id: item.id, text: item.text, isFinal: true, speaker: item.sender }];
    });

    try {
      const translated = await gemini.translate(item.text, 'auto', targetLang);
      const transId = crypto.randomUUID();
      
      setTranslations(prev => [...prev, { 
        id: transId, 
        transcriptId: item.id, 
        text: translated, 
        lang: targetLang.toUpperCase() 
      }]);

      if (playAudio && outputAudioContextRef.current) {
        const audioData = await gemini.generateSpeech(translated, voiceType);
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
            if (activeTtsCountRef.current <= 0) {
              activeTtsCountRef.current = 0;
              setIsTtsPlaying(false);
            }
          };

          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += buffer.duration;
        }
      }
    } catch (err) {
      console.error("Transcript Processing Error:", err);
    }
  }, [targetLang, voiceType]);

  useEffect(() => {
    if (!isActive || role !== UserRole.LISTENER) return;

    const transcriptChannel = supabase
      .channel('public:transcriptions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transcriptions' }, (payload) => {
        processTranscriptItem(payload.new, true);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(transcriptChannel);
    };
  }, [isActive, role, processTranscriptItem]);

  const syncToDatabase = useCallback(async (text: string, isFinal: boolean, speakerNameOverride?: string) => {
    if (!text.trim() || !currentUserId || role !== UserRole.SPEAKER) return;
    const utteranceId = currentUtteranceIdRef.current;

    const performSync = async () => {
      try {
        await saveTranscript({
          id: utteranceId, 
          user_id: currentUserId, 
          room_id: DEFAULT_ROOM, 
          speaker: speakerNameOverride || displayName, 
          text
        });

        if (isFinal) {
          currentUtteranceIdRef.current = crypto.randomUUID();
        }
      } catch (e: any) {
        setLastError(e.message);
      }
    };

    if (syncTimeoutRef.current) window.clearTimeout(syncTimeoutRef.current);
    if (isFinal) {
      performSync();
    } else {
      syncTimeoutRef.current = window.setTimeout(performSync, SYNC_DEBOUNCE_MS);
    }
  }, [role, currentUserId, displayName]);

  const toggleActive = useCallback(async () => {
    if (isActive) {
      setIsActive(false);
      releaseWakeLock();
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      sessionManagerRef.current?.close();
      setAudioLevel(0);
      setTranscripts([]);
      setTranslations([]);
    } else {
      if (role === UserRole.IDLE) return;

      if (aiStudio && typeof aiStudio.hasSelectedApiKey === 'function') {
        const hasKey = await aiStudio.hasSelectedApiKey();
        if (!hasKey) {
          setNeedsApiKey(true);
          return;
        }
      }

      try {
        await requestWakeLock();

        if (role === UserRole.LISTENER) {
          setSessionStatus('connecting');
          const { data, error } = await fetchTranscripts(DEFAULT_ROOM);
          if (error) {
            setLastError("Failed to fetch history: " + error.message);
          } else if (data && data.length > 0) {
            for (const item of data) {
              await processTranscriptItem(item, false); 
            }
          }
          setSessionStatus('connected');
        }

        let stream: MediaStream | null = null;
        if (role === UserRole.SPEAKER) {
          if (audioSource === AudioSource.MIC) {
            stream = await navigator.mediaDevices.getUserMedia({ 
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000
              } 
            });
          } else {
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
                throw new Error("No audio track found. Did you check 'Share audio'?");
              }
            } catch (err: any) {
              if (err.name === 'NotAllowedError') return;
              throw err;
            }
          }
          streamRef.current = stream;
        }
        setIsActive(true);
        
        if (role === UserRole.SPEAKER) {
          const manager = await gemini.connectLive({
            onTranscription: (text, isFinal, speaker) => {
              const uid = currentUtteranceIdRef.current;
              const speakerName = speaker || displayName;
              setTranscripts(prev => {
                const idx = prev.findIndex(t => t.id === uid);
                if (idx > -1) {
                  const updated = [...prev];
                  updated[idx] = { ...updated[idx], text, isFinal, speaker: speakerName };
                  return updated;
                }
                return [...prev, { id: uid, text, isFinal, speaker: speakerName }];
              });
              syncToDatabase(text, isFinal, speakerName);
            },
            onStatusChange: setSessionStatus,
            onError: (e) => setLastError(e.message)
          }, displayName);
          sessionManagerRef.current = manager;

          if (stream) {
            const ctx = audioContextRef.current!;
            if (ctx.state === 'suspended') await ctx.resume();
            const audioTrack = stream.getAudioTracks()[0];
            const audioStream = new MediaStream([audioTrack]);
            const source = ctx.createMediaStreamSource(audioStream);
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const data = e.inputBuffer.getChannelData(0);
              if (activeTtsCountRef.current > 0) {
                setAudioLevel(0);
                return; 
              }
              let rms = 0;
              for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
              const level = Math.sqrt(rms / data.length);
              setAudioLevel(Math.min(level * 5, 1));
              sessionManagerRef.current?.processAudio(data);
            };
            source.connect(processor);
            processor.connect(ctx.destination);
          }
        }
      } catch (err: any) {
        setLastError(err.message);
        setIsActive(false);
        releaseWakeLock();
      }
    }
  }, [isActive, role, audioSource, displayName, syncToDatabase, processTranscriptItem]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-950 text-slate-100 overflow-x-hidden relative font-inter">
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[60%] h-[60%] bg-indigo-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 right-1/4 w-[60%] h-[60%] bg-emerald-600/10 blur-[120px] rounded-full" />
      </div>

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

      {needsApiKey && (
        <div className="fixed inset-0 z-[110] bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-white/10 rounded-[2.5rem] p-10 text-center shadow-2xl animate-in zoom-in duration-300">
            <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-indigo-500/20">
              <Key className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tight mb-4">API Key Required</h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-8 font-medium">
              To use real-time transcription, you must select a paid Google Cloud project. 
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-indigo-400 hover:underline block mt-2">Learn about billing</a>
            </p>
            <button 
              onClick={handleOpenKeyDialog}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 rounded-2xl transition-all shadow-lg active:scale-95 uppercase tracking-widest text-sm"
            >
              Select API Key
            </button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-slate-950/80 backdrop-blur-md">
        <div className="w-full px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase tracking-widest leading-none">TTR <span className="text-indigo-500">/</span> Realtime</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">{displayName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge 
              status={sessionStatus} 
              icon={role === UserRole.SPEAKER ? Wifi : CloudLightning} 
              label={role === UserRole.SPEAKER ? `STT: ${sessionStatus.toUpperCase()}` : `STREAM: ${sessionStatus.toUpperCase()}`} 
              active={sessionStatus === 'connected'} 
            />
            <StatusBadge status={dbStatus} icon={Database} label="DATABASE" active={dbStatus === 'connected'} error={dbStatus === 'error'} />
            {role === UserRole.SPEAKER && isActive && (
               <div className="flex items-center gap-3 px-3 py-1 rounded-lg border border-indigo-500/20 text-indigo-400 bg-indigo-500/5 text-[10px] font-black tracking-widest overflow-hidden relative">
                 {isTtsPlaying ? (
                   <div className="flex items-center gap-2 text-indigo-400 animate-in fade-in duration-300">
                     <VolumeX className="w-3.5 h-3.5" />
                     <span>MIC AUTO-MUTED (TTS)</span>
                   </div>
                 ) : (
                   <div className="flex items-center gap-3 relative z-10 animate-in fade-in duration-300">
                     <div className="flex items-center gap-2">
                       <Mic2 className="w-3.5 h-3.5" />
                       <span>{audioSource === AudioSource.MIC ? 'MIC ACTIVE' : 'TAB/SYSTEM ACTIVE'}</span>
                     </div>
                     <AudioLevelMeter level={audioLevel} />
                   </div>
                 )}
               </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full px-4 py-6 md:py-8 max-w-full overflow-hidden">
        <div className={`w-full h-full flex flex-col md:flex-row gap-4 min-h-[calc(100vh-280px)]`}>
          <div className={`flex-1 transition-all duration-700 ${role === UserRole.SPEAKER ? 'w-full' : 'w-full md:w-1/2'}`}>
            <LiveCaptions 
              title={role === UserRole.SPEAKER ? "My Transcription (Broadcasting)" : "Original Transcription"} 
              transcripts={transcripts} 
              translations={[]} 
              type="source" 
            />
          </div>
          
          {role === UserRole.LISTENER && (
            <div className="flex-1 w-full md:w-1/2 animate-in slide-in-from-right duration-700">
              <LiveCaptions title="My Translation (Read Aloud)" transcripts={[]} translations={translations} type="target" />
            </div>
          )}
        </div>
        <div className="h-44 shrink-0 w-full" />
      </main>

      <SessionControls 
        role={role} isActive={isActive} onToggleRole={setRole} onToggleActive={toggleActive}
        targetLang={targetLang} onTargetLangChange={setTargetLang} 
        audioSource={audioSource} onAudioSourceChange={setAudioSource}
        voiceType={voiceType} onVoiceTypeChange={setVoiceType}
      />
    </div>
  );
};

const AudioLevelMeter = ({ level }: { level: number }) => {
  const segments = 8;
  const activeSegments = Math.ceil(level * segments);
  
  return (
    <div className="flex items-center gap-0.5 h-3">
      {Array.from({ length: segments }).map((_, i) => (
        <div 
          key={i} 
          className={`w-1 rounded-full transition-all duration-75 ${
            i < activeSegments 
              ? (i > 6 ? 'bg-rose-500 h-3' : i > 4 ? 'bg-amber-400 h-2.5' : 'bg-emerald-500 h-2') 
              : 'bg-white/10 h-1.5'
          }`} 
        />
      ))}
    </div>
  );
};

const StatusBadge = ({ icon: Icon, label, active, error }: any) => (
  <div className={`flex items-center gap-2 px-3 py-1 rounded-lg border text-[10px] font-black tracking-widest transition-colors ${
    error ? 'border-rose-500/40 text-rose-400 bg-rose-500/5' :
    active ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5' : 'border-white/10 text-slate-500 bg-white/5'
  }`}>
    <Icon className="w-3.5 h-3.5" />
    <span>{label}</span>
  </div>
);

export default App;
