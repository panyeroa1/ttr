import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserRole, AudioSource, TranscriptionItem, TranslationItem, VoiceName, STTEngine, TranslationEngine, TTSEngine } from './types';
import { gemini, decode, decodeAudioData, SessionStatus, isDailyQuotaReached } from './services/geminiService';
import { supabase, saveTranscript, saveTranslation, fetchTranscripts, getUserProfile } from './lib/supabase';
import SessionControls from './components/SessionControls';
import LiveCaptions from './components/LiveCaptions';
import SubtitlesOverlay from './components/SubtitlesOverlay';
import { Sparkles, Database, AlertCircle, X, Wifi, CloudLightning, Mic2, VolumeX, Settings, Server, Globe, Cpu, Subtitles as SubtitlesIcon, Info, LayoutDashboard, SlidersHorizontal, MessageSquare, Volume2, AudioWaveform, UserCircle, Monitor } from 'lucide-react';

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
  const [usingFallbackTTS, setUsingFallbackTTS] = useState(false);

  // Engines
  const [sttProvider, setSttProvider] = useState<STTEngine>(STTEngine.GEMINI);
  const [translationProvider, setTranslationProvider] = useState<TranslationEngine>(TranslationEngine.GEMINI);
  const [ttsProvider, setTtsProvider] = useState<TTSEngine>(TTSEngine.GEMINI);

  // API Keys & Voice IDs
  const [deepgramKey, setDeepgramKey] = useState('');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState('21m00Tcm4TlvDq8ikWAM');
  const [cartesiaKey, setCartesiaKey] = useState('');
  const [cartesiaVoiceId, setCartesiaVoiceId] = useState('79a125e8-cd45-4c13-8a67-01224ca5850b');
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

  // Sequential processing queue to ensure strictly chronological turn handling for AUDIO
  const processingQueueRef = useRef<Promise<void>>(Promise.resolve());

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
   * Browser Native TTS fallback using Web Speech API
   */
  const speakWithBrowserNative = (text: string, lang: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        console.warn("Browser does not support Speech Synthesis");
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      
      utterance.onstart = () => {
        setIsTtsPlaying(true);
        activeTtsCountRef.current++;
      };
      
      utterance.onend = () => {
        activeTtsCountRef.current--;
        if (activeTtsCountRef.current <= 0) setIsTtsPlaying(false);
        resolve();
      };

      utterance.onerror = (e) => {
        console.error("Browser Native TTS Error:", e);
        activeTtsCountRef.current--;
        if (activeTtsCountRef.current <= 0) setIsTtsPlaying(false);
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  };

  const segmentIntoSentences = (text: string, isFinal: boolean) => {
    const abbreviations = [
      'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'St', 'Co', 'Inc', 'Ltd', 
      'vs', 'approx', 'min', 'max', 'dept', 'univ', 'vol', 'ed', 'est', 'etc',
      'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      'U.S', 'U.K', 'E.U', 'B.C', 'A.D', 'p.m', 'a.m', 'i.e', 'e.g', 'c.f',
      'D.C', 'L.A', 'N.Y', 'Ph.D', 'M.D', 'viz', 'cf', 'sq', 'ft', 'lb', 'oz',
      'Corp', 'Gov', 'Rep', 'Sen', 'Rev', 'Hon', 'Capt', 'Col', 'Gen'
    ];
    
    const sentenceRegex = /([.!?\u3002\uff01\uff1f]+|(?:\.\.\.))["'）)\]]*(\s+|$)/g;
    const sentences: string[] = [];
    let match;
    let start = 0;

    while ((match = sentenceRegex.exec(text)) !== null) {
      const punc = match[1];
      const puncEndIndex = match.index + punc.length;
      const fullSegment = text.substring(start, puncEndIndex).trim();
      
      const lastWordMatch = fullSegment.match(/(\S+)(?:[.!?\u3002\uff01\uff1f]+)$/);
      if (lastWordMatch) {
        const lastWord = lastWordMatch[1];
        const isDecimal = /\d$/.test(lastWord) && /^\d/.test(text.substring(puncEndIndex).trim());
        const isAbbrev = abbreviations.some(a => a.toLowerCase() === lastWord.toLowerCase()) || 
                        /^[A-Z]$/.test(lastWord); 
        
        if ((isAbbrev || isDecimal) && !isFinal) {
          continue;
        }
      }

      sentences.push(text.substring(start, match.index + match[0].length).trim());
      start = match.index + match[0].length;
    }

    const remaining = text.substring(start).trim();
    if (isFinal && remaining.length > 0) {
      sentences.push(remaining);
      return { sentences, lastIndex: text.length };
    }

    if (remaining.length > MAX_UNPUNCTUATED_LENGTH) {
      const lastComma = remaining.lastIndexOf(',');
      if (lastComma > remaining.length * 0.6) {
        sentences.push(remaining.substring(0, lastComma + 1).trim());
        return { sentences, lastIndex: start + lastComma + 1 };
      }
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

    // 1. INSTANT UI UPDATE (Non-queued)
    const speakerName = item.sender || displayName;
    setActiveSpeakerName(speakerName);
    
    if (speakerTimeoutRef.current) window.clearTimeout(speakerTimeoutRef.current);
    speakerTimeoutRef.current = window.setTimeout(() => setActiveSpeakerName(null), SPEAKER_TIMEOUT_MS);

    setTranscripts(prev => {
      const idx = prev.findIndex(t => t.id === item.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], text: item.text, isFinal: item.isFinal ?? true, speaker: speakerName };
        return updated;
      }
      return [{ id: item.id, text: item.text, isFinal: item.isFinal ?? true, speaker: speakerName }, ...prev];
    });

    const lastOffset = processedTextOffsetRef.current.get(item.id) || 0;
    const currentText = item.text;
    const newContent = currentText.substring(lastOffset);
    
    if (newContent.trim()) {
      setCurrentSubtitle({ text: newContent.trim(), isFinal: item.isFinal });
    }

    // 2. QUEUED AUDIO GENERATION & TRANSLATION
    if (role !== UserRole.LISTENER) return;
    
    const { sentences, lastIndex } = segmentIntoSentences(newContent, item.isFinal);
    if (sentences.length === 0) return;

    processedTextOffsetRef.current.set(item.id, lastOffset + lastIndex);

    processingQueueRef.current = processingQueueRef.current
      .catch(() => {}) 
      .then(async () => {
        if (isRateLimited || isDailyQuotaReached()) {
           // If we are rate limited on cloud, but playAudio is requested, try browser native directly
           if (playAudio) {
             for (const sentence of sentences) {
               await speakWithBrowserNative(sentence, targetLang);
             }
           }
           return;
        }

        for (const sentence of sentences) {
          console.debug(`[Audio-Queue] Processing: "${sentence}"`);
          try {
            const translated = translationProvider === TranslationEngine.GEMINI 
              ? await gemini.translate(sentence, 'auto', targetLang)
              : await translateViaOllama(sentence, targetLang);

            const transId = crypto.randomUUID();
            
            if (currentUserId) {
              saveTranslation({
                id: transId,
                user_id: currentUserId,
                source_lang: 'auto',
                target_lang: targetLang,
                original_text: sentence,
                translated_text: translated
              });
            }

            setTranslations(prev => [{ 
              id: transId, 
              transcriptId: item.id, 
              text: translated, 
              lang: targetLang.toUpperCase() 
            }, ...prev]);

            if (playAudio) {
              if (ttsProvider === TTSEngine.BROWSER_NATIVE) {
                await speakWithBrowserNative(translated, targetLang);
                continue;
              }

              const ctx = outputAudioContextRef.current;
              if (ctx && ctx.state === 'suspended') await ctx.resume();

              let audioBuffer: AudioBuffer | null = null;
              let attemptFallback = false;

              try {
                if (ttsProvider === TTSEngine.GEMINI) {
                  const audioData = await gemini.generateSpeech(translated, voiceName);
                  if (audioData) {
                    audioBuffer = await decodeAudioData(decode(audioData), ctx!, 24000, 1);
                  } else {
                    attemptFallback = true;
                  }
                } else if (ttsProvider === TTSEngine.ELEVENLABS && elevenLabsKey) {
                  const data = await gemini.generateElevenLabsSpeech(translated, elevenLabsKey, elevenLabsVoiceId);
                  audioBuffer = await ctx!.decodeAudioData(data);
                } else if (ttsProvider === TTSEngine.DEEPGRAM && deepgramTtsKey) {
                  const data = await gemini.generateDeepgramSpeech(translated, deepgramTtsKey);
                  audioBuffer = await ctx!.decodeAudioData(data);
                } else if (ttsProvider === TTSEngine.CARTESIA && cartesiaKey) {
                  const data = await gemini.generateCartesiaSpeech(translated, cartesiaKey, cartesiaVoiceId);
                  audioBuffer = await ctx!.decodeAudioData(data);
                } else {
                  attemptFallback = true;
                }
              } catch (err) {
                console.warn("[TTS] Cloud Provider Failed, falling back to Browser Native:", err);
                attemptFallback = true;
              }

              if (audioBuffer) {
                const lookahead = 0.05;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx!.currentTime + lookahead);
                
                const source = ctx!.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx!.destination);
                
                activeTtsCountRef.current++;
                setIsTtsPlaying(true);
                
                source.onended = () => {
                  activeTtsCountRef.current--;
                  if (activeTtsCountRef.current <= 0) { setIsTtsPlaying(false); }
                };
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
              } else if (attemptFallback) {
                setUsingFallbackTTS(true);
                await speakWithBrowserNative(translated, targetLang);
              }
            }
          } catch (err: any) {
            console.error("[Audio-Queue] Sentence Failure:", err);
            const errorMsg = err?.message || "";
            if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg === "DAILY_QUOTA_REACHED") {
              setIsRateLimited(true);
              setLastError("Cloud API Quota Exceeded. Engaging browser native audio fallback.");
              // Don't wait, just process with native for current batch
              await speakWithBrowserNative(sentence, targetLang);
              setTimeout(() => setIsRateLimited(false), 30000);
            }
          }
        }
      });
  }, [targetLang, voiceName, displayName, translationProvider, ttsProvider, elevenLabsKey, elevenLabsVoiceId, cartesiaKey, cartesiaVoiceId, deepgramTtsKey, ollamaUrl, currentUserId, isRateLimited, role]);

  useEffect(() => {
    if (!isActive || role !== UserRole.LISTENER) return;
    const transcriptChannel = supabase.channel('public:transcriptions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transcriptions' }, (payload) => {
        processTranscriptItem(payload.new, true);
      }).subscribe();
    return () => { supabase.removeChannel(transcriptChannel); };
  }, [isActive, role, processTranscriptItem]);

  const syncToDatabase = useCallback(async (text: string, isFinal: boolean, utteranceId: string, senderOverride?: string) => {
    if (!text.trim() || !currentUserId || role !== UserRole.SPEAKER) return;
    
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
      nextStartTimeRef.current = 0;
      processingQueueRef.current = Promise.resolve();
      setUsingFallbackTTS(false);
    } else {
      if (role === UserRole.IDLE) return;
      try {
        await requestWakeLock();
        
        if (role === UserRole.LISTENER) {
          setSessionStatus('connecting');
          const { data, error } = await fetchTranscripts(DEFAULT_ROOM);
          if (error) throw error;
          if (data) {
            setTranscripts(data);
            data.forEach((item, index) => {
              if (index === 0) {
                processedTextOffsetRef.current.set(item.id, 0);
              } else {
                processedTextOffsetRef.current.set(item.id, item.text.length);
              }
            });
            if (data.length > 0) {
              console.debug("[Init] Autoplaying latest transcription for listener join...");
              processTranscriptItem(data[0], true);
            }
          }
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
                syncToDatabase(text, isFinal, uid, senderName);
                processTranscriptItem({ id: uid, text, sender: senderName, isFinal: isFinal }, false);
                if (isFinal) {
                  currentUtteranceIdRef.current = crypto.randomUUID();
                }
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
              const uid = currentUtteranceIdRef.current;
              setCurrentSubtitle({ text, isFinal });
              syncToDatabase(text, isFinal, uid, displayName);
              processTranscriptItem({ id: uid, text, sender: displayName, isFinal: isFinal }, false);
              if (isFinal) currentUtteranceIdRef.current = crypto.randomUUID();
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
                const uid = currentUtteranceIdRef.current;
                setCurrentSubtitle({ text: transcript, isFinal: data.is_final });
                if (data.is_final) {
                  syncToDatabase(transcript, true, uid, displayName);
                  processTranscriptItem({ id: uid, text: transcript, sender: displayName, isFinal: true }, false);
                  currentUtteranceIdRef.current = crypto.randomUUID();
                } else {
                  processTranscriptItem({ id: uid, text: transcript, sender: displayName, isFinal: false }, false);
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
              <h4 className="text-amber-400 font-black text-xs uppercase tracking-widest mb-1">Status Alert</h4>
              <p className="text-amber-100/80 text-sm">Cloud API quota reached. Switched to browser-native fallback for uninterrupted service.</p>
            </div>
          </div>
        </div>
      )}

      {usingFallbackTTS && !isRateLimited && !isDailyQuotaReached() && (
        <div className="fixed top-20 right-4 z-[100] w-auto animate-in slide-in-from-right duration-300">
          <div className="bg-blue-500/15 border border-blue-500/40 backdrop-blur-2xl px-4 py-2 rounded-full flex items-center gap-3 shadow-xl">
             <Volume2 className="w-3.5 h-3.5 text-blue-400" />
             <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Degraded Audio Active</span>
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
                </SettingsSection>

                {/* Translation Section */}
                <SettingsSection icon={MessageSquare} title="Translation" description="AI powered chat completions">
                  <div className="grid grid-cols-1 gap-3">
                    <SettingBtn active={translationProvider === TranslationEngine.GEMINI} onClick={() => setTranslationProvider(TranslationEngine.GEMINI)} icon={Sparkles} label="Gemini Flash" description="Fastest cloud translation" />
                    <SettingBtn active={translationProvider === TranslationEngine.OLLAMA_GEMMA} onClick={() => setTranslationProvider(TranslationEngine.OLLAMA_GEMMA)} icon={Cpu} label="Gemma (Ollama Cloud)" description="High-performance remote model" />
                  </div>
                </SettingsSection>

                {/* TTS Section */}
                <SettingsSection icon={Volume2} title="Text-to-Speech (TTS)" description="Speech synthesis engine">
                  <div className="grid grid-cols-1 gap-3">
                    <SettingBtn active={ttsProvider === TTSEngine.GEMINI} onClick={() => setTtsProvider(TTSEngine.GEMINI)} icon={Sparkles} label="Gemini TTS" description="Integrated high-quality" />
                    <SettingBtn active={ttsProvider === TTSEngine.ELEVENLABS} onClick={() => setTtsProvider(TTSEngine.ELEVENLABS)} icon={AudioWaveform} label="ElevenLabs" description="Ultra-realistic voices" />
                    <SettingBtn active={ttsProvider === TTSEngine.BROWSER_NATIVE} onClick={() => setTtsProvider(TTSEngine.BROWSER_NATIVE)} icon={Monitor} label="Browser Native" description="No latency, high privacy" />
                    <SettingBtn active={ttsProvider === TTSEngine.DEEPGRAM} onClick={() => setTtsProvider(TTSEngine.DEEPGRAM)} icon={Server} label="Deepgram TTS" description="Optimized low-latency" />
                    <SettingBtn active={ttsProvider === TTSEngine.CARTESIA} icon={Cpu} label="Cartesia" description="State-of-the-art inference" />
                  </div>
                </SettingsSection>

                {/* Interface Section */}
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