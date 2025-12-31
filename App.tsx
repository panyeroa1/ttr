import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserRole, AudioSource, TranscriptionItem, TranslationItem } from './types';
import { gemini, encode, decode, decodeAudioData, SessionStatus } from './services/geminiService';
import { supabase, saveTranscript, saveTranslation } from './lib/supabase';
import SessionControls from './components/SessionControls';
import LiveCaptions from './components/LiveCaptions';
import { Sparkles, Activity, Database, AlertCircle, X, Wifi, RefreshCw, CloudLightning } from 'lucide-react';

// VAD Constants
const SILENCE_THRESHOLD_RMS = 0.005; 
const SYNC_DEBOUNCE_MS = 250;

const App: React.FC = () => {
  const [role, setRole] = useState<UserRole>(UserRole.IDLE);
  const [isActive, setIsActive] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource>(AudioSource.MIC);
  const [targetLang, setTargetLang] = useState('es-MX');
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
  
  const currentUtteranceIdRef = useRef<string>(crypto.randomUUID());
  const syncTimeoutRef = useRef<number | null>(null);

  // Initialize Auth
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

  // Initialize Audio Contexts
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    return () => {
      audioContextRef.current?.close();
      outputAudioContextRef.current?.close();
    };
  }, []);

  // Real-time Supabase Subscription for Listeners
  useEffect(() => {
    if (!isActive || role !== UserRole.LISTENER) return;

    console.log("Subscribing to Supabase Real-time for language:", targetLang);

    const transcriptChannel = supabase
      .channel('public:transcriptions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transcriptions' }, (payload) => {
        const item = payload.new as any;
        setTranscripts(prev => {
          const idx = prev.findIndex(t => t.id === item.id);
          if (idx > -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], text: item.text, isFinal: true };
            return updated;
          }
          return [...prev, { id: item.id, text: item.text, isFinal: true, speaker: item.sender }];
        });
      })
      .subscribe();

    const translationChannel = supabase
      .channel('public:translations')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'translations',
          filter: `target_lang=eq.${targetLang}`
        }, 
        async (payload) => {
          const item = payload.new as any;
          if (!item.translated_text) return;

          setTranslations(prev => {
            const idx = prev.findIndex(t => t.id === item.id);
            if (idx > -1) return prev;
            return [...prev, { 
              id: item.id, 
              transcriptId: item.transcript_id || '', 
              text: item.translated_text, 
              lang: item.target_lang.toUpperCase() 
            }];
          });

          // Trigger TTS for Listener
          if (outputAudioContextRef.current) {
            try {
              const audioData = await gemini.generateSpeech(item.translated_text);
              if (audioData) {
                const ctx = outputAudioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += buffer.duration;
              }
            } catch (e) {
              console.error("TTS Error:", e);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(transcriptChannel);
      supabase.removeChannel(translationChannel);
    };
  }, [isActive, role, targetLang]);

  // DB Sync Logic (Speaker side)
  const syncToDatabase = useCallback(async (text: string, isFinal: boolean) => {
    if (!text.trim() || !currentUserId || role !== UserRole.SPEAKER) return;
    const utteranceId = currentUtteranceIdRef.current;

    const performSync = async () => {
      try {
        await saveTranscript({
          id: utteranceId, user_id: currentUserId, room_id: 'default-room', speaker: 'SPEAKER_1', text
        });

        if (isFinal) {
          // Speaker generates translation to store it for everyone
          const translated = await gemini.translate(text, 'English', targetLang);
          const transId = crypto.randomUUID();
          await saveTranslation({
            id: transId, user_id: currentUserId, source_lang: 'English', target_lang: targetLang, original_text: text, translated_text: translated
          });

          // Speaker updates their own view locally for immediate feedback
          setTranslations(prev => [...prev, { id: transId, transcriptId: utteranceId, text: translated, lang: targetLang.toUpperCase() }]);
          
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
  }, [targetLang, role, currentUserId]);

  const toggleActive = useCallback(async () => {
    if (isActive) {
      setIsActive(false);
      streamRef.current?.getTracks().forEach(t => t.stop());
      sessionManagerRef.current?.close();
      setAudioLevel(0);
      setTranscripts([]);
      setTranslations([]);
    } else {
      if (role === UserRole.IDLE) return;
      try {
        let stream: MediaStream | null = null;
        if (role === UserRole.SPEAKER) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
        }
        setIsActive(true);
        
        const manager = await gemini.connectLive({
          onTranscription: (text, isFinal) => {
            // Speaker handles local state update and DB push
            if (role === UserRole.SPEAKER) {
              const uid = currentUtteranceIdRef.current;
              setTranscripts(prev => {
                const idx = prev.findIndex(t => t.id === uid);
                if (idx > -1) {
                  const updated = [...prev];
                  updated[idx] = { ...updated[idx], text, isFinal };
                  return updated;
                }
                return [...prev, { id: uid, text, isFinal, speaker: 'SOURCE' }];
              });
              syncToDatabase(text, isFinal);
            }
          },
          onStatusChange: setSessionStatus
        });
        sessionManagerRef.current = manager;

        if (role === UserRole.SPEAKER && stream) {
          const ctx = audioContextRef.current!;
          if (ctx.state === 'suspended') await ctx.resume();
          const source = ctx.createMediaStreamSource(stream);
          const processor = ctx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            const data = e.inputBuffer.getChannelData(0);
            let rms = 0;
            for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
            const currentLevel = Math.sqrt(rms / data.length);
            setAudioLevel(currentLevel);

            if (currentLevel > SILENCE_THRESHOLD_RMS) {
              const int16 = new Int16Array(data.length);
              for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
              sessionManagerRef.current?.sendRealtimeInput({
                media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' }
              });
            }
          };
          source.connect(processor);
          processor.connect(ctx.destination);
        }
      } catch (err: any) {
        setLastError(err.message);
        setIsActive(false);
      }
    }
  }, [isActive, role, syncToDatabase]);

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

      <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-slate-950/80 backdrop-blur-md flex justify-center">
        <div className="max-w-7xl w-full px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20"><Sparkles className="w-5 h-5 text-white" /></div>
            <h1 className="text-xl font-black tracking-tighter">TTR <span className="text-indigo-500">/</span> REALTIME</h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={sessionStatus} icon={sessionStatus === 'connected' ? Wifi : RefreshCw} label={sessionStatus.toUpperCase()} active={sessionStatus === 'connected'} />
            <StatusBadge status={dbStatus} icon={Database} label={role === UserRole.LISTENER ? 'LIVE SYNC' : 'DB SYNC'} active={dbStatus === 'connected'} error={dbStatus === 'error'} />
            {role === UserRole.LISTENER && isActive && (
               <div className="flex items-center gap-2 px-3 py-1 rounded-lg border border-indigo-500/20 text-indigo-400 bg-indigo-500/5 text-[10px] font-black tracking-widest">
                 <CloudLightning className="w-3.5 h-3.5 animate-pulse" />
                 <span>SUBSCRIBED</span>
               </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center w-full px-6 py-6 md:py-10 max-w-7xl mx-auto">
        <div className="w-full flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 h-full min-h-0">
          <LiveCaptions title="Transcript" transcripts={transcripts} translations={[]} type="source" />
          <LiveCaptions title="Translation" transcripts={[]} translations={translations} type="target" />
        </div>
        <div className="h-40 shrink-0 w-full" />
      </main>

      <SessionControls 
        role={role} isActive={isActive} onToggleRole={setRole} onToggleActive={toggleActive}
        targetLang={targetLang} onTargetLangChange={setTargetLang} audioSource={audioSource} onAudioSourceChange={setAudioSource}
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