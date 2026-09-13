import { getSupabaseServer } from '@/lib/supabase/server';
import { requireSuperadmin } from '@/lib/auth/session';
import { RolesClient, type RoleRow } from './roles-client';

export const dynamic = 'force-dynamic';

type RoleListRow = {
  id: string;
  name: string;
  description: string | null;
  role_permissions: { permission_key: string }[];
};

export default async function RolesPage() {
  await requireSuperadmin();

  const supabase = await getSupabaseServer();

  // Bentuk sama dengan GET /api/roles: satu query roles + satu query profiles
  // untuk menghitung user_count per role, lebih murah dibanding count per role.
  const { data } = await supabase
    .from('roles')
    .select('id, name, description, role_permissions(permission_key)')
    .order('name');

  const { data: profileRoles } = await supabase.from('profiles').select('role_id');

  const countByRoleId = new Map<string, number>();
  for (const p of profileRoles ?? []) {
    if (!p.role_id) continue;
    countByRoleId.set(p.role_id, (countByRoleId.get(p.role_id) ?? 0) + 1);
  }

  const roles: RoleRow[] = ((data ?? []) as RoleListRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    permissions: r.role_permissions.map((rp) => rp.permission_key),
    user_count: countByRoleId.get(r.id) ?? 0,
  }));

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="max-w-2xl">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Setup
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Role &amp; <span className="italic">Izin</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-coal-soft">
          Atur role yang bisa dipakai akun, dan izin apa saja yang dipegang tiap role.
        </p>
      </div>
      <RolesClient initialRoles={roles} />
    </div>
  );
}
