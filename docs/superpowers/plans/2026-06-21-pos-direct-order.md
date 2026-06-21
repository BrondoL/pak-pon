# POS Direct Order Implementation Plan (Plan B of POS feature)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ DEPENDENCY:** Plan A (`docs/superpowers/plans/2026-06-21-menu-note-presets.md`) MUST be merged before starting Plan B. Plan B reuses `<NotePresetPicker>`, `<NotaItemModal>`, `mergeItemsByPresets()`, mutex validation, dan kolom `transaction_items.note_presets_snapshot`.

**Goal:** Halaman `/pos` baru untuk kasir input order direct (tanpa foto nota). Split view tablet landscape (menu kiri + cart kanan), inline chip picker, 1-tap add untuk menu tanpa chips. Tx tersimpan langsung `confirmed`. localStorage backup + idempotency key untuk resilience saat network glitch / refresh accidental.

**Architecture:** Server component load menus → client component orchestrator dengan local cart state + localStorage backup. Single new POST endpoint `/api/transactions` (separate dari /scan flow). Reuse Plan A komponen + helper untuk chip handling. Mobile responsive via shadcn `Sheet` drawer.

**Tech Stack:** Next.js 16 App Router, React 19.2, TypeScript strict, Tailwind v4, shadcn (base-nova) + new Sheet, Zod, Supabase, Vitest.

**Spec reference:** `docs/superpowers/specs/2026-06-21-pos-direct-order-design.md`

---

## File structure

| File | Action | Tasks |
|---|---|---|
| `supabase/migrations/0005_transactions_idempotency_key.sql` | Create | 1 |
| `app/api/transactions/route.ts` | Modify (add POST) | 2 |
| `app/api/transactions/_schemas.ts` | Create (shared Zod) | 2 |
| `app/api/transactions/_schemas.test.ts` | Create (TDD) | 2 |
| `components/ui/sheet.tsx` | Create (via shadcn add) | 3 |
| `app/(app)/pos/page.tsx` | Create (server) | 3 |
| `components/pos/pos-client.tsx` | Create (orchestrator) | 3 |
| `components/pos/menu-panel.tsx` | Create | 4 |
| `components/pos/menu-row.tsx` | Create | 4 |
| `components/pos/cart-panel.tsx` | Create | 5 |
| `components/pos/cart-item-row.tsx` | Create | 5 |
| `components/pos/pos-client.tsx` (revisit) | Modify (mobile Sheet integration) | 6 |
| `components/home-tiles.tsx` | Modify (add POS tile) | 7 |
| `docs/superpowers/specs/2026-06-20-pak-pon-design.md` | Modify | 8 |
| `docs/tasks.md` | Modify | 8 |

---

## Task 1: Migration — add `idempotency_key` column

**Files:**
- Create: `supabase/migrations/0005_transactions_idempotency_key.sql`

- [ ] **Step 1: Write migration SQL**

Create `supabase/migrations/0005_transactions_idempotency_key.sql`:

```sql
-- 0005_transactions_idempotency_key.sql
-- Add idempotency_key column to transactions for POS direct order dedup.
-- NULL for /scan flow (existing rows + future scan-flow inserts).

ALTER TABLE transactions
  ADD COLUMN idempotency_key text;

-- Partial unique index — only non-null keys must be unique.
CREATE UNIQUE INDEX transactions_idempotency_key_unique
  ON transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN transactions.idempotency_key IS
  'Optional UUID for POS direct order dedup. NULL for /scan flow.';
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__plugin_supabase_supabase__apply_migration` tool with name `transactions_idempotency_key` and the SQL above. If MCP not available, run via Supabase CLI: `supabase migration up`.

Expected: migration applied, no errors.

- [ ] **Step 3: Verify schema**

Run SQL via execute tool:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions' AND column_name = 'idempotency_key';
```

Expected: 1 row, `text`, nullable.

Verify unique index exists:
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'transactions' AND indexname = 'transactions_idempotency_key_unique';
```

Expected: 1 row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0005_transactions_idempotency_key.sql
git commit -m "feat(db): migration 0005 — transactions.idempotency_key for POS dedup"
```

---

## Task 2: `POST /api/transactions` endpoint + shared Zod schema

**Files:**
- Create: `app/api/transactions/_schemas.ts`
- Create: `app/api/transactions/_schemas.test.ts`
- Modify: `app/api/transactions/route.ts`

- [ ] **Step 1: Create shared Zod schema**

Create `app/api/transactions/_schemas.ts`:

```ts
import { z } from 'zod';

export const NotePresetSnapshotSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(40),
  price_delta: z.number().int().min(0),
});

export const ItemPayloadSchema = z.object({
  menu_id: z.string().uuid(),
  qty: z.number().int().positive(),
  notes: z.string().nullable().default(null),
  sort_order: z.number().int().default(0),
  note_presets_snapshot: z.array(NotePresetSnapshotSchema).max(20).default([]),
});

export const CreateTransactionSchema = z.object({
  customer_name: z.string().nullable().optional(),
  table_no: z.string().nullable().optional(),
  items: z.array(ItemPayloadSchema).min(1, 'items_required'),
}).strict();

export type NotePresetSnapshotPayload = z.infer<typeof NotePresetSnapshotSchema>;
export type ItemPayload = z.infer<typeof ItemPayloadSchema>;
export type CreateTransaction = z.infer<typeof CreateTransactionSchema>;
```

- [ ] **Step 2: Write failing tests**

Create `app/api/transactions/_schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CreateTransactionSchema } from './_schemas';

describe('CreateTransactionSchema', () => {
  it('accepts minimal valid body (one item, no customer)', () => {
    const result = CreateTransactionSchema.safeParse({
      items: [
        {
          menu_id: '11111111-1111-1111-1111-111111111111',
          qty: 1,
          notes: null,
          sort_order: 0,
          note_presets_snapshot: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts items with note_presets_snapshot', () => {
    const result = CreateTransactionSchema.safeParse({
      customer_name: 'Pak Budi',
      table_no: '5',
      items: [
        {
          menu_id: '11111111-1111-1111-1111-111111111111',
          qty: 2,
          notes: null,
          sort_order: 0,
          note_presets_snapshot: [
            { id: 'p1', label: 'Dada', price_delta: 0 },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty items array', () => {
    const result = CreateTransactionSchema.safeParse({
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing items field', () => {
    const result = CreateTransactionSchema.safeParse({
      customer_name: 'X',
    });
    expect(result.success).toBe(false);
  });

  it('rejects qty zero or negative', () => {
    const result = CreateTransactionSchema.safeParse({
      items: [
        { menu_id: '11111111-1111-1111-1111-111111111111', qty: 0 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid menu_id', () => {
    const result = CreateTransactionSchema.safeParse({
      items: [
        { menu_id: 'not-a-uuid', qty: 1 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('defaults notes to null, sort_order to 0, snapshot to []', () => {
    const result = CreateTransactionSchema.parse({
      items: [
        { menu_id: '11111111-1111-1111-1111-111111111111', qty: 1 },
      ],
    });
    expect(result.items[0].notes).toBeNull();
    expect(result.items[0].sort_order).toBe(0);
    expect(result.items[0].note_presets_snapshot).toEqual([]);
  });

  it('rejects extra fields (strict)', () => {
    const result = CreateTransactionSchema.safeParse({
      items: [{ menu_id: '11111111-1111-1111-1111-111111111111', qty: 1 }],
      extra_field: 'nope',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm run test -- app/api/transactions/_schemas.test.ts`

Expected: PASS (all 8 cases).

- [ ] **Step 4: Add POST handler to `app/api/transactions/route.ts`**

Open the file. Existing has only GET. Add POST handler. Add imports at top:

```ts
import { CreateTransactionSchema } from './_schemas';
import { computeReplaceItems, type MenuRef } from '@/lib/transactions';
```

Add helper for cross-mutex validation (reuse pattern from Plan A — copy inline since not yet extracted to shared lib):

```ts
type MenuPresetLookup = {
  id: string;
  name: string;
  price: number;
  note_presets: { id: string; mutex_group: string | null }[];
};

function validateMutexGroups(
  items: Array<{ menu_id: string; note_presets_snapshot: { id: string }[] }>,
  menus: MenuPresetLookup[]
): { valid: true } | { valid: false; reason: string } {
  const byMenuId = new Map(menus.map((m) => [m.id, m]));
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const menu = byMenuId.get(item.menu_id);
    if (!menu) continue;
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

Add POST handler:

```ts
export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/transactions');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const idempotencyKey = request.headers.get('x-idempotency-key');
    if (!idempotencyKey || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'missing_or_invalid_idempotency_key' });
      return NextResponse.json(
        { error: 'invalid_body', detail: 'X-Idempotency-Key header required (UUID)' },
        { status: 400 }
      );
    }
    evt.set('idempotency_key', idempotencyKey);

    const body = await request.json().catch(() => ({}));
    const parsed = CreateTransactionSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_body', zod_issues: parsed.error.issues });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const data = parsed.data;
    evt.merge({ item_count: data.items.length });

    // Idempotency check — return existing tx if key already used
    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing) {
      // Recompute total from existing items for response symmetry
      const { data: existingItems } = await supabase
        .from('transaction_items')
        .select('qty, unit_price_snapshot, note_presets_snapshot')
        .eq('transaction_id', existing.id);
      const total = (existingItems ?? []).reduce((sum, it) => {
        const adds = (it.note_presets_snapshot as Array<{ price_delta: number }> ?? []).reduce(
          (s, p) => s + p.price_delta,
          0
        );
        return sum + it.qty * (it.unit_price_snapshot + adds);
      }, 0);
      tagStatus(evt, 200);
      evt.merge({ idempotency_hit: true, transaction_id: existing.id, total });
      return NextResponse.json({ transaction_id: existing.id, total });
    }

    // Fetch menus referenced by payload for mutex validation + snapshot
    const menuIds = [...new Set(data.items.map((it) => it.menu_id))];
    const { data: menuLookup, error: lookupErr } = await supabase
      .from('menus')
      .select('id, name, price, note_presets')
      .in('id', menuIds);
    if (lookupErr) {
      tagStatus(evt, 500);
      evt.error(lookupErr);
      return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    }
    if (menuLookup == null || menuLookup.length !== menuIds.length) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'unknown_menu_id' });
      return NextResponse.json(
        { error: 'invalid_body', detail: 'one or more menu_id not found' },
        { status: 400 }
      );
    }

    const validation = validateMutexGroups(data.items, menuLookup as MenuPresetLookup[]);
    if (!validation.valid) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'mutex_violation', detail: validation.reason });
      return NextResponse.json({ error: 'invalid_body', detail: validation.reason }, { status: 400 });
    }

    // Insert transaction
    const { data: tx, error: txError } = await supabase
      .from('transactions')
      .insert({
        idempotency_key: idempotencyKey,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        customer_name: data.customer_name?.trim() || null,
        table_no: data.table_no?.trim() || null,
        scan_image_path: null,
        handwritten_total: null,
      })
      .select('id')
      .single();
    if (txError || !tx) {
      tagStatus(evt, 500);
      evt.error(txError ?? new Error('insert failed'));
      return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
    }
    evt.set('transaction_id', tx.id);

    // Build item rows
    const menuRefs: MenuRef[] = menuLookup.map((m) => ({
      id: m.id,
      name: m.name,
      price: m.price as number,
    }));
    const replaced = computeReplaceItems({
      existing: [],
      requested: data.items.map((it) => ({
        menu_id: it.menu_id,
        qty: it.qty,
        notes: it.notes,
        sort_order: it.sort_order,
        note_presets_snapshot: it.note_presets_snapshot,
      })),
      menus: menuRefs,
    });

    const itemRows = replaced.rows.map((row) => ({
      transaction_id: tx.id,
      menu_id: row.menu_id,
      menu_name_snapshot: row.menu_name_snapshot,
      unit_price_snapshot: row.unit_price_snapshot,
      qty: row.qty,
      notes: row.notes,
      sort_order: row.sort_order,
      note_presets_snapshot: row.note_presets_snapshot,
    }));

    const { error: itemsErr } = await supabase.from('transaction_items').insert(itemRows);
    if (itemsErr) {
      // Best-effort cleanup of orphan tx (idempotency-safe — same key won't retry)
      await supabase.from('transactions').delete().eq('id', tx.id);
      tagStatus(evt, 500);
      evt.error(itemsErr);
      return NextResponse.json({ error: 'insert_items_failed' }, { status: 500 });
    }

    const total = itemRows.reduce((sum, it) => {
      const adds = it.note_presets_snapshot.reduce((s, p) => s + p.price_delta, 0);
      return sum + it.qty * (it.unit_price_snapshot + adds);
    }, 0);

    tagStatus(evt, 200);
    evt.merge({ total, item_count: itemRows.length });
    return NextResponse.json({ transaction_id: tx.id, total });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 5: Run lint + tests + build**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS. Existing /scan flow tetap berfungsi (no breaking changes).

- [ ] **Step 6: Commit**

```bash
git add app/api/transactions/_schemas.ts app/api/transactions/_schemas.test.ts app/api/transactions/route.ts
git commit -m "feat(api): POST /api/transactions — direct order with idempotency"
```

---

## Task 3: shadcn Sheet + `/pos` page shell + orchestrator skeleton

**Files:**
- Create: `components/ui/sheet.tsx`
- Create: `app/(app)/pos/page.tsx`
- Create: `components/pos/pos-client.tsx`

- [ ] **Step 1: Install shadcn Sheet**

Run: `NPM_CONFIG_LEGACY_PEER_DEPS=true npx shadcn@latest add sheet`

Expected: `components/ui/sheet.tsx` created. `@base-ui/react` already installed.

- [ ] **Step 2: Create server page**

Create `app/(app)/pos/page.tsx`:

```tsx
import { getSupabaseServer } from '@/lib/supabase/server';
import { PosClient } from '@/components/pos/pos-client';

export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from('menus')
    .select('id, name, category, price, sort_order, note_presets')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  return (
    <div className="space-y-4">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          POS
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Input <span className="italic">order</span>
        </h1>
        <p className="mt-2 text-sm text-coal-soft">
          Pilih menu, tambahkan ke cart, lalu tap Selesai.
        </p>
      </div>

      <PosClient menus={data ?? []} />
    </div>
  );
}
```

- [ ] **Step 3: Create orchestrator skeleton**

Create `components/pos/pos-client.tsx` (minimal skeleton — menu panel + cart panel akan di-implement Tasks 4 & 5):

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { NotePreset } from '@/app/api/menus/_schemas';
import type { NotePresetSnapshot } from '@/lib/transactions';

export type PosMenu = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  sort_order: number;
  note_presets: NotePreset[];
};

export type CartItem = {
  cart_id: string;
  menu_id: string;
  menu_name: string;
  unit_price: number;
  qty: number;
  notes: string | null;
  note_presets_snapshot: NotePresetSnapshot[];
};

const LS_KEY = 'pos-draft-v1';
const STALE_MS = 24 * 60 * 60 * 1000;

function nanoid(): string {
  return Math.random().toString(36).slice(2, 12);
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function PosClient({ menus }: { menus: PosMenu[] }) {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [tableNo, setTableNo] = useState('');
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateUuid());

  // Restore from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        cart: CartItem[];
        customerName: string;
        tableNo: string;
        timestamp: number;
      };
      if (Date.now() - parsed.timestamp > STALE_MS) {
        localStorage.removeItem(LS_KEY);
        return;
      }
      setCart(parsed.cart);
      setCustomerName(parsed.customerName);
      setTableNo(parsed.tableNo);
    } catch {
      // ignore corrupt draft
    }
  }, []);

  // Debounced sync to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handle = setTimeout(() => {
      const empty = cart.length === 0 && customerName === '' && tableNo === '';
      if (empty) {
        localStorage.removeItem(LS_KEY);
        return;
      }
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ cart, customerName, tableNo, timestamp: Date.now() })
      );
    }, 500);
    return () => clearTimeout(handle);
  }, [cart, customerName, tableNo]);

  const addToCart = useCallback((items: Omit<CartItem, 'cart_id'>[]) => {
    setCart((prev) => [
      ...prev,
      ...items.map((it) => ({ ...it, cart_id: nanoid() })),
    ]);
  }, []);

  const updateCartItem = useCallback((cart_id: string, items: Omit<CartItem, 'cart_id'>[]) => {
    setCart((prev) => {
      const filtered = prev.filter((it) => it.cart_id !== cart_id);
      return [...filtered, ...items.map((it) => ({ ...it, cart_id: nanoid() }))];
    });
  }, []);

  const removeCartItem = useCallback((cart_id: string) => {
    setCart((prev) => prev.filter((it) => it.cart_id !== cart_id));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setCustomerName('');
    setTableNo('');
    if (typeof window !== 'undefined') localStorage.removeItem(LS_KEY);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (cart.length === 0 || saving) return;
    setSaving(true);
    try {
      const body = {
        customer_name: customerName.trim() === '' ? null : customerName.trim(),
        table_no: tableNo.trim() === '' ? null : tableNo.trim(),
        items: cart.map((it, idx) => ({
          menu_id: it.menu_id,
          qty: it.qty,
          notes: it.notes,
          sort_order: idx,
          note_presets_snapshot: it.note_presets_snapshot,
        })),
      };
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (data as { detail?: string }).detail ?? '';
        toast.error('Gagal simpan order', { description: detail || 'Coba lagi.' });
        return;
      }
      const json = data as { transaction_id: string; total: number };
      toast.success(`Order tersimpan — Rp ${(json.total / 1000).toFixed(0)}rb`, {
        action: { label: 'Lihat', onClick: () => router.push(`/transactions/${json.transaction_id}`) },
      });
      // Clear + regenerate idempotency for next order
      clearCart();
      setIdempotencyKey(generateUuid());
      router.push(`/transactions/${json.transaction_id}`);
    } catch (err) {
      toast.error('Gagal simpan order', {
        description: err instanceof Error ? err.message : 'Periksa koneksi.',
      });
    } finally {
      setSaving(false);
    }
  }, [cart, customerName, tableNo, idempotencyKey, saving, router, clearCart]);

  // Placeholder UI — tasks 4 & 5 fill in panels
  return (
    <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
      <div className="rounded-md border border-clay-soft bg-paper-soft p-4">
        <p className="text-sm text-coal-soft italic">
          Menu panel — implement di Task 4.
        </p>
        <p className="mt-2 text-xs text-clay">
          {menus.length} menu loaded. addToCart() callback ready.
        </p>
      </div>
      <div className="rounded-md border border-clay-soft bg-paper-soft p-4">
        <p className="text-sm text-coal-soft italic">
          Cart panel — implement di Task 5.
        </p>
        <p className="mt-2 text-xs text-clay">
          {cart.length} item · customer = {customerName || '—'} · meja = {tableNo || '—'} · saving = {String(saving)}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS. `/pos` route compiles.

- [ ] **Step 5: Commit**

```bash
git add components/ui/sheet.tsx 'app/(app)/pos/page.tsx' components/pos/pos-client.tsx
git commit -m "feat(pos): shadcn Sheet + /pos shell + orchestrator skeleton"
```

---

## Task 4: Menu panel (kiri) — tabs, search, list, expand/collapse

**Files:**
- Create: `components/pos/menu-panel.tsx`
- Create: `components/pos/menu-row.tsx`
- Modify: `components/pos/pos-client.tsx`

- [ ] **Step 1: Create `menu-row.tsx`**

Create `components/pos/menu-row.tsx`:

```tsx
'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NotePresetPicker } from '@/components/note-preset-picker';
import { formatRp } from '@/lib/currency';
import { mergeItemsByPresets, type NotePresetSnapshot, type PorsiSelection } from '@/lib/transactions';
import type { PosMenu, CartItem } from './pos-client';

type AddItemPayload = Omit<CartItem, 'cart_id'>;

export function MenuRow({
  menu,
  expanded,
  onExpand,
  onCollapse,
  onAddToCart,
}: {
  menu: PosMenu;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onAddToCart: (items: AddItemPayload[]) => void;
}) {
  const hasPresets = menu.note_presets.length > 0;
  const hasMutex = useMemo(
    () => menu.note_presets.some((p) => p.mutex_group != null),
    [menu]
  );

  const [qty, setQty] = useState(1);
  const [porsiSelections, setPorsiSelections] = useState<NotePresetSnapshot[][]>([[]]);

  // Reset state on collapse
  useEffect(() => {
    if (!expanded) {
      setQty(1);
      setPorsiSelections([[]]);
    }
  }, [expanded]);

  // Keep porsiSelections length = qty
  useEffect(() => {
    setPorsiSelections((prev) => {
      if (prev.length === qty) return prev;
      if (prev.length < qty) {
        const lastTemplate = prev[prev.length - 1] ?? [];
        return [...prev, ...Array.from({ length: qty - prev.length }, () => [...lastTemplate])];
      }
      return prev.slice(0, qty);
    });
  }, [qty]);

  const showPerPorsi = qty > 1 && hasMutex;
  const totalAdds = porsiSelections.reduce(
    (sum, snap) => sum + snap.reduce((s, c) => s + c.price_delta, 0),
    0
  );
  const total = menu.price * qty + totalAdds;

  function quickAddNoChip() {
    onAddToCart([
      {
        menu_id: menu.id,
        menu_name: menu.name,
        unit_price: menu.price,
        qty: 1,
        notes: null,
        note_presets_snapshot: [],
      },
    ]);
  }

  function commitExpanded() {
    const porsi: PorsiSelection[] = porsiSelections.map((snap) => ({
      menu_id: menu.id,
      notes: null,
      sort_order: 0,
      note_presets_snapshot: snap,
    }));
    const merged = mergeItemsByPresets(porsi);
    onAddToCart(
      merged.map((m) => ({
        menu_id: m.menu_id,
        menu_name: menu.name,
        unit_price: menu.price,
        qty: m.qty,
        notes: m.notes,
        note_presets_snapshot: m.note_presets_snapshot,
      }))
    );
    onCollapse();
  }

  function copyPorsiOneToAll() {
    setPorsiSelections((prev) => {
      const first = prev[0] ?? [];
      return prev.map(() => [...first]);
    });
  }

  return (
    <li className={`rounded-md ${expanded ? 'bg-cream' : 'bg-paper-soft hover:bg-cream/60'}`}>
      <button
        type="button"
        onClick={() => {
          if (!hasPresets) {
            quickAddNoChip();
            return;
          }
          if (expanded) onCollapse(); else onExpand();
        }}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex-1">
          <span className="font-medium text-coal">{menu.name}</span>
        </span>
        <span className="text-sm tracking-tight text-coal-soft">
          {formatRp(menu.price)}
        </span>
        <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-medium text-night-deep">
          {hasPresets ? (expanded ? '▼' : '+') : '+'}
        </span>
      </button>

      {expanded && hasPresets && (
        <div className="space-y-3 border-t border-clay-soft/60 p-4">
          {showPerPorsi ? (
            <>
              {porsiSelections.map((snap, idx) => (
                <div key={idx} className="rounded-md bg-paper-soft p-3">
                  <p className="mb-2 text-xs italic text-coal-soft">
                    Porsi {idx + 1} of {qty}
                  </p>
                  <NotePresetPicker
                    presets={menu.note_presets}
                    selected={snap}
                    onChange={(next) =>
                      setPorsiSelections((prev) =>
                        prev.map((p, i) => (i === idx ? next : p))
                      )
                    }
                  />
                </div>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={copyPorsiOneToAll}>
                ↻ Samakan semua porsi dengan #1
              </Button>
            </>
          ) : (
            <NotePresetPicker
              presets={menu.note_presets}
              selected={porsiSelections[0] ?? []}
              onChange={(next) =>
                setPorsiSelections((prev) => prev.map((p, i) => (i === 0 ? next : p)))
              }
            />
          )}

          <div className="flex items-center gap-2 pt-2">
            <span className="text-xs uppercase tracking-[0.16em] text-clay">Jumlah</span>
            <Button type="button" size="xs" variant="secondary" onClick={() => setQty((q) => Math.max(1, q - 1))}>
              −
            </Button>
            <Input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="w-16 text-center"
            />
            <Button type="button" size="xs" variant="secondary" onClick={() => setQty((q) => q + 1)}>
              +
            </Button>
            <span className="ml-auto font-display text-base text-coal">
              {formatRp(total)}
            </span>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" size="sm" variant="secondary" onClick={onCollapse}>
              ✗ Batal
            </Button>
            <Button type="button" size="sm" onClick={commitExpanded} className="ml-auto">
              ✓ Tambah ke cart
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Create `menu-panel.tsx`**

Create `components/pos/menu-panel.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { MenuRow } from './menu-row';
import type { PosMenu, CartItem } from './pos-client';

type Category = 'makanan' | 'nasi' | 'minuman';
const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'makanan', label: 'Makanan' },
  { value: 'nasi', label: 'Nasi & side' },
  { value: 'minuman', label: 'Minuman' },
];

export function MenuPanel({
  menus,
  onAddToCart,
}: {
  menus: PosMenu[];
  onAddToCart: (items: Omit<CartItem, 'cart_id'>[]) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<Category>('makanan');
  const [search, setSearch] = useState('');
  const [expandedMenuId, setExpandedMenuId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (q !== '') {
      return menus.filter((m) => m.name.toLowerCase().includes(q));
    }
    return menus.filter((m) => m.category === activeCategory);
  }, [menus, search, activeCategory]);

  return (
    <div className="space-y-3 rounded-md border border-clay-soft bg-paper-soft p-4">
      {/* Category tabs */}
      <div className="inline-flex rounded-lg bg-cream p-1">
        {CATEGORIES.map((cat) => {
          const active = activeCategory === cat.value && search === '';
          return (
            <button
              key={cat.value}
              type="button"
              onClick={() => {
                setActiveCategory(cat.value);
                setSearch('');
                setExpandedMenuId(null);
              }}
              className={[
                'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                'duration-[var(--duration-fast)]',
                active
                  ? 'bg-paper-soft text-coal shadow-[var(--shadow-paper)]'
                  : 'text-coal-soft hover:text-coal',
              ].join(' ')}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <Input
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setExpandedMenuId(null);
        }}
        placeholder="🔍 Cari menu..."
        className="w-full"
      />

      {/* Menu list */}
      <ul className="space-y-1">
        {filtered.length === 0 && (
          <li className="rounded-md bg-cream px-4 py-8 text-center text-sm italic text-coal-soft">
            {search !== '' ? 'Tidak ada menu cocok.' : 'Belum ada menu di kategori ini.'}
          </li>
        )}
        {filtered.map((menu) => (
          <MenuRow
            key={menu.id}
            menu={menu}
            expanded={expandedMenuId === menu.id}
            onExpand={() => setExpandedMenuId(menu.id)}
            onCollapse={() => setExpandedMenuId(null)}
            onAddToCart={onAddToCart}
          />
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Wire MenuPanel into pos-client**

Open `components/pos/pos-client.tsx`. Replace the placeholder menu panel div with:

```tsx
import { MenuPanel } from './menu-panel';
```

(Add import at top.)

In the return JSX, replace the menu placeholder div:

```tsx
<MenuPanel menus={menus} onAddToCart={addToCart} />
```

- [ ] **Step 4: Verify build**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/pos/menu-row.tsx components/pos/menu-panel.tsx components/pos/pos-client.tsx
git commit -m "feat(pos): menu panel — tabs + search + expand/collapse + add-to-cart"
```

---

## Task 5: Cart panel (kanan)

**Files:**
- Create: `components/pos/cart-panel.tsx`
- Create: `components/pos/cart-item-row.tsx`
- Modify: `components/pos/pos-client.tsx`

- [ ] **Step 1: Create `cart-item-row.tsx`**

Create `components/pos/cart-item-row.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';
import { NotaItemModal, type MenuOption } from '@/components/nota-item-modal';
import type { NotaItem } from '@/components/nota-item-row';
import type { CartItem, PosMenu } from './pos-client';

export function CartItemRow({
  item,
  menus,
  onUpdate,
  onRemove,
}: {
  item: CartItem;
  menus: PosMenu[];
  onUpdate: (cart_id: string, items: Omit<CartItem, 'cart_id'>[]) => void;
  onRemove: (cart_id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const adds = item.note_presets_snapshot.reduce((s, p) => s + p.price_delta, 0);
  const lineTotal = item.qty * (item.unit_price + adds);

  // Convert CartItem to NotaItem shape for modal
  const modalInitial: NotaItem = {
    id: item.cart_id,
    menu_id: item.menu_id,
    menu_name_snapshot: item.menu_name,
    unit_price_snapshot: item.unit_price,
    qty: item.qty,
    notes: item.notes,
    sort_order: 0,
    note_presets_snapshot: item.note_presets_snapshot,
  };

  const menuOptions: MenuOption[] = menus.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    price: m.price,
    note_presets: m.note_presets,
  }));

  return (
    <>
      <li className="py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-coal">
              {item.qty}× {item.menu_name}
            </p>
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
            {item.notes && (
              <p className="mt-1 text-xs italic text-clay">{item.notes}</p>
            )}
            <p className="mt-1 font-display text-sm tracking-tight text-coal-soft">
              {formatRp(lineTotal)}
            </p>
          </div>
          {confirmingDelete ? (
            <div className="flex items-center gap-1">
              <Button size="xs" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Batal
              </Button>
              <Button size="xs" variant="destructive" onClick={() => onRemove(item.cart_id)}>
                Ya
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Button size="xs" variant="ghost" onClick={() => setEditing(true)} aria-label="Edit item">
                ✏
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmingDelete(true)} aria-label="Hapus item">
                🗑
              </Button>
            </div>
          )}
        </div>
      </li>

      {editing && (
        <NotaItemModal
          initial={modalInitial}
          menus={menuOptions}
          onSave={(mergedItems) => {
            const next = mergedItems.map((m) => ({
              menu_id: m.menu_id,
              menu_name: menus.find((mn) => mn.id === m.menu_id)?.name ?? '',
              unit_price: menus.find((mn) => mn.id === m.menu_id)?.price ?? 0,
              qty: m.qty,
              notes: m.notes,
              note_presets_snapshot: m.note_presets_snapshot,
            }));
            onUpdate(item.cart_id, next);
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
          onDelete={() => {
            onRemove(item.cart_id);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Create `cart-panel.tsx`**

Create `components/pos/cart-panel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatRp } from '@/lib/currency';
import { CartItemRow } from './cart-item-row';
import type { CartItem, PosMenu } from './pos-client';

export function CartPanel({
  cart,
  customerName,
  tableNo,
  saving,
  menus,
  onUpdateItem,
  onRemoveItem,
  onClear,
  onSubmit,
  onCustomerName,
  onTableNo,
}: {
  cart: CartItem[];
  customerName: string;
  tableNo: string;
  saving: boolean;
  menus: PosMenu[];
  onUpdateItem: (cart_id: string, items: Omit<CartItem, 'cart_id'>[]) => void;
  onRemoveItem: (cart_id: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  onCustomerName: (v: string) => void;
  onTableNo: (v: string) => void;
}) {
  const total = cart.reduce((sum, item) => {
    const adds = item.note_presets_snapshot.reduce((s, p) => s + p.price_delta, 0);
    return sum + item.qty * (item.unit_price + adds);
  }, 0);

  return (
    <div className="rounded-md border border-clay-soft bg-paper-soft p-4">
      {/* Customer info */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px]">
        <div>
          <Label htmlFor="customer">Nama (opsional)</Label>
          <Input
            id="customer"
            value={customerName}
            onChange={(e) => onCustomerName(e.target.value)}
            placeholder="cth: Pak Budi"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="table">Meja</Label>
          <Input
            id="table"
            value={tableNo}
            onChange={(e) => onTableNo(e.target.value)}
            maxLength={6}
            placeholder="cth: 5"
            className="mt-1"
          />
        </div>
      </div>

      {/* Items */}
      <div className="mt-4">
        <p className="text-[11px] uppercase tracking-[0.16em] text-clay">Items</p>
        {cart.length === 0 ? (
          <p className="mt-3 rounded-md bg-cream px-4 py-6 text-center text-sm italic text-coal-soft">
            Cart kosong. Pilih menu di sebelah kiri untuk mulai order.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-clay-soft/60">
            {cart.map((item) => (
              <CartItemRow
                key={item.cart_id}
                item={item}
                menus={menus}
                onUpdate={onUpdateItem}
                onRemove={onRemoveItem}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Summary */}
      {cart.length > 0 && (
        <div className="mt-4 border-t border-clay-soft/60 pt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-coal-soft">Total</span>
            <span className="font-display text-2xl tracking-tight text-coal">
              {formatRp(total)}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        {cart.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" disabled={saving}>
                🗑 Kosongkan
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Kosongkan cart?</AlertDialogTitle>
                <AlertDialogDescription>
                  Semua item, nama pelanggan, dan nomor meja akan dihapus.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onClear}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Ya, kosongkan
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button
          disabled={cart.length === 0 || saving}
          onClick={onSubmit}
          className="ml-auto"
        >
          {saving ? 'Menyimpan…' : '✓ Selesai'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire CartPanel into pos-client**

Open `components/pos/pos-client.tsx`. Add import:

```tsx
import { CartPanel } from './cart-panel';
```

Replace the placeholder cart panel div with:

```tsx
<CartPanel
  cart={cart}
  customerName={customerName}
  tableNo={tableNo}
  saving={saving}
  menus={menus}
  onUpdateItem={updateCartItem}
  onRemoveItem={removeCartItem}
  onClear={clearCart}
  onSubmit={handleSubmit}
  onCustomerName={setCustomerName}
  onTableNo={setTableNo}
/>
```

- [ ] **Step 4: Verify build**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/pos/cart-item-row.tsx components/pos/cart-panel.tsx components/pos/pos-client.tsx
git commit -m "feat(pos): cart panel — items + customer + total + Selesai"
```

---

## Task 6: Mobile responsive — Sheet drawer untuk cart

**Files:**
- Modify: `components/pos/pos-client.tsx`

- [ ] **Step 1: Add Sheet import + state**

Open `components/pos/pos-client.tsx`. Add imports at top:

```tsx
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
```

Add state for sheet open:

```tsx
const [sheetOpen, setSheetOpen] = useState(false);
```

Compute total at component level (for sheet trigger label):

```tsx
const cartTotal = cart.reduce((sum, item) => {
  const adds = item.note_presets_snapshot.reduce((s, p) => s + p.price_delta, 0);
  return sum + item.qty * (item.unit_price + adds);
}, 0);
```

- [ ] **Step 2: Replace return JSX with responsive layout**

Replace the return JSX (the `<div className="grid gap-4 md:grid-cols-[3fr_2fr]">` block) with:

```tsx
return (
  <>
    {/* Desktop / tablet landscape: split view */}
    <div className="hidden gap-4 md:grid md:grid-cols-[3fr_2fr]">
      <MenuPanel menus={menus} onAddToCart={addToCart} />
      <CartPanel
        cart={cart}
        customerName={customerName}
        tableNo={tableNo}
        saving={saving}
        menus={menus}
        onUpdateItem={updateCartItem}
        onRemoveItem={removeCartItem}
        onClear={clearCart}
        onSubmit={handleSubmit}
        onCustomerName={setCustomerName}
        onTableNo={setTableNo}
      />
    </div>

    {/* Mobile portrait: menu full-width + sticky bottom drawer */}
    <div className="md:hidden">
      <MenuPanel menus={menus} onAddToCart={addToCart} />

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-clay-soft bg-paper px-4 py-3 shadow-[0_-2px_8px_rgb(26_20_17/_0.08)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-clay">
              Cart ({cart.length})
            </p>
            <p className="font-display text-lg text-coal">
              {cartTotal > 0 ? `Rp ${(cartTotal / 1000).toFixed(0)}rb` : 'kosong'}
            </p>
          </div>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button disabled={cart.length === 0 && customerName === '' && tableNo === ''}>
                ▲ Buka
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[90vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Cart</SheetTitle>
              </SheetHeader>
              <div className="mt-4">
                <CartPanel
                  cart={cart}
                  customerName={customerName}
                  tableNo={tableNo}
                  saving={saving}
                  menus={menus}
                  onUpdateItem={updateCartItem}
                  onRemoveItem={removeCartItem}
                  onClear={clearCart}
                  onSubmit={() => {
                    setSheetOpen(false);
                    handleSubmit();
                  }}
                  onCustomerName={setCustomerName}
                  onTableNo={setTableNo}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Bottom padding to avoid drawer overlapping menu list */}
      <div className="h-20" />
    </div>
  </>
);
```

- [ ] **Step 3: Verify build**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/pos/pos-client.tsx
git commit -m "feat(pos): mobile responsive — Sheet drawer untuk cart"
```

---

## Task 7: Home tile — add POS entry point

**Files:**
- Modify: `components/home-tiles.tsx`

- [ ] **Step 1: Inspect existing HomeTiles**

Run: `cat components/home-tiles.tsx`

Note the existing tile structure. Pattern likely uses Link + Card.

- [ ] **Step 2: Add POS tile**

Open `components/home-tiles.tsx`. Add POS tile in the same style as existing tiles (Scan, History, Reports, Menu). Place it as second tile (after Scan) since both are entry points for input order.

Find the JSX block that renders tile array. Insert (adapt structure to match existing pattern):

```tsx
<Link
  href="/pos"
  className="..."  // same className as other tiles
>
  <span className="text-2xl">📋</span>
  <span className="...">POS</span>
  <span className="...">Input order direct</span>
</Link>
```

(The exact classes and structure must match what already exists in `home-tiles.tsx` — adapt to that file's pattern. If existing tiles are in an array, add a new entry; if hand-written each, insert a new `<Link>` block following the same JSX shape.)

- [ ] **Step 3: Verify build + dev render**

Run: `npm run lint && npm run test && npm run build`

Expected: PASS.

Optional: `npm run dev`, buka Home, lihat tile baru muncul.

- [ ] **Step 4: Commit**

```bash
git add components/home-tiles.tsx
git commit -m "feat(home): add POS tile next to Scan"
```

---

## Task 8: Update main spec + tasks.md + final smoke

**Files:**
- Modify: `docs/superpowers/specs/2026-06-20-pak-pon-design.md`
- Modify: `docs/tasks.md`

- [ ] **Step 1: Update main spec Section 16**

Open `docs/superpowers/specs/2026-06-20-pak-pon-design.md`. Find Section 16 (Open implementation details). Tambah bullet:

```
- **POS direct order**: route `/pos` jadi entry point utama untuk input order tanpa nota fisik. /scan tetap dipakai untuk nota fisik atau saat warung sepi. Lihat `2026-06-21-pos-direct-order-design.md`.
```

- [ ] **Step 2: Update main spec Section 14**

Append bullet di Section 14 "Conventions":

```
- **Direct order endpoint**: `POST /api/transactions` dengan header `X-Idempotency-Key` (UUID) — tx tersimpan langsung status='confirmed', `scan_image_path=NULL`. /scan flow tetap pakai pending_review.
```

- [ ] **Step 3: Update `docs/tasks.md`**

Open `docs/tasks.md`. Find the backlog item "POS direct order (Plan B)" under "### 🍽️ POS / Order entry". Mark as done dengan link ke spec/plan.

Tambah Plan 6 section di atas backlog list:

```
## Plan 6 — POS Direct Order (Plan B of POS feature) ✅ COMPLETE
- [x] Migration 0005 — transactions.idempotency_key
- [x] Shared Zod schema + POST /api/transactions endpoint (TDD)
- [x] shadcn Sheet + /pos page shell + client orchestrator (localStorage + idempotency)
- [x] Menu panel — tabs + search + expand/collapse + chip picker integration
- [x] Cart panel — items + customer + total + Selesai + clear
- [x] Mobile responsive — Sheet drawer untuk cart
- [x] Home tile — POS entry point
- [x] Main spec Section 14 + 16 conventions updated

Spec: `docs/superpowers/specs/2026-06-21-pos-direct-order-design.md`
```

- [ ] **Step 4: Final verification**

Run: `npm run lint && npm run test && npm run build`

Expected: ALL PASS.

Manual smoke checklist (controller browser-test):
- Buka `/pos` di tablet landscape (lebar ≥ md breakpoint) → split view
- Tap menu tanpa chip (Pecel Lele) → langsung ke cart qty=1
- Tap menu dengan chip (Ayam Goreng) → row expand → pick Dada → qty 1 → Tambah → 1 cart entry
- Tap Ayam Goreng lagi → qty=2 → per-porsi cards → porsi 1 Dada, porsi 2 Paha → Tambah → 2 cart entries
- Tap Edit di salah satu cart item → modal NotaItemModal buka → ubah → save → cart updated
- Hapus 1 cart item → inline confirm → ya → removed
- Customer name "Pak Budi" + meja "5"
- Refresh browser → localStorage restore (cart + customer + meja kembali)
- Tap Selesai → POST → redirect ke `/transactions/[id]` detail → tampil chips dan total benar
- Tap Selesai lagi (same idempotency key dalam session sama) → kalau tab masih sama, idempotency belum di-rotate. Verify via DevTools network: second click sebelum redirect tidak terjadi (button disabled), tapi kalau retry setelah error 5xx, harus dedup.
- Mobile portrait (width < md): menu full + sticky bottom drawer → tap Buka → Sheet expand → input cart info → Selesai

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-20-pak-pon-design.md docs/tasks.md
git commit -m "docs: Plan 6 POS direct order complete + main spec conventions"
```

---

## Self-Review

### Spec coverage

- §4 Route & dependency → Task 3 (server page + orchestrator skeleton)
- §5 Data flow & state → Task 3 (state shape + localStorage)
- §5.4 Idempotency → Task 2 (server check) + Task 3 (client generate + header)
- §6 API → Task 2 (POST endpoint + Zod + mutex)
- §7 Schema migration → Task 1
- §8 Menu panel UI → Task 4 (panel + row)
- §9 Cart panel UI → Task 5 (panel + item row)
- §10 Mobile responsive → Task 6 (Sheet drawer)
- §11 Home tile → Task 7
- §12 Edge cases → covered across Tasks 2 (idempotency), 3 (localStorage stale check), 8 (smoke validates)
- §13 Component file org → matches Task list
- §14 Testing → Task 2 unit tests; Task 8 smoke checklist
- §15 Performance — no specific task needed (acceptable defaults)
- §16 Out of scope → enforced by exclusion
- §17 Update docs → Task 8

✅ Full coverage.

### Placeholder scan

- No "TBD" / "TODO" found
- All steps have code blocks or exact commands
- One place worth noting: Task 7 Step 2 says "adapt structure to match existing pattern" — that's because `home-tiles.tsx` was extended in earlier session and exact structure depends on what's there. Acceptable: implementer reads file before edit.

### Type consistency

- `PosMenu`, `CartItem` defined in Task 3 (`pos-client.tsx`), used in Tasks 4, 5, 6 — consistent
- `NotePreset`, `NotePresetSnapshot`, `PorsiSelection`, `mergeItemsByPresets` — from Plan A, imported in Tasks 2, 4, 5 — consistent
- `MenuOption` (from Plan A `nota-item-modal.tsx`) used in Task 5 cart-item-row — consistent
- `NotaItem` (from Plan A `nota-item-row.tsx`) used in Task 5 modal initial value — consistent
- `addToCart`, `updateCartItem`, `removeCartItem`, `clearCart`, `handleSubmit` callbacks declared in Task 3, consumed in Tasks 4, 5 — consistent
- `Omit<CartItem, 'cart_id'>` payload shape — consistent across handoffs

✅ Type names + signatures align.
