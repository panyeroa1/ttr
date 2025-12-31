# DEV SESSION LOG

## Session ID: 20240521-140000
**Start Timestamp**: 2024-05-21 14:00:00 UTC

### Objective(s)
1. Transition from .insert() to .upsert() in Supabase logic.
2. Enable real-time row updates for transcription partials.
3. Ensure translations also update existing rows rather than creating new ones.

### Scope Boundaries
- `lib/supabase.ts` (API logic).
- `App.tsx` (ID management and sync frequency).

### End Timestamp
**End Timestamp**: 2024-05-21 14:15:00 UTC

### Summary of Changes
- Modified `saveTranscript` and `saveTranslation` in `lib/supabase.ts` to use `.upsert()` with `onConflict: 'id'`.
- Updated `App.tsx` to maintain `currentUtteranceIdRef` and `currentTranslationIdRef`.

---

## Session ID: 20240521-143000
**Start Timestamp**: 2024-05-21 14:30:00 UTC

### Objective(s)
1. Decouple Listener UI from local Speaker state.
2. Implement Supabase Real-time subscriptions for transcription and translation tables.
3. Trigger TTS purely from incoming DB translation events for Listeners.

### Repo State
- DB schema with `transcriptions` and `translations` tables ready.
- Speaker logic functional.

### Files Inspected
- `App.tsx`
- `lib/supabase.ts`

### Assumptions / Risks
- Real-time subscription latency might be slightly higher than local propagation, but provides the required "Source of Truth" architecture.
- Filter `target_lang` in Postgres changes subscription ensures listeners only receive their preferred language.

### Summary of Changes
- Added `useEffect` in `App.tsx` to handle `postgres_changes` via Supabase Real-time.
- Moved TTS execution for listeners into the DB event handler.
- Speaker now pushes to DB, and listeners automatically reflect those changes.
- Added a "LIVE SYNC" and "SUBSCRIBED" indicator for Listeners.

### Files Changed
- `App.tsx`
- `DEV_SESSION_LOG.md`

### End Timestamp
**End Timestamp**: 2024-05-21 14:45:00 UTC