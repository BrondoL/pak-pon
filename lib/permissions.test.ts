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
