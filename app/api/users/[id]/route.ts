import { NextResponse, type NextRequest } from 'next/server';
import { newEvent } from '@/lib/logger';
import { guardSuperadmin } from '@/lib/auth/session';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { canDemoteSuperadmin } from '@/lib/permissions';
import { UpdateUserSchema } from '../_schemas';

const LAST_SUPERADMIN_RESPONSE = {
  error: 'last_superadmin',
  detail: 'Ini superadmin terakhir. Angkat orang lain dulu.',
} as const;

/**
 * Apakah kegagalan ini datang dari constraint trigger `profiles_last_superadmin_guard`
 * (migrasi 0048)?
 *
 * Cek JS di bawah menangkap jalur umum, tapi tiga langkahnya (baca → putuskan →
 * tulis) tidak atomik: dua request bersamaan yang menurunkan dua superadmin
 * BERBEDA sama-sama lolos cek itu. Trigger DB yang menangkapnya, dan errornya
 * harus keluar sebagai 409 yang sama supaya kasir/owner tidak melihat 500 misterius.
 *
 * Dicocokkan lewat DUA jalan karena dua rute tulis yang berbeda:
 *   - PATCH menulis `profiles` lewat PostgREST → `error.code` = SQLSTATE ('23514');
 *   - DELETE menulis lewat GoTrue (`auth.admin.deleteUser`) yang mengandalkan
 *     ON DELETE CASCADE ke `profiles`. GoTrue membungkus ulang error DB-nya dan
 *     tidak menjamin SQLSTATE ikut lolos, jadi token `last_superadmin` di teks
 *     pesan yang jadi sandaran kedua.
 */
function isLastSuperadminViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === '23514') return true;
  return typeof e.message === 'string' && e.message.includes('last_superadmin');
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const evt = newEvent('PATCH /api/users/[id]', { target_user_id: id });
  try {
    const g = await guardSuperadmin(evt);
    if (!g.ok) return g.response;

    const parsed = UpdateUserSchema.safeParse(await request.json());
    if (!parsed.success) {
      evt.merge({ status: 400 });
      return NextResponse.json(
        { error: 'invalid_body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const patch = parsed.data;

    const admin = getSupabaseAdmin();

    // Penjagaan superadmin terakhir. Dicek di SERVER — tombol yang di-disable di UI
    // bukan penjagaan, cuma kesopanan.
    const losesSuperadmin = patch.is_superadmin === false || patch.is_active === false;
    if (losesSuperadmin) {
      const { data: sas } = await admin
        .from('profiles')
        .select('user_id')
        .eq('is_superadmin', true)
        .eq('is_active', true);
      const activeSuperadminIds = (sas ?? []).map((r) => r.user_id);
      if (!canDemoteSuperadmin(activeSuperadminIds, id)) {
        evt.merge({ status: 409, blocked: 'last_superadmin' });
        return NextResponse.json(LAST_SUPERADMIN_RESPONSE, { status: 409 });
      }
    }

    if (patch.password !== undefined) {
      const { error: pwErr } = await admin.auth.admin.updateUserById(id, {
        password: patch.password,
      });
      if (pwErr) {
        evt.merge({ status: 400 });
        evt.error(pwErr);
        return NextResponse.json({ error: pwErr.message }, { status: 400 });
      }
      // Jangan pernah menulis password itu sendiri ke log — cuma boolean penanda.
      evt.merge({ password_changed: true });
    }

    const profilePatch: Record<string, unknown> = {};
    if (patch.display_name !== undefined) profilePatch.display_name = patch.display_name;
    if (patch.role_id !== undefined) profilePatch.role_id = patch.role_id;
    if (patch.is_active !== undefined) profilePatch.is_active = patch.is_active;
    if (patch.is_superadmin !== undefined) profilePatch.is_superadmin = patch.is_superadmin;

    if (Object.keys(profilePatch).length > 0) {
      const { error: updateErr } = await admin
        .from('profiles')
        .update(profilePatch)
        .eq('user_id', id);
      if (updateErr) {
        // Backstop trigger DB kebobolan cek JS di atas (dua demosi bersamaan).
        if (isLastSuperadminViolation(updateErr)) {
          evt.merge({ status: 409, blocked: 'last_superadmin', blocked_by: 'db_trigger' });
          return NextResponse.json(LAST_SUPERADMIN_RESPONSE, { status: 409 });
        }
        evt.merge({ status: 500 });
        evt.error(updateErr);
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
    }

    evt.merge({
      status: 200,
      patched_fields: Object.keys(patch).filter((k) => k !== 'password'),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    evt.merge({ status: 500 });
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const evt = newEvent('DELETE /api/users/[id]', { target_user_id: id });
  try {
    const g = await guardSuperadmin(evt);
    if (!g.ok) return g.response;

    const admin = getSupabaseAdmin();

    // Penjagaan superadmin terakhir — untuk DELETE, "kehilangan superadmin" selalu
    // benar (akun lenyap sepenuhnya), jadi cek ini tidak boleh dilewati oleh
    // cabang kode apa pun. Dijalankan SEBELUM baris delete di bawah.
    const { data: sas } = await admin
      .from('profiles')
      .select('user_id')
      .eq('is_superadmin', true)
      .eq('is_active', true);
    const activeSuperadminIds = (sas ?? []).map((r) => r.user_id);
    if (!canDemoteSuperadmin(activeSuperadminIds, id)) {
      evt.merge({ status: 409, blocked: 'last_superadmin' });
      return NextResponse.json(LAST_SUPERADMIN_RESPONSE, { status: 409 });
    }

    // Baris profiles ikut terhapus lewat ON DELETE CASCADE — tidak perlu delete manual.
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) {
      // Backstop trigger DB kebobolan cek JS di atas (dua penghapusan bersamaan).
      if (isLastSuperadminViolation(delErr)) {
        evt.merge({ status: 409, blocked: 'last_superadmin', blocked_by: 'db_trigger' });
        return NextResponse.json(LAST_SUPERADMIN_RESPONSE, { status: 409 });
      }
      evt.merge({ status: 500 });
      evt.error(delErr);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    evt.merge({ status: 200 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    evt.merge({ status: 500 });
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
