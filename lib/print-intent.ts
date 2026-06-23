/**
 * Build Android intent URL untuk trigger RawBT print job.
 *
 * Format default (Plan A — multi-profile via name):
 *   intent://print/#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;S.profile=Dapur;S.payload=<base64>;end
 *
 * RawBT terima intent, lookup profile by name dari setting-nya, kirim payload via TCP:9100.
 *
 * Plan B (env flag PAK_PON_PRINTER_MODE=ip_direct, future, gak diimplementasi di plan ini):
 *   intent://...;S.ip=192.168.1.50;I.port=9100;S.payload=<base64>;end
 */

const RAWBT_PACKAGE = 'ru.a402d.rawbtprinter';

export type PrintTarget = 'dapur' | 'minuman';

export type MenuCategory = 'makanan' | 'nasi' | 'minuman';

export type TransactionItemForPrint = {
  id: string;
  menu_name_snapshot: string;
  menu_category: MenuCategory;
  qty: number;
  notes: string | null;
};

export type SplitItems = {
  dapur: TransactionItemForPrint[];
  minuman: TransactionItemForPrint[];
};

function uint8ToBase64(bytes: Uint8Array): string {
  // Browser-safe base64 (no Node Buffer)
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa available in browser & jsdom
  return btoa(binary);
}

export function buildRawBtIntentUrl(args: {
  profile: string;
  bytes: Uint8Array;
}): string {
  const payloadB64 = uint8ToBase64(args.bytes);
  const encodedProfile = encodeURIComponent(args.profile);
  // Base64 chars (A-Z a-z 0-9 + / =) don't conflict with `;` separator and
  // Intent.parseUri() reads S.key=value literally (no percent-decoding).
  return `intent://print/#Intent;scheme=rawbt;package=${RAWBT_PACKAGE};S.profile=${encodedProfile};S.payload=${payloadB64};end`;
}

/**
 * Split transaction items berdasarkan kategori menu:
 * - makanan, nasi → dapur
 * - minuman      → minuman
 */
export function splitItemsByTarget(
  items: TransactionItemForPrint[]
): SplitItems {
  const dapur: TransactionItemForPrint[] = [];
  const minuman: TransactionItemForPrint[] = [];
  for (const it of items) {
    if (it.menu_category === 'minuman') {
      minuman.push(it);
    } else if (it.menu_category === 'makanan' || it.menu_category === 'nasi') {
      dapur.push(it);
    }
    // else: unknown category, skip (defensive)
  }
  return { dapur, minuman };
}
