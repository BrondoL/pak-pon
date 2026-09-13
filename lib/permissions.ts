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
