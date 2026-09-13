# Multi-Akun & Role dengan Permission Dinamis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah Pak Pon dari satu akun bersama yang bisa apa saja menjadi banyak akun dengan role dinamis yang izinnya diatur owner lewat UI, dijaga di sisi server.

**Architecture:** Katalog izin hidup di kode (`lib/permissions.ts`) sebagai fungsi murni yang bisa diuji tanpa DB; role dan centang izinnya hidup di DB (`roles`, `role_permissions`, `profiles`). Satu gerbang `lib/auth/session.ts` memakai `cache()` React sehingga satu request = satu query, dipakai server component (`requirePermission` → redirect) maupun route handler (`guard` → 403 + wide-event). Manajemen user/role eksklusif superadmin dan sengaja bukan izin yang bisa dicentang.

**Tech Stack:** Next.js 16 (App Router, server components), Supabase (Postgres + Auth + RLS), Zod, Vitest (jsdom, fungsi murni), Tailwind v4 dengan token `app/globals.css`, komponen `components/ui/` (fork base-ui).

**Spec:** `docs/superpowers/specs/2026-09-13-multi-user-roles-design.md`
**Branch:** `feat/multi-user-roles`

## Global Constraints

- Bahasa UI: **Bahasa Indonesia**. Label izin dan pesan error ditulis untuk owner warung, bukan developer.
- Uang: `bigint` rupiah, format `formatRp()` dari `lib/currency.ts`.
- Timezone: Asia/Jakarta.
- Validasi: **Zod di semua batas API route**.
- Logging: wide-event — `newEvent()` di awal, `try/catch/finally`, `evt.emit()` di `finally`. Lihat `docs/logging.md`.
- Styling: **hanya token** dari `app/globals.css` (`text-coal`, `bg-paper-soft`, `border-clay-soft`, dst). Jangan hardcode hex.
- UI: pakai `components/ui/` yang sudah ada (`dialog`, `alert-dialog`, `select`, `switch`, `input`, `label`, `button`, `card`). **Dilarang** `window.confirm` / `alert` / `prompt`.
- Schema source of truth: `supabase/migrations/*.sql`. Nomor migrasi berurutan, jangan menimpa yang sudah ada.
- Next.js 16: baca `node_modules/next/dist/docs/01-app/` sebelum menulis route handler / dynamic API baru.
- Test: `npm run test`. ⚠️ Kalau ada test gagal dan outputnya berbunyi `STACK_TRACE_ERROR`, jalankan ulang dengan `rtk proxy npx vitest run` untuk melihat penyebab asli.
- Tidak ada test integrasi DB di repo ini. Semua test = **fungsi murni**. Jangan membuat harness Supabase palsu.
- Commit tiap akhir task.

---

### Task 1: Katalog izin + fungsi murni

**Files:**
- Create: `lib/permissions.ts`
- Test: `lib/permissions.test.ts`

**Interfaces:**
- Consumes: tidak ada (task pertama, tanpa dependensi)
- Produces:
  - `type PermissionKey` (union 13 kunci literal)
  - `type PermissionGroup = 'Operasional' | 'Transaksi' | 'Laporan' | 'Menu' | 'Setup'`
  - `PERMISSIONS: PermissionDef[]` dengan `PermissionDef = { key: PermissionKey; label: string; group: PermissionGroup; hint: string }`
  - `PERMISSION_KEYS: PermissionKey[]`
  - `KASIR_SEED_PERMISSIONS: PermissionKey[]`
  - `isPermissionKey(v: string): v is PermissionKey`
  - `type Actor = { userId: string; displayName: string; roleId: string | null; roleName: string | null; isSuperadmin: boolean; permissions: Set<PermissionKey> }`
  - `type ProfileRow` (bentuk baris dari Supabase, lihat kode)
  - `resolveActor(row: ProfileRow | null): Actor | null`
  - `can(actor: Actor | null, key: PermissionKey): boolean`
  - `canAny(actor: Actor | null, keys: PermissionKey[]): boolean`
  - `canDemoteSuperadmin(activeSuperadminIds: string[], targetUserId: string): boolean`

- [ ] **Step 1: Tulis test yang gagal**

Buat `lib/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  KASIR_SEED_PERMISSIONS,
  isPermissionKey,
  resolveActor,
  can,
  canAny,
  canDemoteSuperadmin,
  type ProfileRow,
} from './permissions';

function row(over: Partial<ProfileRow> = {}): ProfileRow {
  return {
    user_id: 'u1',
    display_name: 'Kasir 1',
    is_superadmin: false,
    is_active: true,
    role_id: 'r1',
    roles: { name: 'Kasir', role_permissions: [{ permission_key: 'pos.use' }] },
    ...over,
  };
}

describe('katalog', () => {
  it('kunci unik dan label tidak kosong', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const p of PERMISSIONS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
    }
  });

  it('tidak ada kunci manajemen user — itu eksklusif superadmin, bukan izin', () => {
    expect(PERMISSION_KEYS.some((k) => k.startsWith('users.'))).toBe(false);
    expect(PERMISSION_KEYS.some((k) => k.startsWith('roles.'))).toBe(false);
  });

  it('seed Kasir tidak memberi laporan bulanan, hapus transaksi, kelola menu, atau setup', () => {
    expect(KASIR_SEED_PERMISSIONS).toContain('pos.use');
    expect(KASIR_SEED_PERMISSIONS).toContain('reports.daily.view');
    expect(KASIR_SEED_PERMISSIONS).not.toContain('reports.monthly.view');
    expect(KASIR_SEED_PERMISSIONS).not.toContain('transactions.delete');
    expect(KASIR_SEED_PERMISSIONS).not.toContain('menu.manage');
    expect(KASIR_SEED_PERMISSIONS.some((k) => k.startsWith('setup.'))).toBe(false);
  });

  it('semua seed Kasir adalah kunci yang sah', () => {
    for (const k of KASIR_SEED_PERMISSIONS) expect(isPermissionKey(k)).toBe(true);
  });
});

describe('resolveActor', () => {
  it('null kalau baris profil tidak ada', () => {
    expect(resolveActor(null)).toBeNull();
  });

  it('null kalau akun dinonaktifkan', () => {
    expect(resolveActor(row({ is_active: false }))).toBeNull();
  });

  it('null kalau akun dinonaktifkan walau superadmin', () => {
    expect(resolveActor(row({ is_active: false, is_superadmin: true }))).toBeNull();
  });

  it('mengumpulkan izin dari role', () => {
    const actor = resolveActor(row());
    expect(actor?.permissions.has('pos.use')).toBe(true);
    expect(actor?.roleName).toBe('Kasir');
  });

  it('membuang kunci yang tidak ada di katalog (sisa izin yang sudah dihapus)', () => {
    const actor = resolveActor(
      row({ roles: { name: 'Kasir', role_permissions: [{ permission_key: 'izin.hantu' }] } }),
    );
    expect(actor?.permissions.size).toBe(0);
  });

  it('menerima relasi roles berbentuk array (PostgREST kadang mengembalikan array)', () => {
    const actor = resolveActor(
      row({ roles: [{ name: 'Kasir', role_permissions: [{ permission_key: 'pos.use' }] }] as never }),
    );
    expect(actor?.permissions.has('pos.use')).toBe(true);
  });

  it('superadmin tanpa role tetap valid', () => {
    const actor = resolveActor(row({ is_superadmin: true, role_id: null, roles: null }));
    expect(actor?.isSuperadmin).toBe(true);
    expect(actor?.permissions.size).toBe(0);
  });
});

describe('can', () => {
  it('false kalau actor null', () => {
    expect(can(null, 'pos.use')).toBe(false);
  });

  it('superadmin selalu true walau permissions kosong', () => {
    const actor = resolveActor(row({ is_superadmin: true, roles: null }));
    expect(can(actor, 'reports.monthly.view')).toBe(true);
    expect(can(actor, 'setup.ai_usage')).toBe(true);
  });

  it('kasir ditolak untuk izin yang tidak dicentang', () => {
    const actor = resolveActor(row());
    expect(can(actor, 'pos.use')).toBe(true);
    expect(can(actor, 'reports.monthly.view')).toBe(false);
  });

  it('canAny true kalau salah satu dipegang', () => {
    const actor = resolveActor(row());
    expect(canAny(actor, ['reports.monthly.view', 'pos.use'])).toBe(true);
    expect(canAny(actor, ['reports.monthly.view', 'setup.printer'])).toBe(false);
  });
});

describe('canDemoteSuperadmin', () => {
  it('menolak menurunkan superadmin terakhir', () => {
    expect(canDemoteSuperadmin(['u1'], 'u1')).toBe(false);
  });

  it('mengizinkan kalau masih ada superadmin lain', () => {
    expect(canDemoteSuperadmin(['u1', 'u2'], 'u1')).toBe(true);
  });

  it('target yang bukan superadmin tidak mengurangi jumlah', () => {
    expect(canDemoteSuperadmin(['u1'], 'u9')).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm run test -- lib/permissions.test.ts`
Expected: FAIL — `Failed to resolve import "./permissions"`

- [ ] **Step 3: Tulis implementasi**

Buat `lib/permissions.ts`:

```ts
/**
 * Katalog izin. SUMBER KEBENARAN tunggal soal izin apa saja yang ada.
 *
 * Sengaja di kode, bukan di DB: sebuah izin hanya berarti kalau ada kode yang
 * mengeceknya. Menaruh katalognya di sini membuat "tambah halaman = tambah satu
 * baris", dan mustahil ada izin nyangkut di DB yang tidak menjaga apa-apa.
 *
 * TIDAK ADA kunci untuk kelola user/role: itu eksklusif superadmin. Kalau jadi izin
 * biasa, sebuah role bisa dipakai mengangkat dirinya sendiri jadi superadmin.
 */

export type PermissionKey =
  | 'scan.use'
  | 'pos.use'
  | 'monitor.use'
  | 'print.send'
  | 'transactions.view'
  | 'transactions.edit'
  | 'transactions.delete'
  | 'reports.daily.view'
  | 'reports.monthly.view'
  | 'menu.view'
  | 'menu.manage'
  | 'setup.printer'
  | 'setup.ai_usage';

export type PermissionGroup = 'Operasional' | 'Transaksi' | 'Laporan' | 'Menu' | 'Setup';

export type PermissionDef = {
  key: PermissionKey;
  label: string;
  group: PermissionGroup;
  hint: string;
};

export const PERMISSIONS: PermissionDef[] = [
  { key: 'scan.use',    group: 'Operasional', label: 'Scan nota',        hint: 'Foto nota dan biarkan AI membacanya' },
  { key: 'pos.use',     group: 'Operasional', label: 'Buat pesanan',     hint: 'Input pesanan langsung lewat POS' },
  { key: 'monitor.use', group: 'Operasional', label: 'Monitor pesanan',  hint: 'Papan pesanan belum bayar, tandai lunas, tambah item' },
  { key: 'print.send',  group: 'Operasional', label: 'Cetak',            hint: 'Kirim tiket dapur dan nota ke printer' },

  { key: 'transactions.view',   group: 'Transaksi', label: 'Lihat history',     hint: 'Daftar transaksi, detail, dan ringkasan pemasukan di beranda' },
  { key: 'transactions.edit',   group: 'Transaksi', label: 'Ubah transaksi',    hint: 'Review dan perbaiki isi transaksi' },
  { key: 'transactions.delete', group: 'Transaksi', label: 'Hapus transaksi',   hint: 'Hapus transaksi dan pulihkan dari kotak sampah' },

  { key: 'reports.daily.view',   group: 'Laporan', label: 'Laporan harian',  hint: 'Closingan hari berjalan' },
  { key: 'reports.monthly.view', group: 'Laporan', label: 'Laporan bulanan', hint: 'Omzet sebulan dan menu terlaris' },

  { key: 'menu.view',   group: 'Menu', label: 'Lihat menu master', hint: 'Melihat daftar menu dan harga, tanpa mengubah' },
  { key: 'menu.manage', group: 'Menu', label: 'Kelola menu',       hint: 'Tambah, ubah harga, hapus menu dan pilihan chip' },

  { key: 'setup.printer',  group: 'Setup', label: 'Setting printer', hint: 'Atur printer, agent, dan lihat riwayat cetak' },
  { key: 'setup.ai_usage', group: 'Setup', label: 'Pemakaian AI',    hint: 'Biaya dan token OCR harian' },
];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

const KEY_SET = new Set<string>(PERMISSION_KEYS);

export function isPermissionKey(v: string): v is PermissionKey {
  return KEY_SET.has(v);
}

/** Izin bawaan role "Kasir" yang di-seed migrasi 0042. Owner bebas mengubahnya nanti. */
export const KASIR_SEED_PERMISSIONS: PermissionKey[] = [
  'scan.use',
  'pos.use',
  'monitor.use',
  'print.send',
  'transactions.view',
  'transactions.edit',
  'reports.daily.view',
  'menu.view',
];

export type RoleRelation = {
  name: string;
  role_permissions: { permission_key: string }[];
};

export type ProfileRow = {
  user_id: string;
  display_name: string;
  is_superadmin: boolean;
  is_active: boolean;
  role_id: string | null;
  roles: RoleRelation | RoleRelation[] | null;
};

export type Actor = {
  userId: string;
  displayName: string;
  roleId: string | null;
  roleName: string | null;
  isSuperadmin: boolean;
  permissions: Set<PermissionKey>;
};

/**
 * PostgREST mengembalikan relasi to-one sebagai objek, tapi beberapa bentuk query
 * mengembalikannya sebagai array berisi satu elemen. Normalkan supaya pemanggil
 * tidak perlu peduli.
 */
function firstRole(rel: ProfileRow['roles']): RoleRelation | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

/**
 * Baris profil → Actor. `null` berarti tanpa izin apa pun (fail closed):
 * belum punya profil, atau akunnya dinonaktifkan.
 */
export function resolveActor(row: ProfileRow | null): Actor | null {
  if (!row) return null;
  if (!row.is_active) return null;

  const role = firstRole(row.roles);
  const permissions = new Set<PermissionKey>();
  for (const rp of role?.role_permissions ?? []) {
    // Kunci yang tidak dikenal = sisa izin yang sudah dihapus dari katalog. Abaikan.
    if (isPermissionKey(rp.permission_key)) permissions.add(rp.permission_key);
  }

  return {
    userId: row.user_id,
    displayName: row.display_name,
    roleId: row.role_id,
    roleName: role?.name ?? null,
    isSuperadmin: row.is_superadmin,
    permissions,
  };
}

export function can(actor: Actor | null, key: PermissionKey): boolean {
  if (!actor) return false;
  if (actor.isSuperadmin) return true;
  return actor.permissions.has(key);
}

export function canAny(actor: Actor | null, keys: PermissionKey[]): boolean {
  return keys.some((k) => can(actor, k));
}

/**
 * Boleh menurunkan/menonaktifkan/menghapus superadmin `targetUserId`?
 * Tidak, kalau dia satu-satunya yang tersisa — owner tidak boleh mengunci dirinya di luar.
 */
export function canDemoteSuperadmin(activeSuperadminIds: string[], targetUserId: string): boolean {
  return activeSuperadminIds.filter((id) => id !== targetUserId).length >= 1;
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm run test -- lib/permissions.test.ts`
Expected: PASS, semua test hijau.

- [ ] **Step 5: Commit**

```bash
git add lib/permissions.ts lib/permissions.test.ts
git commit -m "feat(auth): katalog izin + fungsi murni resolveActor/can"
```

---

### Task 2: Migrasi tabel role & profil

**Files:**
- Create: `supabase/migrations/0042_roles_and_profiles.sql`

**Interfaces:**
- Consumes: `KASIR_SEED_PERMISSIONS` dari Task 1 (disalin sebagai literal SQL — harus sama persis)
- Produces: tabel `roles`, `role_permissions`, `profiles`; fungsi `public.is_superadmin(uuid)`, `public.has_permission(uuid, text)`

- [ ] **Step 1: Tulis migrasi**

Buat `supabase/migrations/0042_roles_and_profiles.sql`:

```sql
-- 0042_roles_and_profiles.sql
-- Multi-akun + role dinamis.
-- Spec: docs/superpowers/specs/2026-09-13-multi-user-roles-design.md
--
-- Katalog izin (kunci apa saja yang ADA) tidak disimpan di sini — sumber kebenarannya
-- lib/permissions.ts. Tabel ini hanya menyimpan role buatan owner + izin yang dicentang.
-- Kunci yang tidak dikenal lib/permissions.ts diabaikan resolveActor(), jadi menghapus
-- izin dari katalog tidak perlu migrasi pembersih.

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE profiles (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  -- RESTRICT: role yang masih dipakai tidak bisa dihapus; owner harus memindahkan
  -- orangnya dulu. Pola yang sama dengan DELETE primary agent yang diblok 409.
  role_id       uuid REFERENCES roles(id) ON DELETE RESTRICT,
  is_superadmin boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role ON profiles(role_id);
CREATE INDEX idx_profiles_superadmin ON profiles(user_id) WHERE is_superadmin AND is_active;

-- ------------------------------------------------------------
-- Fungsi penjaga
-- ⚠️ WAJIB SECURITY DEFINER. Policy RLS di `profiles` yang membaca `profiles`
-- secara langsung menyebabkan REKURSI TAK TERHINGGA — jebakan klasik Supabase.
-- search_path dikunci, pola sama dengan RPC report_* di migrasi 0034.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_superadmin(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = p_uid AND is_superadmin AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_uid uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = p_uid
      AND p.is_active
      AND (
        p.is_superadmin
        OR EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = p.role_id AND rp.permission_key = p_key
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_superadmin(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.is_superadmin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;

-- roles + role_permissions: siapa pun yang login boleh BACA (setiap user perlu
-- membaca izinnya sendiri, dan daftar nama role tidak sensitif). Tulis: superadmin saja.
CREATE POLICY roles_read   ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY roles_insert ON roles FOR INSERT TO authenticated WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY roles_update ON roles FOR UPDATE TO authenticated
  USING (public.is_superadmin(auth.uid())) WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY roles_delete ON roles FOR DELETE TO authenticated USING (public.is_superadmin(auth.uid()));

CREATE POLICY rp_read   ON role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY rp_insert ON role_permissions FOR INSERT TO authenticated WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY rp_update ON role_permissions FOR UPDATE TO authenticated
  USING (public.is_superadmin(auth.uid())) WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY rp_delete ON role_permissions FOR DELETE TO authenticated USING (public.is_superadmin(auth.uid()));

-- profiles: baca baris sendiri, atau semua baris kalau superadmin. Tulis: superadmin saja.
CREATE POLICY profiles_read ON profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_superadmin(auth.uid()));
CREATE POLICY profiles_insert ON profiles FOR INSERT TO authenticated WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
  USING (public.is_superadmin(auth.uid())) WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY profiles_delete ON profiles FOR DELETE TO authenticated USING (public.is_superadmin(auth.uid()));

-- ------------------------------------------------------------
-- Backfill: semua akun yang SUDAH ADA jadi superadmin.
-- Sekarang itu berarti akun bersama owner — supaya setelah deploy tidak ada
-- yang terkunci di luar aplikasinya sendiri.
-- ------------------------------------------------------------
INSERT INTO profiles (user_id, display_name, is_superadmin)
SELECT u.id, coalesce(nullif(split_part(u.email, '@', 1), ''), 'Owner'), true
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-- ------------------------------------------------------------
-- Seed role "Kasir". Harus sama persis dengan KASIR_SEED_PERMISSIONS
-- di lib/permissions.ts.
-- ------------------------------------------------------------
INSERT INTO roles (name, description)
VALUES ('Kasir', 'Operasional harian: POS, monitor, laporan harian')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, k
FROM roles r
CROSS JOIN unnest(ARRAY[
  'scan.use',
  'pos.use',
  'monitor.use',
  'print.send',
  'transactions.view',
  'transactions.edit',
  'reports.daily.view',
  'menu.view'
]) AS k
WHERE r.name = 'Kasir'
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Terapkan migrasi ke DB**

Pakai MCP Supabase `apply_migration` dengan nama `0042_roles_and_profiles`, isi file di atas.

- [ ] **Step 3: Verifikasi hasilnya**

Jalankan lewat MCP Supabase `execute_sql`:

```sql
SELECT user_id, display_name, is_superadmin, is_active FROM profiles;
SELECT r.name, count(rp.permission_key) AS jml_izin
FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
GROUP BY r.name;
```

Expected: satu baris `profiles` dengan `is_superadmin = true` (akun bersama owner), dan role `Kasir` dengan `jml_izin = 8`.

- [ ] **Step 4: Verifikasi tidak ada rekursi RLS**

```sql
SELECT public.is_superadmin('00000000-0000-0000-0000-000000000000'::uuid);
```

Expected: `false` dikembalikan dengan cepat. Kalau muncul error `infinite recursion detected in policy for relation "profiles"`, berarti ada policy yang membaca `profiles` langsung alih-alih lewat fungsi definer — perbaiki sebelum lanjut.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0042_roles_and_profiles.sql
git commit -m "feat(db): tabel roles/role_permissions/profiles + RLS + seed Kasir"
```

---

### Task 3: Gerbang izin sisi server

**Files:**
- Create: `lib/auth/session.ts`
- Test: `lib/auth/session.test.ts`

**Interfaces:**
- Consumes: `resolveActor`, `can`, `canAny`, `Actor`, `PermissionKey`, `ProfileRow` (Task 1); tabel dari Task 2; `getSupabaseServer` (`lib/supabase/server.ts`); `RequestEvent` (`lib/logger.ts`)
- Produces:
  - `PROFILE_SELECT: string` — string select PostgREST yang dipakai ulang di Task 8/9
  - `getCurrentActor(): Promise<Actor | null>` (dibungkus `cache()`)
  - `requirePermission(key: PermissionKey): Promise<Actor>` — redirect kalau gagal
  - `requireAnyPermission(keys: PermissionKey[]): Promise<Actor>`
  - `requireSuperadmin(): Promise<Actor>`
  - `type GuardResult = { ok: true; actor: Actor } | { ok: false; response: NextResponse }`
  - `guard(evt: RequestEvent, key: PermissionKey): Promise<GuardResult>`
  - `guardSuperadmin(evt: RequestEvent): Promise<GuardResult>`
  - `tagActor(evt: RequestEvent, actor: Actor): void`

- [ ] **Step 1: Tulis test yang gagal**

Hanya bagian murninya yang diuji — `buildActorTags`, yang menentukan isi wide-event. Buat `lib/auth/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildActorTags } from './session';
import { resolveActor, type ProfileRow } from '@/lib/permissions';

const kasir: ProfileRow = {
  user_id: 'u1',
  display_name: 'Kasir 1',
  is_superadmin: false,
  is_active: true,
  role_id: 'r1',
  roles: { name: 'Kasir', role_permissions: [{ permission_key: 'pos.use' }] },
};

describe('buildActorTags', () => {
  it('menandai user_id dan nama role', () => {
    expect(buildActorTags(resolveActor(kasir)!)).toEqual({
      user_id: 'u1',
      actor_role: 'Kasir',
    });
  });

  it('superadmin ditandai "superadmin" walau tanpa role', () => {
    const actor = resolveActor({ ...kasir, is_superadmin: true, role_id: null, roles: null })!;
    expect(buildActorTags(actor)).toEqual({ user_id: 'u1', actor_role: 'superadmin' });
  });

  it('user tanpa role ditandai null, bukan string kosong', () => {
    const actor = resolveActor({ ...kasir, role_id: null, roles: null })!;
    expect(buildActorTags(actor).actor_role).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm run test -- lib/auth/session.test.ts`
Expected: FAIL — `Failed to resolve import "./session"`

- [ ] **Step 3: Tulis implementasi**

Buat `lib/auth/session.ts`:

```ts
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

  const { data } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('user_id', user.id)
    .maybeSingle();

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
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm run test -- lib/auth/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/auth/session.ts lib/auth/session.test.ts
git commit -m "feat(auth): gerbang izin server (getCurrentActor, requirePermission, guard)"
```

---

### Task 4: Halaman 403 + layout menolak akun tanpa profil

**Files:**
- Create: `app/(app)/403/page.tsx`
- Modify: `app/(app)/layout.tsx` (seluruh fungsi `AppLayout`)

**Interfaces:**
- Consumes: `getCurrentActor` (Task 3), `PERMISSIONS` (Task 1)
- Produces: route `/403`; jaminan bahwa semua halaman di `app/(app)/` hanya bisa dibuka oleh akun dengan profil aktif

- [ ] **Step 1: Buat halaman 403**

Buat `app/(app)/403/page.tsx`:

```tsx
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const def = PERMISSIONS.find((x) => x.key === p);

  return (
    <div className="mx-auto max-w-lg">
      <Card variant="paper" className="px-6 py-8 text-center">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Akses ditolak
        </p>
        <h1 className="mt-3 font-display text-2xl italic leading-snug text-coal">
          Halaman ini tidak tersedia untuk akun Anda.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-coal-soft">
          {def
            ? `Dibutuhkan izin "${def.label}" — ${def.hint}.`
            : 'Akun Anda tidak punya izin untuk membuka halaman ini.'}{' '}
          Minta pemilik warung menambahkan izin ini ke role Anda.
        </p>
        <Link href="/" className="mt-6 inline-block">
          <Button>Kembali ke beranda</Button>
        </Link>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Ubah layout supaya menolak akun tanpa profil aktif**

Ganti isi `app/(app)/layout.tsx` dengan:

```tsx
import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { Toaster } from '@/components/ui/sonner';
import { getCurrentActor } from '@/lib/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // null = belum login, belum punya profil, atau dinonaktifkan. Semuanya diperlakukan
  // sama: keluar. Akun yang pembuatannya putus di tengah bisa login tapi tidak bisa
  // apa-apa — gagal ke arah aman.
  const actor = await getCurrentActor();
  if (!actor) redirect('/login?reason=no_access');

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Nav actor={actor} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-10">{children}</main>
      <footer className="surface-night mt-12">
        <div className="mx-auto max-w-5xl px-4 py-5 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          <span className="text-gold">★</span> Pecel Lele Pak Pon · Bandar Lampung <span className="text-gold">★</span>
        </div>
      </footer>
      <Toaster richColors position="top-center" />
    </div>
  );
}
```

⚠️ `Nav` sekarang menerima prop `actor` — itu dibuat di Task 5. Sampai Task 5 selesai, TypeScript akan mengeluh di baris `<Nav actor={actor} />`. Kerjakan Task 5 sebelum menjalankan `npm run build`.

- [ ] **Step 3: Tampilkan alasan di halaman login**

Di `app/(auth)/login/page.tsx`, baca `searchParams.reason` dan kalau bernilai `no_access`, render pesan di atas form:

```tsx
{reason === 'no_access' && (
  <p className="mb-4 rounded-md border border-brick-soft bg-brick-faint px-3 py-2 text-sm text-brick-dark">
    Akun Anda belum diberi akses, atau sudah dinonaktifkan. Hubungi pemilik warung.
  </p>
)}
```

Baca dulu file itu untuk menyesuaikan cara `searchParams` diambil — di Next.js 16 `searchParams` adalah Promise dan harus di-`await`.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/403/page.tsx" "app/(app)/layout.tsx" "app/(auth)/login/page.tsx"
git commit -m "feat(auth): halaman 403 + layout menolak akun tanpa profil aktif"
```

---

### Task 5: Nav & ubin beranda disaring izin

**Files:**
- Modify: `components/nav.tsx`, `components/mobile-nav.tsx`, `components/setup-menu.tsx`, `components/home-tiles.tsx`
- Modify: `app/(app)/page.tsx` (bagian `HomeTiles` dan kartu ringkasan)
- Test: `lib/nav-links.test.ts`
- Create: `lib/nav-links.ts`

**Interfaces:**
- Consumes: `Actor`, `can`, `canAny`, `PermissionKey` (Task 1)
- Produces:
  - `type NavLink = { href: string; label: string; permission: PermissionKey | PermissionKey[] }`
  - `NAV_LINKS: NavLink[]`
  - `visibleNavLinks(actor: Actor | null): NavLink[]`
  - `type SetupLink = { href: string; label: string; permission: PermissionKey | 'superadmin' }`
  - `SETUP_LINKS: SetupLink[]`
  - `visibleSetupLinks(actor: Actor | null): SetupLink[]`

- [ ] **Step 1: Tulis test yang gagal**

Buat `lib/nav-links.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { visibleNavLinks, visibleSetupLinks, NAV_LINKS } from './nav-links';
import { resolveActor, type ProfileRow } from './permissions';

function actorWith(keys: string[], over: Partial<ProfileRow> = {}) {
  return resolveActor({
    user_id: 'u1',
    display_name: 'X',
    is_superadmin: false,
    is_active: true,
    role_id: 'r1',
    roles: { name: 'Kasir', role_permissions: keys.map((k) => ({ permission_key: k })) },
    ...over,
  });
}

describe('visibleNavLinks', () => {
  it('kosong untuk actor null', () => {
    expect(visibleNavLinks(null)).toEqual([]);
  });

  it('superadmin melihat semua', () => {
    const sa = actorWith([], { is_superadmin: true, roles: null });
    expect(visibleNavLinks(sa)).toHaveLength(NAV_LINKS.length);
  });

  it('kasir tidak melihat Menu kalau tanpa izin menu', () => {
    const kasir = actorWith(['pos.use', 'monitor.use']);
    const hrefs = visibleNavLinks(kasir).map((l) => l.href);
    expect(hrefs).toContain('/pos');
    expect(hrefs).not.toContain('/menu');
  });

  it('Laporan muncul kalau punya salah satu izin laporan', () => {
    const harianSaja = actorWith(['reports.daily.view']);
    expect(visibleNavLinks(harianSaja).map((l) => l.href)).toContain('/reports');

    const tanpaLaporan = actorWith(['pos.use']);
    expect(visibleNavLinks(tanpaLaporan).map((l) => l.href)).not.toContain('/reports');
  });
});

describe('visibleSetupLinks', () => {
  it('kelola user hanya untuk superadmin, walau semua izin dicentang', () => {
    const semuaIzin = actorWith([
      'setup.printer', 'setup.ai_usage', 'menu.manage', 'transactions.delete',
      'reports.monthly.view', 'pos.use', 'scan.use', 'monitor.use', 'print.send',
      'transactions.view', 'transactions.edit', 'menu.view',
    ]);
    expect(visibleSetupLinks(semuaIzin).map((l) => l.href)).not.toContain('/setup/users');

    const sa = actorWith([], { is_superadmin: true, roles: null });
    expect(visibleSetupLinks(sa).map((l) => l.href)).toContain('/setup/users');
    expect(visibleSetupLinks(sa).map((l) => l.href)).toContain('/setup/roles');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm run test -- lib/nav-links.test.ts`
Expected: FAIL — `Failed to resolve import "./nav-links"`

- [ ] **Step 3: Tulis implementasi**

Buat `lib/nav-links.ts`:

```ts
import { can, canAny, type Actor, type PermissionKey } from './permissions';

export type NavLink = {
  href: string;
  label: string;
  /** Array = cukup punya salah satu. */
  permission: PermissionKey | PermissionKey[];
};

export const NAV_LINKS: NavLink[] = [
  { href: '/scan',         label: 'Scan',    permission: 'scan.use' },
  { href: '/pos',          label: 'POS',     permission: 'pos.use' },
  { href: '/monitor',      label: 'Monitor', permission: 'monitor.use' },
  { href: '/transactions', label: 'History', permission: 'transactions.view' },
  { href: '/reports',      label: 'Laporan', permission: ['reports.daily.view', 'reports.monthly.view'] },
  { href: '/menu',         label: 'Menu',    permission: 'menu.view' },
];

/** Diekspor karena home-tiles memakai aturan yang sama. */
export function allowed(actor: Actor | null, permission: PermissionKey | PermissionKey[]): boolean {
  return Array.isArray(permission) ? canAny(actor, permission) : can(actor, permission);
}

export function visibleNavLinks(actor: Actor | null): NavLink[] {
  if (!actor) return [];
  return NAV_LINKS.filter((l) => allowed(actor, l.permission));
}

export type SetupLink = {
  href: string;
  label: string;
  /** 'superadmin' = eksklusif superadmin, bukan izin yang bisa dicentang. */
  permission: PermissionKey | 'superadmin';
};

export const SETUP_LINKS: SetupLink[] = [
  { href: '/setup/printer/settings', label: 'Setting Printer', permission: 'setup.printer' },
  { href: '/setup/ai-usage',         label: 'AI Usage',        permission: 'setup.ai_usage' },
  { href: '/setup/users',            label: 'Akun & Pengguna', permission: 'superadmin' },
  { href: '/setup/roles',            label: 'Role & Izin',     permission: 'superadmin' },
];

export function visibleSetupLinks(actor: Actor | null): SetupLink[] {
  if (!actor) return [];
  return SETUP_LINKS.filter((l) =>
    l.permission === 'superadmin' ? actor.isSuperadmin : can(actor, l.permission),
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm run test -- lib/nav-links.test.ts`
Expected: PASS

- [ ] **Step 5: Sambungkan ke komponen**

Di `components/nav.tsx`: hapus konstanta `links` lokal. Terima prop `actor`, hitung `const links = visibleNavLinks(actor)` dan `const setupLinks = visibleSetupLinks(actor)`. Teruskan `links` ke `<MobileNav links={links} />` dan `setupLinks` ke `<SetupMenu links={setupLinks} />`. Sisanya (markup, kelas Tailwind) jangan diubah.

Di `components/setup-menu.tsx`: terima prop `links: SetupLink[]`, render `links.map(...)` menggantikan dua `DropdownMenuItem` yang di-hardcode. Kalau `links.length === 0`, `return null` — jangan render ikon gerigi yang isinya kosong.

Di `components/mobile-nav.tsx`: bentuk prop `links` sudah kompatibel (`{href,label}`), tapi kalau di dalamnya masih ada tautan setup yang di-hardcode, saring juga memakai `setupLinks`. Baca filenya dulu.

Di `components/home-tiles.tsx`: tambahkan field `permission` ke tiap entri `tiles`, sejajar dengan `NAV_LINKS` (`/scan`→`scan.use`, `/pos`→`pos.use`, `/monitor`→`monitor.use`, `/transactions`→`transactions.view`, `/reports`→`['reports.daily.view','reports.monthly.view']`, `/menu`→`menu.view`). Terima prop `actor: Actor` dan saring dengan helper `allowed` yang sama — ekspor `allowed` dari `lib/nav-links.ts` supaya tidak ditulis dua kali.

Di `app/(app)/page.tsx`: ambil `const actor = await getCurrentActor()` di atas, oper ke `<HomeTiles actor={actor} />`. Bungkus **seluruh** `<Card variant="paper">` ringkasan hari ini (termasuk tautan "Buka closingan →") dengan `{can(actor, 'transactions.view') && ( ... )}`. Jangan panggil `supabase.rpc('report_home_today', ...)` sama sekali kalau izinnya tidak ada — hemat satu query dan tidak ada angka yang bocor ke HTML.

- [ ] **Step 6: Verifikasi build & test**

Run: `npm run test && npm run build`
Expected: semua test PASS, build sukses tanpa error TypeScript.

- [ ] **Step 7: Commit**

```bash
git add lib/nav-links.ts lib/nav-links.test.ts components/ "app/(app)/page.tsx"
git commit -m "feat(auth): saring nav, menu setup, ubin beranda, dan ringkasan omzet sesuai izin"
```

---

### Task 6: Pasang gerbang di rute operasional (scan, POS, monitor, print)

**Files:**
- Modify: `app/(app)/scan/page.tsx`, `app/(app)/pos/page.tsx`, `app/(app)/monitor/page.tsx`
- Modify: `app/api/scan/route.ts`, `app/api/pos/route.ts`, `app/api/monitor/route.ts`, `app/api/print/send/route.ts`, `app/api/transactions/[id]/items/route.ts`

**Interfaces:**
- Consumes: `requirePermission`, `guard` (Task 3)
- Produces: tidak ada simbol baru — hanya penjagaan

- [ ] **Step 1: Jaga server component**

Di tiap file page, tambahkan sebagai baris pertama di dalam fungsi komponen:

```tsx
import { requirePermission } from '@/lib/auth/session';
// ...
await requirePermission('scan.use'); // pos.use di /pos, monitor.use di /monitor
```

- [ ] **Step 2: Jaga route handler**

Pola penggantinya, memakai `/api/pos/route.ts` sebagai contoh. Blok lama:

```ts
const supabase = await getSupabaseServer();
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  tagStatus(evt, 401);
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
evt.set('user_id', user.id);
```

Diganti:

```ts
const supabase = await getSupabaseServer();
const g = await guard(evt, 'pos.use');
if (!g.ok) return g.response;
const actor = g.actor;
```

`guard` sudah menandai `user_id` + `actor_role` dan menyetel `status` di wide-event, jadi `tagStatus` dan `evt.set('user_id', ...)` yang lama dihapus. **Jangan** hapus `try/catch/finally` maupun `evt.emit()`.

Kunci per route:
- `app/api/scan/route.ts` → `'scan.use'`
- `app/api/pos/route.ts` → `'pos.use'`
- `app/api/monitor/route.ts` → `'monitor.use'`
- `app/api/print/send/route.ts` → `'print.send'`
- `app/api/transactions/[id]/items/route.ts` → `'monitor.use'` (tombol `+ Item` di kartu monitor)

⚠️ `app/api/cron/*` **jangan** disentuh — dikecualikan di `proxy.ts` dan dijalankan crontab VPS tanpa sesi user. Begitu pula `app/api/agent/heartbeat/route.ts`, yang dipanggil agent Android, bukan browser.

- [ ] **Step 3: Verifikasi build**

Run: `npm run build`
Expected: sukses. Kalau ada error "user is not defined", berarti ada pemakaian variabel `user` lama yang belum diganti `actor` — `actor.userId` adalah penggantinya.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/scan" "app/(app)/pos" "app/(app)/monitor" app/api/scan app/api/pos app/api/monitor app/api/print "app/api/transactions/[id]/items"
git commit -m "feat(auth): gerbang izin di rute operasional"
```

---

### Task 7: Pasang gerbang di rute transaksi, laporan, menu, setup

**Files:**
- Modify: `app/(app)/transactions/page.tsx`, `app/(app)/transactions/[id]/page.tsx`, `app/(app)/transactions/[id]/review/page.tsx`, `app/(app)/transactions/trash/page.tsx`
- Modify: `app/(app)/reports/page.tsx`, `app/(app)/reports/daily/page.tsx`, `app/(app)/reports/monthly/page.tsx`
- Modify: `app/(app)/menu/page.tsx`, `app/(app)/menu/menu-list-client.tsx`
- Modify: `app/(app)/setup/printer/page.tsx`, `app/(app)/setup/printer/debug/page.tsx`, `app/(app)/setup/printer/settings/page.tsx`, `app/(app)/setup/printer/settings/actions.ts`, `app/(app)/setup/ai-usage/page.tsx`
- Modify: `app/api/transactions/route.ts`, `app/api/transactions/[id]/route.ts`, `app/api/transactions/[id]/restore/route.ts`, `app/api/reports/daily/route.ts`, `app/api/reports/monthly/route.ts`, `app/api/menus/route.ts`, `app/api/menus/[id]/route.ts`, `app/api/agent/[id]/route.ts`, `app/api/print/history/route.ts`

**Interfaces:**
- Consumes: `requirePermission`, `requireAnyPermission`, `guard`, `getCurrentActor` (Task 3); `can` (Task 1)
- Produces: tidak ada simbol baru

- [ ] **Step 1: Jaga halaman transaksi**

- `transactions/page.tsx` → `await requirePermission('transactions.view')`
- `transactions/[id]/page.tsx` → `await requirePermission('transactions.view')`; tombol "Edit" dan "Hapus" dirender bersyarat memakai `can(actor, 'transactions.edit')` / `can(actor, 'transactions.delete')` dari `const actor = await getCurrentActor()`
- `transactions/[id]/review/page.tsx` → `await requirePermission('transactions.edit')`
- `transactions/trash/page.tsx` → `await requirePermission('transactions.delete')`

- [ ] **Step 2: Jaga halaman laporan**

- `reports/page.tsx` → `await requireAnyPermission(['reports.daily.view','reports.monthly.view'])`, lalu render kartu tautan harian/bulanan hanya yang diizinkan (`can(actor, ...)`)
- `reports/daily/page.tsx` → `await requirePermission('reports.daily.view')`
- `reports/monthly/page.tsx` → `await requirePermission('reports.monthly.view')`

- [ ] **Step 3: Jaga halaman menu (baca-saja untuk `menu.view`)**

`menu/page.tsx` → `const actor = await requirePermission('menu.view')`, lalu oper `canManage={can(actor, 'menu.manage')}` ke `MenuListClient`. Di `menu-list-client.tsx`, saat `canManage === false`: jangan render tombol tambah/ubah/hapus dan editor chips; daftar menu + harga tetap tampil.

- [ ] **Step 4: Jaga halaman setup**

Semua di `setup/printer/**` → `await requirePermission('setup.printer')`. `setup/ai-usage/page.tsx` → `await requirePermission('setup.ai_usage')`.

⚠️ `setup/printer/settings/actions.ts` adalah **server action**, bukan route handler. Server action bisa dipanggil langsung lewat POST tanpa melewati halamannya, jadi penjagaan di halaman saja tidak cukup — tambahkan `await requirePermission('setup.printer')` sebagai baris pertama di dalam tiap fungsi `'use server'` di file itu.

- [ ] **Step 5: Jaga route handler**

Polanya diulang di sini supaya task ini bisa dikerjakan tanpa membuka Task 6. Blok lama di tiap route:

```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  tagStatus(evt, 401);
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
evt.set('user_id', user.id);
```

Diganti (ganti `'transactions.view'` dengan kunci dari daftar di bawah):

```ts
import { guard } from '@/lib/auth/session';
// ...
const g = await guard(evt, 'transactions.view');
if (!g.ok) return g.response;
const actor = g.actor;
```

`guard` sudah menandai `user_id`, `actor_role`, dan `status` di wide-event, jadi `evt.set('user_id', ...)` yang lama dihapus. Pemakaian `user.id` yang tersisa diganti `actor.userId`. **Jangan** hapus `try/catch/finally` maupun `evt.emit()`.

Kunci per method:

- `app/api/transactions/route.ts` — `GET` → `'transactions.view'`
- `app/api/transactions/[id]/route.ts` — `GET` → `'transactions.view'`; `DELETE` → `'transactions.delete'`; `PATCH` → lihat Step 6
- `app/api/transactions/[id]/restore/route.ts` — `'transactions.delete'`
- `app/api/reports/daily/route.ts` — `'reports.daily.view'`
- `app/api/reports/monthly/route.ts` — `'reports.monthly.view'`
- `app/api/menus/route.ts` — `GET` → `'menu.view'`; `POST` → `'menu.manage'`
- `app/api/menus/[id]/route.ts` — `PATCH`/`DELETE` → `'menu.manage'`
- `app/api/agent/[id]/route.ts` — `'setup.printer'`
- `app/api/print/history/route.ts` — `'setup.printer'`

- [ ] **Step 6: `PATCH /api/transactions/[id]` — dua izin dalam satu route**

Route ini melayani dua hal yang berbeda: menandai lunas dari `/monitor`, dan menyunting isi transaksi dari halaman review. Kalau dijaga satu kunci, kasir yang hanya boleh menandai lunas ikut kehilangan tombol Lunas, atau sebaliknya mendapat hak menyunting.

Setelah `parsed` (hasil Zod) tersedia, tentukan kuncinya dari isi body:

```ts
import { guard } from '@/lib/auth/session';
import type { PermissionKey } from '@/lib/permissions';
// ...
// Body yang HANYA berisi {paid} adalah aksi tandai-lunas dari /monitor.
// Selebihnya (status, items, customer_name, table_no, is_takeaway) adalah penyuntingan.
const keys = Object.keys(parsed.data);
const paidOnly = keys.length > 0 && keys.every((k) => k === 'paid');
const needed: PermissionKey = paidOnly ? 'monitor.use' : 'transactions.edit';

const g = await guard(evt, needed);
if (!g.ok) return g.response;
const actor = g.actor;
evt.set('patch_intent', paidOnly ? 'mark_paid' : 'edit');
```

⚠️ Cek `paidOnly` harus dilakukan pada **hasil parse Zod**, bukan JSON mentah. Zod menyuntikkan nilai default untuk field yang tidak dikirim, jadi kalau skemanya punya `.default()`, `Object.keys` pada hasil parse akan memuat field yang tidak pernah dikirim klien dan `paidOnly` jadi selamanya `false`. Baca `PatchSchema` di file itu dulu: kalau ada `.default()` pada field selain `paid`, ambil `Object.keys` dari body mentah hasil `await request.json()` yang sudah divalidasi Zod, dan catat alasannya sebagai komentar.

- [ ] **Step 7: Verifikasi build & test**

Run: `npm run test && npm run build`
Expected: semua PASS.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)" app/api
git commit -m "feat(auth): gerbang izin di rute transaksi, laporan, menu, dan setup"
```

---

### Task 8: Kunci laporan bulanan di sisi DB

**Files:**
- Create: `supabase/migrations/0043_report_monthly_permission.sql`

**Interfaces:**
- Consumes: `public.has_permission(uuid, text)` (Task 2)
- Produces: `report_monthly` yang menolak pemanggil tanpa `reports.monthly.view`; `report_monthly_data` (internal)

- [ ] **Step 1: Tulis migrasi**

Buat `supabase/migrations/0043_report_monthly_permission.sql`:

```sql
-- 0043_report_monthly_permission.sql
-- Menutup jalur PostgREST langsung: tanpa ini, kasir yang izin bulanannya dicabut
-- masih bisa memanggil rpc/report_monthly dari browser memakai publishable key
-- dan mendapat omzet sebulan.
--
-- Agregasinya TIDAK diubah — fungsi lama dipindah jadi report_monthly_data,
-- lalu dibungkus penjaga izin. Memakai plpgsql karena RAISE tidak ada di LANGUAGE sql,
-- dan menaruh penjaga sebagai predikat WHERE di dalam SQL body TIDAK aman:
-- bulan tanpa transaksi menghasilkan nol baris, predikatnya tidak pernah dievaluasi,
-- dan penjagaannya lolos diam-diam.

ALTER FUNCTION report_monthly(timestamptz, timestamptz, int) RENAME TO report_monthly_data;
REVOKE EXECUTE ON FUNCTION report_monthly_data(timestamptz, timestamptz, int) FROM authenticated;

-- ⚠️ Pembungkusnya SECURITY DEFINER supaya bisa memanggil fungsi dalam yang sudah
-- di-REVOKE. Konsekuensinya agregasi berjalan sebagai owner sehingga RLS tabel
-- transactions dilewati. Hari ini tidak mengubah perilaku apa pun — RLS transactions
-- masih "authenticated boleh ALL" — tapi kalau kelak RLS itu diperketat, fungsi ini
-- harus ditinjau ulang.
CREATE OR REPLACE FUNCTION report_monthly(
  p_start        timestamptz,
  p_end          timestamptz,
  p_cutoff_hours int
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'reports.monthly.view') THEN
    RAISE EXCEPTION 'forbidden: reports.monthly.view required' USING ERRCODE = '42501';
  END IF;
  RETURN report_monthly_data(p_start, p_end, p_cutoff_hours);
END;
$$;

GRANT EXECUTE ON FUNCTION report_monthly(timestamptz, timestamptz, int) TO authenticated;
```

- [ ] **Step 2: Terapkan migrasi**

Pakai MCP Supabase `apply_migration` dengan nama `0043_report_monthly_permission`.

- [ ] **Step 3: Verifikasi laporan bulanan masih jalan untuk owner**

Run: `npm run dev`, buka `http://localhost:3000/reports/monthly` sebagai akun owner.
Expected: angka omzet dan menu terlaris tampil seperti sebelumnya. Kalau kosong atau error, periksa pesan di terminal — `permission denied for function report_monthly_data` berarti `GRANT` pembungkusnya terlewat.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0043_report_monthly_permission.sql
git commit -m "feat(db): report_monthly menolak pemanggil tanpa izin laporan bulanan"
```

---

### Task 9: API kelola akun

**Files:**
- Create: `app/api/users/route.ts`, `app/api/users/_schemas.ts`, `app/api/users/_schemas.test.ts`
- Create: `app/api/users/[id]/route.ts`
- Modify: `lib/supabase/admin.ts` (komentar di atas `getSupabaseAdmin`)

**Interfaces:**
- Consumes: `guardSuperadmin`, `PROFILE_SELECT` (Task 3); `canDemoteSuperadmin`, `isPermissionKey` (Task 1); `getSupabaseAdmin` (`lib/supabase/admin.ts`); `newEvent` (`lib/logger.ts`)
- Produces:
  - `CreateUserSchema` → `{ email: string; password: string; display_name: string; role_id: string | null; is_superadmin: boolean }`
  - `UpdateUserSchema` → `{ display_name?: string; role_id?: string | null; is_active?: boolean; is_superadmin?: boolean; password?: string }`
  - `GET /api/users` → `{ users: UserRow[] }` dengan `UserRow = { user_id, email, display_name, role_id, role_name, is_superadmin, is_active }`
  - `POST /api/users` → `{ user: UserRow }`
  - `PATCH /api/users/[id]`, `DELETE /api/users/[id]`

- [ ] **Step 1: Tulis test skema yang gagal**

Buat `app/api/users/_schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CreateUserSchema, UpdateUserSchema } from './_schemas';

describe('CreateUserSchema', () => {
  it('menerima akun kasir yang wajar', () => {
    const r = CreateUserSchema.safeParse({
      email: 'kasir1@pakpon.local',
      password: 'rahasia123',
      display_name: 'Kasir 1',
      role_id: '11111111-1111-1111-1111-111111111111',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.is_superadmin).toBe(false);
  });

  it('menolak password pendek', () => {
    const r = CreateUserSchema.safeParse({
      email: 'a@b.local', password: '12345', display_name: 'X', role_id: null,
    });
    expect(r.success).toBe(false);
  });

  it('menolak nama kosong', () => {
    const r = CreateUserSchema.safeParse({
      email: 'a@b.local', password: 'rahasia123', display_name: '   ', role_id: null,
    });
    expect(r.success).toBe(false);
  });

  it('email domain .local diterima (kasir sering tidak punya email asli)', () => {
    const r = CreateUserSchema.safeParse({
      email: 'kasir2@pakpon.local', password: 'rahasia123', display_name: 'Kasir 2', role_id: null,
    });
    expect(r.success).toBe(true);
  });
});

describe('UpdateUserSchema', () => {
  it('menerima patch sebagian', () => {
    expect(UpdateUserSchema.safeParse({ is_active: false }).success).toBe(true);
    expect(UpdateUserSchema.safeParse({ role_id: null }).success).toBe(true);
  });

  it('menolak body kosong', () => {
    expect(UpdateUserSchema.safeParse({}).success).toBe(false);
  });

  it('menolak password pendek', () => {
    expect(UpdateUserSchema.safeParse({ password: 'abc' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm run test -- app/api/users/_schemas.test.ts`
Expected: FAIL — modul `./_schemas` tidak ada.

- [ ] **Step 3: Tulis skema**

Buat `app/api/users/_schemas.ts`:

```ts
import { z } from 'zod';

const displayName = z.string().trim().min(1).max(60);
const password = z.string().min(8).max(72);

export const CreateUserSchema = z.object({
  email: z.string().email().max(160),
  password,
  display_name: displayName,
  role_id: z.string().uuid().nullable().default(null),
  is_superadmin: z.boolean().default(false),
});

export const UpdateUserSchema = z
  .object({
    display_name: displayName.optional(),
    role_id: z.string().uuid().nullable().optional(),
    is_active: z.boolean().optional(),
    is_superadmin: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'body kosong' });

export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm run test -- app/api/users/_schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Perbarui komentar `lib/supabase/admin.ts`**

Ganti blok komentar di atas `getSupabaseAdmin` dengan:

```ts
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
```

- [ ] **Step 6: Tulis `app/api/users/route.ts`**

```ts
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
```

- [ ] **Step 7: Tulis `app/api/users/[id]/route.ts`**

`PATCH` dan `DELETE`, keduanya di belakang `guardSuperadmin`. Aturan yang wajib ada:

```ts
// Penjagaan superadmin terakhir. Dicek di SERVER — tombol yang di-disable di UI
// bukan penjagaan, cuma kesopanan.
const admin = getSupabaseAdmin();
const { data: sas } = await admin
  .from('profiles')
  .select('user_id')
  .eq('is_superadmin', true)
  .eq('is_active', true);
const activeSuperadminIds = (sas ?? []).map((r) => r.user_id);

const losesSuperadmin =
  patch.is_superadmin === false || patch.is_active === false; // DELETE: selalu true
if (losesSuperadmin && !canDemoteSuperadmin(activeSuperadminIds, id)) {
  evt.merge({ status: 409, blocked: 'last_superadmin' });
  return NextResponse.json(
    { error: 'last_superadmin', detail: 'Ini superadmin terakhir. Angkat orang lain dulu.' },
    { status: 409 },
  );
}
```

Ganti password: `await admin.auth.admin.updateUserById(id, { password: patch.password })`.
Ubah profil: `await admin.from('profiles').update({...}).eq('user_id', id)`.
`DELETE`: jalankan penjagaan superadmin terakhir di atas dulu, lalu `admin.auth.admin.deleteUser(id)` — baris `profiles` ikut terhapus lewat `ON DELETE CASCADE`.

⚠️ Jangan pernah mengembalikan password di response, dan jangan pernah menuliskannya ke wide-event. Yang boleh dicatat cuma `password_changed: true`.

- [ ] **Step 8: Verifikasi build & test**

Run: `npm run test && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/api/users lib/supabase/admin.ts
git commit -m "feat(users): API kelola akun superadmin-only + penjagaan superadmin terakhir"
```

---

### Task 10: API kelola role

**Files:**
- Create: `app/api/roles/route.ts`, `app/api/roles/_schemas.ts`, `app/api/roles/_schemas.test.ts`
- Create: `app/api/roles/[id]/route.ts`

**Interfaces:**
- Consumes: `guardSuperadmin` (Task 3); `isPermissionKey`, `PERMISSION_KEYS` (Task 1)
- Produces:
  - `RoleWriteSchema` → `{ name: string; description: string | null; permissions: PermissionKey[] }`
  - `GET /api/roles` → `{ roles: RoleRow[] }` dengan `RoleRow = { id, name, description, permissions: string[], user_count: number }`
  - `POST /api/roles`, `PATCH /api/roles/[id]`, `DELETE /api/roles/[id]`

- [ ] **Step 1: Tulis test skema yang gagal**

Buat `app/api/roles/_schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RoleWriteSchema } from './_schemas';

describe('RoleWriteSchema', () => {
  it('menerima role dengan izin sah', () => {
    const r = RoleWriteSchema.safeParse({
      name: 'Kasir Senior',
      description: null,
      permissions: ['pos.use', 'reports.daily.view'],
    });
    expect(r.success).toBe(true);
  });

  it('menolak kunci izin yang tidak ada di katalog', () => {
    const r = RoleWriteSchema.safeParse({
      name: 'X', description: null, permissions: ['izin.hantu'],
    });
    expect(r.success).toBe(false);
  });

  it('menolak kunci manajemen user yang diselundupkan', () => {
    const r = RoleWriteSchema.safeParse({
      name: 'X', description: null, permissions: ['users.manage'],
    });
    expect(r.success).toBe(false);
  });

  it('role tanpa izin sama sekali boleh (dibuat dulu, dicentang belakangan)', () => {
    const r = RoleWriteSchema.safeParse({ name: 'Baru', description: null, permissions: [] });
    expect(r.success).toBe(true);
  });

  it('membuang izin duplikat', () => {
    const r = RoleWriteSchema.safeParse({
      name: 'X', description: null, permissions: ['pos.use', 'pos.use'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.permissions).toEqual(['pos.use']);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm run test -- app/api/roles/_schemas.test.ts`
Expected: FAIL — modul `./_schemas` tidak ada.

- [ ] **Step 3: Tulis skema**

Buat `app/api/roles/_schemas.ts`:

```ts
import { z } from 'zod';
import { isPermissionKey, type PermissionKey } from '@/lib/permissions';

export const RoleWriteSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(160).nullable().default(null),
  permissions: z
    .array(z.string().refine(isPermissionKey, { message: 'kunci izin tidak dikenal' }))
    .max(50)
    // Zod memvalidasi tiap elemen; sisa kerjanya cuma membuang duplikat supaya
    // INSERT tidak bentrok dengan PK (role_id, permission_key).
    .transform((keys) => Array.from(new Set(keys)) as PermissionKey[]),
});

export type RoleWrite = z.infer<typeof RoleWriteSchema>;
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm run test -- app/api/roles/_schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Tulis route handler**

`app/api/roles/route.ts`:
- `GET` → `guardSuperadmin`, baca `roles` + `role_permissions(permission_key)` + hitung pemakai lewat `profiles`. Kembalikan `{ roles: [{ id, name, description, permissions, user_count }] }`.
- `POST` → `guardSuperadmin`, validasi `RoleWriteSchema`, `INSERT roles` lalu `INSERT role_permissions` batch. Kalau nama bentrok, PostgREST mengembalikan kode `23505` → balas `409 { error: 'duplicate_name' }`.

`app/api/roles/[id]/route.ts`:
- `PATCH` → `guardSuperadmin`, validasi, `UPDATE roles`, lalu **ganti seluruh set izin**: `DELETE FROM role_permissions WHERE role_id = id` disusul `INSERT` daftar baru. Ganti-seluruhnya lebih sederhana dan bebas kondisi balapan dibanding menghitung selisih; jumlah barisnya belasan.
- `DELETE` → `guardSuperadmin`, lalu `DELETE FROM roles WHERE id = ...`. `ON DELETE RESTRICT` di `profiles.role_id` membuat Postgres menolak dengan kode `23503` kalau role masih dipakai; terjemahkan jadi:

```ts
if (error?.code === '23503') {
  evt.merge({ status: 409, blocked: 'role_in_use' });
  return NextResponse.json(
    { error: 'role_in_use', detail: 'Role ini masih dipakai. Pindahkan akunnya ke role lain dulu.' },
    { status: 409 },
  );
}
```

Semuanya memakai pola `newEvent()` / `try/catch/finally` / `evt.emit()`.

- [ ] **Step 6: Verifikasi build & test**

Run: `npm run test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/roles
git commit -m "feat(roles): API kelola role + izin, tolak hapus role yang masih dipakai"
```

---

### Task 11: Halaman `/setup/roles`

**Files:**
- Create: `app/(app)/setup/roles/page.tsx`, `app/(app)/setup/roles/roles-client.tsx`

**Interfaces:**
- Consumes: `requireSuperadmin` (Task 3); `PERMISSIONS`, `PermissionGroup` (Task 1); API dari Task 10
- Produces: route `/setup/roles`

- [ ] **Step 1: Tulis halaman server**

`app/(app)/setup/roles/page.tsx`: `await requireSuperadmin()`, ambil daftar role via `getSupabaseServer()` (bentuk sama dengan `GET /api/roles`) untuk render awal, lalu render `<RolesClient initialRoles={roles} />`. `export const dynamic = 'force-dynamic'`.

- [ ] **Step 2: Tulis klien**

`roles-client.tsx` (`'use client'`):
- Daftar role sebagai `Card`, tiap baris menampilkan nama, deskripsi, jumlah izin, dan jumlah pemakai.
- Tombol "Tambah role" membuka `Dialog` berisi `Input` nama, `Textarea` deskripsi, dan matriks centang.
- Matriks izin dikelompokkan memakai `PermissionGroup`, dirender dari `PERMISSIONS` — **jangan** menulis ulang daftarnya:

```tsx
const groups = ['Operasional', 'Transaksi', 'Laporan', 'Menu', 'Setup'] as const;
// ...
{groups.map((g) => (
  <fieldset key={g} className="rounded-lg border border-clay-soft p-3">
    <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-clay">{g}</legend>
    {PERMISSIONS.filter((p) => p.group === g).map((p) => (
      <label key={p.key} className="flex items-start gap-3 py-2">
        <Switch
          checked={selected.has(p.key)}
          onCheckedChange={(v: boolean) => toggle(p.key, v)}
        />
        <span>
          <span className="block text-sm font-medium text-coal">{p.label}</span>
          <span className="block text-xs text-clay">{p.hint}</span>
        </span>
      </label>
    ))}
  </fieldset>
))}
```

- Simpan → `POST`/`PATCH` ke `/api/roles`, lalu `router.refresh()`. Gagal → `toast.error()` dari `sonner` dengan pesan dari body response.
- Hapus → `AlertDialog` konfirmasi. Kalau response `409 role_in_use`, tampilkan `detail`-nya di `toast.error`. ⚠️ Di fork base-ui ini `AlertDialogAction` **bukan** `Close` — kontrol `open` secara manual lewat state dan tutup di handler, pola yang sama dengan dialog toggle bayar di halaman detail transaksi.
- Tambahkan catatan permanen di atas daftar: "Kelola akun dan role hanya bisa dilakukan superadmin, dan itu bukan izin yang bisa dicentang di sini."

- [ ] **Step 3: Verifikasi manual**

Run: `npm run dev`, buka `/setup/roles` sebagai owner. Buat role "Test", centang beberapa izin, simpan, muat ulang halaman.
Expected: role tersimpan dengan izin yang benar. Lalu hapus role "Test" — berhasil karena belum dipakai siapa pun.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/setup/roles"
git commit -m "feat(roles): halaman kelola role + matriks izin"
```

---

### Task 12: Halaman `/setup/users`

**Files:**
- Create: `app/(app)/setup/users/page.tsx`, `app/(app)/setup/users/users-client.tsx`

**Interfaces:**
- Consumes: `requireSuperadmin` (Task 3); API dari Task 9 dan daftar role dari Task 10
- Produces: route `/setup/users`

- [ ] **Step 1: Tulis halaman server**

`page.tsx`: `const actor = await requireSuperadmin()`, ambil daftar akun dan daftar role untuk render awal, render `<UsersClient initialUsers={users} roles={roles} currentUserId={actor.userId} />`. `export const dynamic = 'force-dynamic'`.

- [ ] **Step 2: Tulis klien**

`users-client.tsx` (`'use client'`):
- Tabel akun: Nama, Email, Role, Status. Superadmin ditandai badge emas; baris "(tanpa profil)" ditandai badge peringatan dengan tombol Hapus saja.
- "Tambah akun" → `Dialog`: `Input` nama, email, password, `Select` role. Simpan → `POST /api/users`. Setelah sukses, tampilkan sekali kredensialnya di `toast.success` supaya owner bisa mencatat — **jangan** disimpan di state atau ditampilkan lagi setelah dialog ditutup.
- Aksi per baris: ubah role (`Select` langsung di tabel → `PATCH`), aktif/nonaktif (`Switch` → `PATCH`), reset password (`Dialog` kecil → `PATCH { password }`), hapus (`AlertDialog` → `DELETE`).
- Baris milik diri sendiri: tombol nonaktifkan dan hapus di-disable dengan `title="Tidak bisa menonaktifkan akun sendiri"`. Ini kesopanan UI; penjagaan sebenarnya ada di server (Task 9 Step 7).
- Response `409 last_superadmin` → `toast.error(body.detail)`.
- Tiap perubahan sukses → `router.refresh()`.

Satu helper dipakai semua aksi baris supaya penanganan errornya seragam:

```tsx
async function patchUser(userId: string, patch: Record<string, unknown>, sukses: string) {
  const res = await fetch(`/api/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // 409 last_superadmin membawa `detail` berbahasa Indonesia yang sudah siap tampil.
    toast.error(body.detail ?? body.error ?? 'Gagal menyimpan perubahan.');
    return false;
  }
  toast.success(sukses);
  router.refresh();
  return true;
}
```

- [ ] **Step 3: Verifikasi manual jalur lengkap**

Run: `npm run dev`

1. Buka `/setup/users` sebagai owner, buat akun `kasir1@pakpon.local` dengan role **Kasir**.
2. Buka jendela penyamaran, login sebagai kasir itu.
3. Periksa: navbar **tidak** memuat tautan Menu; ikon gerigi setup **tidak** muncul; beranda tidak menampilkan ubin Menu Master.
4. Ketik `http://localhost:3000/reports/monthly` langsung di URL → mendarat di halaman 403 yang menjelaskan izin apa yang kurang.
5. Ketik `http://localhost:3000/setup/users` → 403.
6. Periksa `/pos` dan `/monitor` bisa dibuka dan pesanan bisa disimpan seperti biasa.
7. Kembali ke jendela owner, nonaktifkan akun kasir. Muat ulang jendela kasir → terlempar ke `/login` dengan pesan "Akun Anda belum diberi akses, atau sudah dinonaktifkan."
8. Coba turunkan diri sendiri dari superadmin → ditolak dengan pesan "Ini superadmin terakhir."

Expected: kedelapan langkah berperilaku persis seperti tertulis. Kalau langkah 4 memperlihatkan angka omzet alih-alih 403, gerbang di Task 7 terlewat.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/setup/users"
git commit -m "feat(users): halaman kelola akun"
```

---

### Task 13: Jejak pembuat transaksi

**Files:**
- Create: `supabase/migrations/0044_transactions_created_by.sql`
- Modify: `app/api/pos/route.ts`, `app/api/transactions/[id]/route.ts`, `app/(app)/transactions/[id]/page.tsx`

**Interfaces:**
- Consumes: `actor` dari `guard()` (Task 3)
- Produces: kolom `transactions.created_by`

- [ ] **Step 1: Tulis migrasi**

Buat `supabase/migrations/0044_transactions_created_by.sql`:

```sql
-- 0044_transactions_created_by.sql
-- Siapa yang menginput transaksi. Berguna saat selisih kas atau nota aneh —
-- sebelum ini, dengan satu akun bersama, tidak ada jejak sama sekali.
--
-- SET NULL, bukan CASCADE: menghapus akun kasir tidak boleh menghapus transaksinya.
-- Nullable tanpa backfill — transaksi sebelum fitur ini memang tidak diketahui pembuatnya.

ALTER TABLE transactions
  ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_transactions_created_by ON transactions(created_by)
  WHERE created_by IS NOT NULL;
```

- [ ] **Step 2: Terapkan migrasi**

Pakai MCP Supabase `apply_migration` dengan nama `0044_transactions_created_by`.

- [ ] **Step 3: Isi saat transaksi dibuat**

Di `app/api/pos/route.ts`, pada `.insert({ ... })` transaksi, tambahkan satu field setelah `daily_seq`:

```ts
created_by: actor.userId,
```

Di `app/api/transactions/[id]/route.ts`, di dalam blok `if (isConfirming)` (transisi `pending_review` → `confirmed`), tambahkan ke `headerUpdate`:

```ts
// Nota hasil OCR dibuat oleh /api/scan sebagai draft; yang bertanggung jawab
// adalah orang yang mengonfirmasinya, bukan yang memotret.
headerUpdate.created_by = actor.userId;
```

- [ ] **Step 4: Tampilkan di halaman detail**

Di `app/(app)/transactions/[id]/page.tsx`, ikutkan `created_by` di `select`, lalu resolusikan namanya lewat `profiles`:

```tsx
let createdByName: string | null = null;
if (tx.created_by) {
  const { data: p } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', tx.created_by)
    .maybeSingle();
  createdByName = p?.display_name ?? null;
}
```

⚠️ RLS `profiles_read` hanya mengizinkan membaca baris sendiri atau semua baris kalau superadmin. Jadi kasir yang membuka transaksi rekannya mendapat `null` dan barisnya tidak dirender — bukan error. Itu perilaku yang diterima: jejak pembuat ditujukan untuk owner. **Jangan** melonggarkan RLS `profiles` untuk ini.

Render hanya kalau ada nilainya, sejajar dengan baris info lain di halaman:

```tsx
{createdByName && (
  <p className="text-xs text-clay">Diinput oleh: {createdByName}</p>
)}
```

- [ ] **Step 5: Verifikasi manual**

Run: `npm run dev`. Buat pesanan lewat `/pos` sebagai owner, buka detailnya.
Expected: muncul "Diinput oleh: <nama owner>". Buka transaksi lama (sebelum migrasi) → baris itu tidak muncul sama sekali, tanpa error.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0044_transactions_created_by.sql app/api/pos "app/api/transactions/[id]" "app/(app)/transactions/[id]/page.tsx"
git commit -m "feat(transactions): catat created_by dan tampilkan di detail"
```

---

### Task 14: Uji anti izin hantu + dokumentasi

**Files:**
- Create: `lib/permissions-usage.test.ts`
- Modify: `CLAUDE.md`, `docs/tasks.md`

**Interfaces:**
- Consumes: `PERMISSION_KEYS` (Task 1); seluruh kode dari Task 6–13
- Produces: jaring pengaman yang gagal kalau ada izin di katalog yang tidak dijaga kode mana pun

- [ ] **Step 1: Tulis test yang gagal**

Buat `lib/permissions-usage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { PERMISSION_KEYS } from './permissions';

/**
 * Izin hantu = kunci yang bisa dicentang owner di /setup/roles tapi tidak dijaga
 * kode mana pun. Owner mengira dia membatasi sesuatu, padahal tidak.
 *
 * Sumber kebenaran katalog ada di lib/permissions.ts, jadi file itu sendiri
 * dikecualikan dari pencarian.
 */
function filesMentioning(key: string): string[] {
  try {
    const out = execFileSync(
      'grep',
      ['-rl', '--include=*.ts', '--include=*.tsx', '--fixed-strings', key, 'app', 'lib', 'components'],
      { encoding: 'utf8' },
    );
    return out.split('\n').filter(Boolean);
  } catch {
    return []; // grep keluar dengan kode 1 kalau tidak ada yang cocok
  }
}

const IGNORED = new Set([
  'lib/permissions.ts',
  'lib/permissions.test.ts',
  'lib/permissions-usage.test.ts',
  'lib/nav-links.ts',
  'lib/nav-links.test.ts',
]);

describe('tidak ada izin hantu', () => {
  it.each(PERMISSION_KEYS)('%s dijaga setidaknya satu file', (key) => {
    const hits = filesMentioning(key).filter((f) => !IGNORED.has(f));
    expect(hits.length, `izin "${key}" tidak dipakai di mana pun`).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Jalankan test**

Run: `npm run test -- lib/permissions-usage.test.ts`
Expected: PASS untuk ketiga belas kunci. Kalau ada yang gagal, itu bukan test yang salah — gerbangnya memang terlewat di Task 6 atau 7. Pasang gerbangnya, jangan mengecualikan kuncinya.

- [ ] **Step 3: Perbarui `CLAUDE.md`**

Sisipkan bagian baru sebelum "## OCR system":

```markdown
## Multi-akun & role (shipped 2026-09-13)

- **Katalog izin di kode, bukan DB**: `lib/permissions.ts` memegang 13 kunci izin + label Indonesia. DB (`roles`, `role_permissions`, `profiles`, migrasi 0042) cuma menyimpan role buatan owner dan centangannya. Kunci di DB yang tidak dikenal katalog **diabaikan** `resolveActor()` — jadi menghapus izin dari katalog tidak butuh migrasi pembersih. Test `lib/permissions-usage.test.ts` gagal kalau ada kunci di katalog yang tidak dijaga kode mana pun (izin hantu).
- **Manajemen user & role eksklusif superadmin, sengaja BUKAN izin.** Kalau jadi izin biasa yang bisa dicentang, sebuah role bisa dipakai mengangkat dirinya sendiri jadi superadmin. `is_superadmin` adalah penanda di `profiles`, bukan role.
- **Gerbang**: `lib/auth/session.ts`. `getCurrentActor()` dibungkus `cache()` React → satu request = satu query walau dipanggil layout + page + komponen. Server component pakai `requirePermission()` (redirect ke `/403?p=<kunci>`), route handler pakai `guard(evt, key)` (403 + tag wide-event `permission_denied`). Izin **tidak** ditanam di JWT: owner yang mencabut izin mengharapkan itu berlaku sekarang, bukan setelah token refresh sejam kemudian.
- **`proxy.ts` sengaja tidak menjaga izin** — dia jalan di Edge tiap request; query DB di sana membuat semua halaman bayar ongkos. Dia cuma mengurus "sudah login atau belum".
- ⚠️ **Rekursi RLS**: policy di `profiles` yang membaca `profiles` langsung = rekursi tak terhingga. Semua pengecekan lewat `public.is_superadmin(uuid)` / `public.has_permission(uuid, text)` yang `SECURITY DEFINER` + `search_path` dikunci. Jangan pernah menulis `EXISTS (SELECT 1 FROM profiles ...)` di dalam policy `profiles`.
- ⚠️ **`report_monthly` dibungkus penjaga izin** (migrasi 0043): agregasi lama dipindah jadi `report_monthly_data` (execute di-REVOKE), pembungkusnya `plpgsql` + `SECURITY DEFINER` dan `RAISE` kalau pemanggil tidak punya `reports.monthly.view`. Penjaga TIDAK boleh ditulis sebagai predikat `WHERE` di body SQL — bulan tanpa transaksi menghasilkan nol baris, predikatnya tak pernah dievaluasi, penjagaannya lolos diam-diam. Konsekuensi `SECURITY DEFINER`: agregasi berjalan sebagai owner, melewati RLS `transactions`. Tidak mengubah apa pun hari ini (RLS itu masih "authenticated boleh ALL"), tapi harus ditinjau ulang kalau RLS transactions kelak diperketat.
- **`PATCH /api/transactions/[id]` dijaga dua kunci**: body yang HANYA berisi `{paid}` = aksi tandai-lunas dari `/monitor` → butuh `monitor.use`; selebihnya = penyuntingan → butuh `transactions.edit`. Tanpa pemisahan ini, kasir yang cuma boleh menandai lunas ikut kehilangan tombol Lunas.
- **RLS tabel transaksi/menu SENGAJA dibiarkan permisif.** Yang ditutup rapat cuma tabel role (kasir tak bisa mengangkat diri) dan omzet bulanan. Menyentuh RLS `transactions` berisiko merusak jalur stabil (RPC laporan, cron cleanup, agent print) dengan bug yang diam. Risiko yang diterima: kasir yang paham devtools masih bisa membaca tabel transaksi lewat PostgREST.
- **`lib/supabase/admin.ts` sekarang punya pengecualian**: `app/api/users/**` boleh memakai service-role key karena membuat akun Supabase Auth menuntutnya. Syaratnya mutlak — di belakang `guardSuperadmin()` dan dicatat wide-event.
- **`transactions.created_by`** (migrasi 0044, nullable, `ON DELETE SET NULL`): diisi `/api/pos` saat simpan dan saat draft OCR dikonfirmasi (yang bertanggung jawab adalah yang mengonfirmasi, bukan yang memotret). Tampil di detail transaksi. ⚠️ RLS `profiles` cuma mengizinkan baca baris sendiri atau semua kalau superadmin, jadi kasir yang membuka transaksi rekannya melihat baris itu **tidak dirender** — bukan error. Perilaku yang diterima; jangan melonggarkan RLS `profiles` untuk ini.
- Spec `docs/superpowers/specs/2026-09-13-multi-user-roles-design.md`, plan `docs/superpowers/plans/2026-09-13-multi-user-roles.md`.
```

Perbarui juga baris **Auth** di bagian "## Conventions" menjadi:

```markdown
- Auth: pages dalam `app/(app)/` harus auth; `app/(auth)/` public. Izin dijaga per halaman/route lewat `requirePermission()` / `guard()` dari `lib/auth/session.ts` — lihat bagian "Multi-akun & role".
```

- [ ] **Step 4: Perbarui `docs/tasks.md`**

Tambahkan entri untuk pekerjaan ini mengikuti format yang sudah ada di file itu.

- [ ] **Step 5: Verifikasi penuh**

Run: `npm run test && npm run lint && npm run build`
Expected: semua PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/permissions-usage.test.ts CLAUDE.md docs/tasks.md
git commit -m "test(auth): jaring pengaman izin hantu + dokumentasi multi-akun & role"
```

---

## Catatan penutup untuk pelaksana

Setelah Task 14, jalankan ulang verifikasi manual delapan langkah di Task 12 Step 3 **dengan build produksi** (`npm run build && npm run start`), bukan dev server. Beberapa perilaku `redirect()` di server component berbeda antara dev dan produksi.

Jangan menggabungkan branch ini sebelum langkah 7 (nonaktifkan akun → terlempar ke login) terbukti jalan: itu satu-satunya cara owner mencabut akses kasir yang berhenti kerja, dan kegagalannya tidak terlihat sampai dibutuhkan.
