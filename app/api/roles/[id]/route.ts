import { NextResponse, type NextRequest } from 'next/server';
import { newEvent } from '@/lib/logger';
import { guardSuperadmin } from '@/lib/auth/session';
import { getSupabaseServer } from '@/lib/supabase/server';
import { RoleWriteSchema } from '../_schemas';

// PostgREST error code returned by `.single()` when zero rows match.
const NOT_FOUND_CODE = 'PGRST116';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const evt = newEvent('PATCH /api/roles/[id]', { role_id: id });
  try {
    const supabase = await getSupabaseServer();
    const g = await guardSuperadmin(evt);
    if (!g.ok) return g.response;

    const parsed = RoleWriteSchema.safeParse(await request.json());
    if (!parsed.success) {
      evt.merge({ status: 400 });
      return NextResponse.json(
        { error: 'invalid_body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const payload = parsed.data;
    evt.merge({ role_name: payload.name, permission_count: payload.permissions.length });

    const { error: updateErr } = await supabase
      .from('roles')
      .update({ name: payload.name, description: payload.description })
      .eq('id', id)
      .select('id')
      .single();
    if (updateErr) {
      if (updateErr.code === NOT_FOUND_CODE) {
        evt.merge({ status: 404 });
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      if (updateErr.code === '23505') {
        evt.merge({ status: 409, blocked: 'duplicate_name' });
        return NextResponse.json({ error: 'duplicate_name' }, { status: 409 });
      }
      evt.merge({ status: 500 });
      evt.error(updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Ganti seluruh set izin lewat SQL function (migrasi 0045): DELETE + INSERT
    // jalan dalam SATU transaksi Postgres, jadi tidak ada jendela di mana role
    // bisa nyangkut tanpa izin sama sekali kalau langkah kedua gagal. Lebih
    // sederhana & bebas kondisi balapan dibanding menghitung selisih; jumlah
    // barisnya belasan.
    const { error: rpcErr } = await supabase.rpc('set_role_permissions', {
      p_role_id: id,
      p_keys: payload.permissions,
    });
    if (rpcErr) {
      evt.merge({ status: 500 });
      evt.error(rpcErr);
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    const { count } = await supabase
      .from('profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('role_id', id);

    evt.merge({ status: 200 });
    return NextResponse.json({
      role: {
        id,
        name: payload.name,
        description: payload.description,
        permissions: payload.permissions,
        user_count: count ?? 0,
      },
    });
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
  const evt = newEvent('DELETE /api/roles/[id]', { role_id: id });
  try {
    const supabase = await getSupabaseServer();
    const g = await guardSuperadmin(evt);
    if (!g.ok) return g.response;

    const { error } = await supabase.from('roles').delete().eq('id', id).select('id').single();
    if (error) {
      if (error.code === NOT_FOUND_CODE) {
        evt.merge({ status: 404 });
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      // ON DELETE RESTRICT di profiles.role_id menolak dengan kode ini kalau
      // role masih dipakai.
      if (error.code === '23503') {
        evt.merge({ status: 409, blocked: 'role_in_use' });
        return NextResponse.json(
          {
            error: 'role_in_use',
            detail: 'Role ini masih dipakai. Pindahkan akunnya ke role lain dulu.',
          },
          { status: 409 },
        );
      }
      evt.merge({ status: 500 });
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
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
