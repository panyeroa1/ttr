import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

/**
 * Base64 encoding for audio data
 */
export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 decoding for audio data
 */
export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode raw PCM audio data into an AudioBuffer
 */
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
  onTranscription: (text: string, isFinal: boolean) => void;
  onStatusChange?: (status: SessionStatus) => void;
  onInterrupted?: () => void;
  onError?: (e: any) => void;
}

export class LiveSessionManager {
  private ai: GoogleGenAI;
  private callbacks: LiveSessionCallbacks;
  private currentSession: any = null;
  private status: SessionStatus = 'disconnected';
  private retryCount = 0;
  private maxRetries = 5;
  private isExplicitlyClosed = false;
  private currentTranscription = '';

  constructor(apiKey: string, callbacks: LiveSessionCallbacks) {
    this.ai = new GoogleGenAI({ apiKey });
    this.callbacks = callbacks;
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

    this.setStatus(this.retryCount > 0 ? 'reconnecting' : 'connecting');

    try {
      this.currentSession = await this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.log('Gemini Live session opened');
            this.setStatus('connected');
            this.retryCount = 0;
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              this.currentTranscription += text;
              this.callbacks.onTranscription(this.currentTranscription, false);
            }
            
            if (message.serverContent?.turnComplete) {
              if (this.currentTranscription.trim()) {
                this.callbacks.onTranscription(this.currentTranscription, true);
              }
              this.currentTranscription = '';
            }
            
            if (message.serverContent?.interrupted) {
              this.callbacks.onInterrupted?.();
            }
          },
          onerror: (e) => {
            console.error('Gemini Live error:', e);
            this.callbacks.onError?.(e);
            this.handleDisconnect();
          },
          onclose: (e) => {
            console.log('Gemini Live session closed', e);
            this.handleDisconnect();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          systemInstruction: `You are a high-performance real-time transcription agent.
          
          RULES:
          1. TRANSCRIBE exactly what is heard.
          2. SEGMENTATION: Trigger 'turnComplete' after exactly 1.0 seconds of silence.
          3. PUNCTUATION: Use precise semantic punctuation (periods, commas, question marks).
          4. NO META-TALK: Never respond to the user. Only transcribe.
          5. NO DELAY: Stream transcription immediately.`,
        }
      });
    } catch (err) {
      console.error('Failed to establish connection:', err);
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
      const delay = Math.min(1000 * Math.pow(2, this.retryCount), 10000);
      this.setStatus('reconnecting');
      setTimeout(() => this.internalConnect(), delay);
    } else {
      this.setStatus('error');
      this.callbacks.onError?.(new Error('Persistent connection failure'));
    }
  }

  sendRealtimeInput(input: any) {
    if (this.status === 'connected' && this.currentSession) {
      this.currentSession.sendRealtimeInput(input);
    }
  }

  close() {
    this.isExplicitlyClosed = true;
    if (this.currentSession) {
      this.currentSession = null;
    }
    this.setStatus('disconnected');
  }
}

export class GeminiService {
  async connectLive(callbacks: LiveSessionCallbacks) {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error('API Key missing');
    const manager = new LiveSessionManager(apiKey, callbacks);
    await manager.connect();
    return manager;
  }

  async translate(text: string, sourceLang: string, targetLang: string) {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Translate to ${targetLang}: "${text}". Only the translation.`,
      config: { temperature: 0.1 }
    });
    return response.text?.trim() || "";
  }

  async generateSpeech(text: string, targetVoice: string = 'Kore') {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: targetVoice } },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  }
}

export const gemini = new GeminiService();