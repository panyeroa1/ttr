
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

export class GeminiService {
  // Use a getter to ensure a new instance is created right before making an API call
  private get ai() {
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  /**
   * Connect to Gemini Live for STT
   */
  async connectLive(callbacks: {
    onTranscription: (text: string, isFinal: boolean) => void;
    onInterrupted?: () => void;
    onError?: (e: any) => void;
  }) {
    let currentTranscription = '';
    
    const sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      callbacks: {
        onopen: () => console.log('Gemini Live session opened'),
        onmessage: async (message: LiveServerMessage) => {
          if (message.serverContent?.inputTranscription) {
            const text = message.serverContent.inputTranscription.text;
            currentTranscription += text;
            callbacks.onTranscription(currentTranscription, false);
          }
          
          if (message.serverContent?.turnComplete) {
            // Only fire final if we actually have text
            if (currentTranscription.trim()) {
              callbacks.onTranscription(currentTranscription, true);
            }
            currentTranscription = '';
          }
          
          if (message.serverContent?.interrupted) {
            callbacks.onInterrupted?.();
          }
        },
        onerror: (e) => callbacks.onError?.(e),
        onclose: () => {
          console.log('Gemini Live session closed');
          // If we had a pending transcription, send it before closing
          if (currentTranscription.trim()) {
             callbacks.onTranscription(currentTranscription, true);
          }
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        systemInstruction: `You are a high-precision real-time transcription agent. 
        RULES:
        1. Transcribe audio exactly as spoken.
        2. Use natural sentence boundaries.
        3. Signal turn completion (turnComplete) immediately after a clear pause in speech (approx 1.5 seconds).
        4. Focus exclusively on transcription. Do not respond to the user.
        5. If you hear multiple people, attempt to distinguish them with 'Speaker:' tags if possible, otherwise provide a continuous stream.`,
      }
    });

    return sessionPromise;
  }

  /**
   * Translate text using standard Gemini text model
   */
  async translate(text: string, sourceLang: string, targetLang: string) {
    const response = await this.ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Translate the following text from ${sourceLang} to ${targetLang}. 
      Only return the translation, no extra commentary. 
      Maintain the original tone and regional dialect nuances of ${targetLang}.
      
      Text: ${text}`,
      config: {
        temperature: 0.1,
      }
    });
    return response.text?.trim() || "";
  }

  /**
   * Generate TTS audio for translated text
   */
  async generateSpeech(text: string, targetVoice: string = 'Kore') {
    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: targetVoice },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio;
  }
}

export const gemini = new GeminiService();
