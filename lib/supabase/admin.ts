import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. BYPASSES Row-Level Security.
 *
 * Boleh dipakai di: cron job, admin script, dan `app/api/users/**` — membuat akun
 * Supabase Auth memang menuntut service-role key.
 *
 * Syarat mutlak di route user-facing: panggilan HARUS berada di belakang
 * `guardSuperadmin()` dan dicatat di wide-event. Jangan pernah memakainya di
 * jalur yang bisa dicapai non-superadmin.
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
