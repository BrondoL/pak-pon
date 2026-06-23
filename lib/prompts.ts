import { z } from 'zod';

export type MenuRef = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
};

export const OCR_SYSTEM_PROMPT = `Anda adalah OCR untuk nota warung Pecel Lele Pak Pon.

Nota: kolom MENU pre-printed, kasir tulis tangan qty di kolom "Banyak nya" (atau kadang di kolom paling kanan). Cek SEMUA baris, termasuk angka faint/pensil tipis.

PRIORITAS UTAMA: jangan miss item. Lebih baik tebak qty/menu yang ragu daripada skip item yang ada angka qty-nya.

Tugas:
1. items[]: ekstrak SEMUA baris yang ada angka qty (tulisan tangan). Skip kalau qty kosong.
   - menu_name: HARUS PERSIS sama dengan salah satu nama di daftar master. Jangan paraphrase/singkat.
   - qty: angka positif dari tulisan tangan.
   - notes: anotasi tulisan tangan di sebelah menu (cth "D P", "tanpa sambel"). Kalau ga jelas maknanya, masukkan tulisan mentahnya. null kalau kosong.
   - confidence (OPSIONAL, 0-100): kasih kalau Anda ragu di item ini. Skip field kalau yakin >= 90%.
   - alternatives (OPSIONAL, max 2): kasih kalau confidence < 90; pilih dari daftar master saja. Skip field kalau yakin.
2. handwritten_total: angka total di bawah nota. PENTING: total ditulis dalam SATUAN RIBUAN. "92" = 92000, "92.000" = 92000. Return rupiah penuh, atau 0 kalau tidak terbaca.
3. customer_name, table_no: isi dari kolom "Nama" dan "No. Meja". null kalau kosong.`;

/**
 * Build the text portion that gives Gemini the menu master as reference.
 */
export function buildMenuRefText(menus: MenuRef[]): string {
  if (menus.length === 0) return 'Daftar menu master kosong.';
  const lines = menus.map(
    (m) => `- ${m.name} (${m.category}) Rp${m.price}`
  );
  return `Daftar menu master (gunakan nama PERSIS seperti tertulis di sini):\n${lines.join('\n')}`;
}

/**
 * Build a Zod schema where menu_name is constrained to the master list (enum).
 * Memaksa Gemini memilih dari daftar valid → mencegah hallucination.
 */
export function buildScanSchema(menus: MenuRef[]) {
  const menuNames = menus.map((m) => m.name);

  const menuNameSchema =
    menuNames.length > 0
      ? z.enum(menuNames as [string, ...string[]])
      : z.string();

  const confidenceSchema = z.number().int().min(0).max(100);

  return z.object({
    items: z.array(
      z.object({
        menu_name: menuNameSchema,
        qty: z.number().int().positive(),
        notes: z.string().nullable(),
        // Both optional so AI can skip them on certain items without breaking schema.
        // Trade: less attention budget on confidence reasoning → more on item detection.
        confidence: confidenceSchema.optional(),
        alternatives: z.array(
          z.object({
            menu_name: menuNameSchema,
            confidence: confidenceSchema.optional(),
          })
        ).max(2).optional(),
      })
    ),
    handwritten_total: z.number().int().nonnegative(),
    customer_name: z.string().nullable(),
    table_no: z.string().nullable(),
  });
}

export type ScanResult = z.infer<ReturnType<typeof buildScanSchema>>;
