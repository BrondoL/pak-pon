import { NextResponse, type NextRequest } from 'next/server';
import { newEvent } from '@/lib/logger';
import { guardSuperadmin } from '@/lib/auth/session';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CreateUserSchema } from './_schemas';

type ProfileListRow = {
  user_id: string;
  display_name: string;
  role_id: string | null;
  is_superadmin: boolean;
  is_active: boolean;
  roles: { name: string } | { name: string }[] | null;
};

function roleName(rel: ProfileListRow['roles']): string | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0]?.name ?? null) : rel.name;
}

export async function GET() {
  const evt = newEvent('GET /api/users');
  try {
    const g = await guardSuperadmin(evt);
    if (!g.ok) return g.response;

    const supabase = await getSupabaseServer();
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, display_name, role_id, is_superadmin, is_active, roles(name)')
      .order('display_name');
    if (error) {
      evt.merge({ status: 500 });
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Email hidup di auth.users, bukan profiles — butuh service-role untuk membacanya.
    const admin = getSupabaseAdmin();
    const { data: authList, error: authErr } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (authErr) {
      evt.merge({ status: 500 });
      evt.error(authErr);
      return NextResponse.json({ error: authErr.message }, { status: 500 });
    }
    const emailById = new Map(authList.users.map((u) => [u.id, u.email ?? '']));

    const rows = (data as ProfileListRow[]).map((p) => ({
      user_id: p.user_id,
      email: emailById.get(p.user_id) ?? '',
      display_name: p.display_name,
      role_id: p.role_id,
      role_name: roleName(p.roles),
      is_superadmin: p.is_superadmin,
      is_active: p.is_active,
    }));

    // Akun auth tanpa baris profiles = pembuatan yang putus di tengah. Tampilkan
    // supaya superadmin bisa membereskannya, bukan disembunyikan.
    const orphans = authList.users
      .filter((u) => !data.some((p) => p.user_id === u.id))
      .map((u) => ({
        user_id: u.id,
        email: u.email ?? '',
        display_name: '(tanpa profil)',
        role_id: null,
        role_name: null,
        is_superadmin: false,
        is_active: false,
      }));

    evt.merge({ status: 200, user_count: rows.length, orphan_count: orphans.length });
    return NextResponse.json({ users: [...rows, ...orphans] });
  } catch (err) {
    evt.merge({ status: 500 });
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/users');
  try {
    const g = await guardSuperadmin(evt);
    if (!g.ok) return g.response;

    const parsed = CreateUserSchema.safeParse(await request.json());
    if (!parsed.success) {
      evt.merge({ status: 400 });
      return NextResponse.json(
        { error: 'invalid_body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const payload = parsed.data;
    evt.merge({ new_user_email: payload.email, new_user_superadmin: payload.is_superadmin });

    const admin = getSupabaseAdmin();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true, // kasir tidak membuka inbox; owner menyerahkan kredensial langsung
    });
    if (createErr || !created.user) {
      evt.merge({ status: 400 });
      evt.error(createErr ?? new Error('createUser mengembalikan user kosong'));
      return NextResponse.json(
        { error: createErr?.message ?? 'gagal membuat akun' },
        { status: 400 },
      );
    }

    const { error: profileErr } = await admin.from('profiles').insert({
      user_id: created.user.id,
      display_name: payload.display_name,
      role_id: payload.role_id,
      is_superadmin: payload.is_superadmin,
      is_active: true,
    });
    if (profileErr) {
      // Bersihkan akun auth-nya supaya tidak meninggalkan akun yatim yang bisa login.
      await admin.auth.admin.deleteUser(created.user.id);
      evt.merge({ status: 500, rolled_back_auth_user: true });
      evt.error(profileErr);
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    evt.merge({ status: 201, new_user_id: created.user.id });
    return NextResponse.json(
      {
        user: {
          user_id: created.user.id,
          email: payload.email,
          display_name: payload.display_name,
          role_id: payload.role_id,
          role_name: null,
          is_superadmin: payload.is_superadmin,
          is_active: true,
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
