import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { VoiceName } from "../types";

export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  // Critical fix: ensure we respect byteOffset when creating the view from the underlying buffer
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export type SessionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface LiveSessionCallbacks {
  onTranscription: (text: string, isFinal: boolean, speaker?: string) => void;
  onStatusChange?: (status: SessionStatus) => void;
  onInterrupted?: () => void;
  onError?: (e: any) => void;
}

// VAD Constants
const VAD_THRESHOLD_START = 0.004;
const VAD_THRESHOLD_STOP = 0.001;
const VAD_HANGOVER_MS = 1200;
const VAD_PREROLL_MS = 500;
const MIN_SPEECH_DURATION_MS = 150;

let dailyQuotaExceeded = false;
export const isDailyQuotaReached = () => dailyQuotaExceeded;

class RequestQueue {
  private queue: (() => Promise<any>)[] = [];
  private processing = false;
  private lastRequestTime = 0;
  // Reduced from 4000 to 200 to allow smooth real-time sentence-by-sentence processing
  private minInterval = 200; 

  async add<T>(requestFn: () => Promise<T>): Promise<T> {
    if (dailyQuotaExceeded) {
      throw new Error("DAILY_QUOTA_REACHED");
    }

    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await this.executeWithRetry(requestFn);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      if (dailyQuotaExceeded) {
        this.queue = [];
        break;
      }

      const now = Date.now();
      const timeSinceLast = now - this.lastRequestTime;
      if (timeSinceLast < this.minInterval) {
        await new Promise(r => setTimeout(r, this.minInterval - timeSinceLast));
      }

      const task = this.queue.shift();
      if (task) {
        this.lastRequestTime = Date.now();
        await task();
      }
    }

    this.processing = false;
  }

  private async executeWithRetry<T>(requestFn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
    try {
      return await requestFn();
    } catch (error: any) {
      const errorStr = JSON.stringify(error);
      const errorMessage = error?.message || "";
      const is429 = errorMessage.includes('429') || error?.status === 429 || error?.name === 'RESOURCE_EXHAUSTED';
      
      const isDailyLimit = errorStr.includes('DailyRequestsPerDay') || errorStr.includes('quotaValue":"20"') || errorMessage.includes('daily limit');

      if (isDailyLimit) {
        dailyQuotaExceeded = true;
        console.error("CRITICAL: Gemini Daily Quota Exhausted. Suspending all API calls.");
        throw new Error("DAILY_QUOTA_REACHED");
      }

      if (is429 && retries > 0) {
        let nextDelay = delay;
        if (Array.isArray(error?.details)) {
          for (const detail of error.details) {
            if (detail.retryDelay) {
              const delaySeconds = parseInt(detail.retryDelay.replace('s', ''));
              if (!isNaN(delaySeconds)) {
                nextDelay = delaySeconds * 1000;
                break;
              }
            }
          }
        }
        
        console.warn(`Rate limit hit. Retrying in ${nextDelay}ms... (${retries} retries left)`);
        await new Promise(r => setTimeout(r, nextDelay));
        return this.executeWithRetry(requestFn, retries - 1, nextDelay * 2);
      }
      throw error;
    }
  }
}

const apiQueue = new RequestQueue();

export class LiveSessionManager {
  private ai: GoogleGenAI | null = null;
  private callbacks: LiveSessionCallbacks;
  private currentSession: any = null;
  private status: SessionStatus = 'disconnected';
  private retryCount = 0;
  private maxRetries = 3;
  private isExplicitlyClosed = false;
  private currentTranscription = '';
  private userName: string = 'Speaker';

  private isSpeaking = false;
  private potentialSpeechStartTime = 0;
  private lastSpeechTime = 0;
  private preRollBuffer: Uint8Array[] = [];
  private readonly sampleRate = 16000;

  constructor(callbacks: LiveSessionCallbacks, userName: string) {
    this.callbacks = callbacks;
    this.userName = userName;
  }

  private setStatus(status: SessionStatus) {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  async connect() {
    this.isExplicitlyClosed = false;
    this.retryCount = 0;
    return this.internalConnect();
  }

  private async internalConnect() {
    if (this.isExplicitlyClosed) return;

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      this.setStatus('error');
      this.callbacks.onError?.(new Error('API Key missing'));
      return;
    }

    this.ai = new GoogleGenAI({ apiKey });
    this.setStatus(this.retryCount > 0 ? 'reconnecting' : 'connecting');

    try {
      this.currentSession = await this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.debug('Live Session Opened');
            this.setStatus('connected');
            this.retryCount = 0;
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              this.currentTranscription += text;
              
              const tagRegex = /\[(Speaker \d+)\]:\s*(.*)/gi;
              let lastMatch;
              let match;
              while ((match = tagRegex.exec(this.currentTranscription)) !== null) {
                lastMatch = match;
              }

              if (lastMatch) {
                this.callbacks.onTranscription(lastMatch[2], false, lastMatch[1]);
              } else {
                this.callbacks.onTranscription(this.currentTranscription, false, this.userName);
              }
            }
            
            if (message.serverContent?.turnComplete) {
              if (this.currentTranscription.trim()) {
                const tagRegex = /\[(Speaker \d+)\]:\s*(.*)/gi;
                let lastMatch;
                let match;
                while ((match = tagRegex.exec(this.currentTranscription)) !== null) {
                  lastMatch = match;
                }

                if (lastMatch) {
                  this.callbacks.onTranscription(lastMatch[2], true, lastMatch[1]);
                } else {
                  this.callbacks.onTranscription(this.currentTranscription, true, this.userName);
                }
              }
              this.currentTranscription = '';
            }
            
            if (message.serverContent?.interrupted) {
              this.callbacks.onInterrupted?.();
            }
          },
          onerror: (e) => {
            console.error('Live Session Error:', e);
            this.handleDisconnect();
            this.callbacks.onError?.(e);
          },
          onclose: (e) => {
            console.debug('Live Session Closed');
            this.handleDisconnect();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          systemInstruction: `You are a specialized transcription agent for a real-time meeting tool.
          
          PRIMARY USER PROFILE:
          Name: ${this.userName}
          
          DIARIZATION MANDATE:
          - Every time a new voice speaks, prefix with "[Speaker X]: ".
          
          TRANSCRIPTION STYLE:
          - Verbatim and highly precise.
          - ABSOLUTE PUNCTUATION REQUIREMENT: You MUST provide terminal punctuation (., ?, !, or Chinese 。) immediately after every single completed thought. 
          - Do not wait for long pauses or the end of a turn. 
          - If a sentence is grammatically complete, punctuate it immediately. 
          - This is CRITICAL for down-stream real-time translation and subtitle rendering.
          - Professional formatting.`,
        }
      });
    } catch (err: any) {
      console.error('Connection Exception:', err);
      this.handleDisconnect();
    }
  }

  private handleDisconnect() {
    if (this.isExplicitlyClosed) {
      this.setStatus('disconnected');
      return;
    }

    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      const delay = Math.min(1000 * Math.pow(2, this.retryCount), 5000);
      this.setStatus('reconnecting');
      setTimeout(() => this.internalConnect(), delay);
    } else {
      this.setStatus('error');
    }
  }

  processAudio(data: Float32Array) {
    if (this.status !== 'connected' || !this.currentSession) return;
    
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) sumSquares += data[i] * data[i];
    const currentLevel = Math.sqrt(sumSquares / data.length);
    
    const int16 = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
    const pcmBytes = new Uint8Array(int16.buffer);
    
    const now = Date.now();

    if (currentLevel > VAD_THRESHOLD_START) {
      if (!this.isSpeaking) {
        if (this.potentialSpeechStartTime === 0) {
          this.potentialSpeechStartTime = now;
        } else if (now - this.potentialSpeechStartTime > MIN_SPEECH_DURATION_MS) {
          this.isSpeaking = true;
          this.potentialSpeechStartTime = 0;
          this.preRollBuffer.forEach(chunk => this.sendToModel(chunk));
          this.preRollBuffer = [];
          this.sendToModel(pcmBytes);
        } else {
          this.preRollBuffer.push(pcmBytes);
        }
      } else {
        this.sendToModel(pcmBytes);
      }
      this.lastSpeechTime = now;
    } else if (currentLevel > VAD_THRESHOLD_STOP && this.isSpeaking) {
      this.sendToModel(pcmBytes);
      this.lastSpeechTime = now;
    } else {
      this.potentialSpeechStartTime = 0;
      
      if (this.isSpeaking) {
        if (now - this.lastSpeechTime < VAD_HANGOVER_MS) {
          this.sendToModel(pcmBytes);
        } else {
          this.isSpeaking = false;
        }
      } else {
        this.preRollBuffer.push(pcmBytes);
        const maxPreRollFrames = (VAD_PREROLL_MS / 1000) * (this.sampleRate / data.length);
        if (this.preRollBuffer.length > maxPreRollFrames) {
          this.preRollBuffer.shift();
        }
      }
    }
  }

  private sendToModel(data: Uint8Array) {
    if (this.status === 'connected' && this.currentSession) {
      try {
        this.currentSession.sendRealtimeInput({
          media: { data: encode(data), mimeType: 'audio/pcm;rate=16000' }
        });
      } catch (err) {}
    }
  }

  close() {
    this.isExplicitlyClosed = true;
    if (this.currentSession) {
      try { this.currentSession.close(); } catch(e) {}
      this.currentSession = null;
    }
    this.ai = null;
    this.setStatus('disconnected');
    this.preRollBuffer = [];
    this.isSpeaking = false;
    this.potentialSpeechStartTime = 0;
  }
}

export class GeminiService {
  async connectLive(callbacks: LiveSessionCallbacks, userName: string) {
    const manager = new LiveSessionManager(callbacks, userName);
    await manager.connect();
    return manager;
  }

  async translate(text: string, sourceLang: string, targetLang: string) {
    return apiQueue.add(async () => {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-flash-latest',
        contents: `Translate the following text to ${targetLang}. Preserve the original tone and context. Only return the translated text without extra formatting or comments.
        
Text: "${text}"`,
        config: { temperature: 0.1 }
      });
      return response.text?.trim() || "";
    });
  }

  async generateSpeech(text: string, voiceName: VoiceName = VoiceName.KORE) {
    return apiQueue.add(async () => {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } },
            },
          },
        });
        const audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audio) {
          console.error("Gemini TTS returned no audio data for text:", text);
        }
        return audio;
      } catch (err) {
        console.error("Gemini generateSpeech Error:", err);
        throw err;
      }
    });
  }

  async generateElevenLabsSpeech(text: string, apiKey: string, voiceId: string = '21m00Tcm4TlvDq8ikWAM') {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.5 }
      })
    });
    if (!response.ok) throw new Error("ElevenLabs API Error");
    return await response.arrayBuffer();
  }

  async generateDeepgramSpeech(text: string, apiKey: string) {
    const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
      method: 'POST',
      headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error("Deepgram TTS Error");
    return await response.arrayBuffer();
  }

  async generateCartesiaSpeech(text: string, apiKey: string, voiceId: string = '79a125e8-cd45-4c13-8a67-01224ca5850b') {
    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: { 
        'Cartesia-Key': apiKey, 
        'Content-Type': 'application/json',
        'X-API-Version': '2024-06-10'
      },
      body: JSON.stringify({
        model_id: 'sonic-english',
        transcript: text,
        voice: { mode: 'id', id: voiceId },
        // Use standard wav container for better browser native decoding
        output_format: { container: 'wav', sample_rate: 24000, encoding: 'pcm_s16le' }
      })
    });
    if (!response.ok) throw new Error("Cartesia API Error");
    return await response.arrayBuffer();
  }
}

export const gemini = new GeminiService();