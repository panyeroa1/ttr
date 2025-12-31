
# APP OVERVIEW: TTR - Transcription Translation Realtime

## Project Purpose
TTR is designed to facilitate cross-language communication in real-time. It leverages the latest Gemini Live capabilities to provide a seamless "Speak in one language, Hear/Read in another" experience.

## Features Implemented
- [x] **Real-time STT**: Microphone capture streamed to Gemini Live with transcription results.
- [x] **Database Persistence**: Transcripts and translations are stored in Supabase for auditability.
- [x] **Automatic Translation**: Finalized transcripts trigger a Gemini-powered translation worker.
- [x] **Real-time TTS**: Translated text is automatically converted to audio using Gemini TTS.
- [x] **Dual Modes**: Dedicated "Speak" and "Listen" configurations to prevent audio feedback loops.
- [x] **Live Captions**: Real-time display of both source and target language text.

## Not Yet Implemented
- [ ] Multi-speaker identification (currently optimized for a single active speaker per room).
- [ ] Advanced noise cancellation beyond standard browser AEC.
- [ ] History replay UI (DB contains data, but UI focus is on live sessions).

## To-Do List
1. Enhance VAD (Voice Activity Detection) logic for better segmentation.
2. Add language selection dropdown for target listeners.
3. Implement robust reconnection logic for WebSocket drops.
