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
