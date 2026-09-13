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
