
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserRole, AudioSource, TranscriptionItem, TranslationItem } from './types';
import { gemini, encode, decode, decodeAudioData } from './services/geminiService';
import { supabase, saveTranscript, saveTranslation } from './lib/supabase';
import SessionControls from './components/SessionControls';
import LiveCaptions from './components/LiveCaptions';
import { Sparkles, ShieldCheck, Activity, Database, AlertCircle, X, Copy, CheckCircle2 } from 'lucide-react';

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
  const [lastError, setLastError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);

  const SQL_FIX = `-- Run this in Supabase SQL Editor to fix RLS errors:
ALTER TABLE public.transcriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.translations DISABLE ROW LEVEL SECURITY;

-- OR use specific policies:
CREATE POLICY "Allow public insert" ON "public"."transcriptions" FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow public insert" ON "public"."translations" FOR INSERT TO anon, authenticated WITH CHECK (true);`;

  const copyFix = () => {
    navigator.clipboard.writeText(SQL_FIX);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 1. Initialize Auth
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
        console.error("Auth initialization failed:", err);
        setDbStatus('error');
        setLastError(err.message || "Authentication Failed");
      }
    };
    initAuth();
  }, []);

  // 2. Initialize Audio Contexts
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    return () => {
      audioContextRef.current?.close();
      outputAudioContextRef.current?.close();
    };
  }, []);

  // Worker: Translation and TTS
  const processFinalTranscript = useCallback(async (text: string, id: string) => {
    if (!text.trim() || !currentUserId) return;
    
    try {
      // 1. Save to DB
      const transcriptRes = await saveTranscript({
        user_id: currentUserId,
        room_id: 'default-room',
        speaker: 'SPEAKER_1',
        text: text
      });

      if (transcriptRes.error) {
        setDbStatus('error');
        setLastError(`Database RLS Policy Violation: The database rejected your transcript. You must enable access policies in Supabase.`);
        return; 
      }

      // 2. Translate
      const translatedText = await gemini.translate(text, 'English', targetLang);
      
      // 3. Save Translation
      const translationRes = await saveTranslation({
        user_id: currentUserId,
        source_lang: 'English',
        target_lang: targetLang,
        original_text: text,
        translated_text: translatedText
      });

      if (translationRes.error) {
        setDbStatus('error');
        setLastError(`Translation Save Failed: ${translationRes.error.message}`);
      }

      // 4. Update UI
      setTranslations(prev => [...prev, {
        id: Math.random().toString(36),
        transcriptId: id,
        text: translatedText,
        lang: targetLang.toUpperCase()
      }]);

      // 5. If Listening, trigger TTS
      if (role === UserRole.LISTENER) {
        const base64Audio = await gemini.generateSpeech(translatedText);
        if (base64Audio && outputAudioContextRef.current) {
          const ctx = outputAudioContextRef.current;
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
          
          const audioBuffer = await decodeAudioData(
            decode(base64Audio),
            ctx,
            24000,
            1
          );
          
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += audioBuffer.duration;
        }
      }
    } catch (error: any) {
      console.error('Worker error:', error);
      setLastError(error.message);
    }
  }, [targetLang, role, currentUserId]);

  // Handle Session Start/Stop
  const toggleActive = useCallback(async () => {
    if (isActive) {
      setIsActive(false);
      streamRef.current?.getTracks().forEach(track => track.stop());
      sessionRef.current = null;
      setAudioLevel(0);
    } else {
      if (role === UserRole.IDLE) {
        alert("Please select a role (Speak or Listen) first.");
        return;
      }
      
      try {
        let stream: MediaStream;
        
        if (role === UserRole.SPEAKER) {
          if (audioSource === AudioSource.MIC) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } else {
            stream = await (navigator.mediaDevices as any).getDisplayMedia({ 
              video: { width: 1, height: 1 }, 
              audio: true 
            });
            stream.getVideoTracks().forEach(t => t.stop());
            if (stream.getAudioTracks().length === 0) {
              stream.getTracks().forEach(t => t.stop());
              alert("No audio track was shared.");
              return;
            }
          }
          
          streamRef.current = stream;
          setIsActive(true);

          const sessionPromise = gemini.connectLive({
            onTranscription: (text, isFinal) => {
              const currentId = 'temp-id-1';
              setTranscripts(prev => {
                const existingIdx = prev.findIndex(t => t.id === currentId && !t.isFinal);
                if (existingIdx > -1) {
                  const updated = [...prev];
                  updated[existingIdx] = { ...updated[existingIdx], text, isFinal };
                  return updated;
                }
                return [...prev, { 
                  id: isFinal ? Math.random().toString(36) : currentId, 
                  text, 
                  isFinal, 
                  speaker: 'SOURCE' 
                }];
              });

              if (isFinal) {
                processFinalTranscript(text, currentId);
              }
            },
            onError: (err) => {
              console.error("Live session error:", err);
              setIsActive(false);
            }
          });

          sessionRef.current = sessionPromise;

          const ctx = audioContextRef.current!;
          if (ctx.state === 'suspended') await ctx.resume();
          
          const sourceNode = ctx.createMediaStreamSource(stream);
          const scriptProcessor = ctx.createScriptProcessor(4096, 1, 1);
          
          scriptProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) {
              sum += inputData[i] * inputData[i];
            }
            const rms = Math.sqrt(sum / inputData.length);
            setAudioLevel(rms);

            const l = inputData.length;
            const int16 = new Int16Array(l);
            for (let i = 0; i < l; i++) {
              int16[i] = inputData[i] * 32768;
            }
            const pcmBlob = {
              data: encode(new Uint8Array(int16.buffer)),
              mimeType: 'audio/pcm;rate=16000'
            };
            
            sessionRef.current?.then((session: any) => {
              session.sendRealtimeInput({ media: pcmBlob });
            });
          };

          sourceNode.connect(scriptProcessor);
          scriptProcessor.connect(ctx.destination);
          
          stream.getTracks().forEach(track => {
            track.onended = () => { if (isActive) toggleActive(); };
          });
        } else {
          setIsActive(true);
        }
      } catch (err: any) {
        console.error("Failed to start session:", err);
        setLastError(err.message);
        setIsActive(false);
      }
    }
  }, [isActive, role, audioSource, processFinalTranscript]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-950 font-inter">
      {/* Background Decor */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-indigo-600/5 blur-[160px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-emerald-600/5 blur-[160px] rounded-full" />
      </div>

      {/* Enhanced RLS Error Alert */}
      {lastError && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-2xl px-4 animate-in slide-in-from-top duration-300">
          <div className="bg-rose-500/10 border border-rose-500/50 backdrop-blur-2xl p-6 rounded-3xl flex items-start gap-5 shadow-2xl">
            <div className="p-3 bg-rose-500/20 rounded-2xl">
              <AlertCircle className="w-6 h-6 text-rose-500 shrink-0" />
            </div>
            <div className="flex-1">
              <h4 className="text-rose-400 font-black text-sm uppercase tracking-[0.2em] mb-2">Supabase Constraint Blocked</h4>
              <p className="text-rose-100/90 text-sm leading-relaxed mb-4">{lastError}</p>
              
              <div className="flex flex-wrap gap-3">
                <button 
                  onClick={copyFix}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black transition-all shadow-lg active:scale-95"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'SQL COPIED!' : 'COPY SQL FIX'}</span>
                </button>
                <div className="px-4 py-2 bg-slate-900/50 text-rose-400/80 rounded-xl text-[10px] font-bold border border-rose-500/20">
                  Paste in Supabase SQL Editor
                </div>
              </div>
            </div>
            <button onClick={() => setLastError(null)} className="text-rose-500/50 hover:text-rose-400 p-1 transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center border-b border-slate-800/50 bg-slate-900/30 backdrop-blur-md shrink-0">
        <header className="max-w-[1600px] w-full px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20 ring-1 ring-indigo-400/50">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter text-white flex items-center gap-2">
                TTR <span className="text-indigo-400 font-medium">/</span> REALTIME
              </h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">STT & Translation Hub</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
             {isActive && role === UserRole.SPEAKER && (
               <div className="flex items-center gap-3 px-4 py-1.5 bg-slate-800/80 border border-slate-700/50 rounded-lg shadow-sm">
                 <Activity className={`w-3.5 h-3.5 ${audioLevel > 0.01 ? 'text-emerald-400 animate-pulse' : 'text-slate-600'}`} />
                 <div className="w-24 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-75 ${audioLevel > 0.01 ? 'bg-emerald-500' : 'bg-slate-500'}`} 
                      style={{ width: `${Math.min(audioLevel * 500, 100)}%` }}
                    />
                 </div>
               </div>
             )}
             
             {/* Database Status Indicator */}
             <button 
              onClick={() => lastError ? setLastError(lastError) : null}
              className={`flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 border rounded-lg shadow-sm transition-all hover:brightness-110 ${dbStatus === 'error' ? 'border-rose-500/50 cursor-pointer' : 'border-slate-700/50 cursor-default'}`}
             >
               <Database className={`w-3.5 h-3.5 ${dbStatus === 'error' ? 'text-rose-500' : dbStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`} />
               <span className={`text-[10px] font-black uppercase tracking-widest ${dbStatus === 'error' ? 'text-rose-400' : 'text-slate-300'}`}>
                {dbStatus === 'error' ? 'RLS POLICY ERROR' : dbStatus === 'connected' ? 'DB LINKED' : 'SYNCING...'}
               </span>
             </button>

             <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 border border-slate-700/50 rounded-lg shadow-sm">
               <ShieldCheck className={`w-3.5 h-3.5 ${currentUserId ? 'text-emerald-400' : 'text-slate-500'}`} />
               <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
                {currentUserId ? 'AUTHENTICATED' : 'ANONYMOUS'}
               </span>
             </div>
          </div>
        </header>
      </div>

      <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-0 w-full overflow-hidden">
        <div className="max-w-[1600px] w-full h-full flex flex-col items-center justify-center">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full h-full max-h-[85vh]">
            <LiveCaptions 
              title="Original Audio Transcript" 
              transcripts={transcripts} 
              translations={[]}
              type="source"
            />
            <LiveCaptions 
              title="Real-time Translation" 
              transcripts={[]} 
              translations={translations}
              type="target"
            />
          </div>
        </div>
        <div className="h-32 shrink-0 w-full" />
      </main>

      <SessionControls 
        role={role}
        isActive={isActive}
        onToggleRole={setRole}
        onToggleActive={toggleActive}
        targetLang={targetLang}
        onTargetLangChange={setTargetLang}
        audioSource={audioSource}
        onAudioSourceChange={setAudioSource}
      />
    </div>
  );
};

export default App;
