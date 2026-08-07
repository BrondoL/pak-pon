# Tambah Item Langsung dari Card Monitor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dari card di `/monitor`, kasir bisa menambah beberapa item sekaligus lewat satu modal, simpan sekali, dan tiket dapur untuk item baru langsung tercetak.

**Architecture:** Endpoint baru **append-only** `POST /api/transactions/[id]/items` yang hanya `INSERT` (tidak pernah delete/replace seperti `PATCH`), sehingga `printed_*_at` item lama utuh dan tidak ada read-modify-write race antar device. Di sisi UI, modal baru `MonitorAddItemModal` memakai ulang `PosMenuPicker` + `PosItemConfigModal` apa adanya; `menus` & `printerSettings` dikirim dari server component `monitor/page.tsx` supaya modal terbuka tanpa fetch.

**Tech Stack:** Next.js 16 (App Router, route handler `params: Promise<{id}>`), React 19 client components, Supabase JS, Zod, Vitest, Tailwind + shadcn-fork (base-ui) di `components/ui/`.

**Spec:** `docs/superpowers/specs/2026-08-07-monitor-add-item-design.md`

## Global Constraints

- Money = `bigint` rupiah tanpa sen. Format display **selalu** lewat `formatRp()` dari `lib/currency.ts`.
- Semua API route boundary divalidasi **Zod**.
- Semua route handler pakai wide-event logging: `newEvent()` di awal, `try/catch/finally`, `evt.emit()` di `finally`, `tagStatus(evt, status)` sebelum tiap return. Lihat `docs/logging.md`.
- Harga **tidak pernah** diterima dari client. Client kirim `chip_labels: string[]`; server hitung `unit_price_snapshot` dari master `menus.price` + `menu_chips.price_delta`.
- UI: cek `components/ui/` dulu sebelum bikin komponen sendiri. **Dilarang** `window.confirm` / `alert` / `prompt`.
- Styling lewat design tokens yang sudah ada (`coal`, `clay`, `paper`, `cream`, `gold`, dst di `app/globals.css @theme`) — jangan hardcode warna hex.
- Next.js 16: kalau ragu soal signature route handler / dynamic API, baca `node_modules/next/dist/docs/01-app/` dulu.
- Bahasa UI: Bahasa Indonesia informal, konsisten dengan halaman lain.
- Perintah test: `npm run test` (Vitest sekali jalan). Lint: `npm run lint`.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `lib/transactions.ts` (modify) | + `buildAppendItemRows()` — fungsi murni, hitung snapshot nama/harga/sort_order untuk item yang di-append |
| `lib/transactions.test.ts` (modify) | + test untuk helper di atas |
| `app/api/transactions/[id]/items/route.ts` (create) | Route handler `POST` append-only: auth → validasi → snapshot chip server-side → INSERT |
| `app/(app)/monitor/page.tsx` (modify) | Fetch `menus` (+ chips) & `printerSettings`, teruskan ke `MonitorBoard` |
| `components/monitor-board.tsx` (modify) | Terima props baru, tombol `+ Item` per card, state modal |
| `components/monitor-add-item-modal.tsx` (create) | Modal tambah item: picker + daftar draft + simpan + dispatch print |
| `lib/print-dispatch.ts` (modify) | + `splitItemsByPrintTarget()` — routing item ke printer dapur/minuman, diangkat dari `pos-client` supaya tidak ada dua salinan |
| `lib/print-dispatch.test.ts` (create) | Test untuk helper routing di atas |
| `components/pos/pos-client.tsx` (modify) | Pakai helper bersama, hapus `splitByTarget` lokal (tanpa perubahan perilaku) |

**Dipakai ulang tanpa diubah:** `components/pos/pos-menu-picker.tsx`, `components/pos/pos-item-config-modal.tsx`, `components/chip-picker.tsx`, `lib/menu-chips.ts`.

---

## Task 1: Helper murni `buildAppendItemRows`

**Files:**
- Modify: `lib/transactions.ts` (tambah di bawah `computeReplaceItems`, sebelum `mapTransactionSource`)
- Test: `lib/transactions.test.ts`

**Interfaces:**
- Consumes: `MenuRef`, `ItemRow`, `AppliedChip` — sudah ada di `lib/transactions.ts` / `lib/menu-chips.ts`
- Produces:
  ```ts
  export type AppendItemRequest = {
    menu_id: string;
    qty: number;
    notes: string | null;
    applied_chips: AppliedChip[];
  };

  export function buildAppendItemRows(input: {
    requested: AppendItemRequest[];
    menus: MenuRef[];
    startSortOrder: number;
  }): ItemRow[]
  ```
  Task 2 memanggil ini lalu meneruskan hasilnya ke `buildItemInsertRows(rows, txId)` yang sudah ada.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `lib/transactions.test.ts`. Import di baris atas file diperluas jadi:

```ts
import { buildItemInsertRows, computeReplaceItems, mapTransactionSource, buildScanImagePurge, buildAppendItemRows, type ExistingItem, type ItemRow, type RequestedItem, type MenuRef, type AppendItemRequest } from './transactions';
```

Lalu di akhir file:

```ts
describe('buildAppendItemRows', () => {
  const appendMenus: MenuRef[] = [
    { id: 'menu-pecel', name: 'Pecel Lele', price: 16000 },
    { id: 'menu-teh',   name: 'Es Teh',     price: 5000 },
  ];

  it('assigns sequential sort_order starting from startSortOrder', () => {
    const requested: AppendItemRequest[] = [
      { menu_id: 'menu-pecel', qty: 1, notes: null, applied_chips: [] },
      { menu_id: 'menu-teh',   qty: 2, notes: null, applied_chips: [] },
    ];
    const rows = buildAppendItemRows({ requested, menus: appendMenus, startSortOrder: 5 });
    expect(rows.map((r) => r.sort_order)).toEqual([5, 6]);
  });

  it('snapshots menu name and price when no chips', () => {
    const requested: AppendItemRequest[] = [
      { menu_id: 'menu-pecel', qty: 3, notes: 'pedas', applied_chips: [] },
    ];
    const [row] = buildAppendItemRows({ requested, menus: appendMenus, startSortOrder: 0 });
    expect(row.menu_name_snapshot).toBe('Pecel Lele');
    expect(row.unit_price_snapshot).toBe(16000);
    expect(row.applied_chips).toEqual([]);
    expect(row.qty).toBe(3);
    expect(row.notes).toBe('pedas');
  });

  it('adds chip price_delta sum to unit_price_snapshot', () => {
    const requested: AppendItemRequest[] = [
      {
        menu_id: 'menu-teh',
        qty: 1,
        notes: null,
        applied_chips: [
          { label: 'Panas', price_delta: 0 },
          { label: 'Jumbo', price_delta: 3000 },
        ],
      },
    ];
    const [row] = buildAppendItemRows({ requested, menus: appendMenus, startSortOrder: 0 });
    expect(row.unit_price_snapshot).toBe(8000);
    expect(row.applied_chips).toEqual([
      { label: 'Panas', price_delta: 0 },
      { label: 'Jumbo', price_delta: 3000 },
    ]);
  });

  it('starts print-tracking flags at null and omits id', () => {
    const requested: AppendItemRequest[] = [
      { menu_id: 'menu-pecel', qty: 1, notes: null, applied_chips: [] },
    ];
    const [row] = buildAppendItemRows({ requested, menus: appendMenus, startSortOrder: 0 });
    expect(row.printed_dapur_at).toBeNull();
    expect(row.printed_minuman_at).toBeNull();
    expect(row.confidence).toBeNull();
    expect(row.id).toBeUndefined();
  });

  it('throws on unknown menu_id', () => {
    const requested: AppendItemRequest[] = [
      { menu_id: 'menu-hantu', qty: 1, notes: null, applied_chips: [] },
    ];
    expect(() => buildAppendItemRows({ requested, menus: appendMenus, startSortOrder: 0 }))
      .toThrow('Unknown menu_id: menu-hantu');
  });

  it('returns rows that buildItemInsertRows strips id from', () => {
    const rows = buildAppendItemRows({
      requested: [{ menu_id: 'menu-pecel', qty: 1, notes: null, applied_chips: [] }],
      menus: appendMenus,
      startSortOrder: 0,
    });
    const insertRows = buildItemInsertRows(rows, 'tx-1');
    expect(insertRows[0]).not.toHaveProperty('id');
    expect(insertRows[0].transaction_id).toBe('tx-1');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test -- lib/transactions.test.ts`
Expected: FAIL — `buildAppendItemRows is not a function` / error import `AppendItemRequest`.

- [ ] **Step 3: Implementasi minimal**

Di `lib/transactions.ts`, sisipkan setelah `computeReplaceItems` (setelah baris `}` penutupnya, sebelum komentar `mapTransactionSource`):

```ts
export type AppendItemRequest = {
  menu_id: string;
  qty: number;
  notes: string | null;
  applied_chips: AppliedChip[];
};

/**
 * Hitung baris insert untuk "tambah item ke transaksi yang sudah jalan".
 *
 * Beda dari computeReplaceItems: tidak ada existing item yang perlu dicocokkan
 * — semuanya baru. Harga selalu di-snapshot dari master menu sekarang + total
 * price_delta chip. `id` sengaja tidak diisi supaya Postgres generate sendiri,
 * dan printed_*_at mulai null supaya tiket dapur untuk item ini belum dianggap
 * tercetak.
 *
 * `startSortOrder` = sort_order tertinggi yang sudah ada di transaksi + 1,
 * supaya item baru selalu muncul di urutan paling bawah nota.
 *
 * Throw kalau ada menu_id yang tidak ada di `menus`.
 */
export function buildAppendItemRows(input: {
  requested: AppendItemRequest[];
  menus: MenuRef[];
  startSortOrder: number;
}): ItemRow[] {
  const menuById = new Map(input.menus.map((m) => [m.id, m]));

  return input.requested.map((req, idx) => {
    const menu = menuById.get(req.menu_id);
    if (!menu) {
      throw new Error(`Unknown menu_id: ${req.menu_id}`);
    }
    const chipDeltaSum = req.applied_chips.reduce((s, c) => s + c.price_delta, 0);

    return {
      menu_id: menu.id,
      menu_name_snapshot: menu.name,
      unit_price_snapshot: menu.price + chipDeltaSum,
      qty: req.qty,
      notes: req.notes,
      applied_chips: req.applied_chips,
      sort_order: input.startSortOrder + idx,
      confidence: null,
      printed_dapur_at: null,
      printed_minuman_at: null,
    };
  });
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm run test -- lib/transactions.test.ts`
Expected: PASS, semua test lama juga tetap hijau.

- [ ] **Step 5: Commit**

```bash
git add lib/transactions.ts lib/transactions.test.ts
git commit -m "feat(monitor): helper buildAppendItemRows untuk append item ke transaksi"
```

---

## Task 2: Endpoint `POST /api/transactions/[id]/items`

**Files:**
- Create: `app/api/transactions/[id]/items/route.ts`

**Interfaces:**
- Consumes: `buildAppendItemRows`, `buildItemInsertRows`, `MenuRef`, `AppendItemRequest` dari Task 1; `fetchChipsByMenu`, `validateChipMutex`, `buildAppliedChipsSnapshot` dari `lib/menu-chips.ts`; `newEvent`, `tagStatus` dari `lib/logger.ts`; `getSupabaseServer` dari `lib/supabase/server.ts`.
- Produces — kontrak HTTP yang dipakai Task 4:
  - Request body: `{ items: Array<{ menu_id: string; qty: number; chip_labels?: string[]; notes?: string | null }> }`
  - `201` → `{ transaction: { id, daily_seq, created_at, customer_name, table_no, is_takeaway }, items: Array<{ id, sort_order, ...kolom transaction_items }> }`
  - `400` `{ error: 'invalid_body' | 'unknown_menu_id' | 'chip_mutex_violation' | 'unknown_chip_label' }`
  - `401` `{ error: 'unauthorized' }`
  - `404` `{ error: 'not_found' }`
  - `409` `{ error: 'not_confirmed' }`
  - `500` `{ error: string }`

- [ ] **Step 1: Buat file route lengkap**

Buat `app/api/transactions/[id]/items/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import {
  buildAppendItemRows,
  buildItemInsertRows,
  type AppendItemRequest,
  type MenuRef,
} from '@/lib/transactions';
import {
  buildAppliedChipsSnapshot,
  validateChipMutex,
  fetchChipsByMenu,
} from '@/lib/menu-chips';

const NOT_FOUND_CODE = 'PGRST116';

const AppendItemsSchema = z
  .object({
    items: z
      .array(
        z.object({
          menu_id: z.string().uuid(),
          qty: z.number().int().positive().max(99),
          chip_labels: z.array(z.string().min(1).max(40)).max(20).default([]),
          notes: z.string().max(200).nullable().default(null),
        }),
      )
      .min(1)
      .max(50),
  })
  .strict();

/**
 * Append-only: tambah item ke transaksi confirmed yang sudah jalan.
 *
 * Sengaja BUKAN PATCH /api/transactions/[id] — route itu delete-all + insert
 * ulang seluruh item, jadi client harus mengirim balik daftar item lama yang
 * bisa saja sudah basi (device lain menambah item di sela GET→PATCH → item itu
 * terhapus). Di sini server cuma INSERT: baris lama tidak pernah tersentuh,
 * printed_dapur_at/printed_minuman_at-nya utuh, tiket dapur mustahil dobel.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const evt = newEvent('POST /api/transactions/[id]/items');
  const startedAt = Date.now();
  try {
    const { id } = await params;
    evt.set('tx_id', id);

    const supabase = await getSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = AppendItemsSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_body', zod_issues: parsed.error.issues });
      return NextResponse.json(
        { error: 'invalid_body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const payload = parsed.data;

    // 1. Transaksi harus ada & belum dihapus.
    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .select('id, status, daily_seq, created_at, customer_name, table_no, is_takeaway')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (txErr) {
      if (txErr.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        evt.set('reject_reason', 'not_found');
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(txErr);
      return NextResponse.json({ error: txErr.message }, { status: 500 });
    }

    // 2. Monitor cuma menampilkan confirmed. 409 menangkap transaksi yang
    //    keburu berubah status dari device lain saat modal terbuka.
    if (tx.status !== 'confirmed') {
      tagStatus(evt, 409);
      evt.merge({ reject_reason: 'not_confirmed', tx_status: tx.status });
      return NextResponse.json({ error: 'not_confirmed' }, { status: 409 });
    }

    // 3. Master menu untuk menu_id yang dikirim saja.
    const menuIds = Array.from(new Set(payload.items.map((i) => i.menu_id)));
    const { data: menusData, error: menusErr } = await supabase
      .from('menus')
      .select('id, name, price')
      .in('id', menuIds);
    if (menusErr) {
      tagStatus(evt, 500);
      evt.error(menusErr);
      return NextResponse.json({ error: menusErr.message }, { status: 500 });
    }
    const menus = (menusData ?? []) as MenuRef[];
    const menuById = new Map(menus.map((m) => [m.id, m]));
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

    // 4. Chip master → snapshot server-side (client cuma kirim label).
    let chipsByMenu;
    try {
      chipsByMenu = await fetchChipsByMenu(supabase, menuIds);
    } catch (err) {
      tagStatus(evt, 500);
      evt.error(err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'chip_fetch_failed' },
        { status: 500 },
      );
    }

    const requested: AppendItemRequest[] = [];
    let totalChipCount = 0;
    let hasFreeNotes = false;
    for (const [idx, item] of payload.items.entries()) {
      const availableChips = chipsByMenu.get(item.menu_id) ?? [];
      try {
        validateChipMutex(item.chip_labels, availableChips);
      } catch (err) {
        tagStatus(evt, 400);
        evt.merge({ reject_reason: 'chip_mutex_violation', item_index: idx });
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
        evt.merge({ reject_reason: 'unknown_chip_label', item_index: idx });
        return NextResponse.json(
          { error: 'unknown_chip_label', details: err instanceof Error ? err.message : 'unknown' },
          { status: 400 },
        );
      }
      totalChipCount += applied.length;
      if (item.notes && item.notes.trim().length > 0) hasFreeNotes = true;
      requested.push({
        menu_id: item.menu_id,
        qty: item.qty,
        notes: item.notes,
        applied_chips: applied,
      });
    }

    // 5. sort_order lanjut dari item terakhir supaya item baru di urutan bawah.
    const { data: lastItem, error: lastErr } = await supabase
      .from('transaction_items')
      .select('sort_order')
      .eq('transaction_id', id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastErr) {
      tagStatus(evt, 500);
      evt.error(lastErr);
      return NextResponse.json({ error: lastErr.message }, { status: 500 });
    }
    const startSortOrder = lastItem ? (lastItem.sort_order as number) + 1 : 0;

    // 6. Insert. buildItemInsertRows membuang key `id` yang undefined —
    //    kalau di-spread mentah, Supabase serialize jadi null → kena NOT NULL.
    const rows = buildAppendItemRows({ requested, menus, startSortOrder });
    const insertRows = buildItemInsertRows(rows, id);
    const { data: itemsCreated, error: itemsErr } = await supabase
      .from('transaction_items')
      .insert(insertRows, { defaultToNull: false })
      .select();
    if (itemsErr) {
      tagStatus(evt, 500);
      evt.error(itemsErr);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    evt.merge({
      item_count: rows.length,
      chip_count: totalChipCount,
      has_free_notes: hasFreeNotes,
      added_amount: rows.reduce((s, r) => s + r.unit_price_snapshot * r.qty, 0),
      start_sort_order: startSortOrder,
      elapsed_ms: Date.now() - startedAt,
    });
    tagStatus(evt, 201);
    return NextResponse.json({ transaction: tx, items: itemsCreated ?? [] }, { status: 201 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Cek lint & typecheck**

Run: `npm run lint`
Expected: tidak ada error di file baru.

Run: `npx tsc --noEmit`
Expected: tidak ada error baru. (Kalau `tsc` tidak dikonfigurasi standalone, `npm run build` juga cukup — lebih lambat.)

- [ ] **Step 3: Smoke test manual endpoint**

Jalankan `npm run dev`, login di browser supaya ada cookie sesi, lalu dari DevTools Console halaman app:

```js
// ganti <TX_ID> dengan id transaksi confirmed, <MENU_ID> dengan id menu aktif
await fetch('/api/transactions/<TX_ID>/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [{ menu_id: '<MENU_ID>', qty: 2 }] }),
}).then((r) => r.json().then((j) => ({ status: r.status, j })));
```

Expected: `status: 201`, `j.items` berisi 1 baris dengan `id` terisi, `printed_dapur_at: null`, `sort_order` lebih besar dari item terakhir. Cek di `/transactions/<TX_ID>` bahwa item lama masih utuh dan item baru muncul di bawah.

Cek juga jalur error: kirim `menu_id` acak → `400 unknown_menu_id`; kirim `id` transaksi yang tidak ada → `404`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/transactions/[id]/items/route.ts"
git commit -m "feat(api): endpoint append-only POST /api/transactions/[id]/items"
```

---

## Task 3: Plumbing halaman monitor + tombol `+ Item`

**Files:**
- Modify: `app/(app)/monitor/page.tsx`
- Modify: `components/monitor-board.tsx`
- Create: `components/monitor-add-item-modal.tsx` (versi draft-only; simpan & cetak menyusul di Task 4)

**Interfaces:**
- Consumes: `MonitorRow` (`lib/monitor.ts`), `MenuOption` (`components/nota-item-modal.tsx`), `PrinterSettings` (`lib/printer-settings.ts`), `PosMenuPicker`, `PosItemConfigModal` + `PosCartItemDraft`.
- Produces:
  ```ts
  // components/monitor-add-item-modal.tsx
  export function MonitorAddItemModal(props: {
    row: MonitorRow;
    menus: MenuOption[];
    printerSettings: PrinterSettings;
    onClose: () => void;
    onSaved: () => void;
  }): JSX.Element

  // components/monitor-board.tsx
  export function MonitorBoard(props: {
    initialRows: MonitorRow[];
    menus: MenuOption[];
    printerSettings: PrinterSettings;
  }): JSX.Element
  ```
  Task 4 mengisi `handleSave` di dalam `MonitorAddItemModal`; signature props tidak berubah.

- [ ] **Step 1: Kirim `menus` + `printerSettings` dari server component**

Ganti isi `app/(app)/monitor/page.tsx` menjadi:

```tsx
// app/(app)/monitor/page.tsx
import { getSupabaseServer } from '@/lib/supabase/server';
import { fetchUnpaidRows } from '@/lib/monitor-server';
import { getPrinterSettings } from '@/lib/printer-settings-server';
import { MonitorBoard } from '@/components/monitor-board';
import type { MenuOption } from '@/components/nota-item-modal';

export const dynamic = 'force-dynamic';

type MenuRow = {
  id: string;
  name: string;
  category: MenuOption['category'];
  price: number;
  sort_order: number;
  chips: MenuOption['chips'] | null;
};

export default async function MonitorPage() {
  const supabase = await getSupabaseServer();

  // menus + printerSettings ikut dirender di server supaya modal "Tambah Item"
  // terbuka instan — tanpa fetch apa pun saat kasir menekan tombolnya.
  const [rows, { data: menusRaw }, printerSettings] = await Promise.all([
    fetchUnpaidRows(supabase),
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
    getPrinterSettings(),
  ]);

  const menus: MenuOption[] = ((menusRaw ?? []) as MenuRow[]).map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    price: m.price,
    chips: [...(m.chips ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Monitor
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Meja <span className="italic">belum bayar</span>
        </h1>
        <p className="mt-2 text-sm text-coal-soft">
          Diperbarui otomatis tiap 15 detik. Tandai lunas saat meja sudah bayar.
        </p>
      </div>

      <MonitorBoard initialRows={rows} menus={menus} printerSettings={printerSettings} />
    </div>
  );
}
```

- [ ] **Step 2: Buat modal versi draft-only**

Buat `components/monitor-add-item-modal.tsx`:

```tsx
// components/monitor-add-item-modal.tsx
'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';
import { PosMenuPicker } from '@/components/pos/pos-menu-picker';
import { PosItemConfigModal, type PosCartItemDraft } from '@/components/pos/pos-item-config-modal';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';
import type { MonitorRow } from '@/lib/monitor';

type DraftRow = PosCartItemDraft & { _localId: string };

function titleFor(row: MonitorRow): string {
  if (row.table_no) return `Tambah Item · Meja ${row.table_no}`;
  if (row.customer_name) return `Tambah Item · ${row.customer_name}`;
  return 'Tambah Item';
}

export function MonitorAddItemModal({
  row,
  menus,
  printerSettings,
  onClose,
  onSaved,
}: {
  row: MonitorRow;
  menus: MenuOption[];
  printerSettings: PrinterSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [pickingMenu, setPickingMenu] = useState<MenuOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Sync guard: setSubmitting async, tap kedua yang cepat bisa masuk handleSave
  // sebelum React commit state-nya.
  const submitLock = useRef(false);

  const totalAmount = draft.reduce((s, it) => s + it.unit_price_snapshot * it.qty, 0);

  /**
   * Tap kartu menu = "+1", bukan buka modal konfigurasi. Ini poin utama fitur:
   * 2 es teh = 2 tap. Baris yang sudah punya chip/catatan sengaja TIDAK ikut
   * naik qty — tap menu polos bikin baris baru supaya konfigurasi kasir tidak
   * diam-diam tertimpa.
   */
  function handleMenuTap(menu: MenuOption) {
    setDraft((prev) => {
      const idx = prev.findIndex(
        (d) => d.menu_id === menu.id && d.applied_chips.length === 0 && d.notes === null,
      );
      if (idx === -1) {
        return [
          ...prev,
          {
            _localId: crypto.randomUUID(),
            menu_id: menu.id,
            menu_name_snapshot: menu.name,
            category: menu.category,
            unit_price_snapshot: menu.price,
            qty: 1,
            notes: null,
            applied_chips: [],
          },
        ];
      }
      return prev.map((d, i) => (i === idx ? { ...d, qty: Math.min(99, d.qty + 1) } : d));
    });
  }

  function handleQtyChange(idx: number, nextQty: number) {
    setDraft((prev) => prev.map((d, i) => (i === idx ? { ...d, qty: nextQty } : d)));
  }

  function handleDelete(idx: number) {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleEdit(idx: number) {
    const menu = menus.find((m) => m.id === draft[idx].menu_id);
    if (!menu) return;
    setEditingIdx(idx);
    setPickingMenu(menu);
  }

  function handleConfigSave(item: PosCartItemDraft) {
    if (editingIdx !== null) {
      setDraft((prev) =>
        prev.map((d, i) => (i === editingIdx ? { ...item, _localId: d._localId } : d)),
      );
    }
    setEditingIdx(null);
    setPickingMenu(null);
  }

  async function handleSave() {
    // Diisi di Task 4.
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
        <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{titleFor(row)}</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            <PosMenuPicker menus={menus} onMenuTap={handleMenuTap} />
          </div>

          <div className="shrink-0 border-t border-clay-soft/60 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-clay">
              Item baru
            </p>

            {draft.length === 0 ? (
              <p className="py-4 text-center text-sm text-clay">
                Tap menu di atas untuk menambah item.
              </p>
            ) : (
              <ul className="max-h-52 divide-y divide-clay-soft/60 overflow-y-auto">
                {draft.map((it, idx) => (
                  <li key={it._localId} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-coal">{it.menu_name_snapshot}</div>
                      {it.applied_chips.length > 0 && (
                        <p className="truncate text-xs text-clay">
                          {it.applied_chips.map((c) => c.label).join(', ')}
                        </p>
                      )}
                      {it.notes && (
                        <p className="truncate text-xs italic text-clay-soft">{it.notes}</p>
                      )}
                    </div>

                    <div className="inline-flex shrink-0 items-center rounded-lg border border-clay-soft/60 bg-paper">
                      <Button
                        size="icon" variant="ghost"
                        onClick={() => handleQtyChange(idx, Math.max(1, it.qty - 1))}
                        disabled={it.qty <= 1}
                        aria-label={`Kurangi jumlah ${it.menu_name_snapshot}`}
                        className="rounded-r-none text-lg leading-none"
                      >
                        −
                      </Button>
                      <span
                        className="min-w-8 px-1 text-center text-sm font-semibold tabular-nums text-coal"
                        aria-live="polite"
                      >
                        {it.qty}
                      </span>
                      <Button
                        size="icon" variant="ghost"
                        onClick={() => handleQtyChange(idx, Math.min(99, it.qty + 1))}
                        disabled={it.qty >= 99}
                        aria-label={`Tambah jumlah ${it.menu_name_snapshot}`}
                        className="rounded-l-none text-lg leading-none"
                      >
                        +
                      </Button>
                    </div>

                    <span className="w-24 shrink-0 text-right font-display text-base tracking-tight tabular-nums text-coal">
                      {formatRp(it.unit_price_snapshot * it.qty)}
                    </span>

                    <Button size="icon" variant="ghost" onClick={() => handleEdit(idx)} aria-label={`Ubah ${it.menu_name_snapshot}`}>
                      ✏️
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(idx)} aria-label={`Hapus ${it.menu_name_snapshot}`}>
                      🗑️
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex gap-2 pb-[max(0px,env(safe-area-inset-bottom))]">
              <Button variant="secondary" onClick={onClose} disabled={submitting}>
                Batal
              </Button>
              <Button onClick={handleSave} disabled={submitting || draft.length === 0} className="flex-1">
                {submitting ? 'Menyimpan…' : `✓ Simpan & Cetak ${draft.length > 0 ? formatRp(totalAmount) : ''}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {pickingMenu && (
        <PosItemConfigModal
          menu={pickingMenu}
          initial={editingIdx !== null ? draft[editingIdx] : undefined}
          onSave={handleConfigSave}
          onClose={() => { setPickingMenu(null); setEditingIdx(null); }}
        />
      )}
    </>
  );
}
```

> **Catatan `printerSettings`:** prop-nya belum dipakai di step ini — baru dipakai Task 4 untuk render tiket. ESLint mungkin mengeluh unused; kalau iya, biarkan sampai Task 4 mengisinya (jangan hapus prop-nya).

- [ ] **Step 3: Tombol `+ Item` di card + state modal**

Di `components/monitor-board.tsx`:

1. Tambah import di atas:

```tsx
import { MonitorAddItemModal } from '@/components/monitor-add-item-modal';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';
```

2. Ganti signature komponen:

```tsx
export function MonitorBoard({
  initialRows,
  menus,
  printerSettings,
}: {
  initialRows: MonitorRow[];
  menus: MenuOption[];
  printerSettings: PrinterSettings;
}) {
```

3. Tambah state di samping `detailId`:

```tsx
  const [addingRow, setAddingRow] = useState<MonitorRow | null>(null);
```

4. Ganti blok `<AlertDialog>…</AlertDialog>` di dalam `<Card>` (baris ~169-188) dengan versi dua tombol:

```tsx
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setAddingRow(row)}
                >
                  + Item
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger render={<Button className="flex-1" />}>
                    Lunas
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Tandai {row.table_no ? `Meja ${row.table_no}` : 'transaksi ini'} lunas?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {row.customer_name ? `${row.customer_name} · ` : ''}
                        {formatRp(row.total)}. Transaksi akan hilang dari monitor. Batalkan lewat detail transaksi di History.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Batal</AlertDialogCancel>
                      <AlertDialogAction onClick={() => markPaid(row)}>Ya, lunas</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
```

5. Render modal di bawah `<MonitorDetailModal … />`:

```tsx
      {addingRow && (
        <MonitorAddItemModal
          row={addingRow}
          menus={menus}
          printerSettings={printerSettings}
          onClose={() => setAddingRow(null)}
          onSaved={() => { setAddingRow(null); void fetchRows(); }}
        />
      )}
```

- [ ] **Step 4: Verifikasi manual di browser**

Run: `npm run dev`, buka `/monitor` (butuh minimal 1 transaksi confirmed dine-in belum bayar hari ini — kalau tidak ada, buat lewat `/pos`).

Cek satu per satu:
1. Card menampilkan dua tombol sebaris: `+ Item` (sekunder) dan `Lunas` (utama).
2. Tap badan card → `MonitorDetailModal` read-only tetap terbuka seperti sebelumnya (tidak rusak).
3. Tap `+ Item` → modal terbuka **tanpa spinner/jeda**.
4. Tap satu menu → muncul di "Item baru" qty 1. Tap menu yang sama lagi → qty jadi 2 (bukan baris kedua).
5. Tap ✏️ pada satu baris → `PosItemConfigModal` terbuka di atasnya, pilih chip, Simpan → baris ter-update, harga ikut naik sesuai `price_delta`.
6. Setelah baris punya chip, tap menu yang sama dari grid → muncul **baris baru**, bukan menaikkan qty baris ber-chip.
7. 🗑️ menghapus baris. `Batal` menutup modal.
8. Tombol `✓ Simpan & Cetak` disabled saat daftar kosong (belum berfungsi — Task 4).
9. Di lebar HP (DevTools ~390px): grid menu yang scroll, blok "Item baru" + tombol tetap terlihat di bawah.

> **Risiko yang harus diperiksa di langkah 5:** `PosItemConfigModal` adalah `Dialog` kedua di atas `Dialog` monitor. Kalau fork base-ui di repo ini bermasalah dengan dialog bertumpuk (fokus terkunci di dialog bawah, atau dialog atas langsung tertutup), solusinya: tambahkan `open={pickingMenu === null}` pada `<Dialog>` induk supaya induk tersembunyi selama config modal terbuka, dan pastikan `onOpenChange` induk tidak memanggil `onClose()` saat tertutup karena sebab ini.

- [ ] **Step 5: Lint & commit**

```bash
npm run lint
git add "app/(app)/monitor/page.tsx" components/monitor-board.tsx components/monitor-add-item-modal.tsx
git commit -m "feat(monitor): tombol + Item di card & modal draft tambah item"
```

---

## Task 4: Simpan + dispatch tiket dapur

**Files:**
- Modify: `lib/print-dispatch.ts` (angkat `splitItemsByPrintTarget` jadi helper bersama)
- Create: `lib/print-dispatch.test.ts`
- Modify: `components/pos/pos-client.tsx` (pakai helper bersama, hapus salinan lokal)
- Modify: `components/monitor-add-item-modal.tsx` (isi `handleSave`)

**Interfaces:**
- Consumes: kontrak HTTP `POST /api/transactions/[id]/items` dari Task 2; `dispatchKitchenPrintJob` + `PrintTarget` dari `lib/print-dispatch.ts`; `toast` dari `sonner`.
- Produces:
  ```ts
  // lib/print-dispatch.ts
  export function splitItemsByPrintTarget<T extends { category: 'makanan' | 'nasi' | 'minuman' }>(
    items: T[],
  ): { dapur: T[]; minuman: T[] };
  ```

> **Kenapa diangkat:** `pos-client.tsx:24` sudah punya fungsi identik bernama `splitByTarget`. Menyalinnya ke modal monitor = duplikasi verbatim logika routing printer di dua tempat — kalau kategori baru ditambahkan nanti, satu tempat pasti terlupakan. Diangkat ke `lib/print-dispatch.ts` karena di situlah routing printer sudah tinggal.

- [ ] **Step 1: Tulis test yang gagal untuk helper bersama**

Buat `lib/print-dispatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitItemsByPrintTarget } from './print-dispatch';

describe('splitItemsByPrintTarget', () => {
  it('routes minuman to the drinks printer', () => {
    const result = splitItemsByPrintTarget([{ category: 'minuman' as const, name: 'Es Teh' }]);
    expect(result.minuman).toHaveLength(1);
    expect(result.dapur).toHaveLength(0);
  });

  it('routes makanan and nasi to the kitchen printer', () => {
    const result = splitItemsByPrintTarget([
      { category: 'makanan' as const, name: 'Pecel Lele' },
      { category: 'nasi' as const, name: 'Nasi Putih' },
    ]);
    expect(result.dapur.map((i) => i.name)).toEqual(['Pecel Lele', 'Nasi Putih']);
    expect(result.minuman).toHaveLength(0);
  });

  it('preserves input order within each target', () => {
    const result = splitItemsByPrintTarget([
      { category: 'minuman' as const, name: 'A' },
      { category: 'makanan' as const, name: 'B' },
      { category: 'minuman' as const, name: 'C' },
    ]);
    expect(result.minuman.map((i) => i.name)).toEqual(['A', 'C']);
    expect(result.dapur.map((i) => i.name)).toEqual(['B']);
  });

  it('returns empty buckets for empty input', () => {
    const result = splitItemsByPrintTarget([]);
    expect(result).toEqual({ dapur: [], minuman: [] });
  });
});
```

Run: `npm run test -- lib/print-dispatch.test.ts`
Expected: FAIL — `splitItemsByPrintTarget is not a function`.

- [ ] **Step 2: Angkat helper ke `lib/print-dispatch.ts`**

Tambahkan di `lib/print-dispatch.ts`, tepat di bawah deklarasi `export type PrintJobTx = {...}`:

```ts
/**
 * Routing item ke printer: minuman → printer minuman, makanan & nasi → dapur.
 *
 * Dipakai bersama oleh POS (`pos-client`) dan modal tambah item di monitor
 * (`monitor-add-item-modal`) — sengaja satu tempat supaya penambahan kategori
 * baru tidak perlu diingat di dua file.
 */
export function splitItemsByPrintTarget<
  T extends { category: 'makanan' | 'nasi' | 'minuman' },
>(items: T[]): { dapur: T[]; minuman: T[] } {
  const dapur: T[] = [];
  const minuman: T[] = [];
  for (const it of items) {
    if (it.category === 'minuman') minuman.push(it);
    else dapur.push(it);
  }
  return { dapur, minuman };
}
```

Run: `npm run test -- lib/print-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 3: Pakai helper bersama di `pos-client.tsx`**

Di `components/pos/pos-client.tsx`:

1. Hapus seluruh deklarasi lokal `function splitByTarget<T …>(cart: T[]) { … }` (baris 24-32).
2. Ubah import print-dispatch jadi:

```tsx
import { dispatchKitchenPrintJob, splitItemsByPrintTarget, type PrintTarget } from '@/lib/print-dispatch';
```

3. Ganti pemanggilannya di `handleSave` (baris ~127) dari `splitByTarget(cartWithIds)` menjadi `splitItemsByPrintTarget(cartWithIds)`. Tidak ada perubahan perilaku lain — `/pos` harus tetap berfungsi persis seperti sebelumnya.

Run: `npm run test && npm run lint`
Expected: seluruh test PASS, lint bersih.

- [ ] **Step 4: Tambah import di modal monitor**

Di `components/monitor-add-item-modal.tsx`, tambahkan pada blok import:

```tsx
import { toast } from 'sonner';
import { dispatchKitchenPrintJob, splitItemsByPrintTarget, type PrintTarget } from '@/lib/print-dispatch';
```

- [ ] **Step 5: Isi `handleSave`**

Ganti stub `async function handleSave() { /* Diisi di Task 4. */ }` dengan:

```tsx
  async function handleSave() {
    if (draft.length === 0) return;
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/transactions/${row.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: draft.map((it) => ({
            menu_id: it.menu_id,
            qty: it.qty,
            chip_labels: it.applied_chips.map((c) => c.label),
            notes: it.notes,
          })),
        }),
      });

      if (!res.ok) {
        // 404/409 = transaksi sudah tidak relevan; tidak ada gunanya kasir
        // mencoba lagi dengan draft yang sama → tutup + refresh daftar.
        if (res.status === 404 || res.status === 409) {
          toast.error(
            res.status === 404 ? 'Transaksi sudah tidak ada' : 'Transaksi sudah tidak aktif',
          );
          onSaved();
          return;
        }
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'save-failed');
      }

      const data = (await res.json()) as {
        transaction: {
          id: string;
          daily_seq: number | null;
          created_at: string;
          customer_name: string | null;
          table_no: string | null;
          is_takeaway: boolean;
        };
        items: Array<{ id: string; sort_order: number }>;
      };

      // Cocokkan draft ke baris hasil insert lewat sort_order (server assign
      // berurutan mengikuti urutan kiriman), bukan asumsi urutan array response.
      const created = [...data.items].sort((a, b) => a.sort_order - b.sort_order);
      const withIds = draft.map((it, idx) => ({
        ...it,
        id: created[idx]?.id ?? crypto.randomUUID(),
      }));

      // Hanya item baru yang dicetak. Item lama tidak tersentuh di server, jadi
      // tidak perlu filter printed_*_at seperti di nota-review-form.
      const split = splitItemsByPrintTarget(withIds);
      const jobs: Promise<{ target: PrintTarget; ok: boolean; offline: boolean }>[] = [];
      if (split.dapur.length > 0) {
        jobs.push(
          dispatchKitchenPrintJob({
            tx: data.transaction, target: 'dapur', items: split.dapur,
            trigger: 'auto_additional', printerSettings,
          }).then((r) => ({ ...r, target: 'dapur' as const })),
        );
      }
      if (split.minuman.length > 0) {
        jobs.push(
          dispatchKitchenPrintJob({
            tx: data.transaction, target: 'minuman', items: split.minuman,
            trigger: 'auto_additional', printerSettings,
          }).then((r) => ({ ...r, target: 'minuman' as const })),
        );
      }
      const results = await Promise.all(jobs);
      const failed = results.filter((r) => !r.ok);
      const offlineCount = failed.filter((f) => f.offline).length;

      if (failed.length === 0) {
        toast.success(`${draft.length} item ditambahkan, ${results.length} print job dikirim`);
      } else if (offlineCount > 0) {
        toast.success(`${draft.length} item ditambahkan`);
        toast.warning(
          'Agent printer offline. Nyalakan agent lalu cetak manual dari detail transaksi.',
          { duration: 10000 },
        );
      } else {
        toast.success(`${draft.length} item ditambahkan`);
        toast.error(`Gagal kirim print: ${failed.map((f) => f.target).join(', ')}`);
      }

      onSaved();
    } catch (err) {
      // Modal sengaja tetap terbuka & draft dipertahankan — kasir tinggal
      // menekan Simpan lagi tanpa mengetik ulang pesanannya.
      toast.error('Gagal menambah item', {
        description: err instanceof Error ? err.message : 'Coba lagi.',
      });
      submitLock.current = false;
    } finally {
      setSubmitting(false);
    }
  }
```

- [ ] **Step 6: Lint & typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: bersih. Prop `printerSettings` sudah terpakai sekarang.

- [ ] **Step 7: Verifikasi end-to-end manual**

Prasyarat: agent printer primary online (cek banner di `/setup/printer/debug`).

1. `/monitor` → pilih meja yang belum bayar, catat total & jumlah item di card.
2. `+ Item` → tambah 1 makanan (qty 2) + 1 minuman → `✓ Simpan & Cetak`.
3. Expected: toast sukses "2 item ditambahkan, 2 print job dikirim"; modal tertutup; card langsung menampilkan `item_count` & total yang sudah naik.
4. Expected cetakan: **dua** tiket keluar — tiket dapur berisi hanya makanan yang baru, tiket minuman berisi hanya minuman yang baru. **Item lama tidak ikut tercetak.**
5. Buka `/transactions/<id>` → item baru ada di urutan paling bawah, harga per unit sesuai menu + chip.
6. Cek `print_history` (atau `/setup/printer/debug`) → dua baris baru dengan `trigger='auto_additional'` berstatus `done`.
7. Uji jalur gagal: matikan agent printer, ulangi tambah 1 item → data tetap tersimpan, muncul toast kuning "Agent printer offline…".
8. Uji jalur 404: buka modal, lalu di tab lain soft-delete transaksinya, kembali dan tekan Simpan → toast "Transaksi sudah tidak ada", modal tertutup, daftar ter-refresh.
9. Uji retry: matikan koneksi (DevTools Network → Offline), tekan Simpan → toast merah, **modal tetap terbuka dan draft utuh**; nyalakan koneksi, tekan Simpan lagi → berhasil.

- [ ] **Step 8: Jalankan seluruh test suite**

Run: `npm run test`
Expected: seluruh test PASS (termasuk 4 test baru `splitItemsByPrintTarget`).

- [ ] **Step 9: Commit**

```bash
git add lib/print-dispatch.ts lib/print-dispatch.test.ts components/pos/pos-client.tsx components/monitor-add-item-modal.tsx
git commit -m "feat(monitor): simpan item baru dari modal + auto-cetak tiket dapur"
```

---

## Task 5: Dokumentasi

**Files:**
- Modify: `CLAUDE.md` (section "Monitor meja belum bayar")
- Modify: `docs/tasks.md`
- Modify: `docs/superpowers/specs/2026-08-07-monitor-add-item-design.md` (ubah Status)

- [ ] **Step 1: Tambah paragraf di `CLAUDE.md`**

Di akhir bagian `## Monitor meja belum bayar (shipped 2026-07-21)`, sebelum baris "**Laporan tidak disentuh**", sisipkan:

```markdown
- **Tambah item dari card (shipped 2026-08-07)**: tombol `+ Item` di card monitor → `MonitorAddItemModal` (picker menu + daftar draft multi-item, simpan sekali). Tap kartu menu = `qty += 1` untuk baris tanpa chip/catatan; baris ber-chip tidak ikut naik (tap bikin baris baru). Simpan → `POST /api/transactions/[id]/items` (**append-only**, bukan `PATCH`: server cuma `INSERT` sehingga `printed_*_at` item lama utuh & tidak ada read-modify-write race antar device) → auto-dispatch `dispatchKitchenPrintJob` trigger `auto_additional` hanya untuk item baru. `menus` + `printerSettings` di-SSR dari `monitor/page.tsx` supaya modal buka instan. Gagal simpan → modal tetap terbuka + draft utuh; 404/409 → tutup + refresh. Spec `docs/superpowers/specs/2026-08-07-monitor-add-item-design.md`.
```

- [ ] **Step 2: Update `docs/tasks.md`**

Buka `docs/tasks.md`, ikuti format entri terakhir, dan tambahkan baris untuk plan ini dengan status selesai beserta tanggal 2026-08-07.

- [ ] **Step 3: Tandai spec sebagai shipped**

Di `docs/superpowers/specs/2026-08-07-monitor-add-item-design.md`, ganti baris:

```
**Status:** Approved (brainstorm), pending implementation plan
```

menjadi:

```
**Status:** Shipped 2026-08-07 — plan: `docs/superpowers/plans/2026-08-07-monitor-add-item.md`
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/tasks.md docs/superpowers/specs/2026-08-07-monitor-add-item-design.md docs/superpowers/plans/2026-08-07-monitor-add-item.md
git commit -m "docs: catat fitur tambah item dari card monitor"
```

---

## Catatan implementasi

**Tidak memindahkan `components/pos/*`.** `PosMenuPicker` dan `PosItemConfigModal` sekarang dipakai monitor juga meski tinggal di folder `pos/`. Sengaja tidak dipindah ke `components/` — memindah file melebarkan diff tanpa manfaat nyata sekarang. Kalau muncul pemakai ketiga, baru layak naik.

**Transaksi yang keburu lunas tetap boleh ditambah item.** Route tidak memeriksa `paid_at`. Memblokirnya akan menghalangi kasus sah "sudah bayar, lalu pesan tambah". Konsekuensi: transaksi itu tidak muncul di monitor, jadi kasir menambahnya lewat halaman edit — sesuai desain.

**Non-goals (jangan dikerjakan):** ubah/hapus item lama dari modal ini, ubah nama/meja/flag bungkus, cetak struk pelanggan, menampilkan item lama di modal, undo "tambah item" setelah tersimpan.
