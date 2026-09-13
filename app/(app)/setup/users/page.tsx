import { getSupabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { requireSuperadmin } from '@/lib/auth/session';
import { UsersClient, type UserRow, type RoleOption } from './users-client';

export const dynamic = 'force-dynamic';

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

export default async function UsersPage() {
  const actor = await requireSuperadmin();

  const supabase = await getSupabaseServer();

  // Bentuk sama dengan GET /api/users: satu query profiles + auth.admin.listUsers
  // untuk email (email hidup di auth.users, bukan profiles).
  const { data } = await supabase
    .from('profiles')
    .select('user_id, display_name, role_id, is_superadmin, is_active, roles(name)')
    .order('display_name');

  const admin = getSupabaseAdmin();
  const { data: authList } = await admin.auth.admin.listUsers({ perPage: 200 });
  const emailById = new Map((authList?.users ?? []).map((u) => [u.id, u.email ?? '']));

  const rows = ((data ?? []) as ProfileListRow[]).map((p) => ({
    user_id: p.user_id,
    email: emailById.get(p.user_id) ?? '',
    display_name: p.display_name,
    role_id: p.role_id,
    role_name: roleName(p.roles),
    is_superadmin: p.is_superadmin,
    is_active: p.is_active,
  }));

  // Akun auth tanpa baris profiles = pembuatan yang putus di tengah — tampilkan
  // supaya superadmin bisa membereskannya, bukan disembunyikan.
  const orphans: UserRow[] = (authList?.users ?? [])
    .filter((u) => !(data ?? []).some((p) => p.user_id === u.id))
    .map((u) => ({
      user_id: u.id,
      email: u.email ?? '',
      display_name: '(tanpa profil)',
      role_id: null,
      role_name: null,
      is_superadmin: false,
      is_active: false,
    }));

  const users: UserRow[] = [...rows, ...orphans];

  const { data: roleData } = await supabase.from('roles').select('id, name').order('name');
  const roles: RoleOption[] = (roleData ?? []).map((r) => ({ id: r.id, name: r.name }));

  return (
    /* Tanpa mx-auto/max-w/p sendiri: app/(app)/layout.tsx sudah memberi lebar dan
       padding halaman. Membungkus ulang di sini bikin padding dobel di HP. */
    <div className="space-y-6 md:space-y-8">
      <div className="max-w-2xl">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Setup
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Akun &amp; <span className="italic">Pengguna</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-coal-soft">
          Buat akun kasir baru, atur role-nya, dan nonaktifkan akun yang sudah tidak dipakai.
        </p>
      </div>
      <UsersClient initialUsers={users} roles={roles} currentUserId={actor.userId} />
    </div>
  );
}
