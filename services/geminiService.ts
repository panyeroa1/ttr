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

/**
 * VAD Configuration
 */
const VAD_THRESHOLD = 0.006;
const VAD_HANGOVER_MS = 1000; // Keep sending audio for 1s after last detected speech
const VAD_PREROLL_MS = 400;   // Buffer 400ms of audio to catch soft starts

export class LiveSessionManager {
  private ai: GoogleGenAI;
  private callbacks: LiveSessionCallbacks;
  private currentSession: any = null;
  private status: SessionStatus = 'disconnected';
  private retryCount = 0;
  private maxRetries = 5;
  private isExplicitlyClosed = false;
  private currentTranscription = '';

  // VAD State
  private isSpeaking = false;
  private lastSpeechTime = 0;
  private preRollBuffer: Uint8Array[] = [];
  private readonly sampleRate = 16000;

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
          systemInstruction: `You are a world-class real-time transcriptionist. 
          
          TASK:
          Convert audio stream into highly accurate text.
          
          GUIDELINES:
          1. VERBATIM: Output exactly what is spoken.
          2. FORMATTING: Use professional punctuation and casing.
          3. SEGMENTATION: Be sensitive to conversational pauses. Trigger 'turnComplete' on significant silence (approx 1.5s).
          4. NO CHATTER: Do not respond to content. Only transcribe.
          5. NO DELAY: Stream transcription chunks as soon as they are parsed.`,
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

  /**
   * Processes raw audio data with VAD logic
   */
  processAudio(data: Float32Array) {
    if (this.status !== 'connected' || !this.currentSession) return;

    // Calculate RMS for basic VAD
    let rms = 0;
    for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
    const currentLevel = Math.sqrt(rms / data.length);

    // Convert to PCM
    const int16 = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
    const pcmBytes = new Uint8Array(int16.buffer);

    const now = Date.now();

    if (currentLevel > VAD_THRESHOLD) {
      this.lastSpeechTime = now;
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        // Flush Pre-roll
        console.debug("VAD: Speech Start Detected. Flushing Pre-roll.");
        this.preRollBuffer.forEach(chunk => this.sendToModel(chunk));
        this.preRollBuffer = [];
      }
      this.sendToModel(pcmBytes);
    } else {
      if (this.isSpeaking) {
        // Hangover Period
        if (now - this.lastSpeechTime < VAD_HANGOVER_MS) {
          this.sendToModel(pcmBytes);
        } else {
          console.debug("VAD: Speech End (Hangover Finished).");
          this.isSpeaking = false;
        }
      } else {
        // Lookbehind Buffer (Pre-roll)
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
      this.currentSession.sendRealtimeInput({
        media: { data: encode(data), mimeType: 'audio/pcm;rate=16000' }
      });
    }
  }

  close() {
    this.isExplicitlyClosed = true;
    if (this.currentSession) {
      this.currentSession = null;
    }
    this.setStatus('disconnected');
    this.preRollBuffer = [];
    this.isSpeaking = false;
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