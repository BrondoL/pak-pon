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
