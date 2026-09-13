import { NextResponse, type NextRequest } from 'next/server';
import { newEvent } from '@/lib/logger';
import { guardSuperadmin } from '@/lib/auth/session';
import { getSupabaseServer } from '@/lib/supabase/server';
import { RoleWriteSchema } from './_schemas';

type RoleListRow = {
  id: string;
  name: string;
  description: string | null;
  role_permissions: { permission_key: string }[];
};

export async function GET() {
  const evt = newEvent('GET /api/roles');
  try {
    const supabase = await getSupabaseServer();
    const g = await guardSuperadmin(evt);
    if (!g.ok) return g.response;

    const { data, error } = await supabase
      .from('roles')
      .select('id, name, description, role_permissions(permission_key)')
      .order('name');
    if (error) {
      evt.merge({ status: 500 });
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Satu query untuk semua profil, dipakai menghitung user_count per role —
    // jauh lebih murah dibanding satu query count per role.
    const { data: profileRoles, error: profileErr } = await supabase
      .from('profiles')
      .select('role_id');
    if (profileErr) {
      evt.merge({ status: 500 });
      evt.error(profileErr);
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    const countByRoleId = new Map<string, number>();
    for (const p of profileRoles ?? []) {
      if (!p.role_id) continue;
      countByRoleId.set(p.role_id, (countByRoleId.get(p.role_id) ?? 0) + 1);
    }

    const roles = (data as RoleListRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.role_permissions.map((rp) => rp.permission_key),
      user_count: countByRoleId.get(r.id) ?? 0,
    }));

    evt.merge({ status: 200, role_count: roles.length });
    return NextResponse.json({ roles });
  } catch (err) {
    evt.merge({ status: 500 });
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/roles');
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

    const { data: createdRole, error: roleErr } = await supabase
      .from('roles')
      .insert({ name: payload.name, description: payload.description })
      .select()
      .single();
    if (roleErr) {
      if (roleErr.code === '23505') {
        evt.merge({ status: 409, blocked: 'duplicate_name' });
        return NextResponse.json({ error: 'duplicate_name' }, { status: 409 });
      }
      evt.merge({ status: 500 });
      evt.error(roleErr);
      return NextResponse.json({ error: roleErr.message }, { status: 500 });
    }

    if (payload.permissions.length > 0) {
      const rows = payload.permissions.map((permission_key) => ({
        role_id: createdRole.id,
        permission_key,
      }));
      const { error: permErr } = await supabase.from('role_permissions').insert(rows);
      if (permErr) {
        // Bersihkan role yatim supaya tidak nyangkut tanpa izin yang benar.
        //
        // Sengaja compensating delete, BUKAN `set_role_permissions` seperti di
        // PATCH /api/roles/[id]. Bedanya bukan gaya: di PATCH, role-nya sudah
        // dipakai orang, jadi jendela antara DELETE dan INSERT bisa mengunci
        // kasir yang sedang bekerja — itu butuh atomicity DB. Di sini role-nya
        // baru lahir sedetik lalu dan `role_id`-nya belum pernah dilihat siapa
        // pun, jadi kegagalan terburuknya cuma baris role yatim yang langsung
        // dihapus. Kalau delete ini sendiri gagal, yang tertinggal adalah role
        // tanpa izin yang tidak dipegang siapa-siapa — owner tinggal menghapusnya
        // dari /setup/roles.
        await supabase.from('roles').delete().eq('id', createdRole.id);
        evt.merge({ status: 500, rolled_back_role: true });
        evt.error(permErr);
        return NextResponse.json({ error: permErr.message }, { status: 500 });
      }
    }

    evt.merge({ status: 201, new_role_id: createdRole.id });
    return NextResponse.json(
      {
        role: {
          id: createdRole.id,
          name: createdRole.name,
          description: createdRole.description,
          permissions: payload.permissions,
          user_count: 0,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    evt.merge({ status: 500 });
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
