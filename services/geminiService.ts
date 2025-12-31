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
  const dataInt16 = new Int16Array(data.buffer);
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

const VAD_THRESHOLD = 0.006;
const VAD_HANGOVER_MS = 1000;
const VAD_PREROLL_MS = 400;

/**
 * Utility class to manage rate-limited requests to the Gemini API
 */
class RequestQueue {
  private queue: (() => Promise<any>)[] = [];
  private processing = false;
  private lastRequestTime = 0;
  private minInterval = 4000; // Increased to 4 seconds for free tier stability

  async add<T>(requestFn: () => Promise<T>): Promise<T> {
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

  private async executeWithRetry<T>(requestFn: () => Promise<T>, retries = 3, delay = 3000): Promise<T> {
    try {
      return await requestFn();
    } catch (error: any) {
      const errorMessage = error?.message || "";
      const isRateLimit = errorMessage.includes('429') || error?.status === 429 || error?.name === 'RESOURCE_EXHAUSTED';
      
      if (isRateLimit && retries > 0) {
        let nextDelay = delay;
        
        // Scan all details for RetryInfo as it's not always the first element
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
            this.handleDisconnect();
            this.callbacks.onError?.(e);
          },
          onclose: (e) => this.handleDisconnect(),
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
    let rms = 0;
    for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
    const currentLevel = Math.sqrt(rms / data.length);
    const int16 = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
    const pcmBytes = new Uint8Array(int16.buffer);
    const now = Date.now();

    if (currentLevel > VAD_THRESHOLD) {
      this.lastSpeechTime = now;
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.preRollBuffer.forEach(chunk => this.sendToModel(chunk));
        this.preRollBuffer = [];
      }
      this.sendToModel(pcmBytes);
    } else {
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
        model: 'gemini-3-flash-preview',
        contents: `Translate the following text to ${targetLang}. Preserve the original tone and context. Only return the translated text without extra formatting or comments.
        
Text: "${text}"`,
        config: { temperature: 0.1 }
      });
      return response.text?.trim() || "";
    });
  }

  async generateSpeech(text: string, voiceName: VoiceName = VoiceName.KORE) {
    return apiQueue.add(async () => {
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
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    });
  }
}

export const gemini = new GeminiService();