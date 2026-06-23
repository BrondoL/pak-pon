# AI Scan Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah per-item confidence dengan visual highlight, top-2 menu alternatives untuk swap cepat, hint satuan ribuan di prompt, backend smart total parser, dan notes raw text hint — semua dalam satu bundle release.

**Architecture:** Gemini structured output di-extend dengan field `confidence` + `alternatives` per item (validated via Zod). DB tambah 2 kolom nullable di `transaction_items`. Helper baru `lib/total-parser.ts` deteksi pola satuan ribuan. Review UI (`NotaItemRow` + `NotaReviewForm`) tampilkan tier kuning/merah, chip alternative, dan smart-total banner.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Zod, Vitest, Supabase Postgres, Tailwind 4 design tokens, Gemini SDK (`@google/genai`).

**Spec reference:** `docs/superpowers/specs/2026-06-23-ai-scan-improvements-design.md`

**Working directory:** `/home/brondol/Downloads/pak-pon`

---

## Task 1: Smart total parser helper (TDD)

**Files:**
- Create: `lib/total-parser.ts`
- Test: `lib/total-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/total-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectThousandsMissing } from './total-parser';

describe('detectThousandsMissing', () => {
  it('returns no-suggest when handwritten_total is null', () => {
    expect(detectThousandsMissing(null, 50000)).toEqual({ suggest: false });
  });

  it('returns no-suggest when handwritten_total is 0', () => {
    expect(detectThousandsMissing(0, 50000)).toEqual({ suggest: false });
  });

  it('returns no-suggest when computed_sum is 0', () => {
    expect(detectThousandsMissing(50, 0)).toEqual({ suggest: false });
  });

  it('returns no-suggest when handwritten_total is already >= 1000', () => {
    expect(detectThousandsMissing(50000, 50000)).toEqual({ suggest: false });
    expect(detectThousandsMissing(1500, 1500)).toEqual({ suggest: false });
  });

  it('suggests expanded total when handwritten * 1000 matches computed_sum within ±15%', () => {
    expect(detectThousandsMissing(92, 92000)).toEqual({
      suggest: true,
      suggested_total: 92000,
    });
    expect(detectThousandsMissing(92, 85000)).toEqual({
      suggest: true,
      suggested_total: 92000,
    });
    expect(detectThousandsMissing(92, 100000)).toEqual({
      suggest: true,
      suggested_total: 92000,
    });
  });

  it('does not suggest when handwritten * 1000 is outside ±15% of computed_sum', () => {
    expect(detectThousandsMissing(92, 50000)).toEqual({ suggest: false });
    expect(detectThousandsMissing(92, 200000)).toEqual({ suggest: false });
  });

  it('handles edge of tolerance band exactly at 15%', () => {
    expect(detectThousandsMissing(100, 115000)).toEqual({
      suggest: true,
      suggested_total: 100000,
    });
    expect(detectThousandsMissing(100, 85000)).toEqual({
      suggest: true,
      suggested_total: 100000,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- lib/total-parser`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `lib/total-parser.ts`:

```ts
export type ThousandsHint =
  | { suggest: false }
  | { suggest: true; suggested_total: number };

const TOLERANCE = 0.15;
const RIBUAN_CUTOFF = 1000;

/**
 * Detect kemungkinan handwritten_total ditulis ringkas tanpa zero-suffix ribuan.
 * Cth: kasir tulis "92" padahal maksudnya Rp 92.000.
 */
export function detectThousandsMissing(
  handwritten_total: number | null,
  computed_sum: number
): ThousandsHint {
  if (!handwritten_total || handwritten_total === 0) return { suggest: false };
  if (computed_sum === 0) return { suggest: false };
  if (handwritten_total >= RIBUAN_CUTOFF) return { suggest: false };

  const expanded = handwritten_total * 1000;
  const ratio = Math.abs(expanded - computed_sum) / computed_sum;
  if (ratio <= TOLERANCE) {
    return { suggest: true, suggested_total: expanded };
  }
  return { suggest: false };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- lib/total-parser`
Expected: PASS, all 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/total-parser.ts lib/total-parser.test.ts
git commit -m "feat(scan): add detectThousandsMissing helper for smart total parsing"
```

---

## Task 2: DB migration — confidence + alternatives columns

**Files:**
- Create: `supabase/migrations/0007_scan_confidence.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0007_scan_confidence.sql`:

```sql
-- 0007_scan_confidence.sql — per-item OCR confidence + top-N alternatives
-- Both nullable: NULL = item added or edited manually by user (no AI confidence applies).

ALTER TABLE transaction_items
  ADD COLUMN confidence  smallint CHECK (confidence BETWEEN 0 AND 100),
  ADD COLUMN alternatives jsonb;

COMMENT ON COLUMN transaction_items.confidence  IS 'Self-reported AI confidence 0-100. NULL kalau item user-added/edited.';
COMMENT ON COLUMN transaction_items.alternatives IS 'JSON array of {menu_name, confidence}, max 2. Kosong/NULL kalau AI sangat yakin atau user-edited.';
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__plugin_supabase_supabase__apply_migration` tool with:
- name: `scan_confidence`
- query: (paste the SQL above)

If MCP not available, run via Supabase CLI: `npx supabase db push`.

- [ ] **Step 3: Verify the columns exist**

Use `mcp__plugin_supabase_supabase__list_tables` (filter to `public.transaction_items`) or run via Supabase SQL editor:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'transaction_items' AND column_name IN ('confidence', 'alternatives');
```

Expected: 2 rows, both nullable, `confidence smallint` + `alternatives jsonb`.

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/migrations/0007_scan_confidence.sql
git commit -m "feat(db): add confidence + alternatives columns to transaction_items"
```

---

## Task 3: Update Zod schema + OCR prompt

**Files:**
- Modify: `lib/prompts.ts`
- Modify: `lib/prompts.test.ts`

- [ ] **Step 1: Update tests first (failing initially)**

Replace contents of `lib/prompts.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { buildScanSchema, buildMenuRefText, OCR_SYSTEM_PROMPT, type MenuRef } from './prompts';

const sampleMenus: MenuRef[] = [
  { id: 'a', name: 'Pecel Lele', category: 'makanan', price: 16000 },
  { id: 'b', name: 'Es Teh',     category: 'minuman', price: 6000 },
];

describe('OCR_SYSTEM_PROMPT', () => {
  it('mentions Pak Pon and is in Indonesian', () => {
    expect(OCR_SYSTEM_PROMPT).toContain('Pak Pon');
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('handwritten');
  });

  it('instructs AI to return confidence per item', () => {
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('confidence');
  });

  it('instructs AI to return alternatives per item', () => {
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('alternatives');
  });

  it('instructs AI that handwritten_total is in thousands', () => {
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('ribuan');
  });

  it('instructs AI to keep raw notes when uncertain', () => {
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('mentah');
  });
});

describe('buildMenuRefText', () => {
  it('lists menus with price + category', () => {
    const text = buildMenuRefText(sampleMenus);
    expect(text).toContain('Pecel Lele');
    expect(text).toContain('makanan');
    expect(text).toContain('16000');
    expect(text).toContain('Es Teh');
  });
  it('returns a string even for empty menu list', () => {
    expect(typeof buildMenuRefText([])).toBe('string');
  });
});

describe('buildScanSchema', () => {
  it('accepts valid Gemini-like response with confidence + alternatives', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [
        { menu_name: 'Pecel Lele', qty: 3, notes: null, confidence: 95, alternatives: [] },
        { menu_name: 'Es Teh', qty: 2, notes: 'dingin', confidence: 60, alternatives: [
          { menu_name: 'Pecel Lele', confidence: 30 },
        ] },
      ],
      handwritten_total: 60000,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects menu_name not in master list', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{ menu_name: 'Burger', qty: 1, notes: null, confidence: 90, alternatives: [] }],
      handwritten_total: 50000,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects qty < 1', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{ menu_name: 'Pecel Lele', qty: 0, notes: null, confidence: 90, alternatives: [] }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of 0-100 range', () => {
    const schema = buildScanSchema(sampleMenus);
    expect(schema.safeParse({
      items: [{ menu_name: 'Pecel Lele', qty: 1, notes: null, confidence: 150, alternatives: [] }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    }).success).toBe(false);
    expect(schema.safeParse({
      items: [{ menu_name: 'Pecel Lele', qty: 1, notes: null, confidence: -1, alternatives: [] }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    }).success).toBe(false);
  });

  it('rejects more than 2 alternatives', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{
        menu_name: 'Pecel Lele',
        qty: 1,
        notes: null,
        confidence: 50,
        alternatives: [
          { menu_name: 'Es Teh', confidence: 30 },
          { menu_name: 'Es Teh', confidence: 20 },
          { menu_name: 'Es Teh', confidence: 10 },
        ],
      }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects alternative with menu_name not in master list', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{
        menu_name: 'Pecel Lele',
        qty: 1,
        notes: null,
        confidence: 50,
        alternatives: [{ menu_name: 'Burger', confidence: 30 }],
      }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });

  it('handles empty menu list', () => {
    const schema = buildScanSchema([]);
    const result = schema.safeParse({
      items: [],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify failures**

Run: `npm run test -- lib/prompts`
Expected: Several FAILs related to confidence / alternatives / ribuan / mentah keywords missing.

- [ ] **Step 3: Update `lib/prompts.ts` — prompt + schema**

Replace contents of `lib/prompts.ts` with:

```ts
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
2. Anotasi tulisan tangan di sebelah nama menu (cth: "D P", "Dada", "tanpa sambel") masuk ke field "notes". Kalau ada tulisan tangan tapi maknanya tidak jelas, tetap masukkan tulisan mentahnya — jangan kosongkan.
3. handwritten_total = angka total yang ditulis tangan di bagian bawah nota. PENTING: total ditulis dalam SATUAN RIBUAN RUPIAH. Kalau kasir tulis "92", baca sebagai 92000. Kalau "92.000" atau "92rb", juga 92000. Selalu return dalam rupiah penuh. Return 0 kalau tidak terbaca.
4. customer_name dan table_no = isi dari kolom "Nama" dan "No. Meja" di atas nota — null kalau kosong.
5. Untuk SETIAP item, kasih "confidence" (0-100): seberapa yakin Anda bahwa menu_name + qty + notes terbaca dengan benar. Pertimbangkan kejelasan tulisan tangan, ambiguitas vs menu lain, dan kemiripan visual.
6. Untuk SETIAP item, kasih "alternatives" (array, maksimal 2): menu-menu lain dari daftar master yang punya kemungkinan benar (urutkan dari paling mungkin). Kosongkan kalau Anda sangat yakin (confidence >= 90).

PENTING: Field "menu_name" (dan setiap "menu_name" di alternatives) HARUS PERSIS sama dengan salah satu nama menu di daftar master di bawah. Jangan paraphrase, jangan terjemahkan, jangan singkat.`;

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
        confidence: confidenceSchema,
        alternatives: z.array(
          z.object({
            menu_name: menuNameSchema,
            confidence: confidenceSchema,
          })
        ).max(2),
      })
    ),
    handwritten_total: z.number().int().nonnegative(),
    customer_name: z.string().nullable(),
    table_no: z.string().nullable(),
  });
}

export type ScanResult = z.infer<ReturnType<typeof buildScanSchema>>;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- lib/prompts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/prompts.ts lib/prompts.test.ts
git commit -m "feat(scan): extend OCR prompt + schema with confidence, alternatives, ribuan hint"
```

---

## Task 4: Extend `lib/transactions.ts` types (carry confidence + alternatives)

**Files:**
- Modify: `lib/transactions.ts`
- Modify: `lib/transactions.test.ts`

Background: `computeReplaceItems` is the helper that PATCH uses to compute final item rows. We need to plumb `confidence` and `alternatives` through it: take them from `requested`, write them into `rows`.

- [ ] **Step 1: Update test file**

Replace contents of `lib/transactions.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { computeReplaceItems, type ExistingItem, type RequestedItem, type MenuRef } from './transactions';

const menus: MenuRef[] = [
  { id: 'menu-pecel', name: 'Pecel Lele', price: 16000 },
  { id: 'menu-nasi',  name: 'Nasi',       price: 7000 },
];

const existing: ExistingItem[] = [
  { id: 'item-1', menu_id: 'menu-pecel', unit_price_snapshot: 15000, qty: 2, notes: null,   sort_order: 0 },
  { id: 'item-2', menu_id: 'menu-nasi',  unit_price_snapshot: 6500,  qty: 3, notes: 'less', sort_order: 1 },
];

describe('computeReplaceItems', () => {
  it('preserves snapshot price for items with matching id', () => {
    const requested: RequestedItem[] = [
      { id: 'item-1', menu_id: 'menu-pecel', qty: 4, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].unit_price_snapshot).toBe(15000);
    expect(result.rows[0].qty).toBe(4);
    expect(result.rows[0].menu_name_snapshot).toBe('Pecel Lele');
  });

  it('snapshots current menu price for new items (no id)', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-pecel', qty: 1, notes: 'extra sambel', sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].unit_price_snapshot).toBe(16000);
    expect(result.rows[0].notes).toBe('extra sambel');
  });

  it('omits items whose id was in existing but not in requested (effective delete)', () => {
    const requested: RequestedItem[] = [
      { id: 'item-1', menu_id: 'menu-pecel', qty: 1, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].menu_id).toBe('menu-pecel');
  });

  it('rejects requested item referencing unknown menu_id', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-nonexistent', qty: 1, notes: null, sort_order: 0 },
    ];
    expect(() => computeReplaceItems({ existing, requested, menus })).toThrow(/unknown menu/i);
  });

  it('handles requested id that does not match any existing — treats as new', () => {
    const requested: RequestedItem[] = [
      { id: 'fake-id', menu_id: 'menu-nasi', qty: 5, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].unit_price_snapshot).toBe(7000);
  });

  it('returns sort_order from requested', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-pecel', qty: 1, notes: null, sort_order: 5 },
      { menu_id: 'menu-nasi',  qty: 1, notes: null, sort_order: 3 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].sort_order).toBe(5);
    expect(result.rows[1].sort_order).toBe(3);
  });

  it('passes through confidence + alternatives from requested when present', () => {
    const requested: RequestedItem[] = [
      {
        menu_id: 'menu-pecel',
        qty: 1,
        notes: null,
        sort_order: 0,
        confidence: 62,
        alternatives: [{ menu_name: 'Nasi', confidence: 20 }],
      },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].confidence).toBe(62);
    expect(result.rows[0].alternatives).toEqual([{ menu_name: 'Nasi', confidence: 20 }]);
  });

  it('defaults confidence + alternatives to null when not provided', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-pecel', qty: 1, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].confidence).toBeNull();
    expect(result.rows[0].alternatives).toBeNull();
  });

  it('passes through explicit null confidence + empty alternatives (user-edited item)', () => {
    const requested: RequestedItem[] = [
      {
        menu_id: 'menu-pecel',
        qty: 1,
        notes: null,
        sort_order: 0,
        confidence: null,
        alternatives: [],
      },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].confidence).toBeNull();
    expect(result.rows[0].alternatives).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `npm run test -- lib/transactions`
Expected: 3 NEW tests FAIL (the existing 6 pass), because `confidence` / `alternatives` aren't on the types.

- [ ] **Step 3: Update `lib/transactions.ts`**

Replace contents of `lib/transactions.ts` with:

```ts
export type MenuRef = {
  id: string;
  name: string;
  price: number;
};

export type Alternative = {
  menu_name: string;
  confidence: number;
};

export type ExistingItem = {
  id: string;
  menu_id: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
};

export type RequestedItem = {
  id?: string;
  menu_id: string;
  qty: number;
  notes: string | null;
  sort_order: number;
  confidence?: number | null;
  alternatives?: Alternative[];
};

export type ItemRow = {
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
  confidence: number | null;
  alternatives: Alternative[] | null;
};

export type ReplaceItemsResult = {
  rows: ItemRow[];
};

/**
 * Compute rows untuk "replace items" PATCH transaksi.
 *
 * Untuk setiap requested item:
 * - Kalau punya `id` yang cocok dengan existing → preserve `unit_price_snapshot` lama
 * - Kalau no `id` atau id tidak cocok → snapshot harga sekarang dari menus
 * - confidence + alternatives di-passthrough apa adanya (default null kalau tidak dikirim)
 *
 * Throw kalau ada requested item dengan menu_id yang tidak ada di menus.
 */
export function computeReplaceItems(input: {
  existing: ExistingItem[];
  requested: RequestedItem[];
  menus: MenuRef[];
}): ReplaceItemsResult {
  const existingById = new Map(input.existing.map((e) => [e.id, e]));
  const menuById = new Map(input.menus.map((m) => [m.id, m]));

  const rows: ItemRow[] = input.requested.map((req) => {
    const menu = menuById.get(req.menu_id);
    if (!menu) {
      throw new Error(`Unknown menu_id: ${req.menu_id}`);
    }

    const matchedExisting = req.id ? existingById.get(req.id) : undefined;
    const unit_price_snapshot = matchedExisting?.unit_price_snapshot ?? menu.price;

    return {
      menu_id: menu.id,
      menu_name_snapshot: menu.name,
      unit_price_snapshot,
      qty: req.qty,
      notes: req.notes,
      sort_order: req.sort_order,
      confidence: req.confidence ?? null,
      alternatives: req.alternatives ?? null,
    };
  });

  return { rows };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test -- lib/transactions`
Expected: all 9 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/transactions.ts lib/transactions.test.ts
git commit -m "feat(tx): plumb confidence + alternatives through computeReplaceItems"
```

---

## Task 5: Update `/api/scan` route — persist + log + return suggest_thousands

**Files:**
- Modify: `app/api/scan/route.ts`
- Modify: `lib/total-parser.ts` (no change; already created in Task 1)

- [ ] **Step 1: Edit `app/api/scan/route.ts`**

Add import at top (alongside existing imports):

```ts
import { detectThousandsMissing } from '@/lib/total-parser';
```

Find the `.map((item, idx) => { ... }` block that builds `itemRows` (around line 92). Replace the returned object to include `confidence` + `alternatives`:

```ts
return {
  transaction_id: transactionId,
  menu_id: menu.id,
  menu_name_snapshot: menu.name,
  unit_price_snapshot: menu.price,
  qty: item.qty,
  notes: item.notes,
  sort_order: idx,
  confidence: item.confidence,
  alternatives: item.alternatives,
};
```

After the `itemRows` filter and `evt.set('items_resolved', ...)`, BEFORE `supabase.from('transactions').insert(...)`, add confidence aggregation logging:

```ts
const confidences = ocr.items.map((it) => it.confidence);
if (confidences.length > 0) {
  const minConf = Math.min(...confidences);
  const meanConf = Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);
  const lowConfItems = ocr.items.filter((it) => it.confidence < 75).map((it) => it.menu_name);
  evt.merge({
    ocr_conf_min: minConf,
    ocr_conf_mean: meanConf,
    ocr_low_conf_count: lowConfItems.length,
    ocr_low_conf_items: lowConfItems,
  });
}
```

Find where `computedSum` and `mismatch` are computed (just after items insert), and add smart-total detection:

```ts
const computedSum = itemRows.reduce((acc, it) => acc + it.qty * it.unit_price_snapshot, 0);
const mismatch = !!ocr.handwritten_total && computedSum !== ocr.handwritten_total;
const suggestThousands = detectThousandsMissing(ocr.handwritten_total, computedSum);
evt.merge({
  computed_sum: computedSum,
  mismatch,
  suggest_thousands: suggestThousands.suggest,
});
```

Update the success response body (the `NextResponse.json(...)` after `tagStatus(evt, 201)`) to include `suggest_thousands`:

```ts
return NextResponse.json(
  {
    transaction_id: transactionId,
    item_count: itemRows.length,
    handwritten_total: ocr.handwritten_total,
    computed_sum: computedSum,
    mismatch,
    suggest_thousands: suggestThousands,
    ocr_total_failure: ocrMeta.final_model === null,
  },
  { status: 201 }
);
```

- [ ] **Step 2: Type check**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/scan/route.ts
git commit -m "feat(scan): persist confidence/alts + smart total detection + observability"
```

---

## Task 6: Extend PATCH endpoint to accept handwritten_total + per-item confidence

**Files:**
- Modify: `app/api/transactions/[id]/route.ts`

- [ ] **Step 1: Extend `PatchSchema`**

In `app/api/transactions/[id]/route.ts`, replace the existing `PatchSchema`:

```ts
const AlternativeSchema = z.object({
  menu_name: z.string(),
  confidence: z.number().int().min(0).max(100),
});

const PatchSchema = z.object({
  status: z.enum(['pending_review', 'confirmed']).optional(),
  customer_name: z.string().nullable().optional(),
  table_no: z.string().nullable().optional(),
  handwritten_total: z.number().int().nonnegative().nullable().optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        menu_id: z.string().uuid(),
        qty: z.number().int().positive(),
        notes: z.string().nullable().default(null),
        sort_order: z.number().int().default(0),
        confidence: z.number().int().min(0).max(100).nullable().optional(),
        alternatives: z.array(AlternativeSchema).max(2).optional(),
      })
    )
    .optional(),
}).strict();
```

- [ ] **Step 2: Update `applyHeaderUpdate` to handle handwritten_total**

In `applyHeaderUpdate`, after `if (patch.table_no !== undefined) headerUpdate.table_no = patch.table_no;`, add:

```ts
if (patch.handwritten_total !== undefined) {
  headerUpdate.handwritten_total = patch.handwritten_total;
  evt.set('total_changed', true);
}
```

- [ ] **Step 3: Update `evt.merge` call in PATCH handler**

In the PATCH handler, find `evt.merge({ patch_status: ..., patch_items_count: ..., patch_set_customer_name: ..., patch_set_table_no: ... })` and add a line:

```ts
evt.merge({
  patch_status: parsed.data.status ?? null,
  patch_items_count: parsed.data.items?.length ?? null,
  patch_set_customer_name: parsed.data.customer_name !== undefined,
  patch_set_table_no: parsed.data.table_no !== undefined,
  patch_set_handwritten_total: parsed.data.handwritten_total !== undefined,
});
```

- [ ] **Step 4: Verify `replaceItems` passes confidence/alternatives through**

The `replaceItems` function already calls `computeReplaceItems(...)` which (after Task 4) reads `confidence`/`alternatives` from each requested item and writes them into the rows. The insert at the bottom of `replaceItems` writes all keys via `...r`. No further code change needed — verify the chain looks right by reading lines 248-318.

- [ ] **Step 5: Type check + lint + tests**

Run: `npm run build && npm run lint && npm run test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add app/api/transactions/[id]/route.ts
git commit -m "feat(tx): accept handwritten_total + per-item confidence/alts in PATCH"
```

---

## Task 7: Update review server load — fetch fields + compute suggest_thousands

**Files:**
- Modify: `app/(app)/transactions/[id]/review/page.tsx`

- [ ] **Step 1: Update the `transaction_items` select + add suggestThousands compute**

Replace contents of `app/(app)/transactions/[id]/review/page.tsx` with:

```tsx
import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { NotaReviewForm } from '@/components/nota-review-form';
import type { MenuOption } from '@/components/nota-item-modal';
import { detectThousandsMissing } from '@/lib/total-parser';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'notas';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getSupabaseServer();

  const { data: tx, error: txError } = await supabase
    .from('transactions')
    .select('id, status, handwritten_total, customer_name, table_no, created_at, scan_image_path')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (txError || !tx) notFound();

  const { data: items } = await supabase
    .from('transaction_items')
    .select('id, menu_id, menu_name_snapshot, unit_price_snapshot, qty, notes, sort_order, confidence, alternatives')
    .eq('transaction_id', id)
    .order('sort_order');

  const { data: menusData } = await supabase
    .from('menus')
    .select('id, name, category, price')
    .eq('is_active', true)
    .order('category')
    .order('name');
  const menus: MenuOption[] = menusData ?? [];

  let scanUrl: string | null = null;
  if (tx.scan_image_path) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(tx.scan_image_path, SIGNED_URL_TTL_SECONDS);
    scanUrl = signed?.signedUrl ?? null;
  }

  const computedSum = (items ?? []).reduce(
    (acc, it) => acc + it.qty * it.unit_price_snapshot,
    0
  );
  const suggestThousands = detectThousandsMissing(tx.handwritten_total, computedSum);

  return (
    <NotaReviewForm
      transaction={{
        id: tx.id,
        status: tx.status,
        handwritten_total: tx.handwritten_total,
        customer_name: tx.customer_name,
        table_no: tx.table_no,
        created_at: tx.created_at,
      }}
      initialItems={items ?? []}
      menus={menus}
      scanUrl={scanUrl}
      suggestThousands={suggestThousands}
    />
  );
}
```

- [ ] **Step 2: Type check (will fail at NotaReviewForm — fix in Task 10)**

Run: `npm run build`
Expected: FAIL with "Property 'suggestThousands' does not exist..." — that's expected; will be fixed in Task 10.

- [ ] **Step 3: Commit (work-in-progress, types will resolve after Tasks 8-10)**

```bash
git add app/\(app\)/transactions/\[id\]/review/page.tsx
git commit -m "feat(review): fetch confidence/alts + compute suggest_thousands server-side"
```

> Note: build is intentionally broken between Tasks 7 and 10. Don't push until Task 10 done.

---

## Task 8: Extend NotaItem type + reset confidence on modal edit

**Files:**
- Modify: `components/nota-item-row.tsx` (just the type definition)
- Modify: `components/nota-item-modal.tsx`

- [ ] **Step 1: Extend `NotaItem` in `nota-item-row.tsx`**

In `components/nota-item-row.tsx`, replace the `NotaItem` type:

```ts
export type Alternative = {
  menu_name: string;
  confidence: number;
};

export type NotaItem = {
  id?: string;
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
  confidence: number | null;
  alternatives: Alternative[] | null;
  _localId: string;
};
```

(Rest of the file stays for now — full row UI overhaul in Task 9.)

- [ ] **Step 2: Reset confidence + alternatives in modal save**

In `components/nota-item-modal.tsx`, update `handleSave`:

```ts
function handleSave() {
  if (!selectedMenu || qty < 1) return;
  onSave({
    id: initial?.id,
    _localId: initial?._localId ?? crypto.randomUUID(),
    menu_id: selectedMenu.id,
    menu_name_snapshot: initial?.menu_name_snapshot ?? selectedMenu.name,
    unit_price_snapshot: initial?.id ? initial.unit_price_snapshot : selectedMenu.price,
    qty,
    notes: notes.trim() === '' ? null : notes,
    sort_order: initial?.sort_order ?? 0,
    confidence: null,
    alternatives: [],
  });
}
```

Rationale: kasir editing item via modal = user-confirmed, no AI confidence applies anymore.

- [ ] **Step 3: Type check**

Run: `npm run build`
Expected: NotaItem-related errors should resolve. (NotaReviewForm type mismatch still expected — Task 10.)

- [ ] **Step 4: Commit**

```bash
git add components/nota-item-row.tsx components/nota-item-modal.tsx
git commit -m "feat(review): extend NotaItem with confidence/alternatives, reset on modal edit"
```

---

## Task 9: Render tier highlight + alternative chips in `NotaItemRow`

**Files:**
- Modify: `components/nota-item-row.tsx`

- [ ] **Step 1: Rewrite `NotaItemRow` with tier styling + chips**

Replace contents of `components/nota-item-row.tsx` with:

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';
import type { MenuOption } from './nota-item-modal';

export type Alternative = {
  menu_name: string;
  confidence: number;
};

export type NotaItem = {
  id?: string;
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
  confidence: number | null;
  alternatives: Alternative[] | null;
  _localId: string;
};

type Tier = 'red' | 'yellow' | null;

function tierOf(confidence: number | null): Tier {
  if (confidence === null) return null;
  if (confidence < 75) return 'red';
  if (confidence < 90) return 'yellow';
  return null;
}

const TIER_CLASS: Record<Exclude<Tier, null>, { row: string; badge: string }> = {
  red: {
    row: 'bg-brick-faint border-l-4 border-brick',
    badge: 'text-brick-dark',
  },
  yellow: {
    row: 'bg-mustard-faint border-l-4 border-mustard',
    badge: 'text-gold-dark',
  },
};

export function NotaItemRow({
  item,
  menusByName,
  onEdit,
  onDelete,
  onSwapMenu,
}: {
  item: NotaItem;
  menusByName: Map<string, MenuOption>;
  onEdit: () => void;
  onDelete: () => void;
  onSwapMenu: (localId: string, newMenu: MenuOption) => void;
}) {
  const tier = tierOf(item.confidence);
  const tierClass = tier ? TIER_CLASS[tier] : null;

  // Filter alternatives: skip if name matches primary or menu not in master (inactive/removed)
  const validAlts = (item.alternatives ?? []).filter(
    (alt) =>
      alt.menu_name !== item.menu_name_snapshot &&
      menusByName.has(alt.menu_name)
  );

  const showAlts = tier !== null && validAlts.length > 0;

  return (
    <li className={['px-5 py-3.5', tierClass?.row ?? ''].join(' ')}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-coal truncate">{item.menu_name_snapshot}</span>
            <span className="text-xs text-clay">× {item.qty}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-clay">
            <span>{formatRp(item.unit_price_snapshot)} ea</span>
            {item.notes && (
              <>
                <span className="text-clay-soft">·</span>
                <span className="italic">{item.notes}</span>
              </>
            )}
          </div>
        </div>

        <div className="text-right">
          <div className="font-display text-base tracking-tight text-coal">
            {formatRp(item.unit_price_snapshot * item.qty)}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${item.menu_name_snapshot}`}>
            ✏️
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Hapus ${item.menu_name_snapshot}`}>
            🗑️
          </Button>
        </div>
      </div>

      {showAlts && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={['font-semibold', tierClass!.badge].join(' ')}>
            ⚠ {item.confidence}%
          </span>
          <span className="text-clay">Mungkin:</span>
          {validAlts.map((alt) => {
            const altMenu = menusByName.get(alt.menu_name)!;
            return (
              <button
                key={alt.menu_name}
                type="button"
                onClick={() => onSwapMenu(item._localId, altMenu)}
                aria-label={`Ganti ke ${altMenu.name}`}
                className="rounded-md border border-clay-soft bg-paper-soft px-2 py-1 text-coal transition-colors hover:border-coal hover:bg-cream"
              >
                {altMenu.name}
              </button>
            );
          })}
        </div>
      )}

      {tier !== null && !showAlts && (
        <div className="mt-2 text-xs">
          <span className={['font-semibold', tierClass!.badge].join(' ')}>
            ⚠ {item.confidence}% — periksa item ini
          </span>
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npm run build`
Expected: still fails on `NotaReviewForm` (Task 10 fixes that), but `nota-item-row.tsx` itself compiles.

- [ ] **Step 3: Commit**

```bash
git add components/nota-item-row.tsx
git commit -m "feat(review): tier-based highlight + alternative chips in NotaItemRow"
```

---

## Task 10: Wire `NotaReviewForm` — swap, smart-total banner, confirm payload

**Files:**
- Modify: `components/nota-review-form.tsx`

- [ ] **Step 1: Replace `nota-review-form.tsx`**

Replace contents of `components/nota-review-form.tsx` with:

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRp } from '@/lib/currency';
import { NotaItemRow, type NotaItem } from './nota-item-row';
import { NotaItemModal, type MenuOption } from './nota-item-modal';
import { renderTicket, uint8ToBase64 } from '@/lib/escpos';
import type { ThousandsHint } from '@/lib/total-parser';

type Transaction = {
  id: string;
  status: 'pending_review' | 'confirmed';
  handwritten_total: number | null;
  customer_name: string | null;
  table_no: string | null;
  created_at: string;
};

type PrinterTarget = 'dapur' | 'minuman';

type ItemForQueue = {
  qty: number;
  menu_name_snapshot: string;
  menu_category: string;
  notes: string | null;
};

function splitItems(items: ItemForQueue[]) {
  const dapur: ItemForQueue[] = [];
  const minuman: ItemForQueue[] = [];
  for (const it of items) {
    if (it.menu_category === 'minuman') minuman.push(it);
    else if (it.menu_category === 'makanan' || it.menu_category === 'nasi') dapur.push(it);
  }
  return { dapur, minuman };
}

async function submitPrintJob(args: {
  tx: { id: string; daily_seq: number | null; created_at: string; customer_name: string | null; table_no: string | null };
  target: PrinterTarget;
  items: ItemForQueue[];
}): Promise<boolean> {
  const bytes = renderTicket({
    target: args.target,
    daily_seq: args.tx.daily_seq ?? 0,
    created_at: new Date(args.tx.created_at),
    customer_name: args.tx.customer_name,
    table_no: args.tx.table_no,
    items: args.items.map((i) => ({
      qty: i.qty,
      name: i.menu_name_snapshot,
      note: i.notes,
    })),
  });
  const bytes_b64 = uint8ToBase64(bytes);
  try {
    const res = await fetch('/api/print/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: 'auto',
        bytes_b64,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function NotaReviewForm({
  transaction,
  initialItems,
  menus,
  scanUrl,
  suggestThousands,
}: {
  transaction: Transaction;
  initialItems: Omit<NotaItem, '_localId'>[];
  menus: MenuOption[];
  scanUrl: string | null;
  suggestThousands: ThousandsHint;
}) {
  const router = useRouter();
  const [items, setItems] = useState<NotaItem[]>(
    initialItems.map((it) => ({ ...it, _localId: crypto.randomUUID() }))
  );
  const [customerName, setCustomerName] = useState<string>(transaction.customer_name ?? '');
  const [tableNo, setTableNo] = useState<string>(transaction.table_no ?? '');
  const [editing, setEditing] = useState<NotaItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [handwrittenTotal, setHandwrittenTotal] = useState<number | null>(transaction.handwritten_total);
  const [thousandsDismissed, setThousandsDismissed] = useState(false);
  const [thousandsApplying, setThousandsApplying] = useState(false);

  const menusByName = useMemo(
    () => new Map(menus.map((m) => [m.name, m])),
    [menus]
  );

  const computedSum = items.reduce(
    (acc, it) => acc + it.unit_price_snapshot * it.qty,
    0
  );
  const mismatch = !!handwrittenTotal && handwrittenTotal !== computedSum;

  const showThousandsBanner =
    suggestThousands.suggest &&
    !thousandsDismissed &&
    handwrittenTotal !== null &&
    handwrittenTotal < 1000;

  function upsertItem(item: NotaItem) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p._localId === item._localId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      const nextSort = prev.length;
      return [...prev, { ...item, sort_order: nextSort }];
    });
    setEditing(null);
    setAdding(false);
  }

  function removeItem(localId: string) {
    setItems((prev) => prev.filter((p) => p._localId !== localId));
    setEditing(null);
  }

  function swapMenu(localId: string, newMenu: MenuOption) {
    setItems((prev) =>
      prev.map((it) =>
        it._localId === localId
          ? {
              ...it,
              menu_id: newMenu.id,
              menu_name_snapshot: newMenu.name,
              unit_price_snapshot: newMenu.price,
              confidence: null,
              alternatives: [],
            }
          : it
      )
    );
    toast.success(`Diganti ke ${newMenu.name}`);
  }

  async function applyThousands() {
    if (!suggestThousands.suggest) return;
    const newTotal = suggestThousands.suggested_total;
    setThousandsApplying(true);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handwritten_total: newTotal }),
      });
      if (!res.ok) {
        throw new Error('patch-failed');
      }
      setHandwrittenTotal(newTotal);
      setThousandsDismissed(true);
      toast.success(`Total disesuaikan ke ${formatRp(newTotal)}`);
    } catch {
      toast.error('Gagal update total. Coba lagi.');
    } finally {
      setThousandsApplying(false);
    }
  }

  async function handleConfirm() {
    setSubmitError(null);
    const payload = {
      status: 'confirmed' as const,
      customer_name: customerName.trim() === '' ? null : customerName.trim(),
      table_no: tableNo.trim() === '' ? null : tableNo.trim(),
      items: items.map((it, idx) => ({
        id: it.id,
        menu_id: it.menu_id,
        qty: it.qty,
        notes: it.notes,
        sort_order: idx,
        confidence: it.confidence,
        alternatives: it.alternatives ?? [],
      })),
    };
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'patch-failed');
      }
      const data = await res.json() as {
        transaction: {
          id: string;
          daily_seq: number | null;
          created_at: string;
          customer_name: string | null;
          table_no: string | null;
        };
        items: Array<{ id: string; menu_id: string; menu_name_snapshot: string; qty: number; notes: string | null }>;
      };

      const itemsForQueue: ItemForQueue[] = data.items.map((it) => {
        const menu = menus.find((m) => m.id === it.menu_id);
        return {
          qty: it.qty,
          menu_name_snapshot: it.menu_name_snapshot,
          menu_category: menu?.category ?? 'makanan',
          notes: it.notes,
        };
      });
      const split = splitItems(itemsForQueue);
      const submitJobs: Promise<{ target: PrinterTarget; ok: boolean }>[] = [];
      if (split.dapur.length > 0) {
        submitJobs.push(
          submitPrintJob({ tx: data.transaction, target: 'dapur', items: split.dapur }).then((ok) => ({ target: 'dapur', ok }))
        );
      }
      if (split.minuman.length > 0) {
        submitJobs.push(
          submitPrintJob({ tx: data.transaction, target: 'minuman', items: split.minuman }).then((ok) => ({ target: 'minuman', ok }))
        );
      }
      const results = await Promise.all(submitJobs);
      const succeeded = results.filter((r) => r.ok).map((r) => r.target);
      const failed = results.filter((r) => !r.ok).map((r) => r.target);

      if (failed.length === 0 && succeeded.length > 0) {
        toast.success(`Nota tersimpan, ${succeeded.length} print job dikirim ke agent`);
      } else if (failed.length > 0) {
        toast.success('Nota tersimpan');
        toast.error(`Gagal kirim print job ke: ${failed.join(', ')}. Coba reprint manual dari halaman detail.`);
      } else {
        toast.success('Nota tersimpan');
      }

      startTransition(() => {
        router.push('/');
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? `Gagal menyimpan: ${err.message}. Coba lagi.`
          : 'Gagal menyimpan. Coba lagi.';
      setSubmitError(message);
      toast.error('Gagal menyimpan nota', {
        description: err instanceof Error ? err.message : 'Coba lagi.',
      });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Review Hasil OCR
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Periksa <span className="italic">nota</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-coal-soft">
          Pastikan item dan jumlah sudah benar. Item kuning/merah perlu lebih teliti. Klik chip alternatif untuk ganti menu cepat.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {scanUrl && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <Card variant="paper" className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={scanUrl}
                alt="Foto nota"
                className="mx-auto w-full object-contain max-h-72 lg:max-h-[calc(100vh-6rem)]"
              />
            </Card>
          </div>
        )}

        <div className="space-y-6">
          <Card variant="paper" className="p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="customer-name">Nama</Label>
                <Input
                  id="customer-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="kosongkan kalau tidak ada"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="table-no">No. Meja</Label>
                <Input
                  id="table-no"
                  value={tableNo}
                  onChange={(e) => setTableNo(e.target.value)}
                  placeholder="kosongkan kalau tidak ada"
                  className="mt-2"
                />
              </div>
            </div>
          </Card>

          {showThousandsBanner && suggestThousands.suggest && (
            <div
              className="rounded-md border border-mustard/40 bg-mustard-faint px-4 py-3 text-sm text-coal"
              role="alert"
            >
              💡 Total tertulis <strong>{formatRp(handwrittenTotal!)}</strong>.
              Mungkin maksudnya <strong>{formatRp(suggestThousands.suggested_total)}</strong>?
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={applyThousands} disabled={thousandsApplying}>
                  {thousandsApplying ? 'Menyimpan…' : `Pakai ${formatRp(suggestThousands.suggested_total)}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setThousandsDismissed(true)}>
                  Tetap {formatRp(handwrittenTotal!)}
                </Button>
              </div>
            </div>
          )}

          {mismatch && (
            <div
              className="rounded-md border border-mustard/40 bg-mustard-faint px-4 py-3 text-sm text-coal"
              role="alert"
            >
              ⚠️ Total tulisan tangan {formatRp(handwrittenTotal!)} berbeda
              dari perhitungan item {formatRp(computedSum)}. Selisih{' '}
              <strong>{formatRp(Math.abs(handwrittenTotal! - computedSum))}</strong>.
              Periksa lagi sebelum menyimpan.
            </div>
          )}

          <Card variant="paper">
            <ul className="divide-y divide-clay-soft/60">
              {items.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-clay">
                  Belum ada item. Klik &quot;Tambah item&quot; di bawah.
                </li>
              )}
              {items.map((it) => (
                <NotaItemRow
                  key={it._localId}
                  item={it}
                  menusByName={menusByName}
                  onEdit={() => setEditing(it)}
                  onDelete={() => removeItem(it._localId)}
                  onSwapMenu={swapMenu}
                />
              ))}
            </ul>

            <div className="border-t border-clay-soft/60 px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm uppercase tracking-wide text-clay">Total sistem</span>
                <span className="font-display text-2xl tracking-tight text-coal">
                  {formatRp(computedSum)}
                </span>
              </div>
            </div>
          </Card>

          <Button variant="secondary" onClick={() => setAdding(true)} className="w-full">
            + Tambah item
          </Button>

          {submitError && (
            <p
              className="rounded-md border border-brick/30 bg-brick-faint px-3 py-2 text-sm text-brick-dark"
              role="alert"
            >
              {submitError}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push('/')}
              disabled={pending}
            >
              Batal
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={pending || items.length === 0}
              className="flex-1"
            >
              {pending ? 'Menyimpan…' : '✓ Simpan & Cetak'}
            </Button>
          </div>
        </div>
      </div>

      {(editing || adding) && (
        <NotaItemModal
          initial={editing ?? undefined}
          menus={menus}
          onSave={upsertItem}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
          onDelete={editing ? () => removeItem(editing._localId) : undefined}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type check (should now pass end-to-end)**

Run: `npm run build`
Expected: PASS — full chain types resolved.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add components/nota-review-form.tsx
git commit -m "feat(review): swap handler, smart-total banner, persist confidence in confirm payload"
```

---

## Task 11: Manual QA + final verification

**Files:** (none — verification only)

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Open: `http://localhost:3000`
Log in (existing test account).

- [ ] **Step 2: Run an OCR scan**

Navigate to `/scan`. Upload a real nota photo with handwritten qty + a short total like "85" or "92".

Expected after redirect to review page:
- Items list renders.
- Items with low AI confidence have yellow or red left border + tinted background.
- Items with `<90 confidence` AND alternatives show "⚠ N%  Mungkin: [chip1] [chip2]" row.
- Items with confidence between 75–89 = yellow border (`mustard-faint`).
- Items with confidence <75 = red border (`brick-faint`).
- If total handwritten was short (e.g., "85" / "92"), smart-total banner appears: "💡 Total tertulis Rp 85. Mungkin maksudnya Rp 85.000? [Pakai…] [Tetap…]".

- [ ] **Step 3: Test swap chip**

Click an alternative chip on a yellow/red item.

Expected:
- Item swaps to alternative menu name + price.
- Highlight (yellow/red border) disappears.
- Total sistem recalculates.
- Toast: "Diganti ke {menu}".

- [ ] **Step 4: Test smart-total "Pakai" button**

Click "Pakai Rp X.000" on the banner.

Expected:
- Banner disappears.
- Toast: "Total disesuaikan ke Rp X.000".
- Mismatch banner either disappears (if X.000 matches computed) or stays (if still mismatch).
- Refresh page — banner stays gone (handwritten_total persisted in DB).

- [ ] **Step 5: Test smart-total "Tetap" button**

Re-scan another nota with short total to get banner back. Click "Tetap Rp X".

Expected:
- Banner disappears (dismiss).
- Mismatch banner (existing) still shows since handwritten_total is unchanged.
- Refresh page — banner re-appears (dismiss is local state only).

- [ ] **Step 6: Test confirm + persistence**

Click "✓ Simpan & Cetak". After redirect, query DB:

```sql
SELECT menu_name_snapshot, confidence, alternatives
FROM transaction_items
WHERE transaction_id = '<id>'
ORDER BY sort_order;
```

Expected: items have non-null confidence + alternatives values (or NULL for any that were edited/swapped).

- [ ] **Step 7: Inspect wide-event logs**

Check server console / Vercel logs for the scan request. Verify event has fields:
- `ocr_conf_min`, `ocr_conf_mean`, `ocr_low_conf_count`, `ocr_low_conf_items`
- `suggest_thousands` (bool)

Check PATCH log when "Pakai" was clicked. Verify `total_changed: true` is present.

- [ ] **Step 8: Edge case — manual add item**

Click "+ Tambah item", pick a menu, save.

Expected: new item appears in list with no highlight (confidence=null).

- [ ] **Step 9: Final full test run**

Run: `npm run test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 10: Commit (only if there are changes; otherwise skip)**

If Step 9 surfaced any small fixes:
```bash
git add <files>
git commit -m "fix(scan): <description>"
```

Otherwise nothing to commit — manual QA only.

---

## Self-Review Notes

**Spec coverage:**
- §4.1 prompt updates → Task 3 ✓
- §4.2 Zod schema → Task 3 ✓
- §4.3 migration → Task 2 ✓
- §5.1 total-parser → Task 1 ✓
- §5.2 scan route persistence + logging + suggest_thousands → Task 5 ✓
- §5.3 PATCH extension → Task 6 ✓
- §6.1 NotaItemRow tier + chips → Tasks 8, 9 ✓
- §6.2 NotaReviewForm swap + banner + payload → Task 10 ✓
- §6.3 review page server load → Task 7 ✓
- §8 edge cases (manual add → null conf, alt filter for inactive menu, swap reset) → covered in Tasks 8-10 + Task 11 QA ✓
- §9 wide-event additions → Task 5 (scan) + Task 6 (PATCH) ✓

**Note on ordering:** Tasks 7, 8, 9 produce an intermediate state where TypeScript build fails until Task 10 completes. The plan calls this out — don't push between Task 7 and Task 10. (If running via subagent-driven dev, the agent dispatching tasks should not block on type errors between these.)
