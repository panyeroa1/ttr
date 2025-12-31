
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rcbuikbjqgykssiatxpo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uTIwEo4TJBo_YkX-OWN9qQ_5HJvl4c5';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * !!! IMPORTANT: SQL FIX FOR RLS ERRORS !!!
 * If you see "violates row-level security policy", you MUST run this in your Supabase SQL Editor:
 * 
 * -- Allow public access for local development
 * ALTER TABLE public.transcriptions DISABLE ROW LEVEL SECURITY;
 * ALTER TABLE public.translations DISABLE ROW LEVEL SECURITY;
 * 
 * -- OR run specific policies (better for production):
 * CREATE POLICY "Allow public insert/update" ON "public"."transcriptions" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
 * CREATE POLICY "Allow public insert/update trans" ON "public"."translations" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
 */

export const saveTranscript = async (data: { id: string, user_id: string, room_id: string, speaker: string, text: string }) => {
  const { data: result, error } = await supabase
    .from('transcriptions')
    .upsert([{
      id: data.id,
      user_id: data.user_id,
      room_name: data.room_id,
      sender: data.speaker,
      text: data.text,
      created_at: new Date().toISOString()
    }], { onConflict: 'id' })
    .select();
  
  if (error) {
    console.error('Supabase Upsert Error (Transcriptions):', error.message);
    return { error };
  }
  return { data: result ? result[0] : null };
};

export const fetchTranscripts = async (room_id: string) => {
  const { data, error } = await supabase
    .from('transcriptions')
    .select('*')
    .eq('room_name', room_id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Supabase Fetch Error (Transcriptions):', error.message);
    return { error, data: [] };
  }
  return { data };
};

export const saveTranslation = async (data: { id: string, user_id: string, source_lang: string, target_lang: string, original_text: string, translated_text: string }) => {
  const { data: result, error } = await supabase
    .from('translations')
    .upsert([{
      id: data.id,
      user_id: data.user_id,
      source_lang: data.source_lang,
      target_lang: data.target_lang,
      original_text: data.original_text,
      translated_text: data.translated_text,
      created_at: new Date().toISOString()
    }], { onConflict: 'id' })
    .select();

  if (error) {
    console.error('Supabase Upsert Error (Translations):', error.message);
    return { error };
  }
  return { data: result ? result[0] : null };
};
