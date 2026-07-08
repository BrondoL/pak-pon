# POS Direct Order + Per-Menu Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/pos` page for direct order entry (no photo nota) + per-menu chip system (multi-select with optional mutex_group + price_delta), reusing print dispatch pipeline.

**Architecture:**
Separate `menu_chips` table with FK to `menus`, snapshot-style `applied_chips` jsonb on `transaction_items`. New `POST /api/pos` bikin `confirmed` transaksi + items in one shot (skip pending_review). Reuse `NotaItemModal` extended for chip picker, `renderKitchenTicket` + `renderCustomerReceipt` extended for chip labels. Home tile → `/pos` route → hybrid 2-column layout (menu picker grid + cart) → save + auto-print via existing FCM pipeline.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, Zod, React, shadcn/ui, vitest, ESC/POS bytes rendering.

**Spec reference:** `docs/superpowers/specs/2026-07-08-pos-direct-order-with-chips-design.md`

---

## File Structure

**New files:**
- `supabase/migrations/0032_menu_chips_and_applied.sql` — schema migration
- `lib/menu-chips.ts` — chip snapshot + mutex validation helpers
- `lib/menu-chips.test.ts` — unit tests
- `app/api/pos/route.ts` — POST endpoint
- `app/api/pos/_schemas.ts` — Zod schemas for POS
- `app/api/pos/_schemas.test.ts` — schema tests
- `app/(app)/pos/page.tsx` — server component (loads menus)
- `components/pos/pos-client.tsx` — main client component (2-column layout, state)
- `components/pos/pos-menu-picker.tsx` — menu grid + category tabs
- `components/pos/pos-item-config-modal.tsx` — modal buat pick chip + qty + notes saat tap menu

**Modified files:**
- `app/api/menus/_schemas.ts` — extend with `chips` array in create/update schemas
- `app/api/menus/route.ts` — GET return chips per menu; POST accept chips array
- `app/api/menus/[id]/route.ts` — PATCH accept chips array with diff
- `app/api/transactions/[id]/route.ts` — PATCH accept `chip_labels` per item, snapshot server-side
- `lib/transactions.ts` — extend types + `computeReplaceItems` to handle `applied_chips`
- `lib/transactions.test.ts` — add cases
- `lib/escpos.ts` — `RenderItem` shape extended (`applied_chips`), kitchen ticket + customer receipt render chip lines
- `lib/escpos.test.ts` — add cases
- `components/menu-form.tsx` — chip editor inline table (label + price_delta + mutex_group + delete)
- `components/nota-item-modal.tsx` — chip picker sections (mutex groups + multi-select "Pilihan cepat")
- `components/nota-item-row.tsx` — display chip labels
- `components/nota-review-form.tsx` — passthrough `applied_chips` to render + `detectModalContext` chip diff
- `components/home-tiles.tsx` — add "Buat pesanan" tile

---

## Phase 1: Data Model & Backend Foundation

### Task 1: Schema migration + verify

**Files:**
- Create: `supabase/migrations/0032_menu_chips_and_applied.sql`

- [ ] **Step 1: Verify `scan_image_path` nullability**

Run:
```bash
grep -n "scan_image_path" supabase/migrations/*.sql | head -5
```

Expected: locate original CREATE for `transactions` — check if `scan_image_path` has `NOT NULL`. If YES → migration adds `ALTER … DROP NOT NULL`. If NO → skip that ALTER (still write other parts).

- [ ] **Step 2: Write migration SQL**

Create `supabase/migrations/0032_menu_chips_and_applied.sql`:

```sql
-- POS direct order + per-menu chips feature.
-- Spec: docs/superpowers/specs/2026-07-08-pos-direct-order-with-chips-design.md

-- 1. New table: menu_chips
CREATE TABLE menu_chips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id uuid NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  price_delta bigint NOT NULL DEFAULT 0 CHECK (price_delta >= 0),
  mutex_group text CHECK (mutex_group IS NULL OR length(mutex_group) BETWEEN 1 AND 20),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (menu_id, label)
);

CREATE INDEX idx_menu_chips_menu_id_sort
  ON menu_chips(menu_id, sort_order);

-- Reuse existing updated_at trigger function used by menus.
-- If pattern uses moddatetime extension, reuse. Otherwise recreate here.
CREATE TRIGGER menu_chips_set_updated_at
  BEFORE UPDATE ON menu_chips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. New column: transaction_items.applied_chips
ALTER TABLE transaction_items
  ADD COLUMN applied_chips jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. Make scan_image_path nullable (POS transaksi ga ada foto).
-- Ganti ke DROP NOT NULL kalau kolom currently NOT NULL. Skip statement kalau
-- sudah nullable (idempotent via DO block).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions'
      AND column_name = 'scan_image_path'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE transactions ALTER COLUMN scan_image_path DROP NOT NULL;
  END IF;
END $$;
```

**Note:** kalau `set_updated_at()` function-nya beda naming di project (mis. pakai extension `moddatetime`), sesuaikan. Cek existing menu trigger:
```bash
grep -rn "set_updated_at\|moddatetime\|updated_at" supabase/migrations/*.sql | head -10
```

- [ ] **Step 3: Apply migration via Supabase CLI (dev) or MCP**

Prefer local Supabase workflow:
```bash
npx supabase migration up
```

Atau via Supabase MCP `apply_migration` — confirm dengan user before applying to remote.

Expected: migration applies clean, no errors.

- [ ] **Step 4: Verify schema in DB**

Run:
```bash
npx supabase db diff --schema public
```

Expected: `menu_chips` table exists, `transaction_items.applied_chips` column exists.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0032_menu_chips_and_applied.sql
git commit -m "feat(db): add menu_chips + transaction_items.applied_chips"
```

---

### Task 2: `lib/menu-chips.ts` — snapshot & mutex helpers

**Files:**
- Create: `lib/menu-chips.ts`
- Create: `lib/menu-chips.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/menu-chips.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildAppliedChipsSnapshot,
  validateChipMutex,
  type MenuChip,
  type AppliedChip,
} from './menu-chips';

const chips: MenuChip[] = [
  { id: 'c1', menu_id: 'm1', label: 'Dada', price_delta: 0, mutex_group: 'bagian', sort_order: 0 },
  { id: 'c2', menu_id: 'm1', label: 'Paha', price_delta: 0, mutex_group: 'bagian', sort_order: 1 },
  { id: 'c3', menu_id: 'm1', label: 'Paha atas', price_delta: 3000, mutex_group: 'bagian', sort_order: 2 },
  { id: 'c4', menu_id: 'm1', label: 'Extra pedas', price_delta: 2000, mutex_group: null, sort_order: 3 },
  { id: 'c5', menu_id: 'm1', label: 'Goreng garing', price_delta: 0, mutex_group: null, sort_order: 4 },
];

describe('buildAppliedChipsSnapshot', () => {
  it('snapshots chip labels + price_delta only', () => {
    const result = buildAppliedChipsSnapshot(['Dada', 'Goreng garing'], chips);
    expect(result).toEqual([
      { label: 'Dada', price_delta: 0 },
      { label: 'Goreng garing', price_delta: 0 },
    ]);
  });

  it('preserves client label order', () => {
    const result = buildAppliedChipsSnapshot(['Goreng garing', 'Dada'], chips);
    expect(result[0].label).toBe('Goreng garing');
    expect(result[1].label).toBe('Dada');
  });

  it('throws on unknown label', () => {
    expect(() => buildAppliedChipsSnapshot(['NonExistent'], chips))
      .toThrow(/unknown chip.*NonExistent/i);
  });

  it('returns empty for empty labels', () => {
    expect(buildAppliedChipsSnapshot([], chips)).toEqual([]);
  });

  it('picks non-zero price_delta correctly', () => {
    const result = buildAppliedChipsSnapshot(['Paha atas', 'Extra pedas'], chips);
    expect(result).toEqual([
      { label: 'Paha atas', price_delta: 3000 },
      { label: 'Extra pedas', price_delta: 2000 },
    ]);
  });
});

describe('validateChipMutex', () => {
  it('accepts multiple chips from different mutex groups', () => {
    expect(() => validateChipMutex(['Dada', 'Extra pedas'], chips)).not.toThrow();
  });

  it('accepts multiple mutex_group=null chips', () => {
    expect(() => validateChipMutex(['Extra pedas', 'Goreng garing'], chips)).not.toThrow();
  });

  it('rejects 2 chips from same mutex group', () => {
    expect(() => validateChipMutex(['Dada', 'Paha'], chips))
      .toThrow(/mutex.*bagian.*Dada.*Paha/i);
  });

  it('rejects 3 chips from same mutex group', () => {
    expect(() => validateChipMutex(['Dada', 'Paha', 'Paha atas'], chips))
      .toThrow(/mutex.*bagian/i);
  });

  it('accepts single chip from mutex group', () => {
    expect(() => validateChipMutex(['Dada'], chips)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — verify fail**

```bash
npm run test -- lib/menu-chips.test.ts
```

Expected: FAIL (module doesn't exist).

- [ ] **Step 3: Implement `lib/menu-chips.ts`**

```typescript
export type MenuChip = {
  id: string;
  menu_id: string;
  label: string;
  price_delta: number;
  mutex_group: string | null;
  sort_order: number;
};

export type AppliedChip = {
  label: string;
  price_delta: number;
};

export function buildAppliedChipsSnapshot(
  chipLabels: string[],
  availableChips: MenuChip[],
): AppliedChip[] {
  const byLabel = new Map(availableChips.map((c) => [c.label, c]));
  return chipLabels.map((label) => {
    const chip = byLabel.get(label);
    if (!chip) {
      throw new Error(`Unknown chip label: ${label}`);
    }
    return { label: chip.label, price_delta: chip.price_delta };
  });
}

export function validateChipMutex(
  chipLabels: string[],
  availableChips: MenuChip[],
): void {
  const byLabel = new Map(availableChips.map((c) => [c.label, c]));
  const seenGroups = new Map<string, string>();
  for (const label of chipLabels) {
    const chip = byLabel.get(label);
    if (!chip || !chip.mutex_group) continue;
    const prev = seenGroups.get(chip.mutex_group);
    if (prev) {
      throw new Error(
        `Mutex violation in group "${chip.mutex_group}": "${prev}" and "${label}" cannot coexist`,
      );
    }
    seenGroups.set(chip.mutex_group, label);
  }
}

export function sumChipPriceDeltas(chips: AppliedChip[]): number {
  return chips.reduce((sum, c) => sum + c.price_delta, 0);
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npm run test -- lib/menu-chips.test.ts
```

Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/menu-chips.ts lib/menu-chips.test.ts
git commit -m "feat(chips): add menu-chips snapshot + mutex validation helpers"
```

---

### Task 3: Extend `_schemas.ts` for menu chips

**Files:**
- Modify: `app/api/menus/_schemas.ts`
- Modify: `app/api/menus/_schemas.test.ts`

- [ ] **Step 1: Read existing schemas + tests**

Verify current shape of `CreateMenuSchema` and `UpdateMenuSchema`. Add extension w/o breaking existing fields.

- [ ] **Step 2: Write failing tests**

Extend `app/api/menus/_schemas.test.ts` (append or add new describe blocks):

```typescript
import { describe, expect, it } from 'vitest';
import { CreateMenuSchema, UpdateMenuSchema, ChipInputSchema } from './_schemas';

describe('ChipInputSchema', () => {
  it('accepts valid chip', () => {
    const result = ChipInputSchema.safeParse({
      label: 'Dada',
      price_delta: 3000,
      mutex_group: 'bagian',
      sort_order: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null mutex_group', () => {
    const result = ChipInputSchema.safeParse({
      label: 'Extra pedas',
      price_delta: 2000,
      mutex_group: null,
      sort_order: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional id for existing chip', () => {
    const result = ChipInputSchema.safeParse({
      id: '11111111-1111-1111-1111-111111111111',
      label: 'Dada',
      price_delta: 0,
      mutex_group: null,
      sort_order: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative price_delta', () => {
    const result = ChipInputSchema.safeParse({
      label: 'Diskon',
      price_delta: -500,
      mutex_group: null,
      sort_order: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty label', () => {
    const result = ChipInputSchema.safeParse({
      label: '',
      price_delta: 0,
      mutex_group: null,
      sort_order: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects label >40 chars', () => {
    const result = ChipInputSchema.safeParse({
      label: 'x'.repeat(41),
      price_delta: 0,
      mutex_group: null,
      sort_order: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects mutex_group >20 chars', () => {
    const result = ChipInputSchema.safeParse({
      label: 'A',
      price_delta: 0,
      mutex_group: 'x'.repeat(21),
      sort_order: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateMenuSchema with chips', () => {
  it('accepts menu with chips array', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'Ayam Goreng',
      category: 'makanan',
      price: 22000,
      sort_order: 0,
      chips: [
        { label: 'Dada', price_delta: 0, mutex_group: 'bagian', sort_order: 0 },
        { label: 'Paha', price_delta: 0, mutex_group: 'bagian', sort_order: 1 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts menu without chips (defaults to empty array)', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'Ayam Goreng',
      category: 'makanan',
      price: 22000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.chips).toEqual([]);
  });

  it('rejects duplicate chip label (case-insensitive)', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'Ayam Goreng',
      category: 'makanan',
      price: 22000,
      chips: [
        { label: 'Dada', price_delta: 0, mutex_group: null, sort_order: 0 },
        { label: 'dada', price_delta: 0, mutex_group: null, sort_order: 1 },
      ],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests — verify fail**

```bash
npm run test -- app/api/menus/_schemas.test.ts
```

Expected: FAIL (`ChipInputSchema` not exported).

- [ ] **Step 4: Extend `_schemas.ts`**

Update `app/api/menus/_schemas.ts`:

```typescript
import { z } from 'zod';

export const CategorySchema = z.enum(['makanan', 'nasi', 'minuman']);

export const ChipInputSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(40),
  price_delta: z.number().int().min(0),
  mutex_group: z.string().min(1).max(20).nullable(),
  sort_order: z.number().int().min(0),
});

const ChipsArraySchema = z
  .array(ChipInputSchema)
  .max(20)
  .default([])
  .refine(
    (chips) => {
      const labels = chips.map((c) => c.label.toLowerCase());
      return new Set(labels).size === labels.length;
    },
    { message: 'Duplicate chip label (case-insensitive)' },
  );

export const CreateMenuSchema = z.object({
  name: z.string().min(1).max(80),
  category: CategorySchema,
  price: z.number().int().nonnegative(),
  sort_order: z.number().int().default(0),
  chips: ChipsArraySchema,
});

export const UpdateMenuSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  category: CategorySchema.optional(),
  price: z.number().int().nonnegative().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  chips: ChipsArraySchema.optional(),
}).strict();

export type ChipInput = z.infer<typeof ChipInputSchema>;
export type CreateMenu = z.infer<typeof CreateMenuSchema>;
export type UpdateMenu = z.infer<typeof UpdateMenuSchema>;
```

- [ ] **Step 5: Run tests — verify pass**

```bash
npm run test -- app/api/menus/_schemas.test.ts
```

Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/menus/_schemas.ts app/api/menus/_schemas.test.ts
git commit -m "feat(menus): add ChipInputSchema + extend create/update with chips"
```

---

### Task 4: GET/POST `/api/menus` — chips passthrough

**Files:**
- Modify: `app/api/menus/route.ts`

- [ ] **Step 1: Extend GET to include chips**

Replace `route.ts` GET body. Update select to fetch chips too. Since chips is a separate table, use nested select:

```typescript
export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/menus');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const includeInactive = request.nextUrl.searchParams.get('include_inactive') === '1';
    evt.set('include_inactive', includeInactive);

    let query = supabase
      .from('menus')
      .select(`
        id, name, category, price, sort_order, is_active, created_at, updated_at,
        chips:menu_chips(id, label, price_delta, mutex_group, sort_order)
      `)
      .order('category')
      .order('sort_order')
      .order('name');

    if (!includeInactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Sort chips per menu by sort_order (nested select doesn't guarantee order).
    const items = (data ?? []).map((m) => ({
      ...m,
      chips: [...(m.chips ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    }));

    evt.set('items_count', items.length);
    tagStatus(evt, 200);
    return NextResponse.json({ items });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Extend POST to accept chips array**

Replace POST body:

```typescript
export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/menus');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = CreateMenuSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_body', zod_issues: parsed.error.issues });
      return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
    }
    const { chips, ...menuFields } = parsed.data;
    evt.merge({
      menu_name: menuFields.name,
      menu_category: menuFields.category,
      menu_price: menuFields.price,
      chip_count: chips.length,
    });

    const { data: created, error } = await supabase
      .from('menus')
      .insert(menuFields)
      .select()
      .single();
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    evt.set('menu_id', created.id);

    if (chips.length > 0) {
      const chipRows = chips.map((c, idx) => ({
        menu_id: created.id,
        label: c.label,
        price_delta: c.price_delta,
        mutex_group: c.mutex_group,
        sort_order: c.sort_order ?? idx,
      }));
      const { error: chipError } = await supabase.from('menu_chips').insert(chipRows);
      if (chipError) {
        tagStatus(evt, 500);
        evt.error(chipError);
        return NextResponse.json({ error: chipError.message }, { status: 500 });
      }
    }

    tagStatus(evt, 201);
    return NextResponse.json({ menu: { ...created, chips } }, { status: 201 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 3: Run type check + build**

```bash
npm run build
```

Expected: no type errors.

- [ ] **Step 4: Manual sanity check via curl (dev server)**

Start dev server (background):
```bash
npm run dev
```

In another terminal, list menus:
```bash
# Requires auth cookie — do via browser DevTools or verify via the /menu UI page
```

Actually easier: navigate `/menu` in browser (log in first), open network tab → GET /api/menus → verify response includes `chips: []` per menu.

- [ ] **Step 5: Commit**

```bash
git add app/api/menus/route.ts
git commit -m "feat(menus): include chips in GET, accept chips array in POST"
```

---

### Task 5: PATCH `/api/menus/[id]` — chips diff

**Files:**
- Modify: `app/api/menus/[id]/route.ts`

- [ ] **Step 1: Extend PATCH to diff chips**

Replace PATCH body. Strategy: DELETE all + INSERT fresh (simpler than diff, safe since hard-delete OK, snapshot preserves history).

```typescript
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('PATCH /api/menus/[id]', { menu_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = UpdateMenuSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_body', zod_issues: parsed.error.issues });
      return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
    }
    const { chips, ...menuFields } = parsed.data;
    evt.merge({
      patch_fields: Object.keys(menuFields),
      patch_chips_present: chips !== undefined,
      patch_chip_count: chips?.length ?? null,
    });

    if (Object.keys(menuFields).length > 0) {
      const { error } = await supabase
        .from('menus')
        .update(menuFields)
        .eq('id', id)
        .select('id')
        .single();
      if (error) {
        if (error.code === NOT_FOUND_CODE) {
          tagStatus(evt, 404);
          return NextResponse.json({ error: 'not_found' }, { status: 404 });
        }
        tagStatus(evt, 500);
        evt.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    if (chips !== undefined) {
      // DELETE all + INSERT fresh. Snapshot di transaction_items.applied_chips
      // aman karena freeze at save. Simpler than diff, atomic-enough per row.
      const { error: delError } = await supabase
        .from('menu_chips')
        .delete()
        .eq('menu_id', id);
      if (delError) {
        tagStatus(evt, 500);
        evt.error(delError);
        return NextResponse.json({ error: delError.message }, { status: 500 });
      }

      if (chips.length > 0) {
        const chipRows = chips.map((c, idx) => ({
          menu_id: id,
          label: c.label,
          price_delta: c.price_delta,
          mutex_group: c.mutex_group,
          sort_order: c.sort_order ?? idx,
        }));
        const { error: insError } = await supabase.from('menu_chips').insert(chipRows);
        if (insError) {
          tagStatus(evt, 500);
          evt.error(insError);
          return NextResponse.json({ error: insError.message }, { status: 500 });
        }
      }
    }

    // Return final state
    const { data: finalMenu } = await supabase
      .from('menus')
      .select(`
        id, name, category, price, sort_order, is_active, created_at, updated_at,
        chips:menu_chips(id, label, price_delta, mutex_group, sort_order)
      `)
      .eq('id', id)
      .single();

    tagStatus(evt, 200);
    return NextResponse.json({ menu: finalMenu });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: no type errors.

- [ ] **Step 3: Manual test via dev server**

In `/menu` page (browser), edit a menu → check network PATCH request works. Skip actual chip UI test — that's Task 11.

- [ ] **Step 4: Commit**

```bash
git add app/api/menus/[id]/route.ts
git commit -m "feat(menus): PATCH replace-all chips on menu update"
```

---

### Task 6: Extend `lib/transactions.ts` for `applied_chips`

**Files:**
- Modify: `lib/transactions.ts`
- Modify: `lib/transactions.test.ts`

- [ ] **Step 1: Write failing test**

Append to `lib/transactions.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computeReplaceItems } from './transactions';

describe('computeReplaceItems with applied_chips', () => {
  const menus = [{ id: 'm1', name: 'Ayam', price: 22000 }];
  const existing = [{
    id: 'i1',
    menu_id: 'm1',
    unit_price_snapshot: 25000,
    qty: 2,
    notes: null,
    applied_chips: [{ label: 'Dada', price_delta: 3000 }],
    sort_order: 0,
    printed_dapur_at: null,
    printed_minuman_at: null,
  }];

  it('preserves applied_chips for existing item unchanged', () => {
    const result = computeReplaceItems({
      existing,
      requested: [{
        id: 'i1',
        menu_id: 'm1',
        qty: 2,
        notes: null,
        applied_chips: [{ label: 'Dada', price_delta: 3000 }],
        sort_order: 0,
      }],
      menus,
    });
    expect(result.rows[0].applied_chips).toEqual([{ label: 'Dada', price_delta: 3000 }]);
    expect(result.rows[0].unit_price_snapshot).toBe(25000);
  });

  it('uses new applied_chips when requested changes', () => {
    const result = computeReplaceItems({
      existing,
      requested: [{
        id: 'i1',
        menu_id: 'm1',
        qty: 2,
        notes: null,
        applied_chips: [{ label: 'Paha', price_delta: 0 }],
        sort_order: 0,
      }],
      menus,
    });
    expect(result.rows[0].applied_chips).toEqual([{ label: 'Paha', price_delta: 0 }]);
  });

  it('defaults to empty array when no chips passed', () => {
    const result = computeReplaceItems({
      existing: [],
      requested: [{
        menu_id: 'm1',
        qty: 1,
        notes: null,
        sort_order: 0,
      }],
      menus,
    });
    expect(result.rows[0].applied_chips).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — verify fail**

```bash
npm run test -- lib/transactions.test.ts
```

Expected: FAIL (type mismatch or missing field).

- [ ] **Step 3: Extend types + impl**

Update `lib/transactions.ts`:

```typescript
import type { AppliedChip } from './menu-chips';

export type MenuRef = {
  id: string;
  name: string;
  price: number;
};

export type ExistingItem = {
  id: string;
  menu_id: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: AppliedChip[];
  sort_order: number;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};

export type RequestedItem = {
  id?: string;
  menu_id: string;
  qty: number;
  notes: string | null;
  applied_chips?: AppliedChip[];
  sort_order: number;
  confidence?: number | null;
};

export type ItemRow = {
  id?: string;
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: AppliedChip[];
  sort_order: number;
  confidence: number | null;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};

export type ReplaceItemsResult = {
  rows: ItemRow[];
};

export function buildItemInsertRows(
  rows: ItemRow[],
  transactionId: string,
): Array<Record<string, unknown>> {
  return rows.map((r) => {
    const { id: rowId, ...rest } = r;
    const base: Record<string, unknown> = { ...rest, transaction_id: transactionId };
    if (typeof rowId === 'string' && rowId.length > 0) {
      base.id = rowId;
    }
    return base;
  });
}

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
    const applied_chips = req.applied_chips ?? [];

    // Unit price snapshot: base menu price + sum(chip price_delta) for new items.
    // For preserved existing items, keep the frozen unit_price_snapshot UNLESS
    // chip selection changed (mis. kasir toggle chip on existing item).
    const existingChipsKey = matchedExisting
      ? matchedExisting.applied_chips.map((c) => c.label).sort().join('|')
      : '';
    const requestedChipsKey = applied_chips.map((c) => c.label).sort().join('|');
    const chipsChanged = existingChipsKey !== requestedChipsKey;

    const chipDeltaSum = applied_chips.reduce((s, c) => s + c.price_delta, 0);
    const unit_price_snapshot =
      matchedExisting && !chipsChanged
        ? matchedExisting.unit_price_snapshot
        : menu.price + chipDeltaSum;

    return {
      id: matchedExisting?.id,
      menu_id: menu.id,
      menu_name_snapshot: menu.name,
      unit_price_snapshot,
      qty: req.qty,
      notes: req.notes,
      applied_chips,
      sort_order: req.sort_order,
      confidence: req.confidence ?? null,
      printed_dapur_at: matchedExisting?.printed_dapur_at ?? null,
      printed_minuman_at: matchedExisting?.printed_minuman_at ?? null,
    };
  });

  return { rows };
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
npm run test -- lib/transactions.test.ts
```

Expected: ALL PASS (including pre-existing tests still work — `applied_chips` field just defaults to empty).

- [ ] **Step 5: Fix any test that broke due to `ExistingItem` type change**

If pre-existing tests use `ExistingItem` shape without `applied_chips`, add `applied_chips: []` to fixture data.

- [ ] **Step 6: Commit**

```bash
git add lib/transactions.ts lib/transactions.test.ts
git commit -m "feat(tx): extend computeReplaceItems + types for applied_chips"
```

---

## Phase 2: New Endpoint (POST /api/pos)

### Task 7: POST `/api/pos` schemas + endpoint

**Files:**
- Create: `app/api/pos/_schemas.ts`
- Create: `app/api/pos/_schemas.test.ts`
- Create: `app/api/pos/route.ts`

- [ ] **Step 1: Write schema tests**

Create `app/api/pos/_schemas.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { CreatePosTransactionSchema } from './_schemas';

describe('CreatePosTransactionSchema', () => {
  const validPayload = {
    customer_name: null,
    table_no: '5',
    is_takeaway: false,
    items: [{
      menu_id: '11111111-1111-1111-1111-111111111111',
      qty: 2,
      chip_labels: ['Dada'],
      notes: null,
      sort_order: 0,
    }],
  };

  it('accepts valid payload', () => {
    expect(CreatePosTransactionSchema.safeParse(validPayload).success).toBe(true);
  });

  it('accepts empty chip_labels', () => {
    const p = { ...validPayload, items: [{ ...validPayload.items[0], chip_labels: [] }] };
    expect(CreatePosTransactionSchema.safeParse(p).success).toBe(true);
  });

  it('rejects empty items array', () => {
    expect(CreatePosTransactionSchema.safeParse({ ...validPayload, items: [] }).success).toBe(false);
  });

  it('rejects qty < 1', () => {
    const p = { ...validPayload, items: [{ ...validPayload.items[0], qty: 0 }] };
    expect(CreatePosTransactionSchema.safeParse(p).success).toBe(false);
  });

  it('rejects invalid menu_id (not uuid)', () => {
    const p = { ...validPayload, items: [{ ...validPayload.items[0], menu_id: 'not-uuid' }] };
    expect(CreatePosTransactionSchema.safeParse(p).success).toBe(false);
  });
});
```

- [ ] **Step 2: Implement schema**

Create `app/api/pos/_schemas.ts`:

```typescript
import { z } from 'zod';

export const CreatePosTransactionSchema = z.object({
  customer_name: z.string().max(80).nullable().default(null),
  table_no: z.string().max(20).nullable().default(null),
  is_takeaway: z.boolean().default(false),
  items: z.array(
    z.object({
      menu_id: z.string().uuid(),
      qty: z.number().int().positive(),
      chip_labels: z.array(z.string().min(1).max(40)).max(20).default([]),
      notes: z.string().nullable().default(null),
      sort_order: z.number().int().min(0).default(0),
    }),
  ).min(1),
});

export type CreatePosTransaction = z.infer<typeof CreatePosTransactionSchema>;
```

- [ ] **Step 3: Run schema tests — verify pass**

```bash
npm run test -- app/api/pos/_schemas.test.ts
```

Expected: ALL PASS.

- [ ] **Step 4: Implement endpoint**

Create `app/api/pos/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { computeNextDailySeq } from '@/lib/daily-seq';
import { businessDate, businessDayRange } from '@/lib/date';
import {
  buildAppliedChipsSnapshot,
  validateChipMutex,
  sumChipPriceDeltas,
  type MenuChip,
} from '@/lib/menu-chips';
import { CreatePosTransactionSchema } from './_schemas';

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/pos');
  const startedAt = Date.now();
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = CreatePosTransactionSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_body', zod_issues: parsed.error.issues });
      return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
    }
    const payload = parsed.data;

    // Fetch menus + chips for all items.
    const menuIds = Array.from(new Set(payload.items.map((i) => i.menu_id)));
    const { data: menusData, error: menusErr } = await supabase
      .from('menus')
      .select('id, name, price, category, is_active')
      .in('id', menuIds);
    if (menusErr) {
      tagStatus(evt, 500);
      evt.error(menusErr);
      return NextResponse.json({ error: menusErr.message }, { status: 500 });
    }
    const menuById = new Map((menusData ?? []).map((m) => [m.id, m]));
    for (const menuId of menuIds) {
      if (!menuById.has(menuId)) {
        tagStatus(evt, 400);
        evt.set('reject_reason', 'unknown_menu_id');
        return NextResponse.json(
          { error: 'unknown_menu_id', details: `Menu ${menuId} not found` },
          { status: 400 },
        );
      }
    }

    const { data: chipsData, error: chipsErr } = await supabase
      .from('menu_chips')
      .select('id, menu_id, label, price_delta, mutex_group, sort_order')
      .in('menu_id', menuIds);
    if (chipsErr) {
      tagStatus(evt, 500);
      evt.error(chipsErr);
      return NextResponse.json({ error: chipsErr.message }, { status: 500 });
    }
    const chipsByMenu = new Map<string, MenuChip[]>();
    for (const c of chipsData ?? []) {
      const list = chipsByMenu.get(c.menu_id) ?? [];
      list.push(c as MenuChip);
      chipsByMenu.set(c.menu_id, list);
    }

    // Snapshot + validate per item.
    const itemsForInsert: Array<{
      menu_id: string;
      menu_name_snapshot: string;
      unit_price_snapshot: number;
      qty: number;
      notes: string | null;
      applied_chips: Array<{ label: string; price_delta: number }>;
      sort_order: number;
      confidence: number | null;
    }> = [];
    let totalChipCount = 0;
    let hasFreeNotes = false;
    for (const [idx, item] of payload.items.entries()) {
      const menu = menuById.get(item.menu_id)!;
      const availableChips = chipsByMenu.get(item.menu_id) ?? [];
      try {
        validateChipMutex(item.chip_labels, availableChips);
      } catch (err) {
        tagStatus(evt, 400);
        evt.set('reject_reason', 'chip_mutex_violation').set('item_index', idx);
        return NextResponse.json(
          { error: 'chip_mutex_violation', details: err instanceof Error ? err.message : 'mutex' },
          { status: 400 },
        );
      }
      let applied;
      try {
        applied = buildAppliedChipsSnapshot(item.chip_labels, availableChips);
      } catch (err) {
        tagStatus(evt, 400);
        evt.set('reject_reason', 'unknown_chip_label').set('item_index', idx);
        return NextResponse.json(
          { error: 'unknown_chip_label', details: err instanceof Error ? err.message : 'unknown' },
          { status: 400 },
        );
      }
      totalChipCount += applied.length;
      if (item.notes && item.notes.trim().length > 0) hasFreeNotes = true;
      itemsForInsert.push({
        menu_id: menu.id,
        menu_name_snapshot: menu.name,
        unit_price_snapshot: menu.price + sumChipPriceDeltas(applied),
        qty: item.qty,
        notes: item.notes,
        applied_chips: applied,
        sort_order: item.sort_order ?? idx,
        confidence: null,
      });
    }

    // Compute daily_seq — pattern dari PATCH transactions confirm.
    const now = new Date();
    const ymd = businessDate(now);
    const { start, end } = businessDayRange(ymd);
    const { data: sameDayTxs, error: seqErr } = await supabase
      .from('transactions')
      .select('daily_seq')
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .gte('created_at', start)
      .lt('created_at', end);
    if (seqErr) {
      tagStatus(evt, 500);
      evt.error(seqErr);
      return NextResponse.json({ error: seqErr.message }, { status: 500 });
    }
    const dailySeq = computeNextDailySeq((sameDayTxs ?? []).map((r) => r.daily_seq as number | null));

    // Insert transaction.
    const txId = randomUUID();
    const { data: txCreated, error: txErr } = await supabase
      .from('transactions')
      .insert({
        id: txId,
        status: 'confirmed',
        customer_name: payload.customer_name,
        table_no: payload.table_no,
        is_takeaway: payload.is_takeaway,
        confirmed_at: now.toISOString(),
        daily_seq: dailySeq,
        scan_image_path: null,
        handwritten_total: null,
      })
      .select()
      .single();
    if (txErr) {
      tagStatus(evt, 500);
      evt.error(txErr);
      return NextResponse.json({ error: txErr.message }, { status: 500 });
    }

    // Insert items.
    const insertRows = itemsForInsert.map((r) => ({
      ...r,
      transaction_id: txId,
    }));
    const { data: itemsCreated, error: itemsErr } = await supabase
      .from('transaction_items')
      .insert(insertRows, { defaultToNull: false })
      .select('*, menus(category)');
    if (itemsErr) {
      tagStatus(evt, 500);
      evt.error(itemsErr);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    const totalAmount = itemsForInsert.reduce((s, r) => s + r.unit_price_snapshot * r.qty, 0);
    evt.merge({
      tx_id: txId,
      item_count: itemsForInsert.length,
      total_amount: totalAmount,
      chip_count: totalChipCount,
      is_takeaway: payload.is_takeaway,
      has_free_notes: hasFreeNotes,
      daily_seq_assigned: dailySeq,
      elapsed_ms: Date.now() - startedAt,
    });
    tagStatus(evt, 201);
    return NextResponse.json({ transaction: txCreated, items: itemsCreated ?? [] }, { status: 201 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 5: Run build**

```bash
npm run build
```

Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/pos/
git commit -m "feat(pos): POST /api/pos creates confirmed tx with items + chip snapshot"
```

---

### Task 8: Extend PATCH `/api/transactions/[id]` for `chip_labels`

**Files:**
- Modify: `app/api/transactions/[id]/route.ts`

- [ ] **Step 1: Extend PatchSchema**

Add `chip_labels` to per-item schema:

```typescript
const PatchSchema = z.object({
  status: z.enum(['pending_review', 'confirmed']).optional(),
  customer_name: z.string().nullable().optional(),
  table_no: z.string().nullable().optional(),
  handwritten_total: z.number().int().nonnegative().nullable().optional(),
  is_takeaway: z.boolean().optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        menu_id: z.string().uuid(),
        qty: z.number().int().positive(),
        notes: z.string().nullable().default(null),
        chip_labels: z.array(z.string().min(1).max(40)).max(20).default([]),
        sort_order: z.number().int().default(0),
        confidence: z.number().int().min(0).max(100).nullable().optional(),
      })
    )
    .optional(),
}).strict();
```

- [ ] **Step 2: Update `replaceItems` fn — resolve chip_labels to applied_chips snapshot**

Add chip fetching + snapshot inside `replaceItems` before calling `computeReplaceItems`:

```typescript
async function replaceItems(
  supabase: SupabaseLike,
  id: string,
  requestedItems: NonNullable<z.infer<typeof PatchSchema>['items']>,
  evt: RequestEvent
): Promise<StepResult> {
  const { data: existingItems, error: existingError } = await supabase
    .from('transaction_items')
    .select('id, menu_id, unit_price_snapshot, qty, notes, applied_chips, sort_order, printed_dapur_at, printed_minuman_at')
    .eq('transaction_id', id);
  if (existingError) {
    tagStatus(evt, 500);
    evt.error(existingError);
    return { kind: 'error', response: NextResponse.json({ error: existingError.message }, { status: 500 }) };
  }

  const { data: menusData, error: menusError } = await supabase
    .from('menus')
    .select('id, name, price');
  if (menusError || !menusData) {
    tagStatus(evt, 500);
    evt.set('reject_reason', 'menu_fetch_failed').error(menusError);
    return { kind: 'error', response: NextResponse.json({ error: 'menu_fetch_failed' }, { status: 500 }) };
  }

  // Fetch chips only for referenced menus.
  const menuIds = Array.from(new Set(requestedItems.map((r) => r.menu_id)));
  const { data: chipsData, error: chipsError } = await supabase
    .from('menu_chips')
    .select('id, menu_id, label, price_delta, mutex_group, sort_order')
    .in('menu_id', menuIds);
  if (chipsError) {
    tagStatus(evt, 500);
    evt.error(chipsError);
    return { kind: 'error', response: NextResponse.json({ error: chipsError.message }, { status: 500 }) };
  }
  const chipsByMenu = new Map<string, MenuChip[]>();
  for (const c of chipsData ?? []) {
    const list = chipsByMenu.get(c.menu_id) ?? [];
    list.push(c as MenuChip);
    chipsByMenu.set(c.menu_id, list);
  }

  // Snapshot per item.
  let resolvedItems;
  try {
    resolvedItems = requestedItems.map((item) => {
      const available = chipsByMenu.get(item.menu_id) ?? [];
      validateChipMutex(item.chip_labels, available);
      const applied = buildAppliedChipsSnapshot(item.chip_labels, available);
      return {
        ...item,
        applied_chips: applied,
      };
    });
  } catch (err) {
    tagStatus(evt, 400);
    evt.set('reject_reason', 'chip_validation_failed').error(err);
    return {
      kind: 'error',
      response: NextResponse.json(
        { error: 'chip_validation_failed', details: err instanceof Error ? err.message : 'unknown' },
        { status: 400 },
      ),
    };
  }

  let computed;
  try {
    computed = computeReplaceItems({
      existing: (existingItems ?? []) as ExistingItem[],
      requested: resolvedItems,
      menus: menusData as MenuRef[],
    });
  } catch (err) {
    tagStatus(evt, 400);
    evt.set('reject_reason', 'invalid_items').error(err);
    return {
      kind: 'error',
      response: NextResponse.json(
        { error: 'invalid_items', details: err instanceof Error ? err.message : 'unknown' },
        { status: 400 },
      ),
    };
  }

  evt.merge({
    items_existing_count: existingItems?.length ?? 0,
    items_computed_count: computed.rows.length,
  });

  const { error: deleteError } = await supabase
    .from('transaction_items')
    .delete()
    .eq('transaction_id', id);
  if (deleteError) {
    tagStatus(evt, 500);
    evt.error(deleteError);
    return { kind: 'error', response: NextResponse.json({ error: deleteError.message }, { status: 500 }) };
  }

  if (computed.rows.length > 0) {
    const insertRows = buildItemInsertRows(computed.rows, id);
    const { error: insertError } = await supabase
      .from('transaction_items')
      .insert(insertRows, { defaultToNull: false });
    if (insertError) {
      tagStatus(evt, 500);
      evt.error(insertError);
      return { kind: 'error', response: NextResponse.json({ error: insertError.message }, { status: 500 }) };
    }
  }
  return { kind: 'ok' };
}
```

Import at top of file:

```typescript
import {
  buildAppliedChipsSnapshot,
  validateChipMutex,
  type MenuChip,
} from '@/lib/menu-chips';
```

- [ ] **Step 3: Run build + tests**

```bash
npm run build
npm run test -- lib/transactions.test.ts
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/transactions/[id]/route.ts
git commit -m "feat(tx): PATCH transactions accepts chip_labels + snapshots server-side"
```

---

## Phase 3: Print Rendering

### Task 9: Extend `lib/escpos.ts` — `RenderItem` + kitchen ticket

**Files:**
- Modify: `lib/escpos.ts`
- Modify: `lib/escpos.test.ts`

- [ ] **Step 1: Write failing test for kitchen ticket chip rendering**

Append to `lib/escpos.test.ts`:

```typescript
import { renderKitchenTicket, renderCustomerReceipt, type TicketInput } from './escpos';
import { DEFAULT_PRINTER_SETTINGS } from './printer-settings';

describe('renderKitchenTicket with applied_chips', () => {
  const baseInput: TicketInput = {
    daily_seq: 42,
    created_at: new Date('2026-07-08T10:00:00+07:00'),
    customer_name: null,
    table_no: '5',
    is_takeaway: false,
    items: [{
      qty: 2,
      name: 'Ayam Goreng',
      unit_price: 25000,
      note: 'pisah nasinya',
      applied_chips: [
        { label: 'Dada', price_delta: 3000 },
        { label: 'Goreng garing', price_delta: 0 },
      ],
    }],
  };

  it('prints chip labels line before free-text note', () => {
    const bytes = renderKitchenTicket(baseInput, DEFAULT_PRINTER_SETTINGS);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Dada, Goreng garing');
    expect(text).toContain('pisah nasinya');
    // Chip line comes before note line.
    expect(text.indexOf('Dada')).toBeLessThan(text.indexOf('pisah nasinya'));
  });

  it('skips chip line when applied_chips empty', () => {
    const input = { ...baseInput, items: [{ ...baseInput.items[0], applied_chips: [] }] };
    const bytes = renderKitchenTicket(input, DEFAULT_PRINTER_SETTINGS);
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain('Dada');
    expect(text).toContain('pisah nasinya');
  });

  it('skips note line when notes null but chips exist', () => {
    const input = { ...baseInput, items: [{ ...baseInput.items[0], note: null }] };
    const bytes = renderKitchenTicket(input, DEFAULT_PRINTER_SETTINGS);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Dada, Goreng garing');
  });
});
```

- [ ] **Step 2: Run test — verify fail**

```bash
npm run test -- lib/escpos.test.ts
```

Expected: FAIL (`applied_chips` not on `RenderItem` type OR rendering doesn't produce chip line).

- [ ] **Step 3: Extend `RenderItem` type + kitchen ticket render**

In `lib/escpos.ts`, update `RenderItem` type (line ~33 area):

```typescript
export type RenderItem = {
  qty: number;
  name: string;
  unit_price: number;
  note: string | null;
  applied_chips?: Array<{ label: string; price_delta: number }>;
};
```

Update `renderKitchenTicket` items block (~line 181-193 area):

```typescript
// Items in DOUBLE SIZE — qty + name uppercase. Chip labels + notes in normal size below.
let totalQty = 0;
for (const item of input.items) {
  totalQty += item.qty;
  parts.push(DOUBLE_SIZE_ON);
  parts.push(encodeText(`${item.qty}x ${item.name.toUpperCase()}`));
  parts.push(DOUBLE_SIZE_OFF);
  parts.push(lineFeed(1));

  // Chip labels line (semua chip — zero + berbayar).
  if (item.applied_chips && item.applied_chips.length > 0) {
    const chipText = item.applied_chips.map((c) => c.label).join(', ');
    parts.push(BOLD_ON);
    parts.push(encodeText(`  > ${chipText}`));
    parts.push(BOLD_OFF);
    parts.push(lineFeed(1));
  }
  // Free-text notes line.
  if (item.note) {
    parts.push(encodeText(`  > ${item.note}`));
    parts.push(lineFeed(1));
  }
}
```

- [ ] **Step 4: Run tests — pass**

```bash
npm run test -- lib/escpos.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/escpos.ts lib/escpos.test.ts
git commit -m "feat(escpos): kitchen ticket render chip labels + notes lines"
```

---

### Task 10: Customer receipt — paid chips only

**Files:**
- Modify: `lib/escpos.ts`
- Modify: `lib/escpos.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `lib/escpos.test.ts`:

```typescript
describe('renderCustomerReceipt with applied_chips', () => {
  const baseInput: TicketInput = {
    daily_seq: 42,
    created_at: new Date('2026-07-08T10:00:00+07:00'),
    customer_name: null,
    table_no: '5',
    is_takeaway: false,
    items: [{
      qty: 2,
      name: 'Ayam Goreng',
      unit_price: 25000,
      note: 'pisah nasinya',
      applied_chips: [
        { label: 'Dada', price_delta: 3000 },
        { label: 'Goreng garing', price_delta: 0 },
      ],
    }],
  };

  it('shows only chips with price_delta > 0', () => {
    const bytes = renderCustomerReceipt(baseInput, DEFAULT_PRINTER_SETTINGS);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Dada');
    expect(text).not.toContain('Goreng garing');
  });

  it('never shows free-text notes on customer receipt', () => {
    const bytes = renderCustomerReceipt(baseInput, DEFAULT_PRINTER_SETTINGS);
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain('pisah nasinya');
  });

  it('skips chip line if all chips zero-price', () => {
    const input = {
      ...baseInput,
      items: [{
        ...baseInput.items[0],
        applied_chips: [{ label: 'Goreng garing', price_delta: 0 }],
      }],
    };
    const bytes = renderCustomerReceipt(input, DEFAULT_PRINTER_SETTINGS);
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain('Goreng garing');
    expect(text).not.toContain('Dada');
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npm run test -- lib/escpos.test.ts
```

Expected: FAIL (customer receipt doesn't render chips at all).

- [ ] **Step 3: Update `renderCustomerReceipt` items block**

In `lib/escpos.ts`, find the customer receipt items loop (~line 270-282) and update:

```typescript
for (const item of input.items) {
  const lineTotal = item.qty * item.unit_price;
  totalQty += item.qty;
  totalAmount += lineTotal;

  parts.push(encodeText(item.name));
  parts.push(lineFeed(1));

  const left = `${item.qty}x ${formatRupiah(item.unit_price)}`;
  const right = formatRupiah(lineTotal);
  parts.push(encodeText(rightAlignLine(left, right, lineWidth)));
  parts.push(lineFeed(1));

  // Show ONLY paid chips (price_delta > 0). Zero-delta chips + free-text notes
  // are kitchen-only — customer doesn't need dapur instructions.
  const paidChips = (item.applied_chips ?? []).filter((c) => c.price_delta > 0);
  if (paidChips.length > 0) {
    const chipText = paidChips.map((c) => c.label).join(', ');
    parts.push(encodeText(`   ${chipText}`));
    parts.push(lineFeed(1));
  }
}
```

- [ ] **Step 4: Run tests — pass**

```bash
npm run test -- lib/escpos.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/escpos.ts lib/escpos.test.ts
git commit -m "feat(escpos): customer receipt shows paid chips only, skip notes"
```

---

### Task 11: `nota-review-form` — passthrough `applied_chips` to render

**Files:**
- Modify: `components/nota-review-form.tsx`

- [ ] **Step 1: Extend `ItemForQueue` type + `NotaItem` type impact**

Find `ItemForQueue` at `nota-review-form.tsx:39-48`:

```typescript
type ItemForQueue = {
  id: string;
  qty: number;
  menu_name_snapshot: string;
  menu_category: string;
  unit_price_snapshot: number;
  notes: string | null;
  applied_chips: Array<{ label: string; price_delta: number }>;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};
```

- [ ] **Step 2: Update `submitPrintJob` — pass `applied_chips`**

In `submitPrintJob` fn (line ~107), update the render items mapping:

```typescript
items: args.items.map((i) => ({
  qty: i.qty,
  name: i.menu_name_snapshot,
  unit_price: i.unit_price_snapshot,
  note: i.notes,
  applied_chips: i.applied_chips,
})),
```

- [ ] **Step 3: Update items mapping in `submitSave`**

Find where `itemsForQueue` is built (around line 324):

```typescript
const itemsForQueue: ItemForQueue[] = data.items.map((it: any) => {
  const menu = menus.find((m) => m.id === it.menu_id);
  return {
    id: it.id,
    qty: it.qty,
    menu_name_snapshot: it.menu_name_snapshot,
    menu_category: menu?.category ?? 'makanan',
    unit_price_snapshot: it.unit_price_snapshot,
    notes: it.notes,
    applied_chips: it.applied_chips ?? [],
    printed_dapur_at: it.printed_dapur_at,
    printed_minuman_at: it.printed_minuman_at,
  };
});
```

Also update the `data.items` type annotation (around line 310) to include `applied_chips`:

```typescript
items: Array<{
  id: string;
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: Array<{ label: string; price_delta: number }>;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
}>;
```

- [ ] **Step 4: Update `detectModalContext` — detect chip change**

Find `detectModalContext` at line 65. Extend:

```typescript
function detectModalContext(
  initial: Omit<NotaItem, '_localId'>[],
  current: NotaItem[],
  menus: MenuOption[],
): ModalContext {
  const initialById = new Map(initial.map((i) => [i.id, i]));
  const categoryByMenuId = new Map(menus.map((m) => [m.id, m.category]));
  const modified = { dapur: false, minuman: false };
  const newItems = { dapur: 0, minuman: 0 };
  function markTarget(category: string | undefined, kind: 'modified' | 'new') {
    const isKitchen = category === 'makanan' || category === 'nasi';
    const isMinuman = category === 'minuman';
    if (kind === 'modified') {
      if (isKitchen) modified.dapur = true;
      else if (isMinuman) modified.minuman = true;
    } else {
      if (isKitchen) newItems.dapur += 1;
      else if (isMinuman) newItems.minuman += 1;
    }
  }
  function chipsKey(chips: Array<{ label: string }>): string {
    return chips.map((c) => c.label).sort().join('|');
  }
  for (const cur of current) {
    if (!cur.id) {
      markTarget(categoryByMenuId.get(cur.menu_id), 'new');
      continue;
    }
    const orig = initialById.get(cur.id);
    if (!orig) continue;
    const chipsChanged = chipsKey(orig.applied_chips ?? []) !== chipsKey(cur.applied_chips ?? []);
    const changed =
      orig.menu_id !== cur.menu_id ||
      orig.qty !== cur.qty ||
      orig.notes !== cur.notes ||
      chipsChanged;
    if (!changed) continue;
    markTarget(categoryByMenuId.get(cur.menu_id), 'modified');
    if (orig.menu_id !== cur.menu_id) {
      markTarget(categoryByMenuId.get(orig.menu_id), 'modified');
    }
  }
  return { modified, newItems };
}
```

- [ ] **Step 5: Update PATCH payload — include chip_labels per item**

In `submitSave`, find the items mapping in payload (~line 282):

```typescript
items: items.map((it, idx) => ({
  id: it.id,
  menu_id: it.menu_id,
  qty: it.qty,
  notes: it.notes,
  chip_labels: (it.applied_chips ?? []).map((c) => c.label),
  sort_order: idx,
  confidence: it.confidence,
})),
```

- [ ] **Step 6: Run build**

```bash
npm run build
```

Expected: no type errors (may need to adjust NotaItem type — that's next task).

**Note**: kalau ada TS error di NotaItem tidak punya `applied_chips`, akan di-fix di Task 12 selanjutnya. Skip untuk sekarang atau add `applied_chips?: Array<{ label: string; price_delta: number }>` sementara ke NotaItem di `nota-item-row.tsx`.

- [ ] **Step 7: Commit**

```bash
git add components/nota-review-form.tsx
git commit -m "feat(review): passthrough applied_chips + chip diff in modal detect"
```

---

## Phase 4: UI — Menu Master

### Task 12: `NotaItem` type + `nota-item-row` display chips

**Files:**
- Modify: `components/nota-item-row.tsx`

- [ ] **Step 1: Extend `NotaItem` type**

Read current `nota-item-row.tsx`. Add `applied_chips` to `NotaItem`:

```typescript
export type NotaItem = {
  _localId: string;
  id?: string;
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: Array<{ label: string; price_delta: number }>;
  sort_order: number;
  confidence: number | null;
};
```

- [ ] **Step 2: Update row rendering — chip labels line above notes**

Find where notes are rendered in `NotaItemRow` component. Add chip line before it:

```tsx
{item.applied_chips && item.applied_chips.length > 0 && (
  <p className="text-xs text-clay">
    {item.applied_chips.map((c) => c.label).join(', ')}
  </p>
)}
{item.notes && <p className="text-xs text-clay-soft italic">{item.notes}</p>}
```

Exact JSX depends on existing structure — check current markup for notes and insert chip line above.

- [ ] **Step 3: Update all NotaItem consumers to include `applied_chips`**

Grep for consumers:

```bash
grep -rn "NotaItem" components/ app/ | grep -v ".test."
```

Add `applied_chips: []` (or actual value) wherever `NotaItem` objects are constructed. Places likely to touch:
- `components/nota-item-modal.tsx` — `onSave` payload
- `components/nota-review-form.tsx` — initial items map (line ~164), `upsertItem`
- `app/(app)/transactions/[id]/review/page.tsx` — initialItems load (add `applied_chips: it.applied_chips ?? []`)

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add components/nota-item-row.tsx components/nota-item-modal.tsx components/nota-review-form.tsx app/\(app\)/transactions/
git commit -m "feat(review): NotaItem type + row displays chip labels"
```

---

### Task 13: `NotaItemModal` — chip picker sections

**Files:**
- Modify: `components/nota-item-modal.tsx`

- [ ] **Step 1: Extend `MenuOption` type with chips**

```typescript
export type MenuOption = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  chips: Array<{
    id: string;
    label: string;
    price_delta: number;
    mutex_group: string | null;
    sort_order: number;
  }>;
};
```

- [ ] **Step 2: Add state for chip selection + notes**

Inside `NotaItemModal` component, add:

```typescript
const [selectedChipLabels, setSelectedChipLabels] = useState<string[]>(
  initial?.applied_chips?.map((c) => c.label) ?? []
);
```

Recompute effective price:

```typescript
const chipDelta = useMemo(() => {
  if (!selectedMenu) return 0;
  return selectedMenu.chips
    .filter((c) => selectedChipLabels.includes(c.label))
    .reduce((sum, c) => sum + c.price_delta, 0);
}, [selectedMenu, selectedChipLabels]);

const effectiveUnitPrice = (selectedMenu?.price ?? 0) + chipDelta;
```

Reset chip selection when menu changes:

```typescript
useEffect(() => {
  // If user picks different menu, chips from previous menu are invalid.
  if (initial && selectedMenu?.id === initial.menu_id) return;
  setSelectedChipLabels([]);
}, [selectedMenu, initial]);
```

- [ ] **Step 3: Render chip picker sections**

Below the qty input and before notes input, add:

```tsx
{selectedMenu && selectedMenu.chips.length > 0 && (
  <ChipPicker
    chips={selectedMenu.chips}
    selectedLabels={selectedChipLabels}
    onChange={setSelectedChipLabels}
  />
)}
```

Add `ChipPicker` inline component (below `NotaItemModal` in same file):

```tsx
function ChipPicker({
  chips,
  selectedLabels,
  onChange,
}: {
  chips: MenuOption['chips'];
  selectedLabels: string[];
  onChange: (next: string[]) => void;
}) {
  // Group chips by mutex_group. Nulls form one "free" bucket.
  const groups = useMemo(() => {
    const mutex = new Map<string, typeof chips>();
    const free: typeof chips = [];
    for (const c of chips) {
      if (c.mutex_group) {
        const arr = mutex.get(c.mutex_group) ?? [];
        arr.push(c);
        mutex.set(c.mutex_group, arr);
      } else {
        free.push(c);
      }
    }
    // Sort each bucket by sort_order.
    for (const arr of mutex.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    free.sort((a, b) => a.sort_order - b.sort_order);
    // Order mutex sections by min(sort_order) of their chips.
    const mutexSections = Array.from(mutex.entries())
      .map(([name, list]) => ({ name, list, minOrder: list[0]?.sort_order ?? 0 }))
      .sort((a, b) => a.minOrder - b.minOrder);
    return { mutexSections, free };
  }, [chips]);

  function toggleFreeChip(label: string) {
    onChange(
      selectedLabels.includes(label)
        ? selectedLabels.filter((l) => l !== label)
        : [...selectedLabels, label]
    );
  }

  function pickMutexChip(groupChips: typeof chips, label: string) {
    // Remove any other chip from same group, then toggle this one.
    const groupLabels = new Set(groupChips.map((c) => c.label));
    const withoutGroup = selectedLabels.filter((l) => !groupLabels.has(l));
    const isCurrentlySelected = selectedLabels.includes(label);
    onChange(isCurrentlySelected ? withoutGroup : [...withoutGroup, label]);
  }

  function renderChip(label: string, priceDelta: number, isSelected: boolean, onClick: () => void) {
    const displayLabel = priceDelta > 0 ? `${label} +${Math.round(priceDelta / 1000)}k` : label;
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        className={[
          'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
          isSelected
            ? 'border-coal bg-coal text-paper'
            : 'border-clay-soft bg-paper-soft text-coal hover:bg-cream',
        ].join(' ')}
      >
        {displayLabel}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {groups.mutexSections.map((section) => (
        <div key={section.name}>
          <Label className="mb-2 block text-xs uppercase tracking-wide text-clay">
            {section.name} (pilih satu)
          </Label>
          <div className="flex flex-wrap gap-2">
            {section.list.map((c) =>
              renderChip(c.label, c.price_delta, selectedLabels.includes(c.label), () =>
                pickMutexChip(section.list, c.label)
              )
            )}
          </div>
        </div>
      ))}
      {groups.free.length > 0 && (
        <div>
          <Label className="mb-2 block text-xs uppercase tracking-wide text-clay">
            Pilihan cepat
          </Label>
          <div className="flex flex-wrap gap-2">
            {groups.free.map((c) =>
              renderChip(c.label, c.price_delta, selectedLabels.includes(c.label), () =>
                toggleFreeChip(c.label)
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `handleSave` — include applied_chips**

Update `handleSave` to build `applied_chips` snapshot:

```typescript
function handleSave() {
  if (!selectedMenu || qty < 1) return;
  const menuChanged = !initial?.id || initial.menu_id !== selectedMenu.id;
  const applied_chips = selectedMenu.chips
    .filter((c) => selectedChipLabels.includes(c.label))
    .map((c) => ({ label: c.label, price_delta: c.price_delta }));
  // Preserve historical unit_price for unchanged menu + unchanged chips.
  const origChipsKey = (initial?.applied_chips ?? [])
    .map((c) => c.label).sort().join('|');
  const newChipsKey = applied_chips.map((c) => c.label).sort().join('|');
  const chipsChanged = origChipsKey !== newChipsKey;
  const preserveOldPrice = !menuChanged && !chipsChanged && initial?.unit_price_snapshot;
  const chipDelta = applied_chips.reduce((s, c) => s + c.price_delta, 0);
  const unit_price_snapshot = preserveOldPrice
    ? initial.unit_price_snapshot
    : selectedMenu.price + chipDelta;
  onSave({
    id: initial?.id,
    _localId: initial?._localId ?? crypto.randomUUID(),
    menu_id: selectedMenu.id,
    menu_name_snapshot: menuChanged ? selectedMenu.name : initial.menu_name_snapshot,
    unit_price_snapshot,
    qty,
    notes: notes.trim() === '' ? null : notes,
    applied_chips,
    sort_order: initial?.sort_order ?? 0,
    confidence: null,
  });
}
```

- [ ] **Step 5: Update Subtotal display**

Where `selectedMenu.price * qty` displayed, replace with `effectiveUnitPrice * qty`:

```tsx
<span className="ml-auto font-display text-lg text-coal">
  {selectedMenu ? formatRp(effectiveUnitPrice * qty) : '—'}
</span>
```

- [ ] **Step 6: Manual test — dev server**

```bash
npm run dev
```

Setup: buka `/menu` → create menu "Ayam Goreng" (skip chip Ini di Task 14). Skip test chip picker sekarang — will verify combined at Task 15.

- [ ] **Step 7: Commit**

```bash
git add components/nota-item-modal.tsx
git commit -m "feat(review): NotaItemModal chip picker (mutex + multi-select sections)"
```

---

### Task 14: `menu-form.tsx` — chip editor + list badge

**Files:**
- Modify: `components/menu-form.tsx`
- Modify: `components/setup-menu.tsx` or `/menu/page.tsx` (badge)

- [ ] **Step 1: Extend `MenuFormValues` type + chip state**

Add to `menu-form.tsx`:

```typescript
export type ChipDraft = {
  id?: string;              // undefined for new rows
  label: string;
  price_delta: number;
  mutex_group: string;      // empty string = null
  sort_order: number;
};

export type MenuFormValues = {
  id?: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  sort_order: number;
  is_active?: boolean;
  chips: ChipDraft[];
};
```

- [ ] **Step 2: Add chip state in component**

```typescript
const [chips, setChips] = useState<ChipDraft[]>(
  initial?.chips ??
    (initial?.id ? [] : []) // fresh new menu
);
const [chipErrors, setChipErrors] = useState<Map<number, string>>(new Map());

function addChip() {
  setChips((prev) => [...prev, {
    label: '',
    price_delta: 0,
    mutex_group: '',
    sort_order: prev.length,
  }]);
}

function updateChip(idx: number, patch: Partial<ChipDraft>) {
  setChips((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
}

function removeChip(idx: number) {
  setChips((prev) => prev.filter((_, i) => i !== idx).map((c, i) => ({ ...c, sort_order: i })));
}
```

- [ ] **Step 3: Add validation for chips**

```typescript
function validateChips(): boolean {
  const errors = new Map<number, string>();
  const seenLabels = new Set<string>();
  chips.forEach((c, idx) => {
    if (c.label.trim().length === 0) {
      errors.set(idx, 'Isi nama pilihan atau hapus baris');
      return;
    }
    const lower = c.label.trim().toLowerCase();
    if (seenLabels.has(lower)) {
      errors.set(idx, 'Label sudah ada');
      return;
    }
    seenLabels.add(lower);
    if (c.price_delta < 0) {
      errors.set(idx, 'Harga tidak boleh negatif');
    }
  });
  setChipErrors(errors);
  return errors.size === 0;
}
```

- [ ] **Step 4: Render chip editor section**

Add before the submit buttons:

```tsx
<div className="space-y-3 border-t border-clay-soft/60 pt-4">
  <div>
    <Label>Pilihan cepat (chips)</Label>
    <p className="mt-1 text-xs text-clay">
      Muncul di POS saat kasir tap menu ini. Isi harga tambahan (0 = tidak nambah).
      Isi "Grup" untuk pilihan eksklusif (mis. "bagian" → Dada/Paha/Sayap pilih 1).
    </p>
  </div>

  {chips.length === 0 && (
    <p className="text-xs text-clay">Belum ada chip. Klik &quot;+ Tambah pilihan&quot; kalau menu ini punya varian.</p>
  )}

  {chips.map((c, idx) => (
    <div key={idx} className="grid grid-cols-[1fr_100px_120px_auto] gap-2 items-start">
      <div>
        <Input
          value={c.label}
          onChange={(e) => updateChip(idx, { label: e.target.value })}
          placeholder="cth: Dada"
          aria-label={`Label chip ${idx + 1}`}
        />
      </div>
      <Input
        type="number"
        min={0}
        step={500}
        value={c.price_delta}
        onChange={(e) => updateChip(idx, { price_delta: Number(e.target.value) || 0 })}
        aria-label={`Harga chip ${idx + 1}`}
      />
      <Input
        value={c.mutex_group}
        onChange={(e) => updateChip(idx, { mutex_group: e.target.value })}
        placeholder="Grup (opsional)"
        aria-label={`Grup chip ${idx + 1}`}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => removeChip(idx)}
        aria-label={`Hapus chip ${idx + 1}`}
      >
        🗑
      </Button>
      {chipErrors.has(idx) && (
        <p className="col-span-4 text-xs text-brick">{chipErrors.get(idx)}</p>
      )}
    </div>
  ))}

  <Button type="button" variant="secondary" size="sm" onClick={addChip}>
    + Tambah pilihan
  </Button>
</div>
```

- [ ] **Step 5: Update `handleSubmit` to include chips in payload**

```typescript
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setError(null);
  if (!validateChips()) {
    setError('Perbaiki input chip yang bermasalah dulu.');
    return;
  }
  setPending(true);
  try {
    const chipsPayload = chips.map((c, idx) => ({
      id: c.id,
      label: c.label.trim(),
      price_delta: c.price_delta,
      mutex_group: c.mutex_group.trim().length === 0 ? null : c.mutex_group.trim(),
      sort_order: idx,
    }));
    const payload = { name, category, price, sort_order: sortOrder, chips: chipsPayload };
    const res = initial?.id
      ? await fetch(`/api/menus/${initial.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/menus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (data.error === 'invalid_body') throw new Error('Data tidak valid. Periksa nama, harga, kategori, dan chip.');
      if (data.error === 'unauthorized') throw new Error('Sesi habis. Silakan login ulang.');
      throw new Error('Gagal menyimpan. Coba lagi.');
    }
    toast.success(initial?.id ? 'Menu diperbarui' : 'Menu baru ditambah');
    onSaved();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menyimpan. Coba lagi.';
    setError(message);
    toast.error('Gagal menyimpan menu', { description: message });
  } finally {
    setPending(false);
  }
}
```

- [ ] **Step 6: Update menu list page to pass existing chips as initial + show badge**

Find `/menu` page (`app/(app)/menu/page.tsx` or `components/setup-menu.tsx`). Load chips per menu (GET already returns them from Task 4).

When rendering menu list row, add:

```tsx
{menu.chips && menu.chips.length > 0 && (
  <span className="rounded-full bg-cream px-2 py-0.5 text-[10px] text-clay">
    {menu.chips.length} pilihan
  </span>
)}
```

When opening edit dialog, pass initial chips:

```tsx
<MenuForm
  initial={{
    id: menu.id,
    name: menu.name,
    category: menu.category,
    price: menu.price,
    sort_order: menu.sort_order,
    chips: (menu.chips ?? []).map((c: any) => ({
      id: c.id,
      label: c.label,
      price_delta: c.price_delta,
      mutex_group: c.mutex_group ?? '',
      sort_order: c.sort_order,
    })),
  }}
  onSaved={...}
  onCancel={...}
/>
```

- [ ] **Step 7: Manual test — dev server**

```bash
npm run dev
```

Navigate `/menu`:
1. Create a menu "Ayam Goreng" with chips: Dada (0, bagian), Paha (0, bagian), Paha atas (3000, bagian), Extra pedas (2000, ""), Goreng garing (0, "").
2. Verify save works, badge "5 pilihan" muncul.
3. Edit and verify chips preserved.
4. Delete a chip, verify removed on refetch.

- [ ] **Step 8: Commit**

```bash
git add components/menu-form.tsx components/setup-menu.tsx app/\(app\)/menu/
git commit -m "feat(menu): chip editor in menu-form + count badge in list"
```

---

## Phase 5: POS UI

### Task 15: Home tile + `/pos` route skeleton

**Files:**
- Modify: `components/home-tiles.tsx`
- Create: `app/(app)/pos/page.tsx`
- Create: `components/pos/pos-client.tsx`

- [ ] **Step 1: Add "Buat pesanan" tile**

In `components/home-tiles.tsx`, insert new tile after "Scan Nota":

```typescript
{
  href: '/pos',
  title: 'Buat Pesanan',
  subtitle: 'Input langsung tanpa nota',
  accent: 'gold',
  glyph: (
    <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden>
      <path d="M7 7h18l-2 14a2 2 0 01-2 2H11a2 2 0 01-2-2L7 7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 11v-2a4 4 0 018 0v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
},
```

Add `gold` accent to `accentClasses`:

```typescript
gold: { bg: 'bg-gold-faint', text: 'text-gold' },
```

- [ ] **Step 2: Create server component `/pos` page**

Create `app/(app)/pos/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getPrinterSettings } from '@/lib/printer-settings';
import { PosClient } from '@/components/pos/pos-client';

export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const [{ data: menusRaw }, printerSettings] = await Promise.all([
    supabase
      .from('menus')
      .select(`
        id, name, category, price, sort_order, is_active,
        chips:menu_chips(id, label, price_delta, mutex_group, sort_order)
      `)
      .eq('is_active', true)
      .order('category')
      .order('sort_order')
      .order('name'),
    getPrinterSettings(supabase),
  ]);

  const menus = (menusRaw ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    price: m.price,
    sort_order: m.sort_order,
    chips: [...(m.chips ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="font-display text-3xl leading-tight text-coal mb-4">
        Buat <span className="italic">pesanan</span>
      </h1>
      <PosClient menus={menus} printerSettings={printerSettings} />
    </div>
  );
}
```

Note: `getPrinterSettings` API — verify import path matches existing usage (grep review page).

- [ ] **Step 3: Skeleton `pos-client.tsx`**

Create `components/pos/pos-client.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';

export function PosClient({
  menus,
  printerSettings,
}: {
  menus: MenuOption[];
  printerSettings: PrinterSettings;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="min-h-96 rounded-lg border border-clay-soft bg-paper p-4">
        <p className="text-clay text-sm">Menu picker (Task 16)</p>
      </div>
      <div className="min-h-96 rounded-lg border border-clay-soft bg-paper p-4">
        <p className="text-clay text-sm">Cart (Task 17)</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Manual verify — /pos navigates**

```bash
npm run dev
```

Home → tap "Buat Pesanan" → arrive at `/pos` with skeleton visible.

- [ ] **Step 5: Commit**

```bash
git add components/home-tiles.tsx app/\(app\)/pos/ components/pos/
git commit -m "feat(pos): Home tile + /pos route skeleton"
```

---

### Task 16: POS menu picker + item config modal

**Files:**
- Create: `components/pos/pos-menu-picker.tsx`
- Modify: `components/pos/pos-client.tsx`

- [ ] **Step 1: Extract & reuse `NotaItemModal` for POS**

The existing `NotaItemModal` already supports chip picker (Task 13). We reuse it directly for POS by passing `menus` and letting kasir select menu inside modal.

Alternative simpler UX: dedicated `PosItemConfigModal` that opens WITH menu pre-selected (kasir already tapped a menu card). Faster flow.

**Choice (recorded)**: dedicated modal for POS since flow is menu-first.

Create `components/pos/pos-item-config-modal.tsx`:

```tsx
'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';
import type { MenuOption } from '@/components/nota-item-modal';

export type PosCartItemDraft = {
  menu_id: string;
  menu_name_snapshot: string;
  category: MenuOption['category'];
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: Array<{ label: string; price_delta: number }>;
};

export function PosItemConfigModal({
  menu,
  initial,
  onSave,
  onClose,
}: {
  menu: MenuOption;
  initial?: PosCartItemDraft;
  onSave: (item: PosCartItemDraft) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(initial?.qty ?? 1);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [selectedChipLabels, setSelectedChipLabels] = useState<string[]>(
    initial?.applied_chips?.map((c) => c.label) ?? []
  );

  const chipDelta = useMemo(() => {
    return menu.chips
      .filter((c) => selectedChipLabels.includes(c.label))
      .reduce((sum, c) => sum + c.price_delta, 0);
  }, [menu, selectedChipLabels]);

  const effectiveUnitPrice = menu.price + chipDelta;

  // Group chips.
  const groups = useMemo(() => {
    const mutex = new Map<string, typeof menu.chips>();
    const free: typeof menu.chips = [];
    for (const c of menu.chips) {
      if (c.mutex_group) {
        const arr = mutex.get(c.mutex_group) ?? [];
        arr.push(c);
        mutex.set(c.mutex_group, arr);
      } else {
        free.push(c);
      }
    }
    for (const arr of mutex.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    free.sort((a, b) => a.sort_order - b.sort_order);
    const mutexSections = Array.from(mutex.entries())
      .map(([name, list]) => ({ name, list, minOrder: list[0]?.sort_order ?? 0 }))
      .sort((a, b) => a.minOrder - b.minOrder);
    return { mutexSections, free };
  }, [menu]);

  function toggleFreeChip(label: string) {
    setSelectedChipLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  }
  function pickMutexChip(groupChips: typeof menu.chips, label: string) {
    const groupLabels = new Set(groupChips.map((c) => c.label));
    setSelectedChipLabels((prev) => {
      const without = prev.filter((l) => !groupLabels.has(l));
      return prev.includes(label) ? without : [...without, label];
    });
  }
  function renderChip(label: string, priceDelta: number, isSelected: boolean, onClick: () => void) {
    const display = priceDelta > 0 ? `${label} +${Math.round(priceDelta / 1000)}k` : label;
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        className={[
          'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
          isSelected ? 'border-coal bg-coal text-paper' : 'border-clay-soft bg-paper-soft text-coal hover:bg-cream',
        ].join(' ')}
      >
        {display}
      </button>
    );
  }

  function handleSave() {
    if (qty < 1) return;
    const applied_chips = menu.chips
      .filter((c) => selectedChipLabels.includes(c.label))
      .map((c) => ({ label: c.label, price_delta: c.price_delta }));
    onSave({
      menu_id: menu.id,
      menu_name_snapshot: menu.name,
      category: menu.category,
      unit_price_snapshot: effectiveUnitPrice,
      qty,
      notes: notes.trim() === '' ? null : notes.trim(),
      applied_chips,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{menu.name} — {formatRp(menu.price)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="pos-qty">Jumlah</Label>
            <div className="mt-2 flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</Button>
              <Input id="pos-qty" type="number" min={1} value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 text-center font-display" />
              <Button type="button" variant="secondary" size="sm" onClick={() => setQty((q) => q + 1)}>+</Button>
              <span className="ml-auto font-display text-lg text-coal">
                {formatRp(effectiveUnitPrice * qty)}
              </span>
            </div>
          </div>

          {groups.mutexSections.map((section) => (
            <div key={section.name}>
              <Label className="mb-2 block text-xs uppercase tracking-wide text-clay">
                {section.name} (pilih satu)
              </Label>
              <div className="flex flex-wrap gap-2">
                {section.list.map((c) =>
                  renderChip(c.label, c.price_delta, selectedChipLabels.includes(c.label), () => pickMutexChip(section.list, c.label))
                )}
              </div>
            </div>
          ))}
          {groups.free.length > 0 && (
            <div>
              <Label className="mb-2 block text-xs uppercase tracking-wide text-clay">Pilihan cepat</Label>
              <div className="flex flex-wrap gap-2">
                {groups.free.map((c) =>
                  renderChip(c.label, c.price_delta, selectedChipLabels.includes(c.label), () => toggleFreeChip(c.label))
                )}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="pos-notes">Catatan tambahan (opsional)</Label>
            <Input id="pos-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="cth: pisah nasinya, jangan garing" className="mt-2" />
          </div>
        </div>

        <DialogFooter className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="ml-auto">Batal</Button>
          <Button type="button" onClick={handleSave} disabled={qty < 1}>
            {initial ? 'Simpan' : '+ Tambah ke cart'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create menu picker component**

Create `components/pos/pos-menu-picker.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { formatRp } from '@/lib/currency';
import type { MenuOption } from '@/components/nota-item-modal';

const CATEGORY_ORDER: MenuOption['category'][] = ['makanan', 'nasi', 'minuman'];
const CATEGORY_LABEL: Record<MenuOption['category'], string> = {
  makanan: '🍛 Makanan',
  nasi: '🍚 Nasi',
  minuman: '🥤 Minuman',
};

export function PosMenuPicker({
  menus,
  onMenuTap,
}: {
  menus: MenuOption[];
  onMenuTap: (menu: MenuOption) => void;
}) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<MenuOption['category']>('makanan');

  const isSearching = search.trim().length > 0;
  const visibleMenus = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (s) return menus.filter((m) => m.name.toLowerCase().includes(s));
    return menus.filter((m) => m.category === activeCategory);
  }, [menus, activeCategory, search]);

  const categoryCounts = useMemo(() => {
    const counts: Record<MenuOption['category'], number> = { makanan: 0, nasi: 0, minuman: 0 };
    for (const m of menus) counts[m.category]++;
    return counts;
  }, [menus]);

  return (
    <div className="space-y-3">
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari menu…" />

      <div className="grid grid-cols-3 gap-1.5" aria-hidden={isSearching}>
        {CATEGORY_ORDER.map((cat) => {
          const active = !isSearching && cat === activeCategory;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => { setActiveCategory(cat); if (isSearching) setSearch(''); }}
              disabled={isSearching}
              className={[
                'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                active ? 'border-coal bg-coal text-paper' : 'border-clay-soft bg-paper-soft text-coal hover:bg-cream',
                isSearching ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {CATEGORY_LABEL[cat]} <span className="text-[10px] opacity-70">({categoryCounts[cat]})</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visibleMenus.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-clay">
            {isSearching ? `Tidak ada menu cocok dengan "${search.trim()}".` : `Tidak ada menu di ${CATEGORY_LABEL[activeCategory]}.`}
          </p>
        )}
        {visibleMenus.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onMenuTap(m)}
            className="rounded-lg border border-clay-soft bg-paper-soft p-3 text-left transition-colors hover:bg-cream"
          >
            <div className="font-medium text-coal">{m.name}</div>
            <div className="mt-1 text-xs text-clay">{formatRp(m.price)}</div>
            {m.chips.length > 0 && (
              <div className="mt-1 text-[10px] text-mustard">{m.chips.length} pilihan</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire menu picker + config modal into `pos-client.tsx`**

Update `pos-client.tsx` to wire menu picker + modal. Skip cart for now (Task 17):

```tsx
'use client';

import { useState } from 'react';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';
import { PosMenuPicker } from './pos-menu-picker';
import { PosItemConfigModal, type PosCartItemDraft } from './pos-item-config-modal';

export function PosClient({
  menus,
  printerSettings,
}: {
  menus: MenuOption[];
  printerSettings: PrinterSettings;
}) {
  const [pickingMenu, setPickingMenu] = useState<MenuOption | null>(null);
  const [cart, setCart] = useState<Array<PosCartItemDraft & { _localId: string }>>([]);

  function handleAddItem(draft: PosCartItemDraft) {
    setCart((prev) => [...prev, { ...draft, _localId: crypto.randomUUID() }]);
    setPickingMenu(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <PosMenuPicker menus={menus} onMenuTap={setPickingMenu} />

      <div className="min-h-96 rounded-lg border border-clay-soft bg-paper p-4">
        <p className="text-clay text-sm">Cart items ({cart.length}) — full UI in Task 17</p>
        <ul className="mt-2 space-y-1 text-xs text-coal">
          {cart.map((it) => (
            <li key={it._localId}>{it.qty}× {it.menu_name_snapshot} — {it.applied_chips.map((c) => c.label).join(', ')}</li>
          ))}
        </ul>
      </div>

      {pickingMenu && (
        <PosItemConfigModal
          menu={pickingMenu}
          onSave={handleAddItem}
          onClose={() => setPickingMenu(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Manual verify**

```bash
npm run dev
```

Navigate `/pos`. Tap menu card → modal muncul with chips → pick chips → add → cart list grows.

- [ ] **Step 5: Commit**

```bash
git add components/pos/
git commit -m "feat(pos): menu picker + item config modal with chips"
```

---

### Task 17: POS cart + save + print dispatch

**Files:**
- Modify: `components/pos/pos-client.tsx`

- [ ] **Step 1: Build full cart + header form state**

Rewrite `pos-client.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatRp } from '@/lib/currency';
import { renderKitchenTicket, uint8ToBase64 } from '@/lib/escpos';
import { PosMenuPicker } from './pos-menu-picker';
import { PosItemConfigModal, type PosCartItemDraft } from './pos-item-config-modal';

type CartRow = PosCartItemDraft & { _localId: string };

type PrinterTarget = 'dapur' | 'minuman';

function splitByTarget(cart: CartRow[]) {
  const dapur: CartRow[] = [];
  const minuman: CartRow[] = [];
  for (const it of cart) {
    if (it.category === 'minuman') minuman.push(it);
    else dapur.push(it);
  }
  return { dapur, minuman };
}

async function submitPrintJob(args: {
  tx: { id: string; daily_seq: number | null; created_at: string; customer_name: string | null; table_no: string | null; is_takeaway: boolean };
  target: PrinterTarget;
  items: Array<CartRow & { id: string }>;
  printerSettings: PrinterSettings;
}): Promise<{ ok: boolean; offline: boolean }> {
  const bytes = renderKitchenTicket(
    {
      daily_seq: args.tx.daily_seq ?? 0,
      created_at: new Date(args.tx.created_at),
      customer_name: args.tx.customer_name,
      table_no: args.tx.table_no,
      is_takeaway: args.tx.is_takeaway,
      items: args.items.map((i) => ({
        qty: i.qty,
        name: i.menu_name_snapshot,
        unit_price: i.unit_price_snapshot,
        note: i.notes,
        applied_chips: i.applied_chips,
      })),
    },
    args.printerSettings,
  );
  const bytes_b64 = uint8ToBase64(bytes);
  try {
    const res = await fetch('/api/print/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: 'auto',
        item_ids: args.items.map((i) => i.id),
        bytes_b64,
      }),
    });
    if (res.ok) return { ok: true, offline: false };
    return { ok: false, offline: res.status === 503 };
  } catch {
    return { ok: false, offline: false };
  }
}

export function PosClient({
  menus,
  printerSettings,
}: {
  menus: MenuOption[];
  printerSettings: PrinterSettings;
}) {
  const router = useRouter();
  const [pickingMenu, setPickingMenu] = useState<MenuOption | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [cart, setCart] = useState<CartRow[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [tableNo, setTableNo] = useState('');
  const [isTakeaway, setIsTakeaway] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const totalAmount = cart.reduce((s, it) => s + it.unit_price_snapshot * it.qty, 0);

  function handleAddOrEditItem(draft: PosCartItemDraft) {
    if (editingIdx !== null) {
      setCart((prev) => prev.map((c, i) => (i === editingIdx ? { ...draft, _localId: c._localId } : c)));
      setEditingIdx(null);
    } else {
      setCart((prev) => [...prev, { ...draft, _localId: crypto.randomUUID() }]);
    }
    setPickingMenu(null);
  }

  function handleEditItem(idx: number) {
    const item = cart[idx];
    const menu = menus.find((m) => m.id === item.menu_id);
    if (!menu) return;
    setEditingIdx(idx);
    setPickingMenu(menu);
  }

  function handleDeleteItem(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleCancel() {
    if (cart.length === 0) {
      router.push('/');
      return;
    }
    setConfirmingCancel(true);
  }

  async function handleSave() {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      const payload = {
        customer_name: customerName.trim() === '' ? null : customerName.trim(),
        table_no: tableNo.trim() === '' ? null : tableNo.trim(),
        is_takeaway: isTakeaway,
        items: cart.map((it, idx) => ({
          menu_id: it.menu_id,
          qty: it.qty,
          chip_labels: it.applied_chips.map((c) => c.label),
          notes: it.notes,
          sort_order: idx,
        })),
      };
      const res = await fetch('/api/pos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'save-failed');
      }
      const data = await res.json() as {
        transaction: { id: string; daily_seq: number | null; created_at: string; customer_name: string | null; table_no: string | null; is_takeaway: boolean };
        items: Array<{ id: string }>;
      };

      // Match returned item IDs by index (server preserves sort_order).
      const cartWithIds: Array<CartRow & { id: string }> = cart.map((it, idx) => ({
        ...it,
        id: data.items[idx]?.id ?? crypto.randomUUID(),
      }));
      const split = splitByTarget(cartWithIds);
      const jobs: Promise<{ target: PrinterTarget; ok: boolean; offline: boolean }>[] = [];
      if (split.dapur.length > 0) {
        jobs.push(submitPrintJob({ tx: data.transaction, target: 'dapur', items: split.dapur, printerSettings })
          .then((r) => ({ ...r, target: 'dapur' as const })));
      }
      if (split.minuman.length > 0) {
        jobs.push(submitPrintJob({ tx: data.transaction, target: 'minuman', items: split.minuman, printerSettings })
          .then((r) => ({ ...r, target: 'minuman' as const })));
      }
      const results = await Promise.all(jobs);
      const failed = results.filter((r) => !r.ok);
      const offlineCount = failed.filter((f) => f.offline).length;

      if (failed.length === 0) {
        toast.success(`Pesanan tersimpan, ${results.length} print job dikirim`);
      } else if (offlineCount > 0) {
        toast.success('Pesanan tersimpan');
        toast.warning('Agent printer offline. Nyalakan agent lalu cetak manual dari detail transaksi.', { duration: 10000 });
      } else {
        toast.success('Pesanan tersimpan');
        toast.error(`Gagal kirim print: ${failed.map((f) => f.target).join(', ')}`);
      }

      startTransition(() => { router.push('/'); });
    } catch (err) {
      toast.error('Gagal menyimpan pesanan', {
        description: err instanceof Error ? err.message : 'Coba lagi.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PosMenuPicker menus={menus} onMenuTap={(m) => { setEditingIdx(null); setPickingMenu(m); }} />

        <div className="space-y-4">
          <Card variant="paper" className="p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="pos-customer">Nama</Label>
                <Input id="pos-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="opsional" className="mt-2" />
              </div>
              <div>
                <Label htmlFor="pos-table">No. Meja</Label>
                <Input id="pos-table" value={tableNo} onChange={(e) => setTableNo(e.target.value)} placeholder="opsional" className="mt-2" />
              </div>
            </div>

            <label
              htmlFor="pos-takeaway"
              className={[
                'mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-lg border px-4 py-3 transition-colors',
                isTakeaway ? 'border-gold/60 bg-gold-faint' : 'border-clay-soft/60 bg-paper',
              ].join(' ')}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-coal">
                  <span aria-hidden>📦</span><span>Dibungkus</span>
                </div>
                <p className="mt-0.5 text-xs text-coal-soft">
                  {isTakeaway ? 'Tiket dapur akan bertanda BUNGKUS besar.' : 'Nyalakan kalau pesanan bungkus.'}
                </p>
              </div>
              <Switch id="pos-takeaway" checked={isTakeaway} onCheckedChange={setIsTakeaway} />
            </label>
          </Card>

          <Card variant="paper">
            <ul className="divide-y divide-clay-soft/60">
              {cart.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-clay">
                  Cart kosong. Tap menu di sebelah kiri untuk mulai order.
                </li>
              )}
              {cart.map((it, idx) => (
                <li key={it._localId} className="flex items-start gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-coal">
                      {it.qty}× {it.menu_name_snapshot}
                    </div>
                    {it.applied_chips.length > 0 && (
                      <p className="text-xs text-clay">
                        {it.applied_chips.map((c) => c.label).join(', ')}
                      </p>
                    )}
                    {it.notes && <p className="text-xs italic text-clay-soft">{it.notes}</p>}
                  </div>
                  <div className="text-right">
                    <div className="font-display text-sm text-coal">{formatRp(it.unit_price_snapshot * it.qty)}</div>
                    <div className="mt-1 flex gap-1">
                      <button type="button" onClick={() => handleEditItem(idx)} aria-label="Edit item" className="rounded p-1 text-xs hover:bg-cream">✏️</button>
                      <button type="button" onClick={() => handleDeleteItem(idx)} aria-label="Hapus item" className="rounded p-1 text-xs hover:bg-brick-faint">🗑</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="border-t border-clay-soft/60 px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm uppercase tracking-wide text-clay">Total sistem</span>
                <span className="font-display text-2xl tracking-tight text-coal">{formatRp(totalAmount)}</span>
              </div>
            </div>
          </Card>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleCancel} disabled={pending || submitting}>Batal</Button>
            <Button
              onClick={handleSave}
              disabled={pending || submitting || cart.length === 0}
              className="flex-1"
            >
              {submitting ? 'Menyimpan…' : '✓ Simpan & Cetak'}
            </Button>
          </div>
        </div>
      </div>

      {pickingMenu && (
        <PosItemConfigModal
          menu={pickingMenu}
          initial={editingIdx !== null ? cart[editingIdx] : undefined}
          onSave={handleAddOrEditItem}
          onClose={() => { setPickingMenu(null); setEditingIdx(null); }}
        />
      )}

      <AlertDialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan pesanan?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua {cart.length} item di cart akan hilang. Ga bisa di-undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Kembali</AlertDialogCancel>
            <AlertDialogAction onClick={() => router.push('/')}>Ya, batalkan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 2: Manual test — full flow with printer agent**

```bash
npm run dev
```

Prerequisites:
- Login sebagai owner.
- Setup 1 menu "Ayam Goreng" dengan chips (Task 14).
- Print agent running & primary (optional — kalau ga running, expect offline warning).

Test:
1. Navigate `/pos`.
2. Tap Ayam Goreng → chips picker muncul → pick "Dada" (mutex) + "Goreng garing" (free) → tambah ke cart.
3. Tap Ayam Goreng lagi → pick "Paha" + "Extra pedas" → tambah.
4. Isi No. Meja `5`, toggle Bungkus off.
5. Tap Simpan & Cetak → expect toast success + redirect ke Home.
6. Navigate `/transactions` → verify transaksi baru dengan status confirmed + benar item + chip labels displayed.
7. Buka detail — verify `applied_chips` displayed correctly.
8. Kalau agent running: verify kitchen ticket printed dengan chip labels line.

- [ ] **Step 3: Commit**

```bash
git add components/pos/pos-client.tsx
git commit -m "feat(pos): full POS flow — cart, save, print dispatch"
```

---

### Task 18: Fix review page — load `applied_chips` + reflect in edit

**Files:**
- Modify: `app/(app)/transactions/[id]/review/page.tsx`
- Verify: `components/nota-review-form.tsx` handles applied_chips end-to-end

- [ ] **Step 1: Read review page**

```bash
grep -n "initialItems\|applied_chips" app/\(app\)/transactions/\[id\]/review/page.tsx
```

Verify: server loads transaction items and passes to `<NotaReviewForm initialItems=...>`. Update mapper to include `applied_chips`.

- [ ] **Step 2: Update items load**

Ensure `initialItems` includes `applied_chips`:

```typescript
const initialItems = (items ?? []).map((it: any) => ({
  id: it.id,
  menu_id: it.menu_id,
  menu_name_snapshot: it.menu_name_snapshot,
  unit_price_snapshot: it.unit_price_snapshot,
  qty: it.qty,
  notes: it.notes,
  applied_chips: it.applied_chips ?? [],
  sort_order: it.sort_order,
  confidence: it.confidence,
}));
```

- [ ] **Step 3: Also load menus with chips**

Menus fetch in server component needs `chips` join. Update:

```typescript
const { data: menusRaw } = await supabase
  .from('menus')
  .select(`
    id, name, category, price, sort_order,
    chips:menu_chips(id, label, price_delta, mutex_group, sort_order)
  `)
  .eq('is_active', true);

const menus = (menusRaw ?? []).map((m) => ({
  id: m.id,
  name: m.name,
  category: m.category,
  price: m.price,
  chips: [...(m.chips ?? [])].sort((a, b) => a.sort_order - b.sort_order),
}));
```

- [ ] **Step 4: Manual test**

Buka POS-created transaksi via `/transactions/[id]/review`:
- Verify chip labels tampil di items.
- Edit item → chip picker muncul dengan state prefill.
- Toggle chip → save → verify update + reprint modal muncul (if confirmed tx).

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/transactions/
git commit -m "feat(review): load applied_chips + menu chips into review page"
```

---

### Task 19: Verify OCR flow zero regression

**Files:** none (verification only)

- [ ] **Step 1: Test OCR flow end-to-end**

```bash
npm run dev
```

1. `/scan` — upload foto nota lama (yang biasa dipake test).
2. Verify OCR result muncul with items.
3. Confirm → save → verify tx confirmed.
4. Verify kitchen ticket printed (kalau agent running).
5. Verify DB: `applied_chips` untuk items OCR = `[]`.

Kalau ada regression, fix. Should not be any — OCR flow doesn't pass `chip_labels`.

- [ ] **Step 2: Run full test suite**

```bash
npm run test
```

Expected: ALL PASS.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit (if any small fixes)**

Only commit if changes were needed. Else no commit.

---

### Task 20: Update `docs/tasks.md`

**Files:**
- Modify: `docs/tasks.md`

- [ ] **Step 1: Mark POS direct order done**

In `docs/tasks.md`, find the "POS / Order entry" section. Change:

```markdown
### 🍽️ POS / Order entry
- [ ] **POS direct order** ...
```

To:

```markdown
### 🍽️ POS / Order entry
- [x] **POS direct order + per-menu chips** — shipped 2026-07-08. `/pos` route, per-menu chips (multi-select + optional mutex_group + optional price_delta), snapshot in `transaction_items.applied_chips`. Kitchen ticket shows chip labels + free-text; customer receipt shows only paid chips. Spec: `docs/superpowers/specs/2026-07-08-pos-direct-order-with-chips-design.md`. Plan: `docs/superpowers/plans/2026-07-08-pos-direct-order-with-chips.md`.
```

Sub-bullets bisa dihilangkan (chip system supersede backlog details).

Keep "Mark menu habis hari ini" as-is (deferred to stock management).

- [ ] **Step 2: Add summary section to Plan history**

Add near the end of the plan phases:

```markdown
## Plan 7 — POS Direct Order + Per-Menu Chips ✅ COMPLETE (2026-07-08)

Spec: `docs/superpowers/specs/2026-07-08-pos-direct-order-with-chips-design.md`
Plan: `docs/superpowers/plans/2026-07-08-pos-direct-order-with-chips.md`

- `/pos` hybrid layout (menu picker + cart), single-shot save = confirmed + auto-print kitchen.
- Per-menu chips (table `menu_chips`), multi-select + optional `mutex_group` (radio behavior per group) + optional `price_delta`.
- `applied_chips` jsonb snapshot on `transaction_items` — historical safe.
- Kitchen ticket: chip labels + free-text. Customer receipt: paid chips only.
- Menu master extended with inline chip editor (label / +Harga / Grup / delete).
- Existing OCR flow zero-regression — items default `applied_chips = []`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/tasks.md
git commit -m "docs: mark POS + chips done in tasks.md"
```

---

## Self-Review

- **Spec coverage**: All spec sections (§4 data model, §5 UX, §6 endpoints, §7 menu master, §8 print) covered across Tasks 1–17. §10 (POS skip cols) implicit in Task 7 (POST /api/pos sets scan_image_path=null, handwritten_total=null). §11 testing covered by unit tests in Tasks 2/3/6/9/10 + manual E2E in Task 17/18/19.
- **Placeholder scan**: no TBD/TODO. "00XX" in migration filename resolves to `0032` (verified in Task 1 file listing). All code blocks complete.
- **Type consistency**: `AppliedChip`, `MenuChip`, `ItemForQueue`, `NotaItem.applied_chips`, `RenderItem.applied_chips`, `PosCartItemDraft.applied_chips` — all use same shape `{ label: string; price_delta: number }`. `ChipDraft` in menu-form has `mutex_group: string` (empty string maps to null in payload) — intentionally different for form state.
- **Ordering**: Migration (T1) → helpers (T2) → schemas (T3) → API (T4/T5) → types (T6) → endpoints (T7/T8) → escpos (T9/T10) → passthrough (T11) → NotaItem+row (T12) → NotaItemModal chip picker (T13) → menu-form chip editor (T14) → POS home tile (T15) → menu picker (T16) → full POS flow (T17) → review page load (T18) → OCR regression check (T19) → docs (T20). Dependencies respected.
