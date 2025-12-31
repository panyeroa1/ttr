export enum UserRole {
  SPEAKER = 'SPEAKER',
  LISTENER = 'LISTENER',
  IDLE = 'IDLE'
}

export enum AudioSource {
  MIC = 'MIC',
  TAB = 'TAB',
  SYSTEM = 'SYSTEM'
}

export enum STTEngine {
  GEMINI = 'GEMINI',
  DEEPGRAM = 'DEEPGRAM',
  WEBSPEECH = 'WEBSPEECH'
}

export enum TranslationEngine {
  GEMINI = 'GEMINI',
  OLLAMA_GEMMA = 'OLLAMA_GEMMA'
}

export enum TTSEngine {
  GEMINI = 'GEMINI',
  ELEVENLABS = 'ELEVENLABS',
  DEEPGRAM = 'DEEPGRAM',
  CARTESIA = 'CARTESIA'
}

export enum VoiceName {
  PUCK = 'Puck',
  CHARON = 'Charon',
  KORE = 'Kore',
  FENRIR = 'Fenrir',
  ZEPHYR = 'Zephyr'
}

export interface TranscriptionItem {
  id: string;
  text: string;
  isFinal: boolean;
  speaker: string;
}

export interface TranslationItem {
  id: string;
  transcriptId: string;
  text: string;
  lang: string;
}