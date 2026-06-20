import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client untuk operasi yang bypass RLS (mis. cron cleanup di Plan 3).
 * HANYA dipakai di server-side route handlers yang diauthorisasi (mis. cron secret).
 */
export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
