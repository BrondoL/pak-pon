import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PERMISSION_KEYS } from './permissions';

/**
 * Izin hantu = kunci yang bisa dicentang owner di /setup/roles tapi tidak dijaga
 * kode mana pun. Owner mengira dia membatasi sesuatu, padahal tidak.
 *
 * Yang DIBUKTIKAN test ini: tiap kunci di katalog muncul sebagai argumen literal
 * di pemanggilan salah satu fungsi gerbang (`guard`/`guardSuperadmin`/
 * `requirePermission`/`requireAnyPermission`/`can`/`canAny`) di `app`, `lib`,
 * atau `components` — bukan cuma disebut di suatu tempat. Sekadar disebut
 * (misal jadi `permission:` field yang cuma dipakai buat sembunyikan tautan/tile,
 * atau nongol di komentar/tipe) TIDAK cukup — itu filter tampilan, bukan gerbang.
 * `lib/nav-links.ts` dan `components/home-tiles.tsx` sengaja tidak diperlakukan
 * istimewa: keduanya cuma menyimpan kunci di field `permission:` lalu meneruskan
 * *variabel* ke `can`/`canAny`, jadi regex gerbang-verb di bawah otomatis tidak
 * pernah cocok di sana walau kedua file itu tidak di-skip secara eksplisit.
 *
 * Yang TIDAK dibuktikan test ini: bahwa gerbangnya benar dipasang di jalur yang
 * tepat (halaman yang tepat, method HTTP yang tepat), atau bahwa hasil `can()`
 * benar-benar dipakai untuk memblokir (bisa saja hasilnya dihitung lalu diabaikan).
 * Itu domain code review + test perilaku per fitur, bukan test generik ini.
 *
 * Sumber kebenaran katalog ada di lib/permissions.ts, jadi file itu sendiri
 * dikecualikan dari pencarian. `lib/permissions.test.ts` juga dikecualikan:
 * dia memanggil `can()`/`canAny()` langsung dengan kunci literal untuk menguji
 * fungsi itu sendiri, yang kalau ikut dihitung akan membuat kunci tampak
 * "terjaga" semata-mata karena diuji unit, bukan karena ada pemanggil gerbang
 * nyata di kode aplikasi.
 */

const GATE_CALL = /(guardSuperadmin|guard|requireAnyPermission|requirePermission|canAny|can)\s*\([^)]*['"]KEY['"]/;

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

/** File yang isinya sudah pasti bukan bukti gerbang nyata — lihat komentar di atas. */
const IGNORED = new Set([
  'lib/permissions.ts',
  'lib/permissions.test.ts',
  'lib/permissions-usage.test.ts',
]);

function isGatedIn(filePath: string, key: string): boolean {
  const content = readFileSync(filePath, 'utf8');
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(GATE_CALL.source.replace('KEY', escaped));
  return pattern.test(content);
}

describe('tidak ada izin hantu', () => {
  it.each(PERMISSION_KEYS)('%s dijaga setidaknya satu pemanggilan gerbang', (key) => {
    const candidates = filesMentioning(key).filter((f) => !IGNORED.has(f));
    const gatedIn = candidates.filter((f) => isGatedIn(f, key));
    expect(
      gatedIn.length,
      `izin "${key}" tidak pernah jadi argumen guard()/requirePermission()/requireAnyPermission()/can()/canAny() di kode aplikasi (kandidat file yang menyebutnya: ${candidates.join(', ') || '(tidak ada)'})`,
    ).toBeGreaterThan(0);
  });
});
