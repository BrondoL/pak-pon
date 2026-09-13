import { cache } from 'react';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import {
  resolveActor,
  can,
  canAny,
  type Actor,
  type PermissionKey,
  type ProfileRow,
} from '@/lib/permissions';
import type { RequestEvent } from '@/lib/logger';

/** Select PostgREST untuk membangun Actor. Dipakai ulang di /api/users. */
export const PROFILE_SELECT =
  'user_id, display_name, is_superadmin, is_active, role_id, roles(name, role_permissions(permission_key))';

/**
 * Siapa yang sedang melakukan request.
 *
 * Dibungkus cache() React: dipanggil layout, page, DAN komponen di dalam request
 * yang sama hanya menghasilkan SATU query. Sengaja tidak menanam izin di JWT —
 * owner yang mencabut izin mengharapkan itu berlaku sekarang, bukan setelah
 * token refresh sejam kemudian.
 *
 * null = tanpa izin apa pun: belum login, belum punya profil, atau dinonaktifkan.
 */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('user_id', user.id)
    .maybeSingle();

  // Dua sebab `data === null` yang HASILNYA SAMA tapi ARTINYA berlawanan:
  //   (a) tidak ada baris — akun memang belum diberi akses / dinonaktifkan;
  //   (b) query-nya gagal — DB down, RLS salah, PostgREST error sesaat.
  // Keduanya sengaja tetap gagal ke arah aman (null = tanpa izin) — akses tidak
  // boleh diberikan cuma karena pengecekannya error. Tapi keduanya HARUS bisa
  // dibedakan di log: (a) normal dan diharapkan, (b) insiden yang mengunci SEMUA
  // orang termasuk owner di luar aplikasi. Tanpa baris ini, keduanya tampil
  // identik sebagai "user mendarat di /no-access" dan penyebabnya tak terlacak.
  //
  // console.error ke stderr, JSON satu baris — konvensi yang sama dengan
  // lib/logger.ts (stdout-JSON). Sengaja BUKAN wide-event: fungsi ini juga
  // dipanggil dari server component yang tidak punya RequestEvent.
  if (error) {
    console.error(
      JSON.stringify({
        event: 'get_current_actor_query_failed',
        ts: new Date().toISOString(),
        user_id: user.id,
        pg_code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      }),
    );
  }

  return resolveActor((data as ProfileRow | null) ?? null);
});

export function buildActorTags(actor: Actor): { user_id: string; actor_role: string | null } {
  return {
    user_id: actor.userId,
    actor_role: actor.isSuperadmin ? 'superadmin' : actor.roleName,
  };
}

export function tagActor(evt: RequestEvent, actor: Actor): void {
  evt.merge(buildActorTags(actor));
}

// ---------- Server component ----------

export async function requirePermission(key: PermissionKey): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect('/login');
  if (!can(actor, key)) redirect(`/403?p=${encodeURIComponent(key)}`);
  return actor;
}

export async function requireAnyPermission(keys: PermissionKey[]): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect('/login');
  if (!canAny(actor, keys)) redirect(`/403?p=${encodeURIComponent(keys[0])}`);
  return actor;
}

export async function requireSuperadmin(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect('/login');
  if (!actor.isSuperadmin) redirect('/403?p=superadmin');
  return actor;
}

// ---------- Route handler ----------

export type GuardResult = { ok: true; actor: Actor } | { ok: false; response: NextResponse };

/**
 * Gerbang untuk route handler. Menandai wide-event supaya percobaan akses nyasar
 * kelihatan di log (`permission_denied`), bukan hilang diam-diam.
 */
export async function guard(evt: RequestEvent, key: PermissionKey): Promise<GuardResult> {
  const actor = await getCurrentActor();
  if (!actor) {
    evt.set('status', 401);
    return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  tagActor(evt, actor);
  if (!can(actor, key)) {
    evt.merge({ status: 403, permission_denied: key });
    return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true, actor };
}

export async function guardSuperadmin(evt: RequestEvent): Promise<GuardResult> {
  const actor = await getCurrentActor();
  if (!actor) {
    evt.set('status', 401);
    return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  tagActor(evt, actor);
  if (!actor.isSuperadmin) {
    evt.merge({ status: 403, permission_denied: 'superadmin' });
    return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true, actor };
}
