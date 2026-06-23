/**
 * Build URL untuk trigger RawBT print job di Android Chrome.
 *
 * Format yang dipakai (verified dari rawbt.ru + community examples):
 *   rawbt:base64,<base64-data>
 *
 * Cara kerja: Android Chrome lihat scheme `rawbt:`, route ke RawBT app
 * (yang register handler untuk scheme ini), RawBT decode base64 → kirim
 * ESC/POS ke printer default yang sudah di-setup di RawBT.
 *
 * BATASAN PENTING:
 * - RawBT cuma support 1 default printer per app. URL TIDAK BISA pilih
 *   printer target — semua print job ke printer default RawBT.
 * - Untuk multi-printer (dapur + minuman simultan), butuh approach lain
 *   (Plan B: WebSocket server, Capacitor wrap, atau 2 tab dengan 2 RawBT
 *   profile default berbeda).
 * - `profile` parameter di-accept untuk kompatibilitas signature, tapi
 *   tidak digunakan dalam URL saat ini (logged untuk diagnostic).
 */

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
  profile: string; // kompat — tidak dipakai dalam URL (RawBT default printer)
  bytes: Uint8Array;
}): string {
  const payloadB64 = uint8ToBase64(args.bytes);
  return `rawbt:base64,${payloadB64}`;
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
