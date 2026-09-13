import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. BYPASSES Row-Level Security.
 *
 * Boleh dipakai di: cron job, admin script, dan permukaan manajemen pengguna yang
 * dikunci superadmin — membaca/menulis akun Supabase Auth memang menuntut
 * service-role key. Hari ini itu berarti:
 *   - `app/api/users/**` (route handler, di belakang `guardSuperadmin()`);
 *   - `app/(app)/setup/users/page.tsx` (server component, di belakang
 *     `requireSuperadmin()`) — halaman ini perlu `auth.admin.listUsers()` untuk
 *     menampilkan akun yatim, yaitu auth user yang baris `profiles`-nya tidak ada.
 *     Akun seperti itu menurut definisinya tidak terlihat lewat PostgREST.
 *
 * Syarat mutlak di mana pun yang user-facing: panggilan HARUS berada di belakang
 * gerbang superadmin (`guardSuperadmin()` di route handler, `requireSuperadmin()`
 * di server component) dan — untuk route handler — dicatat di wide-event. Jangan
 * pernah memakainya di jalur yang bisa dicapai non-superadmin.
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
