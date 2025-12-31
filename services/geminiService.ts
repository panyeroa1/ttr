
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

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
              
              // Handle optional speaker labels if the model adds them like "[Speaker 1]: text"
              const speakerMatch = this.currentTranscription.match(/^\[(Speaker \d+)\]:\s*(.*)/i);
              if (speakerMatch) {
                this.callbacks.onTranscription(speakerMatch[2], false, speakerMatch[1]);
              } else {
                this.callbacks.onTranscription(this.currentTranscription, false, this.userName);
              }
            }
            
            if (message.serverContent?.turnComplete) {
              if (this.currentTranscription.trim()) {
                const speakerMatch = this.currentTranscription.match(/^\[(Speaker \d+)\]:\s*(.*)/i);
                if (speakerMatch) {
                  this.callbacks.onTranscription(speakerMatch[2], true, speakerMatch[1]);
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
          systemInstruction: `You are a specialized transcription agent for a meeting tool.
          
          PRIMARY SPEAKER: ${this.userName}
          
          TASK:
          Transcribe the incoming audio stream with high fidelity.
          
          DIARIZATION RULES:
          1. If you hear multiple distinct voices, label them as [Speaker 1], [Speaker 2], etc.
          2. If the voice matches the profile of the primary speaker (${this.userName}), you may label it as such or leave it for the UI to handle.
          3. Format: "[Speaker Name]: Transcription text".
          
          GENERAL RULES:
          - Verbatim output only.
          - Professional punctuation.
          - High sensitivity to turns and pauses.`,
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
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Translate to ${targetLang}: "${text}". Only the translation.`,
      config: { temperature: 0.1 }
    });
    return response.text?.trim() || "";
  }

  async generateSpeech(text: string, voiceName: string = 'Aoede') {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prebuiltVoice = voiceName === 'Orus' ? 'Puck' : 'Kore';
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: prebuiltVoice } },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  }
}

export const gemini = new GeminiService();
