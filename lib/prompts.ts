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

LOOK-ALIKE WARNING (KRITIS — pasangan menu yang sering tertukar):
- "X goreng" vs "X bakar": Ayam goreng/bakar, Ayam Kampung goreng/bakar, Bebek goreng/bakar, Burung Dara goreng/bakar, Nila goreng/bakar
- "Es X" vs "X panas" / "X tawar": Es Teh vs Teh Panas vs Teh Panas Tawar vs Es Teh Tawar
Kalau Anda TIDAK BISA BACA DENGAN JELAS kata penentu (goreng/bakar/es/panas/tawar), Anda WAJIB:
  - Set confidence <= 70 (bahkan kalau nama lainnya jelas)
  - Sertakan alternatives berisi pasangan look-alike-nya
Lebih baik flag berlebihan daripada salah identifikasi.

Tugas:
1. items[]: ekstrak SEMUA baris yang ada angka qty (tulisan tangan). Skip kalau qty kosong.
   - menu_name: HARUS PERSIS sama dengan salah satu nama di daftar master. Jangan paraphrase/singkat.
   - qty: angka positif dari tulisan tangan.
   - notes: anotasi tulisan tangan di sebelah menu (cth "D P", "tanpa sambel"). Kalau ga jelas maknanya, masukkan tulisan mentahnya. null kalau kosong.
   - confidence (OPSIONAL, 0-100): kasih kalau Anda ragu DI BAGIAN APAPUN. Khusus look-alike pairs di atas, confidence WAJIB <= 70 kalau kata penentu tidak jelas. Skip field cuma kalau benar-benar yakin >= 95%.
   - alternatives (max 2): SERTAKAN setiap kali ada kemungkinan look-alike (pasangan goreng/bakar atau es/panas dari menu yang sama). Pilih dari daftar master saja. Skip cuma kalau menu sangat unik (tidak ada pasangan look-alike).
2. handwritten_total: angka total di bawah nota. PENTING: total ditulis dalam SATUAN RIBUAN. "92" = 92000, "92.000" = 92000. Return rupiah penuh, atau 0 kalau tidak terbaca.
3. customer_name, table_no: isi dari kolom "Nama" dan "No. Meja". null kalau kosong.`;

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
