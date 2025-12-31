
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserRole, AudioSource, TranscriptionItem, TranslationItem } from './types';
import { gemini, encode, decode, decodeAudioData } from './services/geminiService';
import { saveTranscript, saveTranslation } from './lib/supabase';
import SessionControls from './components/SessionControls';
import LiveCaptions from './components/LiveCaptions';
import { Sparkles, ShieldCheck, Activity, Waveform } from 'lucide-react';

const GUEST_USER_ID = '00000000-0000-0000-0000-000000000000';
const VAD_THRESHOLD = 0.01; // Sensitivity threshold (0.0 to 1.0)
const VAD_SILENCE_TIMEOUT = 1500; // ms of silence before forced turn completion (hint)

const App: React.FC = () => {
  const [role, setRole] = useState<UserRole>(UserRole.IDLE);
  const [isActive, setIsActive] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource>(AudioSource.MIC);
  const [targetLang, setTargetLang] = useState('es-MX');
  const [transcripts, setTranscripts] = useState<TranscriptionItem[]>([]);
  const [translations, setTranslations] = useState<TranslationItem[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const lastActiveTimeRef = useRef<number>(Date.now());

  // Initialize Audio Contexts
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
    if (!text.trim()) return;
    
    try {
      // 1. Save to DB
      await saveTranscript({
        user_id: GUEST_USER_ID,
        room_id: 'default-room',
        speaker: 'SPEAKER_1',
        text: text
      });

      // 2. Translate
      const translatedText = await gemini.translate(text, 'English', targetLang);
      
      // 3. Save Translation
      await saveTranslation({
        user_id: GUEST_USER_ID,
        source_lang: 'English',
        target_lang: targetLang,
        original_text: text,
        translated_text: translatedText
      });

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
    } catch (error) {
      console.error('Worker error:', error);
    }
  }, [targetLang, role]);

  // Handle Session Start/Stop
  const toggleActive = useCallback(async () => {
    if (isActive) {
      // STOP
      setIsActive(false);
      streamRef.current?.getTracks().forEach(track => track.stop());
      sessionRef.current = null;
      setAudioLevel(0);
    } else {
      // START
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
            
            // --- VAD Logic ---
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) {
              sum += inputData[i] * inputData[i];
            }
            const rms = Math.sqrt(sum / inputData.length);
            setAudioLevel(rms); // Update level meter

            if (rms > VAD_THRESHOLD) {
              lastActiveTimeRef.current = Date.now();
            }
            // -----------------

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
      } catch (err) {
        console.error("Failed to start session:", err);
        setIsActive(false);
      }
    }
  }, [isActive, role, audioSource, processFinalTranscript]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-950 font-inter">
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-indigo-600/5 blur-[160px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-emerald-600/5 blur-[160px] rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_center,rgba(30,41,59,0.2)_0%,rgba(15,23,42,1)_100%)]" />
      </div>

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
                 <Activity className={`w-3.5 h-3.5 ${audioLevel > VAD_THRESHOLD ? 'text-emerald-400 animate-pulse' : 'text-slate-600'}`} />
                 <div className="w-24 h-1.5 bg-slate-700 rounded-full overflow-hidden flex items-center">
                    <div 
                      className={`h-full transition-all duration-75 ${audioLevel > VAD_THRESHOLD ? 'bg-emerald-500' : 'bg-slate-500'}`} 
                      style={{ width: `${Math.min(audioLevel * 500, 100)}%` }}
                    />
                 </div>
                 <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    {audioLevel > VAD_THRESHOLD ? 'SPEAKING' : 'SILENT'}
                 </span>
               </div>
             )}
             <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 border border-slate-700/50 rounded-lg shadow-sm">
               <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
               <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">ENCRYPTED</span>
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
