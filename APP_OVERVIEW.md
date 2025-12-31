# APP OVERVIEW: TTR - Transcription Translation Realtime

## Project Purpose
TTR is designed to facilitate cross-language communication in real-time. It leverages the latest Gemini Live capabilities to provide a seamless "Speak in one language, Hear/Read in another" experience.

## Features Implemented
- [x] **Real-time STT**: Microphone capture streamed to Gemini Live with transcription results.
- [x] **Database Persistence**: Transcripts and translations are stored in Supabase for auditability.
- [x] **Automatic Translation**: Finalized transcripts trigger a Gemini-powered translation worker (for listeners only).
- [x] **Real-time TTS**: Translated text is automatically converted to audio using Gemini TTS (for listeners only).
- [x] **Dual Modes**: Dedicated "Speak" and "Listen" configurations. Speak mode is optimized for minimal overhead (transcribe + save only).
- [x] **Tabbed Navigation**: Dedicated 'Live' and 'Settings' tabs for clear separation of concerns.
- [x] **Comprehensive Settings**: Full control over STT engines, Translation providers (Gemini vs Local Ollama), and TTS voices.
- [x] **Rate-Limit Safeguards**: Enhanced `RequestQueue` with `retryDelay` parsing and UI-level quota warnings.

## Known Constraints
- **Gemini Free Tier Quotas**: The default daily limit for `gemini-3-flash` is 20 requests. Users on this tier will see a "Quota Warning" once this limit is reached, and translations will be paused.

## Not Yet Implemented
- [ ] Multi-speaker identification (currently optimized for a single active speaker per room).
- [ ] Advanced noise cancellation beyond standard browser AEC.
- [ ] History replay UI (DB contains data, but UI focus is on live sessions).

## To-Do List
1. Enhance VAD (Voice Activity Detection) logic for better segmentation.
2. Implement robust reconnection logic for WebSocket drops.
3. Add multi-channel speaker diarization visuals.