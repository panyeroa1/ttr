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

export enum VoiceType {
  MALE = 'Orus',
  FEMALE = 'Aoede'
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