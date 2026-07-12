import { z } from 'zod';

export type MenuRef = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
};

export const OCR_SYSTEM_PROMPT = `OCR nota Pak Pon. Qty handwritten di kolom "Banyak nya"; cek SEMUA baris termasuk pensil tipis.

PRIORITAS: jangan miss item. Tebak qty/menu yang ragu daripada skip.

LOOK-ALIKE (pasangan yang sering tertukar — kalau kata penentu tidak terbaca jelas, confidence WAJIB <=70):
- "X goreng" vs "X bakar" (Ayam, Ayam Kampung, Bebek, Burung Dara, Nila)
- "Es X" vs "X panas" vs "X tawar" (Teh)

Output JSON dengan key pendek (schema define required + enum menu):
- i[]: items. Tiap item minimum {"m","q"}. Skip item kalau qty kosong.
- m: menu — schema batasi ke daftar master, tidak perlu paraphrase.
- q: qty positif integer.
- n: HANYA anotasi handwritten yang ditulis kasir di nota (cth "PAHA", "tanpa sambel"). Kalau ga jelas maknanya, tulis mentahnya. JANGAN taruh reasoning/penjelasan/meta-komentar tentang OCR di sini. Skip kalau tidak ada anotasi.
- c: confidence 0-100. Isi kalau ragu. Skip kalau yakin >=95%.
- t: total. HANYA angka yang ditulis kasir di bagian bawah nota (label "Total"/"Jumlah"). Kalau kasir TIDAK menulis total, t:0. JANGAN hitung sendiri dari items. Convert ke rupiah penuh (SATUAN RIBUAN) — "92"=92000, "92.000"=92000.
- cn, tn: dari kolom "Nama" & "No. Meja". Skip kalau kosong.`;

// Schema menerima short-key output dari Gemini (m/q/n/c/t/cn/tn) lalu
// .transform() re-expand ke shape long-key supaya consumer code tidak berubah.
export function buildScanSchema(menus: MenuRef[]) {
  const menuNames = menus.map((m) => m.name);

  const menuNameSchema =
    menuNames.length > 0
      ? z.enum(menuNames as [string, ...string[]])
      : z.string();

  const confidenceSchema = z.number().int().min(0).max(100);

  // n / cn / tn optional supaya Gemini bisa omit key kalau null (token saver).
  // Transform normalize back to null untuk consumer code yang expect nullable.
  return z.object({
    i: z.array(
      z.object({
        m: menuNameSchema,
        q: z.number().int().positive(),
        n: z.string().nullable().optional(),
        c: confidenceSchema.optional(),
      })
    ),
    t: z.number().int().nonnegative(),
    cn: z.string().nullable().optional(),
    tn: z.string().nullable().optional(),
  }).transform((d) => ({
    items: d.i.map((it) => ({
      menu_name: it.m,
      qty: it.q,
      notes: it.n ?? null,
      confidence: it.c,
    })),
    handwritten_total: d.t,
    customer_name: d.cn ?? null,
    table_no: d.tn ?? null,
  }));
}

export type ScanResult = z.infer<ReturnType<typeof buildScanSchema>>;

/**
 * Build Gemini responseSchema (OpenAPI 3.0 subset) yang constrain output ke:
 * - `m` (menu_name) hanya salah satu dari master list — no hallucination possible
 * - Field required minimum: item wajib `m`+`q`, root wajib `i`+`t`
 * - `n` / `c` / `cn` / `tn` optional supaya Gemini bisa omit null (token saver)
 * - `maxLength` di free-string field (n/cn/tn) — grammar-level rem supaya kalau
 *   model masuk repetition loop (e.g. 2026-07-11 anomaly: tn ngalor-ngidul digit
 *   sampai 65k tok), Gemini paksa stop sebelum bill meledak.
 *
 * Menu enum di sini tidak di-count sebagai input tokens (verified 2026-07-01
 * via scripts/verify-response-schema.mjs).
 */
export function buildScanResponseSchema(menus: MenuRef[]) {
  const menuNames = menus.map((m) => m.name);
  const menuNameProp: Record<string, unknown> =
    menuNames.length > 0
      ? { type: 'string', enum: menuNames }
      : { type: 'string' };

  return {
    type: 'object',
    properties: {
      i: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            m: menuNameProp,
            q: { type: 'integer' },
            n: { type: 'string', maxLength: 60 },
            c: { type: 'integer' },
          },
          required: ['m', 'q'],
        },
      },
      t: { type: 'integer' },
      cn: { type: 'string', maxLength: 40 },
      tn: { type: 'string', maxLength: 20 },
    },
    required: ['i', 't'],
  };
}
