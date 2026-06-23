# Menu Note Presets Implementation Plan (Plan A of POS feature)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah chip preset per menu (label + mutex_group + price_delta) yang owner kelola dari master menu UI, dan consumer chip picker per-porsi di nota-item-modal supaya kasir tap chip alih-alih ngetik notes. Support real case "qty 2 ayam, 1 dada 1 paha" via auto-merge save logic.

**Architecture:** JSONB inline storage di `menus.note_presets` dan `transaction_items.note_presets_snapshot`. Zero schema lookup penalty (kecuali untuk cross-mutex validation di PATCH). Backward compatible — default `'[]'` array, math identical kalau tidak ada chip. UI: extend MenuForm modal + nota-item-modal dengan reusable sub-components.

**Tech Stack:** Next.js 16 App Router, React 19.2, TypeScript strict, Tailwind v4, shadcn (base-nova) primitives, Zod, Supabase, Vitest.

**Spec reference:** `docs/superpowers/specs/2026-06-21-menu-note-presets-design.md`

---

## File structure

| File | Action | Tasks |
|---|---|---|
| `supabase/migrations/0004_note_presets.sql` | Create | 1 |
| `app/api/menus/_schemas.ts` | Modify (add NotePresetSchema, extend Create/Update) | 2 |
| `app/api/menus/_schemas.test.ts` | Modify (TDD add cases) | 2 |
| `lib/transactions.ts` | Modify (extend types + `mergeItemsByPresets()`) | 3 |
| `lib/transactions.test.ts` | Modify (TDD add cases) | 3 |
| `app/api/transactions/[id]/route.ts` | Modify (PatchSchema + insert) | 4 |
| `app/api/reports/daily/route.ts` | Modify (line_total math) | 5 |
| `app/api/reports/monthly/route.ts` | Modify (line_total math) | 5 |
| `app/(app)/reports/daily/page.tsx` | Modify (line_total math) | 5 |
| `app/(app)/reports/monthly/page.tsx` | Modify (line_total math) | 5 |
| `app/(app)/page.tsx` (Home) | Modify (ringkasan total) | 5 |
| `app/(app)/transactions/page.tsx` | Modify (summary aggregation) | 5 |
| `components/note-preset-editor.tsx` | Create | 6 |
| `components/menu-form.tsx` | Modify (integrate editor) | 7 |
| `components/note-preset-picker.tsx` | Create | 8 |
| `components/nota-item-modal.tsx` | Modify (per-porsi picker + save merge) | 9 |
| `components/nota-item-row.tsx` | Modify (display chips) | 10 |
| `components/nota-review-form.tsx` | Modify (display + pass chip data) | 10 |
| `components/transaction-detail.tsx` | Modify (display chips read-only) | 11 |
| `app/(app)/transactions/page.tsx` (TransactionList summary card) | Verified at Task 5 |
| `docs/superpowers/specs/2026-06-20-pak-pon-design.md` | Modify (mark Q3 partial supersede + convention) | 12 |
| `docs/tasks.md` | Modify (mark Plan A done, link to spec) | 12 |

---

## Task 1: Migration — add JSONB columns

**Files:**
- Create: `supabase/migrations/0004_note_presets.sql`

- [ ] **Step 1: Write migration SQL**

Create `supabase/migrations/0004_note_presets.sql`:

```sql
-- 0004_note_presets.sql
-- Add chip note presets per menu, and snapshot of selected chips per transaction item.

ALTER TABLE menus
  ADD COLUMN note_presets jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT note_presets_is_array CHECK (jsonb_typeof(note_presets) = 'array');

ALTER TABLE transaction_items
  ADD COLUMN note_presets_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT note_presets_snapshot_is_array CHECK (jsonb_typeof(note_presets_snapshot) = 'array');

COMMENT ON COLUMN menus.note_presets IS
  'Array of {id, label, price_delta, mutex_group, sort_order}. See docs spec menu-note-presets.';
COMMENT ON COLUMN transaction_items.note_presets_snapshot IS
  'Array of {id, label, price_delta} snapshotted at tx time. Total line = (unit_price_snapshot + sum price_deltas) * qty.';
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__plugin_supabase_supabase__apply_migration` tool with name `note_presets` and the SQL above. If MCP not available, run via Supabase CLI: `supabase migration up` against the linked project.

Expected: migration applied, no errors.

- [ ] **Step 3: Verify schema**

Use `mcp__plugin_supabase_supabase__list_tables` or run SELECT against `information_schema.columns` to confirm `note_presets` (jsonb, default '[]'::jsonb) and `note_presets_snapshot` (jsonb, default '[]'::jsonb).

- [ ] **Step 4: Verify backward compat**

Run via SQL execution:
```sql
SELECT id, name, note_presets FROM menus LIMIT 5;
SELECT id, qty, note_presets_snapshot FROM transaction_items LIMIT 5;
```

Expected: all rows have `[]` for the new columns (jsonb empty array).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0004_note_presets.sql
git commit -m "feat(db): migration 0004 — note_presets + note_presets_snapshot columns"
```

---

## Task 2: Zod schemas — NotePresetSchema + integrate (TDD)

**Files:**
- Modify: `app/api/menus/_schemas.ts`
- Modify: `app/api/menus/_schemas.test.ts`

- [ ] **Step 1: Add failing tests for NotePresetSchema**

Append to `app/api/menus/_schemas.test.ts`:

```ts
import { NotePresetSchema, CreateMenuSchema, UpdateMenuSchema } from './_schemas';

describe('NotePresetSchema', () => {
  it('accepts a complete preset', () => {
    const result = NotePresetSchema.safeParse({
      id: '01',
      label: 'Dada',
      price_delta: 0,
      mutex_group: 'bagian',
      sort_order: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts preset without mutex_group (null)', () => {
    const result = NotePresetSchema.safeParse({
      id: '02',
      label: 'Extra sambel',
      price_delta: 2000,
      mutex_group: null,
      sort_order: 5,
    });
    expect(result.success).toBe(true);
  });

  it('defaults mutex_group to null and sort_order to 0', () => {
    const result = NotePresetSchema.parse({
      id: '03',
      label: 'Jangan garing',
      price_delta: 0,
    });
    expect(result.mutex_group).toBeNull();
    expect(result.sort_order).toBe(0);
  });

  it('rejects negative price_delta', () => {
    const result = NotePresetSchema.safeParse({
      id: '04',
      label: 'Discount',
      price_delta: -500,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty label', () => {
    const result = NotePresetSchema.safeParse({
      id: '05',
      label: '',
      price_delta: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects label longer than 40 chars', () => {
    const result = NotePresetSchema.safeParse({
      id: '06',
      label: 'a'.repeat(41),
      price_delta: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects mutex_group longer than 20 chars', () => {
    const result = NotePresetSchema.safeParse({
      id: '07',
      label: 'Test',
      price_delta: 0,
      mutex_group: 'a'.repeat(21),
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer price_delta', () => {
    const result = NotePresetSchema.safeParse({
      id: '08',
      label: 'Test',
      price_delta: 1500.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateMenuSchema with note_presets', () => {
  it('accepts menu with note_presets array', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'Ayam Goreng',
      category: 'makanan',
      price: 19000,
      note_presets: [
        { id: '01', label: 'Dada', price_delta: 0, mutex_group: 'bagian' },
        { id: '02', label: 'Paha', price_delta: 0, mutex_group: 'bagian' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note_presets).toHaveLength(2);
    }
  });

  it('defaults note_presets to empty array', () => {
    const result = CreateMenuSchema.parse({
      name: 'Pecel Lele',
      category: 'makanan',
      price: 16000,
    });
    expect(result.note_presets).toEqual([]);
  });

  it('rejects note_presets with more than 20 entries', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'Stress menu',
      category: 'makanan',
      price: 1000,
      note_presets: Array.from({ length: 21 }, (_, i) => ({
        id: String(i),
        label: `chip${i}`,
        price_delta: 0,
      })),
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateMenuSchema with note_presets', () => {
  it('accepts partial update with only note_presets', () => {
    const result = UpdateMenuSchema.safeParse({
      note_presets: [
        { id: '01', label: 'Dada', price_delta: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- app/api/menus/_schemas.test.ts`

Expected: FAIL — `NotePresetSchema` not exported, etc.

- [ ] **Step 3: Update `app/api/menus/_schemas.ts`**

Replace **entire content** with:

```ts
import { z } from 'zod';

export const CategorySchema = z.enum(['makanan', 'nasi', 'minuman']);

export const NotePresetSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(40),
  price_delta: z.number().int().min(0),
  mutex_group: z.string().max(20).nullable().optional().default(null),
  sort_order: z.number().int().min(0).default(0),
});

export const CreateMenuSchema = z.object({
  name: z.string().min(1).max(80),
  category: CategorySchema,
  price: z.number().int().nonnegative(),
  sort_order: z.number().int().default(0),
  note_presets: z.array(NotePresetSchema).max(20).default([]),
});

export const UpdateMenuSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  category: CategorySchema.optional(),
  price: z.number().int().nonnegative().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  note_presets: z.array(NotePresetSchema).max(20).optional(),
}).strict();

export type NotePreset = z.infer<typeof NotePresetSchema>;
export type CreateMenu = z.infer<typeof CreateMenuSchema>;
export type UpdateMenu = z.infer<typeof UpdateMenuSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- app/api/menus/_schemas.test.ts`

Expected: PASS — all tests green (existing + new).

- [ ] **Step 5: Commit**

```bash
git add app/api/menus/_schemas.ts app/api/menus/_schemas.test.ts
git commit -m "feat(api): NotePresetSchema + extend Create/UpdateMenuSchema"
```

---

## Task 3: `lib/transactions.ts` — types extension + `mergeItemsByPresets()` (TDD)

**Files:**
- Modify: `lib/transactions.ts`
- Modify: `lib/transactions.test.ts`

- [ ] **Step 1: Append failing tests to `lib/transactions.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  computeReplaceItems,
  mergeItemsByPresets,
  type PorsiSelection,
} from './transactions';

describe('mergeItemsByPresets', () => {
  it('returns empty for empty input', () => {
    const result = mergeItemsByPresets([]);
    expect(result).toEqual([]);
  });

  it('returns single item for qty=1 single porsi', () => {
    const porsi: PorsiSelection[] = [
      {
        menu_id: 'm1',
        notes: null,
        sort_order: 0,
        note_presets_snapshot: [{ id: 'p1', label: 'Dada', price_delta: 0 }],
      },
    ];
    const result = mergeItemsByPresets(porsi);
    expect(result).toEqual([
      {
        menu_id: 'm1',
        qty: 1,
        notes: null,
        sort_order: 0,
        note_presets_snapshot: [{ id: 'p1', label: 'Dada', price_delta: 0 }],
      },
    ]);
  });

  it('merges identical porsi into single item with qty=N', () => {
    const porsi: PorsiSelection[] = Array.from({ length: 3 }, () => ({
      menu_id: 'm1',
      notes: 'jangan garing',
      sort_order: 0,
      note_presets_snapshot: [{ id: 'p1', label: 'Dada', price_delta: 0 }],
    }));
    const result = mergeItemsByPresets(porsi);
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(3);
    expect(result[0].note_presets_snapshot).toEqual([
      { id: 'p1', label: 'Dada', price_delta: 0 },
    ]);
  });

  it('splits non-identical porsi into multiple items', () => {
    const porsi: PorsiSelection[] = [
      {
        menu_id: 'm1',
        notes: null,
        sort_order: 0,
        note_presets_snapshot: [{ id: 'p1', label: 'Dada', price_delta: 0 }],
      },
      {
        menu_id: 'm1',
        notes: null,
        sort_order: 0,
        note_presets_snapshot: [{ id: 'p2', label: 'Paha', price_delta: 0 }],
      },
    ];
    const result = mergeItemsByPresets(porsi);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.note_presets_snapshot[0].label === 'Dada')?.qty).toBe(1);
    expect(result.find((r) => r.note_presets_snapshot[0].label === 'Paha')?.qty).toBe(1);
  });

  it('merges mixed qty: Dada×2 + Paha×1', () => {
    const dada = (): PorsiSelection => ({
      menu_id: 'm1',
      notes: null,
      sort_order: 0,
      note_presets_snapshot: [{ id: 'p1', label: 'Dada', price_delta: 0 }],
    });
    const paha = (): PorsiSelection => ({
      menu_id: 'm1',
      notes: null,
      sort_order: 0,
      note_presets_snapshot: [{ id: 'p2', label: 'Paha', price_delta: 0 }],
    });
    const result = mergeItemsByPresets([dada(), dada(), paha()]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.note_presets_snapshot[0].label === 'Dada')?.qty).toBe(2);
    expect(result.find((r) => r.note_presets_snapshot[0].label === 'Paha')?.qty).toBe(1);
  });

  it('treats different chip orderings as same group (canonicalize)', () => {
    const porsi: PorsiSelection[] = [
      {
        menu_id: 'm1',
        notes: null,
        sort_order: 0,
        note_presets_snapshot: [
          { id: 'p1', label: 'Dada', price_delta: 0 },
          { id: 'p3', label: 'Extra sambel', price_delta: 2000 },
        ],
      },
      {
        menu_id: 'm1',
        notes: null,
        sort_order: 0,
        note_presets_snapshot: [
          { id: 'p3', label: 'Extra sambel', price_delta: 2000 },
          { id: 'p1', label: 'Dada', price_delta: 0 },
        ],
      },
    ];
    const result = mergeItemsByPresets(porsi);
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(2);
  });

  it('does not merge when notes (free-text) differs', () => {
    const porsi: PorsiSelection[] = [
      {
        menu_id: 'm1',
        notes: 'tidak pakai sambel',
        sort_order: 0,
        note_presets_snapshot: [],
      },
      {
        menu_id: 'm1',
        notes: 'extra pedas',
        sort_order: 0,
        note_presets_snapshot: [],
      },
    ];
    const result = mergeItemsByPresets(porsi);
    expect(result).toHaveLength(2);
  });

  it('handles empty presets (legacy item)', () => {
    const porsi: PorsiSelection[] = [
      { menu_id: 'm1', notes: null, sort_order: 0, note_presets_snapshot: [] },
      { menu_id: 'm1', notes: null, sort_order: 0, note_presets_snapshot: [] },
    ];
    const result = mergeItemsByPresets(porsi);
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(2);
  });
});

describe('computeReplaceItems with note_presets_snapshot', () => {
  it('preserves snapshot when provided in requested', () => {
    const result = computeReplaceItems({
      existing: [],
      requested: [
        {
          menu_id: 'm1',
          qty: 1,
          notes: null,
          sort_order: 0,
          note_presets_snapshot: [
            { id: 'p1', label: 'Dada', price_delta: 0 },
          ],
        },
      ],
      menus: [{ id: 'm1', name: 'Ayam Goreng', price: 19000 }],
    });
    expect(result.rows[0].note_presets_snapshot).toEqual([
      { id: 'p1', label: 'Dada', price_delta: 0 },
    ]);
  });

  it('defaults snapshot to empty array if not provided (legacy)', () => {
    const result = computeReplaceItems({
      existing: [],
      requested: [
        { menu_id: 'm1', qty: 1, notes: null, sort_order: 0 },
      ],
      menus: [{ id: 'm1', name: 'Ayam Goreng', price: 19000 }],
    });
    expect(result.rows[0].note_presets_snapshot).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- lib/transactions.test.ts`

Expected: FAIL — `mergeItemsByPresets` not defined, `PorsiSelection` not exported, etc.

- [ ] **Step 3: Update `lib/transactions.ts`**

Replace **entire content** with:

```ts
export type MenuRef = {
  id: string;
  name: string;
  price: number;
};

export type NotePresetSnapshot = {
  id: string;
  label: string;
  price_delta: number;
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
  note_presets_snapshot?: NotePresetSnapshot[];
};

export type ItemRow = {
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
  note_presets_snapshot: NotePresetSnapshot[];
};

export type PorsiSelection = {
  menu_id: string;
  notes: string | null;
  sort_order: number;
  note_presets_snapshot: NotePresetSnapshot[];
};

export type MergedItemPayload = {
  menu_id: string;
  qty: number;
  notes: string | null;
  sort_order: number;
  note_presets_snapshot: NotePresetSnapshot[];
};

export type ReplaceItemsResult = {
  rows: ItemRow[];
};

/**
 * Canonical key for merging — chip array sorted by id, plus notes + menu_id + sort_order.
 * Different ordering of the same chip set produces the same key.
 */
function porsiKey(p: PorsiSelection): string {
  const sortedPresets = [...p.note_presets_snapshot]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((x) => `${x.id}:${x.label}:${x.price_delta}`)
    .join('|');
  return `${p.menu_id}::${p.notes ?? ''}::${p.sort_order}::${sortedPresets}`;
}

/**
 * Group N porsi (one per unit) into items with auto-merged qty.
 * Porsi with identical chip selection + notes merge into single item with qty=N.
 *
 * Use case: kasir picks Ayam Goreng qty=2 with porsi 1=Dada and porsi 2=Paha →
 * returns 2 items qty=1 each. Porsi 1=Dada, porsi 2=Dada → 1 item qty=2.
 */
export function mergeItemsByPresets(porsi: PorsiSelection[]): MergedItemPayload[] {
  const groups = new Map<string, { sample: PorsiSelection; count: number }>();
  for (const p of porsi) {
    const key = porsiKey(p);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { sample: p, count: 1 });
    }
  }
  return [...groups.values()].map(({ sample, count }) => ({
    menu_id: sample.menu_id,
    qty: count,
    notes: sample.notes,
    sort_order: sample.sort_order,
    note_presets_snapshot: sample.note_presets_snapshot,
  }));
}

/**
 * Compute rows untuk "replace items" PATCH transaksi.
 *
 * Untuk setiap requested item:
 * - Kalau punya `id` yang cocok dengan existing → preserve `unit_price_snapshot` lama
 * - Kalau no `id` atau id tidak cocok → snapshot harga sekarang dari menus
 *
 * `note_presets_snapshot` di-passthrough dari requested (atau default `[]`).
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
      note_presets_snapshot: req.note_presets_snapshot ?? [],
    };
  });

  return { rows };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- lib/transactions.test.ts`

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/transactions.ts lib/transactions.test.ts
git commit -m "feat(transactions): mergeItemsByPresets + snapshot pass-through"
```

---

## Task 4: PATCH `/api/transactions/[id]` — schema + cross-mutex validation + insert

**Files:**
- Modify: `app/api/transactions/[id]/route.ts`

- [ ] **Step 1: Update PatchSchema**

Find the `PatchSchema` (currently around lines 11-26) and replace with:

```ts
const NotePresetSnapshotSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(40),
  price_delta: z.number().int().min(0),
});

const PatchSchema = z.object({
  status: z.enum(['pending_review', 'confirmed']).optional(),
  customer_name: z.string().nullable().optional(),
  table_no: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        menu_id: z.string().uuid(),
        qty: z.number().int().positive(),
        notes: z.string().nullable().default(null),
        sort_order: z.number().int().default(0),
        note_presets_snapshot: z.array(NotePresetSnapshotSchema).max(20).default([]),
      })
    )
    .optional(),
}).strict();
```

- [ ] **Step 2: Add cross-mutex validation helper**

Inside the same file, **before** the PATCH handler, add this validation function:

```ts
type MenuPresetLookup = {
  id: string;
  note_presets: { id: string; mutex_group: string | null }[];
};

/**
 * Validate each item: chip snapshot must not contain >1 chip from the same mutex_group
 * (per current master menu lookup). If a chip id is not found in master, skip its check.
 */
function validateMutexGroups(
  items: Array<{ menu_id: string; note_presets_snapshot: { id: string }[] }>,
  menus: MenuPresetLookup[]
): { valid: true } | { valid: false; reason: string } {
  const byMenuId = new Map(menus.map((m) => [m.id, m]));
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const menu = byMenuId.get(item.menu_id);
    if (!menu) continue; // menu validation handled elsewhere
    const groupsSeen = new Set<string>();
    for (const snap of item.note_presets_snapshot) {
      const masterChip = menu.note_presets.find((c) => c.id === snap.id);
      if (!masterChip || masterChip.mutex_group == null) continue;
      if (groupsSeen.has(masterChip.mutex_group)) {
        return {
          valid: false,
          reason: `Item ${i}: multiple chips in mutex group "${masterChip.mutex_group}"`,
        };
      }
      groupsSeen.add(masterChip.mutex_group);
    }
  }
  return { valid: true };
}
```

- [ ] **Step 3: Wire validation into PATCH handler**

Find the PATCH function where it currently fetches menus and runs `computeReplaceItems`. After parsing `parsed.data.items`, **before** calling `computeReplaceItems`, add:

```ts
if (parsed.data.items && parsed.data.items.length > 0) {
  const menuIds = [...new Set(parsed.data.items.map((it) => it.menu_id))];
  const { data: menuLookup, error: lookupErr } = await supabase
    .from('menus')
    .select('id, note_presets')
    .in('id', menuIds);
  if (lookupErr) {
    tagStatus(evt, 500);
    evt.error(lookupErr);
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  const validation = validateMutexGroups(parsed.data.items, menuLookup ?? []);
  if (!validation.valid) {
    tagStatus(evt, 400);
    evt.merge({ reject_reason: 'mutex_violation', detail: validation.reason });
    return NextResponse.json({ error: 'invalid_body', detail: validation.reason }, { status: 400 });
  }
}
```

- [ ] **Step 4: Propagate `note_presets_snapshot` to insert**

Find where the route inserts new transaction_items rows (after `computeReplaceItems`). Make sure each insert payload includes `note_presets_snapshot`. The shape returned by `computeReplaceItems().rows` already has this field — just confirm the supabase `.insert(rows)` call passes it through. If there's explicit field mapping that strips it, add `note_presets_snapshot: row.note_presets_snapshot`.

- [ ] **Step 5: Run lint + tests**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS. (No unit test for this route — covered by future integration smoke.)

- [ ] **Step 6: Commit**

```bash
git add app/api/transactions/[id]/route.ts
git commit -m "feat(api): PATCH transactions handles note_presets_snapshot + mutex validation"
```

---

## Task 5: Reports math — include chip add-on in line_total

**Files:**
- Modify: `app/api/reports/daily/route.ts`
- Modify: `app/api/reports/monthly/route.ts`
- Modify: `app/(app)/reports/daily/page.tsx`
- Modify: `app/(app)/reports/monthly/page.tsx`
- Modify: `app/(app)/page.tsx`
- Modify: `app/(app)/transactions/page.tsx`

- [ ] **Step 1: Identify the math pattern**

Across these 6 files, the math pattern is:

```ts
const lineTotal = qty * unit_price_snapshot;
```

We need to upgrade to:

```ts
const adds = (note_presets_snapshot ?? []).reduce((s, p) => s + p.price_delta, 0);
const lineTotal = qty * (unit_price_snapshot + adds);
```

- [ ] **Step 2: Update `app/api/reports/daily/route.ts`**

Update the supabase `.select(...)` string to include `note_presets_snapshot`:

```ts
.select('id, transaction_items(qty, unit_price_snapshot, menu_name_snapshot, note_presets_snapshot)')
```

In the loop where `lineTotal` (or equivalent) is computed (find `l.qty * l.unit_price_snapshot`), update to:

```ts
for (const l of lines) {
  const adds = (l.note_presets_snapshot ?? []).reduce(
    (s: number, p: { price_delta: number }) => s + p.price_delta,
    0
  );
  const lineTotal = l.qty * (l.unit_price_snapshot + adds);
  total += lineTotal;
  const prev = byMenu.get(l.menu_name_snapshot) ?? { qty: 0, revenue: 0 };
  byMenu.set(l.menu_name_snapshot, {
    qty: prev.qty + l.qty,
    revenue: prev.revenue + lineTotal,
  });
}
```

(Adapt the `lines` typing to include `note_presets_snapshot: Array<{ price_delta: number }>`.)

- [ ] **Step 3: Update `app/api/reports/monthly/route.ts`**

Same shape — update select to include `note_presets_snapshot`, update the per-line loop.

- [ ] **Step 4: Update `app/(app)/reports/daily/page.tsx`**

Same. Find the supabase select + the per-line loop in the server component.

- [ ] **Step 5: Update `app/(app)/reports/monthly/page.tsx`**

Same.

- [ ] **Step 6: Update `app/(app)/page.tsx` (Home ringkasan)**

Find the supabase select for today's transactions. Add `note_presets_snapshot` to select. Update reduce:

```ts
todayTotal += lines.reduce(
  (acc: number, l: { qty: number; unit_price_snapshot: number; note_presets_snapshot?: Array<{ price_delta: number }> }) => {
    const adds = (l.note_presets_snapshot ?? []).reduce((s, p) => s + p.price_delta, 0);
    return acc + l.qty * (l.unit_price_snapshot + adds);
  },
  0
);
```

- [ ] **Step 7: Update `app/(app)/transactions/page.tsx`**

Find the summary aggregation + paginated list loop. Update both `.select(...)` calls to include `note_presets_snapshot`, and update both reduce paths to include adds.

- [ ] **Step 8: Verify build + tests**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS. Test suite still green (existing tests unaffected — math defaults to old behavior for legacy items with empty snapshot).

- [ ] **Step 9: Commit**

```bash
git add app/api/reports/daily/route.ts \
        app/api/reports/monthly/route.ts \
        'app/(app)/reports/daily/page.tsx' \
        'app/(app)/reports/monthly/page.tsx' \
        'app/(app)/page.tsx' \
        'app/(app)/transactions/page.tsx'
git commit -m "feat(reports): line_total includes note_presets add-on revenue"
```

---

## Task 6: `components/note-preset-editor.tsx` — chip CRUD editor

**Files:**
- Create: `components/note-preset-editor.tsx`

- [ ] **Step 1: Create the component**

Create `components/note-preset-editor.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { NotePreset } from '@/app/api/menus/_schemas';

function nanoid(): string {
  // Short stable id, not cryptographically secure but unique-enough for chip refs
  return Math.random().toString(36).slice(2, 10);
}

export function NotePresetEditor({
  value,
  onChange,
  existingGroups,
}: {
  value: NotePreset[];
  onChange: (next: NotePreset[]) => void;
  existingGroups: string[];
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function updateRow(idx: number, patch: Partial<NotePreset>) {
    const next = value.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    onChange(next);
  }

  function addRow() {
    const maxOrder = value.reduce((m, r) => Math.max(m, r.sort_order), -1);
    onChange([
      ...value,
      {
        id: nanoid(),
        label: '',
        price_delta: 0,
        mutex_group: null,
        sort_order: maxOrder + 1,
      },
    ]);
  }

  function removeRow(id: string) {
    onChange(value.filter((r) => r.id !== id));
    setConfirmDeleteId(null);
  }

  return (
    <div className="space-y-3">
      <Label variant="eyebrow">Catatan & pilihan (opsional)</Label>

      {value.length === 0 && (
        <p className="rounded-md border border-dashed border-clay-soft bg-cream px-3 py-2 text-xs italic text-coal-soft">
          Belum ada chip. Tambahkan kalau menu ini sering punya request seperti
          &quot;dada/paha&quot; atau &quot;tanpa sambel&quot;. Tanpa chip pun OK — kasir
          bisa ketik bebas di catatan.
        </p>
      )}

      {value.length > 0 && (
        <div className="space-y-2">
          {/* Column headers */}
          <div className="grid grid-cols-[100px_1fr_90px_60px] gap-2 px-2 text-[10px] uppercase tracking-[0.16em] text-clay">
            <span>Group</span>
            <span>Label</span>
            <span className="text-right">Harga+</span>
            <span></span>
          </div>

          {value.map((row, idx) => {
            const isConfirming = confirmDeleteId === row.id;
            return (
              <div
                key={row.id}
                className="grid grid-cols-[100px_1fr_90px_60px] items-center gap-2"
              >
                <Input
                  list={`groups-${row.id}`}
                  value={row.mutex_group ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    updateRow(idx, { mutex_group: v === '' ? null : v });
                  }}
                  placeholder="—"
                  className="text-xs"
                  maxLength={20}
                  aria-label="Group mutex"
                />
                <datalist id={`groups-${row.id}`}>
                  {existingGroups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>

                <Input
                  value={row.label}
                  onChange={(e) => updateRow(idx, { label: e.target.value })}
                  placeholder="cth: Dada"
                  maxLength={40}
                  aria-label="Label chip"
                />

                <Input
                  type="number"
                  min={0}
                  step={500}
                  value={row.price_delta}
                  onChange={(e) =>
                    updateRow(idx, { price_delta: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="text-right text-xs"
                  aria-label="Tambah harga"
                />

                {isConfirming ? (
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setConfirmDeleteId(null)}
                      aria-label="Batal hapus"
                    >
                      ×
                    </Button>
                    <Button
                      size="xs"
                      variant="destructive"
                      onClick={() => removeRow(row.id)}
                      aria-label="Konfirmasi hapus chip"
                    >
                      ✓
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setConfirmDeleteId(row.id)}
                    aria-label="Hapus chip"
                  >
                    🗑
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button type="button" size="sm" variant="secondary" onClick={addRow}>
        + Tambah catatan
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run lint && npm run build`

Expected: PASS. Component compiles; not yet consumed.

- [ ] **Step 3: Commit**

```bash
git add components/note-preset-editor.tsx
git commit -m "feat(ui): NotePresetEditor — chip CRUD for master menu"
```

---

## Task 7: Integrate `NotePresetEditor` into `MenuForm`

**Files:**
- Modify: `components/menu-form.tsx`

- [ ] **Step 1: Add state + editor**

Open `components/menu-form.tsx`. Add import:

```ts
import { NotePresetEditor } from '@/components/note-preset-editor';
import type { NotePreset } from '@/app/api/menus/_schemas';
```

Extend `MenuFormValues` type to include `note_presets`:

```ts
export type MenuFormValues = {
  id?: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  sort_order: number;
  is_active?: boolean;
  note_presets?: NotePreset[];
};
```

Add state in component:

```ts
const [notePresets, setNotePresets] = useState<NotePreset[]>(initial?.note_presets ?? []);
```

Update `handleSubmit` to include `note_presets` in payload:

```ts
const payload = {
  name,
  category,
  price,
  sort_order: sortOrder,
  note_presets: notePresets,
};
```

- [ ] **Step 2: Accept `existingGroups` prop**

Add `existingGroups: string[]` to component props:

```ts
export function MenuForm({
  initial,
  onSaved,
  onCancel,
  existingGroups = [],
}: {
  initial?: Partial<MenuFormValues>;
  onSaved: () => void;
  onCancel: () => void;
  existingGroups?: string[];
})
```

- [ ] **Step 3: Render the editor**

In the JSX, after the price + sort_order grid section, add (before the existing `{error && ...}` block):

```tsx
<NotePresetEditor
  value={notePresets}
  onChange={setNotePresets}
  existingGroups={existingGroups}
/>
```

- [ ] **Step 4: Pass `existingGroups` from `menu-list-client.tsx`**

Open `app/(app)/menu/menu-list-client.tsx`. Update the `Menu` type to include `note_presets`:

```ts
type Menu = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  sort_order: number;
  is_active: boolean;
  note_presets: NotePreset[];
};
```

Add import:

```ts
import type { NotePreset } from '@/app/api/menus/_schemas';
```

Compute `existingGroups` from all menus:

```ts
const existingGroups = [
  ...new Set(
    initialMenus
      .flatMap((m) => m.note_presets ?? [])
      .map((p) => p.mutex_group)
      .filter((g): g is string => g != null)
  ),
];
```

Pass to MenuForm in the Dialog:

```tsx
{editing && (
  <MenuForm
    initial={editing}
    existingGroups={existingGroups}
    onSaved={refresh}
    onCancel={() => setEditing(null)}
  />
)}
```

Update the "+ Menu baru" Button onClick to seed `note_presets: []`:

```tsx
<Button onClick={() => setEditing({ category: 'makanan', sort_order: 0, note_presets: [] })}>
  + Menu baru
</Button>
```

(Same for the empty-state CTA button.)

When passing existing menu to `setEditing(m)`, make sure `m` includes `note_presets`. The server-side `app/(app)/menu/page.tsx` should already pass it (since `.select('*')` returns all columns), but verify with a print/log.

- [ ] **Step 5: Verify `app/(app)/menu/page.tsx` includes note_presets**

Open that file. If the supabase select is `.select('*')`, no change needed (default returns all columns). If it's an explicit list, add `note_presets` to the select.

- [ ] **Step 6: Verify build + lint**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/menu-form.tsx 'app/(app)/menu/menu-list-client.tsx' 'app/(app)/menu/page.tsx'
git commit -m "feat(menu): NotePresetEditor wired into MenuForm dialog"
```

---

## Task 8: `components/note-preset-picker.tsx` — per-porsi chip picker

**Files:**
- Create: `components/note-preset-picker.tsx`

- [ ] **Step 1: Create the component**

Create `components/note-preset-picker.tsx`:

```tsx
'use client';

import { formatRp } from '@/lib/currency';
import type { NotePreset } from '@/app/api/menus/_schemas';
import type { NotePresetSnapshot } from '@/lib/transactions';

function formatDelta(n: number): string {
  if (n === 0) return '';
  if (n >= 1000) return `+${(n / 1000).toFixed(0)}rb`;
  return `+${formatRp(n)}`;
}

/**
 * Chip picker untuk satu porsi. Mutex group = radio behavior, no group = toggle.
 *
 * Props:
 *   presets: master chip array dari menu yang dipilih
 *   selected: snapshot dari chip yang ke-pick di porsi ini
 *   onChange: callback dengan snapshot baru
 */
export function NotePresetPicker({
  presets,
  selected,
  onChange,
}: {
  presets: NotePreset[];
  selected: NotePresetSnapshot[];
  onChange: (next: NotePresetSnapshot[]) => void;
}) {
  if (presets.length === 0) return null;

  // Group chips: mutex groups first (ordered by group name), additive at the end
  const grouped = new Map<string | null, NotePreset[]>();
  for (const p of [...presets].sort((a, b) => a.sort_order - b.sort_order)) {
    const key = p.mutex_group;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p);
  }

  function toSnapshot(p: NotePreset): NotePresetSnapshot {
    return { id: p.id, label: p.label, price_delta: p.price_delta };
  }

  function isSelected(id: string): boolean {
    return selected.some((s) => s.id === id);
  }

  function toggle(chip: NotePreset) {
    if (chip.mutex_group != null) {
      // Mutex: clear others in same group, set this
      const next = selected.filter((s) => {
        const master = presets.find((p) => p.id === s.id);
        return !master || master.mutex_group !== chip.mutex_group;
      });
      if (!isSelected(chip.id)) {
        next.push(toSnapshot(chip));
      }
      onChange(next);
    } else {
      // Additive: simple toggle
      if (isSelected(chip.id)) {
        onChange(selected.filter((s) => s.id !== chip.id));
      } else {
        onChange([...selected, toSnapshot(chip)]);
      }
    }
  }

  const mutexEntries = [...grouped.entries()].filter(([k]) => k != null);
  const additive = grouped.get(null) ?? [];

  return (
    <div className="space-y-3">
      {mutexEntries.map(([groupName, chips]) => (
        <div key={groupName}>
          <p className="text-[10px] uppercase tracking-[0.16em] text-clay">
            {groupName} (pilih 1)
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {chips.map((chip) => {
              const active = isSelected(chip.id);
              const delta = formatDelta(chip.price_delta);
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => toggle(chip)}
                  className={[
                    'rounded-full px-3 py-1 text-xs transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-offset-1',
                    active
                      ? 'bg-gold text-night-deep'
                      : 'bg-paper-soft text-coal-soft border border-clay-soft hover:bg-cream',
                  ].join(' ')}
                  aria-pressed={active}
                >
                  {chip.label}
                  {delta && <span className="ml-1 text-[10px] opacity-80">{delta}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {additive.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-clay">Tambahan</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {additive.map((chip) => {
              const active = isSelected(chip.id);
              const delta = formatDelta(chip.price_delta);
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => toggle(chip)}
                  className={[
                    'rounded-full px-3 py-1 text-xs transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-offset-1',
                    active
                      ? 'bg-gold text-night-deep'
                      : 'bg-paper-soft text-coal-soft border border-clay-soft hover:bg-cream',
                  ].join(' ')}
                  aria-pressed={active}
                >
                  {chip.label}
                  {delta && <span className="ml-1 text-[10px] opacity-80">{delta}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/note-preset-picker.tsx
git commit -m "feat(ui): NotePresetPicker — chip selection per-porsi"
```

---

## Task 9: Refactor `components/nota-item-modal.tsx` — per-porsi + total + save merge

**Files:**
- Modify: `components/nota-item-modal.tsx`

- [ ] **Step 1: Update types**

Open the file. Update imports + add NotePresetSnapshot import:

```ts
import { useState, useMemo, useEffect } from 'react';
import { mergeItemsByPresets, type NotePresetSnapshot, type PorsiSelection } from '@/lib/transactions';
import { NotePresetPicker } from '@/components/note-preset-picker';
import type { NotePreset } from '@/app/api/menus/_schemas';
```

Update the `MenuOption` type to include `note_presets`:

```ts
export type MenuOption = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  note_presets: NotePreset[];
};
```

Update the `NotaItem` type (imported from `nota-item-row.tsx`) to include `note_presets_snapshot`. (See Task 10 — for now, assume it gains the field.)

- [ ] **Step 2: Replace component body to support per-porsi**

This is a significant refactor. The component now manages:
- `menuId` (existing)
- `qty` (existing)
- `notes` (existing free-text, applies to whole item / all porsi)
- `porsiSelections: NotePresetSnapshot[][]` — array length = qty, each entry = snapshot for that porsi

Logic outline (replace component body — keep handlers/imports):

```tsx
export function NotaItemModal({
  initial,
  menus,
  onSave,
  onClose,
  onDelete,
}: {
  initial?: NotaItem;
  menus: MenuOption[];
  onSave: (items: Array<{
    menu_id: string;
    qty: number;
    notes: string | null;
    sort_order: number;
    note_presets_snapshot: NotePresetSnapshot[];
  }>) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [menuId, setMenuId] = useState<string>(initial?.menu_id ?? menus[0]?.id ?? '');
  const [qty, setQty] = useState<number>(initial?.qty ?? 1);
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');
  const [porsiSelections, setPorsiSelections] = useState<NotePresetSnapshot[][]>(
    () => {
      const initialSnap = initial?.note_presets_snapshot ?? [];
      const initQty = initial?.qty ?? 1;
      return Array.from({ length: initQty }, () => [...initialSnap]);
    }
  );
  const [search, setSearch] = useState('');

  const selectedMenu = useMemo(() => menus.find((m) => m.id === menuId), [menuId, menus]);
  const filteredMenus = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (q === '') return menus;
    return menus.filter((m) => m.name.toLowerCase().includes(q));
  }, [menus, search]);

  const hasMutex = useMemo(() => {
    if (!selectedMenu) return false;
    return selectedMenu.note_presets.some((p) => p.mutex_group != null);
  }, [selectedMenu]);

  // OCR heuristic: when initial.notes contains a chip label, auto-pick chip in porsi 1
  useEffect(() => {
    if (!initial || !selectedMenu || initial.note_presets_snapshot?.length) return;
    const notesLower = (initial.notes ?? '').toLowerCase();
    if (notesLower === '') return;
    const matched = selectedMenu.note_presets.filter((p) =>
      notesLower.includes(p.label.toLowerCase())
    );
    if (matched.length > 0) {
      setPorsiSelections((prev) => {
        const next = [...prev];
        next[0] = matched.map((p) => ({ id: p.id, label: p.label, price_delta: p.price_delta }));
        return next;
      });
    }
  }, [initial, selectedMenu]);

  // Sync porsiSelections length when qty changes
  useEffect(() => {
    setPorsiSelections((prev) => {
      if (prev.length === qty) return prev;
      if (prev.length < qty) {
        // Extend by duplicating last selection
        const lastTemplate = prev[prev.length - 1] ?? [];
        return [...prev, ...Array.from({ length: qty - prev.length }, () => [...lastTemplate])];
      }
      return prev.slice(0, qty);
    });
  }, [qty]);

  const showPerPorsi = qty > 1 && hasMutex;

  const totalBase = (selectedMenu?.price ?? 0);
  const totalAdds = porsiSelections.reduce(
    (sum, snap) => sum + snap.reduce((s, c) => s + c.price_delta, 0),
    0
  );
  const totalAllPorsi = totalBase * qty + totalAdds;

  function setPorsiSelection(idx: number, next: NotePresetSnapshot[]) {
    setPorsiSelections((prev) => prev.map((p, i) => (i === idx ? next : p)));
  }

  function copyPorsiOneToAll() {
    setPorsiSelections((prev) => {
      const first = prev[0] ?? [];
      return prev.map(() => [...first]);
    });
  }

  function handleSave() {
    if (!selectedMenu) return;
    const porsi: PorsiSelection[] = porsiSelections.map((snap) => ({
      menu_id: selectedMenu.id,
      notes: notes.trim() === '' ? null : notes.trim(),
      sort_order: initial?.sort_order ?? 0,
      note_presets_snapshot: snap,
    }));
    const merged = mergeItemsByPresets(porsi);
    onSave(merged);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Edit item' : 'Tambah item'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Menu search + list */}
          <div>
            <Label htmlFor="menu-search">Cari menu</Label>
            <Input
              id="menu-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="cth: Ayam"
              className="mt-2"
            />
            <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-clay-soft">
              {filteredMenus.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-clay">Tidak ada menu cocok.</p>
              )}
              {filteredMenus.map((m) => {
                const active = m.id === menuId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMenuId(m.id)}
                    className={[
                      'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                      active ? 'bg-gold-faint text-coal' : 'hover:bg-cream',
                    ].join(' ')}
                  >
                    <span>{m.name}</span>
                    <span className="text-clay">{formatRp(m.price)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Qty */}
          <div>
            <Label htmlFor="qty">Jumlah</Label>
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              >
                −
              </Button>
              <Input
                id="qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 text-center font-display"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQty((q) => q + 1)}
              >
                +
              </Button>
              <span className="ml-auto font-display text-lg text-coal">
                {formatRp(totalAllPorsi)}
              </span>
            </div>
          </div>

          {/* Chip picker per-porsi or single */}
          {selectedMenu && selectedMenu.note_presets.length > 0 && (
            <div className="space-y-3 rounded-md bg-cream/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-clay">
                Pilihan untuk {selectedMenu.name}
              </p>
              {showPerPorsi ? (
                <>
                  {porsiSelections.map((snap, idx) => (
                    <div key={idx} className="rounded-md bg-paper-soft p-3">
                      <p className="text-xs italic text-coal-soft mb-2">
                        Porsi {idx + 1} of {qty}
                      </p>
                      <NotePresetPicker
                        presets={selectedMenu.note_presets}
                        selected={snap}
                        onChange={(next) => setPorsiSelection(idx, next)}
                      />
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="ghost" onClick={copyPorsiOneToAll}>
                    ↻ Samakan semua porsi dengan #1
                  </Button>
                </>
              ) : (
                <NotePresetPicker
                  presets={selectedMenu.note_presets}
                  selected={porsiSelections[0] ?? []}
                  onChange={(next) => setPorsiSelection(0, next)}
                />
              )}
            </div>
          )}

          {/* Notes free-text */}
          <div>
            <Label htmlFor="notes">Catatan lain (opsional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="cth: alergi udang, ekstra tisu"
              className="mt-2"
            />
          </div>
        </div>

        <DialogFooter>
          {onDelete && initial?.id && (
            <Button type="button" variant="destructive" onClick={onDelete}>
              🗑️ Hapus
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose} className="ml-auto">
            Batal
          </Button>
          <Button type="button" onClick={handleSave} disabled={!selectedMenu || qty < 1}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Update `onSave` signature**

The `onSave` callback now returns an **array of merged items** instead of a single item. This is a breaking change to the contract with `nota-review-form.tsx` (Task 10). Note this for Task 10.

- [ ] **Step 3: Verify build**

Run: `npm run lint && npm run build`

Expected: FAIL because `onSave` consumer signature mismatched. Acceptable — Task 10 fixes consumer.

- [ ] **Step 4: Commit**

```bash
git add components/nota-item-modal.tsx
git commit -m "feat(modal): per-porsi chip picker + merge save + total live"
```

---

## Task 10: Update `nota-review-form.tsx` + `nota-item-row.tsx` — consumer of new modal contract

**Files:**
- Modify: `components/nota-item-row.tsx`
- Modify: `components/nota-review-form.tsx`

- [ ] **Step 1: Extend `NotaItem` type**

Open `components/nota-item-row.tsx`. Add `NotePresetSnapshot` import:

```ts
import type { NotePresetSnapshot } from '@/lib/transactions';
```

Update the `NotaItem` type (find the `export type NotaItem = ...`):

```ts
export type NotaItem = {
  id: string;
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
  note_presets_snapshot: NotePresetSnapshot[];
};
```

- [ ] **Step 2: Display chips in the row**

Find the JSX where `notes` is displayed under the menu name. Add chip display:

```tsx
{item.note_presets_snapshot.length > 0 && (
  <div className="mt-1 flex flex-wrap gap-1">
    {item.note_presets_snapshot.map((chip) => (
      <span
        key={chip.id}
        className="rounded-full bg-cream px-2 py-0.5 text-[10px] text-coal-soft"
      >
        {chip.label}
        {chip.price_delta > 0 && (
          <span className="ml-1 text-clay">+{(chip.price_delta / 1000).toFixed(0)}rb</span>
        )}
      </span>
    ))}
  </div>
)}
```

Also update the line_total calculation (find the place where `item.qty * item.unit_price_snapshot` is computed for display):

```ts
const adds = item.note_presets_snapshot.reduce((s, p) => s + p.price_delta, 0);
const lineTotal = item.qty * (item.unit_price_snapshot + adds);
```

- [ ] **Step 3: Update `nota-review-form.tsx` to handle merged-save contract**

Open `components/nota-review-form.tsx`. Find the `onSave` handler passed to `NotaItemModal`. Update to receive an array of merged items:

```tsx
<NotaItemModal
  initial={editingItem}
  menus={menus}
  onSave={(mergedItems) => {
    // mergedItems is Array<{menu_id, qty, notes, sort_order, note_presets_snapshot}>
    // Replace editingItem's row with all merged items (could be 1..N items)
    setItems((prev) => {
      // If editing existing item: replace it; if new: append
      if (editingItem?.id) {
        // Replace the single existing item with merged items
        const filtered = prev.filter((it) => it.id !== editingItem.id);
        return [
          ...filtered,
          ...mergedItems.map((m, idx) => ({
            id: idx === 0 ? editingItem.id : `tmp-${crypto.randomUUID()}`,
            menu_id: m.menu_id,
            menu_name_snapshot: menus.find((mn) => mn.id === m.menu_id)?.name ?? '',
            unit_price_snapshot: menus.find((mn) => mn.id === m.menu_id)?.price ?? 0,
            qty: m.qty,
            notes: m.notes,
            sort_order: m.sort_order,
            note_presets_snapshot: m.note_presets_snapshot,
          })),
        ];
      }
      // New item: append all merged
      return [
        ...prev,
        ...mergedItems.map((m) => ({
          id: `tmp-${crypto.randomUUID()}`,
          menu_id: m.menu_id,
          menu_name_snapshot: menus.find((mn) => mn.id === m.menu_id)?.name ?? '',
          unit_price_snapshot: menus.find((mn) => mn.id === m.menu_id)?.price ?? 0,
          qty: m.qty,
          notes: m.notes,
          sort_order: m.sort_order,
          note_presets_snapshot: m.note_presets_snapshot,
        })),
      ];
    });
    closeModal();
  }}
  onClose={closeModal}
  onDelete={editingItem?.id ? () => handleDelete(editingItem.id) : undefined}
/>
```

(Adapt to the existing state shape — variable names like `items`, `editingItem`, `closeModal`, `menus` are illustrative; use whatever existing variables there are.)

- [ ] **Step 4: Update items payload sent to PATCH**

Find where `nota-review-form.tsx` builds the PATCH body (`onConfirm` or similar). Ensure each item includes `note_presets_snapshot`:

```ts
const body = {
  status: 'confirmed',
  customer_name,
  table_no,
  items: items.map((it, idx) => ({
    menu_id: it.menu_id,
    qty: it.qty,
    notes: it.notes,
    sort_order: idx,
    note_presets_snapshot: it.note_presets_snapshot,
  })),
};
```

- [ ] **Step 5: Update server-side GET for review page**

`app/(app)/transactions/[id]/review/page.tsx` server component fetches the transaction with items. Make sure the `.select(...)` includes `note_presets_snapshot`:

```ts
.select(`
  id, customer_name, table_no, scan_image_path, handwritten_total, status,
  transaction_items(
    id, menu_id, menu_name_snapshot, unit_price_snapshot, qty, notes, sort_order,
    note_presets_snapshot
  )
`)
```

Similarly include `note_presets` in the menus select:

```ts
.from('menus')
.select('id, name, category, price, sort_order, is_active, note_presets')
.eq('is_active', true)
```

- [ ] **Step 6: Verify build**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/nota-item-row.tsx components/nota-review-form.tsx 'app/(app)/transactions/[id]/review/page.tsx'
git commit -m "feat(review): handle merged-save + display chips in item rows"
```

---

## Task 11: `components/transaction-detail.tsx` — display chips read-only

**Files:**
- Modify: `components/transaction-detail.tsx`
- Modify: `app/(app)/transactions/[id]/page.tsx`

- [ ] **Step 1: Update server fetch**

Open `app/(app)/transactions/[id]/page.tsx`. Ensure the `.select(...)` for transaction_items includes `note_presets_snapshot`.

- [ ] **Step 2: Update TransactionDetail to display chips**

Open `components/transaction-detail.tsx`. Find the JSX where each item is rendered (under menu name + notes). Add chip display per item:

```tsx
{item.note_presets_snapshot && item.note_presets_snapshot.length > 0 && (
  <div className="mt-1 flex flex-wrap gap-1">
    {item.note_presets_snapshot.map((chip: { id: string; label: string; price_delta: number }) => (
      <span
        key={chip.id}
        className="rounded-full bg-cream px-2 py-0.5 text-[10px] text-coal-soft"
      >
        {chip.label}
        {chip.price_delta > 0 && (
          <span className="ml-1 text-clay">+{(chip.price_delta / 1000).toFixed(0)}rb</span>
        )}
      </span>
    ))}
  </div>
)}
```

Update the line_total math (find where `item.qty * item.unit_price_snapshot` is computed in this file):

```ts
const adds = (item.note_presets_snapshot ?? []).reduce((s, p) => s + p.price_delta, 0);
const lineTotal = item.qty * (item.unit_price_snapshot + adds);
```

- [ ] **Step 3: Verify build**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/transaction-detail.tsx 'app/(app)/transactions/[id]/page.tsx'
git commit -m "feat(detail): display note_presets chips + correct line_total"
```

---

## Task 12: Update main spec + tasks.md + final smoke

**Files:**
- Modify: `docs/superpowers/specs/2026-06-20-pak-pon-design.md`
- Modify: `docs/tasks.md`

- [ ] **Step 1: Update main spec**

Open `docs/superpowers/specs/2026-06-20-pak-pon-design.md`. Find Section 3 (Key decisions) row Q3 (notes / variants). Update the Implikasi column:

```
~~Schema simpel: nullable text~~ **Partial supersede oleh `2026-06-21-menu-note-presets-design.md`** — notes sekarang punya struktur chip preset (mutex_group + price_delta), free-text tetap untuk "catatan lain".
```

In Section 14 "Conventions", add bullet:

```
- **Note presets**: chip preset disimpan inline di `menus.note_presets` JSONB; transaksi capture pakai `transaction_items.note_presets_snapshot` JSONB. Mutex group untuk pilihan eksklusif (Dada/Paha), additive untuk modifier (Extra sambel). Lihat `2026-06-21-menu-note-presets-design.md`.
```

- [ ] **Step 2: Update `docs/tasks.md`**

Open the file. Find the backlog item "POS direct order — Notes per item + Quick-pick chips" under "### 🍽️ POS / Order entry". Update sub-bullets:

```
- [ ] **POS direct order (Plan B)** — input order langsung dari menu picker, tanpa foto nota. Komplemen dari /scan untuk dine-in cepat. (Plan A done — chip presets sudah ready di master menu + nota-item-modal review flow. Plan B pakai sub-component yang sama.)
  - ✅ ~~Notes per item~~ → chip preset di `menus.note_presets` + `transaction_items.note_presets_snapshot`. Lihat `docs/superpowers/specs/2026-06-21-menu-note-presets-design.md`.
  - ✅ ~~Quick-pick chips~~ → `components/note-preset-picker.tsx` reusable.
  - ✅ ~~Harga tetap~~ → chip dengan `price_delta` opsional sudah handle add-on price (Paha atas +3rb). Per-porsi cards support qty>1 multi-pick (1 Dada 1 Paha untuk qty=2).
```

Update the "Plan 4 — Shift Cut-off + shadcn Migration + Polish" section to add a new entry, or add a new completed plan section:

```
## Plan 5 — Menu Note Presets (Plan A of POS feature) ✅ COMPLETE
- [x] Migration 0004 — JSONB columns note_presets + note_presets_snapshot
- [x] Zod schemas (NotePresetSchema + Create/UpdateMenuSchema)
- [x] lib/transactions: mergeItemsByPresets + snapshot pass-through
- [x] PATCH /api/transactions/[id]: schema + cross-mutex validation
- [x] Reports math: line_total include chip add-on
- [x] components/note-preset-editor.tsx (master menu CRUD)
- [x] components/note-preset-picker.tsx (per-porsi consumer)
- [x] nota-item-modal refactor (per-porsi + merge save + OCR heuristic)
- [x] Display chips di nota-item-row + transaction-detail
- [x] Main spec Q3 partial supersede + convention

Spec: `docs/superpowers/specs/2026-06-21-menu-note-presets-design.md`
```

- [ ] **Step 3: Final verification**

Run: `npm run lint && npm run test && npm run build`

Expected: ALL PASS. Tests should be 54 + new (mergeItemsByPresets + NotePresetSchema cases).

Smoke checklist for manual browser test (controller will do):
- `/menu` → Edit menu "Ayam Goreng" → add chip group "bagian" with Dada/Paha/Paha atas (+3rb), add additive chips Extra sambel (+2rb), Jangan garing → save → reopen, chips persist
- `/scan` upload foto nota → /transactions/[id]/review → tap edit item → if menu has chips, picker tampil; pick chips, save
- Test qty=2 mutex pick: tap "+" to qty=2 → per-porsi cards muncul → pick Dada porsi 1, Paha porsi 2 → save → tampil 2 baris di review list (Ayam Goreng × 1 Dada, Ayam Goreng × 1 Paha)
- Confirm transaksi → /transactions/[id] detail tampil chips
- /reports/daily total reflect add-on revenue

- [ ] **Step 4: Commit docs**

```bash
git add docs/superpowers/specs/2026-06-20-pak-pon-design.md docs/tasks.md
git commit -m "docs: mark Q3 partial supersede + Plan 5 menu note presets complete"
```

---

## Self-Review

### Spec coverage

- §4 Data model → Task 1 (migration)
- §5 API → Tasks 2 (Zod), 4 (PATCH + mutex validation), 5 (reports math)
- §6 Master menu UI → Tasks 6 (editor) + 7 (integration)
- §7 nota-item-modal consumer → Tasks 8 (picker) + 9 (modal refactor) + 10 (review-form contract update)
- §8 Component file org → Tasks 6, 8 (new files) + 9, 10 (extension)
- §9 Migration → Task 1
- §10 Testing → Tasks 2 + 3 (Zod + transactions.test) unit tests; smoke at Task 12
- §11 Performance → no special task needed (inline JSONB; no index changes)
- §12 Out of scope → enforced by exclusion (no Plan B, no OCR Gemini learn chip, etc.)
- §13 Update main spec → Task 12

✅ Full coverage.

### Placeholder scan

- No "TBD" / "TODO" / "implement later" found.
- Each step that changes code has a code block.
- Each command has expected output.
- One advisory: Task 4 Step 4 says "If there's explicit field mapping that strips it, add ..." — slight conditional. Justified: implementer must inspect the actual insert call site shape. Not a blocker because the field name is exactly specified.

### Type consistency

- `NotePreset` (Zod inferred, Task 2) used in Tasks 6, 7, 8, 9. Consistent shape.
- `NotePresetSnapshot` (Task 3) used in Tasks 3, 9, 10, 11. Consistent shape `{id, label, price_delta}`.
- `PorsiSelection` (Task 3) used in Tasks 3, 9. Consistent.
- `MergedItemPayload` shape (Task 3) matches expected payload for PATCH (Task 4) and review-form (Task 10).
- `mergeItemsByPresets()` signature consistent: in Task 3 (define), Task 9 (call).

✅ Type names + signatures align across all tasks.
