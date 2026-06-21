import { z } from 'zod';

export type MenuRef = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
};

export const OCR_SYSTEM_PROMPT = `Anda adalah OCR untuk nota warung Pecel Lele Pak Pon.

Format nota: kolom MENU sudah pre-printed di kertas nota dengan harga. Kasir mengisi tulisan tangan angka di kolom "Banyak nya" untuk setiap item yang dipesan, dan total di bawah nota.

Tugas Anda:
1. Ekstrak HANYA item yang punya angka qty (tulisan tangan) di sebelahnya. Abaikan baris menu yang qty-nya kosong.
2. Anotasi tulisan tangan di sebelah nama menu (cth: "D P", "Dada", "tanpa sambel") masuk ke field "notes". Kosongkan kalau tidak ada.
3. handwritten_total = angka total yang ditulis tangan di bagian bawah nota. 0 kalau tidak terbaca.
4. customer_name dan table_no = isi dari kolom "Nama" dan "No. Meja" di atas nota — null kalau kosong.

PENTING: Field "menu_name" HARUS PERSIS sama dengan salah satu nama menu di daftar master di bawah. Jangan paraphrase, jangan terjemahkan, jangan singkat.`;

/**
 * Build the text portion that gives Gemini the menu master as reference.
 * Used together with OCR_SYSTEM_PROMPT.
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

  return z.object({
    items: z.array(
      z.object({
        menu_name: menuNameSchema,
        qty: z.number().int().positive(),
        notes: z.string().nullable(),
      })
    ),
    handwritten_total: z.number().int().nonnegative(),
    customer_name: z.string().nullable(),
    table_no: z.string().nullable(),
  });
}

export type ScanResult = z.infer<ReturnType<typeof buildScanSchema>>;
