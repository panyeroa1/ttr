import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rcbuikbjqgykssiatxpo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uTIwEo4TJBo_YkX-OWN9qQ_5HJvl4c5';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Utility to retry database operations.
 * Handles both thrown exceptions and errors returned in the Supabase { data, error } format.
 */
async function withRetry<T extends { error?: any }>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  let lastResult: T;
  
  try {
    lastResult = await fn();
  } catch (err: any) {
    // Handle cases where the function itself throws (e.g., hard network failure)
    lastResult = { error: err } as unknown as T;
  }

  const error = lastResult.error;
  if (error) {
    const errorMessage = error.message || String(error);
    const isNetworkError = 
      errorMessage.includes('Failed to fetch') || 
      errorMessage.includes('network') || 
      errorMessage.includes('Load failed') ||
      error.name === 'TypeError';

    if (isNetworkError && retries > 0) {
      console.warn(`Database network issue: "${errorMessage}". Retrying in ${delay}ms... (${retries} left)`);
      await new Promise(r => setTimeout(r, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
  }

  return lastResult;
}

export const getUserProfile = async (userId: string) => {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', userId)
      .single();
    
    return { data, error };
  });
};

export const saveTranscript = async (data: { id: string, user_id: string, room_name: string, sender: string, text: string }) => {
  return withRetry(async () => {
    // Removed .select() to minimize payload and overhead
    const { error } = await supabase
      .from('transcriptions')
      .upsert([{
        id: data.id,
        user_id: data.user_id,
        room_name: data.room_name,
        sender: data.sender,
        text: data.text,
        created_at: new Date().toISOString()
      }], { onConflict: 'id' });
    
    if (error) console.error('Supabase Upsert Error (Transcriptions):', error.message);
    return { error };
  });
};

export const fetchTranscripts = async (room_name: string) => {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('transcriptions')
      .select('*')
      .eq('room_name', room_name)
      .order('created_at', { ascending: false });

    return { data, error };
  });
};

export const saveTranslation = async (data: { id: string, user_id: string, source_lang: string, target_lang: string, original_text: string, translated_text: string }) => {
  return withRetry(async () => {
    const { error } = await supabase
      .from('translations')
      .insert([{
        id: data.id,
        user_id: data.user_id,
        source_lang: data.source_lang,
        target_lang: data.target_lang,
        original_text: data.original_text,
        translated_text: data.translated_text,
        created_at: new Date().toISOString()
      }]);

    if (error) console.error('Supabase Insert Error (Translations):', error.message);
    return { error };
  });
};