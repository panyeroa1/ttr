
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rcbuikbjqgykssiatxpo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uTIwEo4TJBo_YkX-OWN9qQ_5HJvl4c5';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * !!! IMPORTANT: SQL FIX FOR RLS ERRORS !!!
 * If you see "violates row-level security policy", you MUST run this in your Supabase SQL Editor:
 * 
 * -- 1. Allow Anyone (Anon/Auth) to Insert Transcriptions
 * CREATE POLICY "Allow public insert transcriptions" ON "public"."transcriptions"
 * FOR INSERT TO anon, authenticated WITH CHECK (true);
 * 
 * -- 2. Allow Anyone (Anon/Auth) to Insert Translations
 * CREATE POLICY "Allow public insert translations" ON "public"."translations"
 * FOR INSERT TO anon, authenticated WITH CHECK (true);
 * 
 * -- 3. (Optional) Allow Anyone to Read (to see the history)
 * CREATE POLICY "Allow public select" ON "public"."transcriptions" FOR SELECT TO anon, authenticated USING (true);
 * CREATE POLICY "Allow public select trans" ON "public"."translations" FOR SELECT TO anon, authenticated USING (true);
 */

export const saveTranscript = async (data: any) => {
  const { data: result, error } = await supabase
    .from('transcriptions')
    .insert([{
      user_id: data.user_id,
      room_name: data.room_id,
      sender: data.speaker,
      text: data.text,
      created_at: new Date().toISOString()
    }])
    .select();
  
  if (error) {
    console.group('Supabase RLS Error (Transcriptions)');
    console.error('Message:', error.message);
    console.info('Action Required: Run the SQL policies provided in lib/supabase.ts');
    console.groupEnd();
    return { error };
  }
  return { data: result ? result[0] : null };
};

export const saveTranslation = async (data: any) => {
  const { data: result, error } = await supabase
    .from('translations')
    .insert([{
      user_id: data.user_id,
      source_lang: data.source_lang,
      target_lang: data.target_lang,
      original_text: data.original_text,
      translated_text: data.translated_text,
      created_at: new Date().toISOString()
    }])
    .select();

  if (error) {
    console.group('Supabase RLS Error (Translations)');
    console.error('Message:', error.message);
    console.groupEnd();
    return { error };
  }
  return { data: result ? result[0] : null };
};
