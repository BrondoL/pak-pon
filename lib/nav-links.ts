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
