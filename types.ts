
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

export interface TranscriptRow {
  id: string;
  session_id: string;
  speaker_user_id: string;
  seq: number;
  text: string;
  is_final: boolean;
  started_at: string;
  ended_at?: string;
}

export interface TranslationRow {
  id: string;
  transcript_id: string;
  listener_user_id: string;
  target_lang: string;
  text: string;
  is_final: boolean;
  created_at: string;
}

export interface SessionState {
  id: string;
  room_id: string;
  active_speaker_id: string | null;
  mode: UserRole;
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
