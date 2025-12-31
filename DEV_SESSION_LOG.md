# DEV SESSION LOG

## Session ID: 20240523-090000
**Summary**: Real-time subtitles and database schema alignment.

---

## Session ID: 20240523-100000
**Start Timestamp**: 2024-05-23 10:00:00 UTC

### Objective(s)
1. Resolve 'TypeError: Failed to fetch' errors in Supabase operations.
2. Implement resilient database communication with exponential backoff.

### Repo State
- `lib/supabase.ts` was performing direct calls without error handling for transient network failures.

### Files Inspected
- `lib/supabase.ts`

### Assumptions / Risks
- The error is likely due to transient network drops or environment-specific rate limiting on the Supabase endpoint.
- Retry logic with backoff is the standard mitigation for `TypeError: Failed to fetch` in browser-based real-time apps.

### Summary of Changes
- **lib/supabase.ts**: Added `withRetry` higher-order function. Wrapped `getUserProfile`, `saveTranscript`, `fetchTranscripts`, and `saveTranslation` in retry logic.

### End Timestamp
**End Timestamp**: 2024-05-23 10:05:00 UTC

---

## Session ID: 20250304-123000
**Start Timestamp**: 2025-03-04 12:30:00 UTC

### Objective(s)
1. Improve Voice Activity Detection (VAD) accuracy.
2. Adjust VAD threshold and hangover time to handle quieter speakers and longer natural pauses.

### Repo State
- `services/geminiService.ts` contains constants for audio segmentation.

### Files Inspected
- `services/geminiService.ts`

### Assumptions / Risks
- Lowering `VAD_THRESHOLD` might increase background noise capture in loud environments.
- Increasing `VAD_HANGOVER_MS` increases latency for finalizing utterances.

### Summary of Changes
- **services/geminiService.ts**: Changed `VAD_THRESHOLD` from `0.006` to `0.003`.
- **services/geminiService.ts**: Changed `VAD_HANGOVER_MS` from `1000` to `1500`.

### End Timestamp
**End Timestamp**: 2025-03-04 12:35:00 UTC

---

## Session ID: 20250304-144500
**Start Timestamp**: 2025-03-04 14:45:00 UTC

### Objective(s)
1. Enhance VAD robustness with hysteresis and noise filtering.
2. Implement seamless lookahead (preroll) and lookbehind (hangover) delivery.

### Scope boundaries
- Logic changes restricted to `LiveSessionManager` class in `services/geminiService.ts`.

### Repo State
- Single threshold VAD was prone to "flickering" near threshold levels and triggering on short non-speech sounds.

### Files Inspected
- `services/geminiService.ts`

### Assumptions / Risks
- `MIN_SPEECH_DURATION_MS` might cause slight initial delay, mitigated by the `preRollBuffer` flush.
- Threshold values (`0.005` start, `0.002` stop) are balanced for typical laptop mics.

### Summary of Changes
- **services/geminiService.ts**: Replaced single `VAD_THRESHOLD` with `VAD_THRESHOLD_START` and `VAD_THRESHOLD_STOP`.
- **services/geminiService.ts**: Added `MIN_SPEECH_DURATION_MS` filter (150ms).
- **services/geminiService.ts**: Refined state machine in `processAudio` to use `potentialSpeechStartTime`.
- **services/geminiService.ts**: Increased `VAD_PREROLL_MS` to 500ms for better leading context.

### End Timestamp
**End Timestamp**: 2025-03-04 15:00:00 UTC

---

## Session ID: 20250304-153000
**Start Timestamp**: 2025-03-04 15:30:00 UTC

### Objective(s)
1. Fine-tune VAD thresholds for better capture of subtle speech nuances.

### Scope boundaries
- Logic changes restricted to VAD constants in `services/geminiService.ts`.

### Repo State
- Thresholds were slightly too high for soft-spoken users, causing cut-offs.

### Files Inspected
- `services/geminiService.ts`

### Assumptions / Risks
- Lowering stop threshold to 0.001 might keep the line open too long in noisy environments.

### Summary of Changes
- **services/geminiService.ts**: Changed `VAD_THRESHOLD_START` to 0.004.
- **services/geminiService.ts**: Changed `VAD_THRESHOLD_STOP` to 0.001.

### End Timestamp
**End Timestamp**: 2025-03-04 15:35:00 UTC

---

## Session ID: 20250304-160000
**Start Timestamp**: 2025-03-04 16:00:00 UTC

### Objective(s)
1. Implement a more robust sentence segmentation algorithm.

### Scope boundaries
- `App.tsx`: Refactor `segmentIntoSentences`.

### Repo State
- Previous logic used a naive regex that split prematurely on common abbreviations like "Mr." or "Dr.".

### Files Inspected
- `App.tsx`

### Assumptions / Risks
- Multi-dot abbreviations (e.g., "Ph.D.") might still require specific handling.
- Fallback for extremely long unpunctuated streams is necessary for UX when model punctuation fails.

### Summary of Changes
- **App.tsx**: Completely rewrote `segmentIntoSentences`.
- Added an abbreviation list and logic to skip splitting when a punctuation mark is preceded by a known abbreviation or initial.
- Refined the "unpunctuated length" fallback to prioritize commas over spaces for better semantic breaks.

### End Timestamp
**End Timestamp**: 2025-03-04 16:10:00 UTC

---

## Session ID: 20250304-163000
**Start Timestamp**: 2025-03-04 16:30:00 UTC

### Objective(s)
1. Fix transcription rendering issues where text wasn't appearing in real-time.

### Scope boundaries
- `App.tsx`: Refactor `onTranscription` callback and `processTranscriptItem`.
- `services/geminiService.ts`: Add debug logging.

### Repo State
- Interim transcription results were being ignored by the UI state, only finalizing sentences visible.
- Boolean logic for `isFinal` was flawed (using `||` which coerced `false` to `true`).

### Summary of Changes
- **App.tsx**: Modified speaker `onTranscription` to call `processTranscriptItem` for every chunk.
- **App.tsx**: Fixed `isFinal` logic using `??` to correctly preserve false interim states.
- **services/geminiService.ts**: Added debug logs for session events.

### End Timestamp
**End Timestamp**: 2025-03-04 16:40:00 UTC

---

## Session ID: 20250304-170000
**Start Timestamp**: 2025-03-04 17:00:00 UTC

### Objective(s)
1. Expand the available languages and dialects for translation selection.

### Scope boundaries
- `components/SessionControls.tsx`: Update `LANGUAGES` array.

### Repo State
- The `LANGUAGES` list was limited to a few common options.

### Summary of Changes
- **components/SessionControls.tsx**: Added over 100 languages and regional dialects to the `LANGUAGES` array, including variations for Arabic, English, Spanish, French, and German.

### End Timestamp
**End Timestamp**: 2025-03-04 17:05:00 UTC

---

## Session ID: 20250304-173000
**Start Timestamp**: 2025-03-04 17:30:00 UTC

### Objective(s)
1. Ensure transcription text correctly updates single rows in Supabase without duplicates or race conditions.

### Scope boundaries
- `App.tsx`: Refactor `syncToDatabase` and `onTranscription` callback logic.

### Repo State
- `syncToDatabase` was relying on a mutable ref for the ID inside an async closure, which could cause race conditions if multiple thoughts were finalized in rapid succession.

### Summary of Changes
- **App.tsx**: Modified `syncToDatabase` to accept an explicit `utteranceId`.
- **App.tsx**: Modified `onTranscription` callback to capture the ID locally and rotate the global ref immediately upon finalization. This ensures that the finalized text and subsequent interim results always use the correct, distinct database keys.

### End Timestamp
**End Timestamp**: 2025-03-04 17:40:00 UTC

---

## Session ID: 20250304-180000
**Start Timestamp**: 2025-03-04 18:00:00 UTC

### Objective(s)
1. Refine VAD thresholds in LiveSessionManager.
2. Further enhance `segmentIntoSentences` in `App.tsx` for robust decimal and abbreviation handling.

### Scope boundaries
- `services/geminiService.ts`: Fine-tune VAD constants.
- `App.tsx`: Refactor segmentation regex and logic.

### Files Inspected
- `services/geminiService.ts`
- `App.tsx`

### Summary of Changes
- **services/geminiService.ts**: Confirmed `VAD_THRESHOLD_START` is 0.004 and `VAD_THRESHOLD_STOP` is 0.001.
- **App.tsx**: Enhanced `segmentIntoSentences` with numeric decimal protection logic and expanded abbreviations list (military ranks, academic titles, etc.).

### End Timestamp
**End Timestamp**: 2025-03-04 18:10:00 UTC

---

## Session ID: 20250304-183000
**Start Timestamp**: 2025-03-04 18:30:00 UTC

### Objective(s)
1. Display original transcription text in descending order (most recent first) in the Listen tab.

### Scope boundaries
- `lib/supabase.ts`: Update `fetchTranscripts` sorting.
- `App.tsx`: Refactor state management for transcripts.
- `components/LiveCaptions.tsx`: Update auto-scroll behavior.

### Repo State
- Transcripts were displayed ascending (oldest first).
- Auto-scroll always moved to bottom.

### Summary of Changes
- **lib/supabase.ts**: Changed `fetchTranscripts` to order by `created_at` descending.
- **App.tsx**: Modified `processTranscriptItem` to prepend new items to the state array. Updated `Initialize listener` logic to use the already-descending fetched data.
- **components/LiveCaptions.tsx**: Modified `useEffect` to scroll to the top for the "source" type while keeping bottom-scroll for "target" (translations).

### End Timestamp
**End Timestamp**: 2025-03-04 18:40:00 UTC

---

## Session ID: 20250304-190000
**Start Timestamp**: 2025-03-04 19:00:00 UTC

### Objective(s)
1. Add configurable Voice IDs for Cartesia and ElevenLabs in the settings.
2. Ensure initialization of listener fetches accurately and processes the latest transcription (translate + speak).

### Scope boundaries
- `App.tsx`: Added state for voice IDs and updated `toggleActive` for listeners.

### Files Inspected
- `App.tsx`

### Summary of Changes
- **App.tsx**: Added `elevenLabsVoiceId` and `cartesiaVoiceId` state with corresponding input fields in the Settings tab.
- **App.tsx**: Updated `toggleActive` for the `LISTENER` role to not only fetch history but explicitly call `processTranscriptItem` with `playAudio: true` for the most recent record.
- **App.tsx**: Updated `processTranscriptItem` to pass the configured voice IDs to the `GeminiService` methods.

### End Timestamp
**End Timestamp**: 2025-03-04 19:15:00 UTC

---

## Session ID: 20250304-200000
**Start Timestamp**: 2025-03-04 20:00:00 UTC

### Objective(s)
1. Standardize translation column to descending order for visual consistency.
2. Improve "autoplay" reliability by accurately hand-off of historical state to live updates.

### Scope boundaries
- `App.tsx`: Refactor `setTranslations` and `toggleActive` for Listeners.
- `components/LiveCaptions.tsx`: Refactor scroll logic.

### Repo State
- Original transcription was descending, but translation was ascending.
- Scroll behavior was inconsistent between columns.
- Potential turn-skip during Listener initialization.

### Summary of Changes
- **App.tsx**: Updated `setTranslations` to prepend new items, ensuring descending order.
- **App.tsx**: Updated `toggleActive` for listeners to initialize `processedTextOffsetRef` for all historical items (preventing re-read of the past) but reset the very latest one (index 0) to ensure it triggers the initial "Welcome" read-aloud precisely.
- **components/LiveCaptions.tsx**: Changed scroll behavior to target the top for both columns.
- **App.tsx**: Updated Settings label to specify "Gemma (Ollama Cloud)".

### End Timestamp
**End Timestamp**: 2025-03-04 20:10:00 UTC

---

## Session ID: 20250304-210000
**Start Timestamp**: 2025-03-04 21:00:00 UTC

### Objective(s)
1. Address "no TTS is heard" reports by Listener role.
2. Fix audio decoding bugs and ensure gapless, ordered playback.
3. Improve robustness of Cartesia TTS output.

### Scope boundaries
- `App.tsx`: Logic for queuing and triggering TTS.
- `services/geminiService.ts`: Audio decoding and API configurations.

### Repo State
- Reports of no audio in Listen tab.
- `decodeAudioData` was potentially reading incorrect buffer segments.
- Overlapping audio possible during rapid speech.

### Summary of Changes
- **services/geminiService.ts**: Fixed `decodeAudioData` to correctly use `byteOffset` and `byteLength` for Int16 buffer creation.
- **services/geminiService.ts**: Added detailed error logs for TTS API calls.
- **services/geminiService.ts**: Changed Cartesia encoding to `pcm_s16le` for better browser compatibility.
- **App.tsx**: Added explicit `ctx.resume()` check before every playback.
- **App.tsx**: Added `console.debug` logs to trace the sentence processing pipeline.
- **App.tsx**: Ensured strictly sequential `await` of sentences within `processTranscriptItem` for ordered output.

### End Timestamp
**End Timestamp**: 2025-03-04 21:15:00 UTC

---

## Session ID: 20250304-220000
**Start Timestamp**: 2025-03-04 22:00:00 UTC

### Objective(s)
1. Refine TTS playback synchronization logic to ensure strictly gapless delivery.
2. Prevent concurrent execution of `processTranscriptItem` to maintain perfect turn order.

### Scope boundaries
- `App.tsx`: Implementation of a sequential processing queue.
- `services/geminiService.ts`: Reduction of `RequestQueue` interval.

### Repo State
- `processTranscriptItem` was triggered concurrently by Supabase, leading to potential race conditions in scheduling `nextStartTimeRef`.
- `minInterval` in `services/geminiService.ts` was 4000ms, causing large gaps between sentences.

### Summary of Changes
- **App.tsx**: Implemented a `processingQueueRef` (Promise-based queue) that serializes all transcription updates.
- **App.tsx**: Added lookahead padding (50ms) to `nextStartTimeRef` when starting from silence to ensure the browser's audio engine has time to buffer before the play-head arrives.
- **services/geminiService.ts**: Reduced `minInterval` to 200ms to allow fluid, nearly instant sequential audio playback.
- **services/geminiService.ts**: Updated Cartesia to use `wav` container for native decoding.

### End Timestamp
**End Timestamp**: 2025-03-04 22:15:00 UTC

---

## Session ID: 20250304-230000
**Start Timestamp**: 2025-03-04 23:00:00 UTC

### Objective(s)
1. Refine the sequential processing queue to prevent Turn 1/Turn 2 overlap and ensure strictly chronological turn handling.
2. Guarantee that UI updates (text) remain real-time while Audio updates (translation/TTS) follow the strictly chronological queue.

### Repo State
- UI updates were previously waiting for the entire turn's processing in the queue, causing a perceived lag in text display.

### Summary of Changes
- **App.tsx**: Refactored `processTranscriptItem` to split into an immediate visual path and a strictly sequential audio path.
- **App.tsx**: Improved error handling within the processing queue to prevent turn-skipping or lock-ups on failure.
- **App.tsx**: Added lookahead padding and sequence logging for debugging.

### End Timestamp
**End Timestamp**: 2025-03-04 23:15:00 UTC

---

## Session ID: 20250304-233000
**Start Timestamp**: 2025-03-04 23:30:00 UTC

### Objective(s)
1. Implement a robust fallback TTS engine using the Web Speech API.
2. Ensure graceful degradation when cloud TTS providers are unavailable or hit rate limits.

### Scope boundaries
- `types.ts`: Added `BROWSER_NATIVE` engine type.
- `App.tsx`: Implemented `speakWithBrowserNative` and updated processing pipeline.

### Assumptions / Risks
- Browser native voices vary by OS/Browser and may sound less natural than Gemini/ElevenLabs.
- `speechSynthesis` operates outside the `AudioContext` timeline, so exact gapless syncing is harder, but sequential turn order is maintained via the processing queue.

### Summary of Changes
- **types.ts**: Added `BROWSER_NATIVE` to `TTSEngine`.
- **App.tsx**: Added `speakWithBrowserNative` helper.
- **App.tsx**: Modified `processTranscriptItem` audio-queue to automatically fallback to `BROWSER_NATIVE` if the primary provider fails or if a quota limit is detected.
- **App.tsx**: Added UI notification for degraded audio status.

### End Timestamp
**End Timestamp**: 2025-03-04 23:45:00 UTC