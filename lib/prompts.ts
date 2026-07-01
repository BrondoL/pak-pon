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

Output JSON (PAKAI KEY PENDEK PERSIS):
{
  "i":[{"m":"<menu_name dari master>","q":<int>0,"n":"<notes>"|null,"c":<0-100, opsional>,"a":[{"m":"<alt>"}] max 2 opsional}],
  "t":<handwritten_total rupiah penuh, "92"=92000, 0 kalau tidak terbaca>,
  "cn":"<customer_name>"|null,
  "tn":"<table_no>"|null
}

Aturan:
1. Item: skip kalau qty kosong. "m" HARUS persis dari master.
2. notes "n": anotasi handwritten (cth "PAHA"). Kalau ga jelas, tulis mentahnya. null kalau kosong.
3. confidence "c" (0-100, opsional): isi kalau ragu. Skip cuma kalau yakin >=95%.
4. alternatives "a" (max 2 dari master, opsional): sertakan untuk look-alike.
5. Total "t": SATUAN RIBUAN — "92"=92000.`;

export function buildMenuRefText(menus: MenuRef[]): string {
  if (menus.length === 0) return 'Daftar menu master kosong.';
  const lines = menus.map((m) => `- ${m.name}`);
  return `Daftar menu master (gunakan nama PERSIS seperti tertulis di sini):\n${lines.join('\n')}`;
}

// Schema menerima short-key output dari Gemini (m/q/n/c/a/t/cn/tn) lalu
// .transform() re-expand ke shape long-key supaya consumer code tidak berubah.
export function buildScanSchema(menus: MenuRef[]) {
  const menuNames = menus.map((m) => m.name);

  const menuNameSchema =
    menuNames.length > 0
      ? z.enum(menuNames as [string, ...string[]])
      : z.string();

  const confidenceSchema = z.number().int().min(0).max(100);

  // Alternatives bisa `{m, c?}` atau shorthand "MenuName" — coerce string → {m}.
  const altItemSchema = z.preprocess(
    (v) => (typeof v === 'string' ? { m: v } : v),
    z.object({
      m: menuNameSchema,
      c: confidenceSchema.optional(),
    })
  );

  return z.object({
    i: z.array(
      z.object({
        m: menuNameSchema,
        q: z.number().int().positive(),
        n: z.string().nullable(),
        c: confidenceSchema.optional(),
        a: z.array(altItemSchema).max(2).optional(),
      })
    ),
    t: z.number().int().nonnegative(),
    cn: z.string().nullable(),
    tn: z.string().nullable(),
  }).transform((d) => ({
    items: d.i.map((it) => ({
      menu_name: it.m,
      qty: it.q,
      notes: it.n,
      confidence: it.c,
      alternatives: it.a?.map((a) => ({
        menu_name: a.m,
        confidence: a.c,
      })),
    })),
    handwritten_total: d.t,
    customer_name: d.cn,
    table_no: d.tn,
  }));
}

export type ScanResult = z.infer<ReturnType<typeof buildScanSchema>>;
