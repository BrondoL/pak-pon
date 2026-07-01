import { z } from 'zod';

export type MenuRef = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
};

export const OCR_SYSTEM_PROMPT = `OCR nota Pak Pon. Qty handwritten di kolom "Banyak nya"; cek SEMUA baris termasuk pensil tipis.

PRIORITAS: jangan miss item. Tebak qty/menu yang ragu daripada skip.

LOOK-ALIKE (pasangan yang sering tertukar — kalau kata penentu tidak terbaca jelas, confidence WAJIB <=70 + sertakan alternatives):
- "X goreng" vs "X bakar" (Ayam, Ayam Kampung, Bebek, Burung Dara, Nila)
- "Es X" vs "X panas" vs "X tawar" (Teh)

Output:
1. items[]: tiap baris dengan qty handwritten. Skip kalau qty kosong.
   - menu_name: HARUS persis dari daftar master di bawah.
   - qty: angka positif.
   - notes: anotasi handwritten (cth "PAHA", "tanpa sambel"). Kalau ga jelas, tulis mentahnya. null kalau kosong.
   - confidence (0-100, opsional): isi kalau ragu. Skip cuma kalau yakin >=95%.
   - alternatives (max 2 dari daftar master, opsional): sertakan untuk look-alike pairs.
2. handwritten_total: angka total bawah nota. SATUAN RIBUAN — "92"=92000. Return rupiah penuh, 0 kalau tidak terbaca.
3. customer_name, table_no: dari kolom "Nama" & "No. Meja". null kalau kosong.`;

export function buildMenuRefText(menus: MenuRef[]): string {
  if (menus.length === 0) return 'Daftar menu master kosong.';
  const lines = menus.map((m) => `- ${m.name}`);
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

  // Tolerate AI returning alternatives as either [{menu_name, confidence?}]
  // (the documented shape) OR ["MenuName"] (shorthand some Gemini versions emit).
  // Coerce string → {menu_name} before validation.
  const altItemSchema = z.preprocess(
    (v) => (typeof v === 'string' ? { menu_name: v } : v),
    z.object({
      menu_name: menuNameSchema,
      confidence: confidenceSchema.optional(),
    })
  );

  return z.object({
    items: z.array(
      z.object({
        menu_name: menuNameSchema,
        qty: z.number().int().positive(),
        notes: z.string().nullable(),
        // Both optional so AI can skip them on certain items without breaking schema.
        // Trade: less attention budget on confidence reasoning → more on item detection.
        confidence: confidenceSchema.optional(),
        alternatives: z.array(altItemSchema).max(2).optional(),
      })
    ),
    handwritten_total: z.number().int().nonnegative(),
    customer_name: z.string().nullable(),
    table_no: z.string().nullable(),
  });
}

export type ScanResult = z.infer<ReturnType<typeof buildScanSchema>>;
