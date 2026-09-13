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
