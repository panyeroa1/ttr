
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserRole, AudioSource, TranscriptionItem, TranslationItem, VoiceType } from './types';
import { gemini, decode, decodeAudioData, SessionStatus } from './services/geminiService';
import { supabase, saveTranscript, fetchTranscripts } from './lib/supabase';
import SessionControls from './components/SessionControls';
import LiveCaptions from './components/LiveCaptions';
import { Sparkles, Database, AlertCircle, X, Wifi, CloudLightning, Mic2 } from 'lucide-react';

const SYNC_DEBOUNCE_MS = 250;
const DEFAULT_ROOM = 'default-room';

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
  const [dbStatus, setDbStatus] = useState<'connected' | 'error' | 'authenticating'>('authenticating');
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionManagerRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);
  
  const currentUtteranceIdRef = useRef<string>(crypto.randomUUID());
  const syncTimeoutRef = useRef<number | null>(null);

  // Background Resilience: Wake Lock
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.debug("Wake Lock acquired.");
      } catch (err: any) {
        console.warn(`Wake Lock Error: ${err.message}`);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().then(() => {
        wakeLockRef.current = null;
        console.debug("Wake Lock released.");
      });
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setCurrentUserId(session.user.id);
          setDbStatus('connected');
        } else {
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error) throw error;
          if (data.user) {
            setCurrentUserId(data.user.id);
            setDbStatus('connected');
          }
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

  // Function to process a single transcript: translate and display
  const processTranscriptItem = useCallback(async (item: any, playAudio: boolean = true) => {
    if (!item || !item.text) return;

    // 1. Update Transcripts state
    setTranscripts(prev => {
      const idx = prev.findIndex(t => t.id === item.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], text: item.text, isFinal: true };
        return updated;
      }
      return [...prev, { id: item.id, text: item.text, isFinal: true, speaker: item.sender }];
    });

    // 2. Translate
    try {
      const translated = await gemini.translate(item.text, 'auto', targetLang);
      const transId = crypto.randomUUID();
      
      setTranslations(prev => [...prev, { 
        id: transId, 
        transcriptId: item.id, 
        text: translated, 
        lang: targetLang.toUpperCase() 
      }]);

      // 3. Audio Out (TTS)
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
          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += buffer.duration;
        }
      }
    } catch (err) {
      console.error("Transcript Processing Error:", err);
    }
  }, [targetLang, voiceType]);

  // Listener Logic: Real-time Subscription
  useEffect(() => {
    if (!isActive || role !== UserRole.LISTENER) return;

    const transcriptChannel = supabase
      .channel('public:transcriptions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transcriptions' }, (payload) => {
        // Only process new/updated final rows in real-time
        processTranscriptItem(payload.new, true);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(transcriptChannel);
    };
  }, [isActive, role, processTranscriptItem]);

  const syncToDatabase = useCallback(async (text: string, isFinal: boolean) => {
    if (!text.trim() || !currentUserId || role !== UserRole.SPEAKER) return;
    const utteranceId = currentUtteranceIdRef.current;

    const performSync = async () => {
      try {
        await saveTranscript({
          id: utteranceId, 
          user_id: currentUserId, 
          room_id: DEFAULT_ROOM, 
          speaker: 'HOST_SPEAKER', 
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
  }, [role, currentUserId]);

  const toggleActive = useCallback(async () => {
    if (isActive) {
      setIsActive(false);
      releaseWakeLock();
      streamRef.current?.getTracks().forEach(t => t.stop());
      sessionManagerRef.current?.close();
      setAudioLevel(0);
      setTranscripts([]);
      setTranslations([]);
    } else {
      if (role === UserRole.IDLE) return;
      try {
        await requestWakeLock();

        // hydration step: if listener, fetch existing history
        if (role === UserRole.LISTENER) {
          setSessionStatus('connecting');
          const { data, error } = await fetchTranscripts(DEFAULT_ROOM);
          if (error) {
            setLastError("Failed to fetch history: " + error.message);
          } else if (data && data.length > 0) {
            // Load historical transcripts into UI
            // We don't play historical audio to avoid noise, but we translate them
            for (const item of data) {
              await processTranscriptItem(item, false); 
            }
          }
          setSessionStatus('connected');
        }

        let stream: MediaStream | null = null;
        if (role === UserRole.SPEAKER) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
        }
        setIsActive(true);
        
        if (role === UserRole.SPEAKER) {
          const manager = await gemini.connectLive({
            onTranscription: (text, isFinal) => {
              const uid = currentUtteranceIdRef.current;
              setTranscripts(prev => {
                const idx = prev.findIndex(t => t.id === uid);
                if (idx > -1) {
                  const updated = [...prev];
                  updated[idx] = { ...updated[idx], text, isFinal };
                  return updated;
                }
                return [...prev, { id: uid, text, isFinal, speaker: 'ME (SPEAKER)' }];
              });
              syncToDatabase(text, isFinal);
            },
            onStatusChange: setSessionStatus
          });
          sessionManagerRef.current = manager;

          if (stream) {
            const ctx = audioContextRef.current!;
            if (ctx.state === 'suspended') await ctx.resume();
            const source = ctx.createMediaStreamSource(stream);
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const data = e.inputBuffer.getChannelData(0);
              let rms = 0;
              for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
              setAudioLevel(Math.sqrt(rms / data.length));
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
  }, [isActive, role, syncToDatabase, processTranscriptItem]);

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

      <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-slate-950/80 backdrop-blur-md">
        <div className="w-full px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-black tracking-tighter uppercase tracking-widest">TTR <span className="text-indigo-500">/</span> Realtime</h1>
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
               <div className="flex items-center gap-2 px-3 py-1 rounded-lg border border-rose-500/20 text-rose-400 bg-rose-500/5 text-[10px] font-black tracking-widest">
                 <Mic2 className="w-3.5 h-3.5 animate-pulse" />
                 <span>MIC ACTIVE</span>
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
