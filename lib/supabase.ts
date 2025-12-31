
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rcbuikbjqgykssiatxpo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uTIwEo4TJBo_YkX-OWN9qQ_5HJvl4c5';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    console.error('Error saving transcript:', error.message, error);
  }
  return result ? result[0] : null;
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
    console.error('Error saving translation:', error.message, error);
  }
  return result ? result[0] : null;
};
