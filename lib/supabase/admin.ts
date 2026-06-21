import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. BYPASSES Row-Level Security.
 * USE ONLY in cron jobs and admin scripts. NEVER import from user-facing API routes.
 */
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY');
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
