# Tap-to-Add Seragam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu perilaku tambah-item di `/pos`, `/transactions/[id]/review`, dan `/monitor` — tap menu = masuk daftar qty 1, tap lagi qty naik, chip/catatan lewat ✏️, simpan sekali.

**Architecture:** Aturan tap diangkat jadi fungsi murni di `lib/cart-draft.ts` (bisa dites, dipakai tiga halaman). UI modal pilih-banyak diangkat dari `MonitorAddItemModal` jadi `components/add-items-modal.tsx` yang tidak tahu apa-apa soal menyimpan; monitor menyambungkannya ke API + cetak, review menyambungkannya ke state item lokal. `/pos` tidak memakai modal — grid dan cart sudah menyatu di halaman, jadi hanya `onMenuTap`-nya yang berubah.

**Tech Stack:** Next.js 16 (App Router), React 19 client components, Vitest, Tailwind + shadcn-fork (base-ui) di `components/ui/`.

**Spec:** `docs/superpowers/specs/2026-08-07-unified-tap-to-add-design.md`

## Global Constraints

- Money = `bigint` rupiah tanpa sen. Format display **selalu** lewat `formatRp()` dari `lib/currency.ts`. Aritmetika integer, tanpa float.
- `lib/` tidak boleh mengimpor dari `components/` — arah impornya terbalik. Tipe parameter di `lib/cart-draft.ts` ditulis struktural seperlunya.
- UI: cek `components/ui/` dulu sebelum bikin komponen sendiri. **Dilarang** `window.confirm` / `alert` / `prompt`. Feedback ke user lewat `toast` dari `sonner`.
- Styling lewat design tokens di `app/globals.css @theme` (`coal`, `coal-soft`, `clay`, `clay-soft`, `paper`, `paper-soft`, `cream`, `gold`, `mustard`). Jangan hardcode hex.
- ⚠️ `variant="secondary"` bernilai `--color-paper-soft`, **warna yang sama persis** dengan `Card variant="paper"`, dan varian tombol default `border-transparent`. Tombol `secondary` di atas card paper tidak terlihat. Pakai `outline` di konteks itu.
- Teks UI & komentar: Bahasa Indonesia informal, konsisten dengan sekitarnya.
- Next.js 16: konsultasi `node_modules/next/dist/docs/01-app/` sebelum menulis konvensi server component / route handler.
- Perintah: `npm run test` (Vitest sekali jalan), `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- Baseline sebelum mulai: **240 test lulus di 20 file**. Harus tetap hijau.
- Repo punya knowledge graph di `graphify-out/` — pakai `graphify query "<pertanyaan>"` sebelum eksplorasi kode luas.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `lib/cart-draft.ts` (create) | Aturan tap murni + tipe `PosCartItemDraft` / `DraftRow` |
| `lib/cart-draft.test.ts` (create) | Test aturan tap |
| `components/add-items-modal.tsx` (create) | Cangkang modal pilih-banyak; tidak tahu soal menyimpan |
| `components/monitor-add-item-modal.tsx` (modify) | Menyusut jadi simpan + cetak saja |
| `components/pos/pos-item-config-modal.tsx` (modify) | Impor `PosCartItemDraft` dari `lib/cart-draft.ts` |
| `components/pos/pos-client.tsx` (modify) | `onMenuTap` pakai aturan baru |
| `components/nota-review-form.tsx` (modify) | "+ Tambah item" pakai `AddItemsModal` |

**Tidak diubah:** `components/nota-item-modal.tsx` (tetap dipakai untuk edit item lama), `components/pos/pos-menu-picker.tsx`, `components/chip-picker.tsx`, `components/nota-item-row.tsx`, semua route API.

---

## Task 1: Aturan tap murni di `lib/cart-draft.ts`

**Files:**
- Create: `lib/cart-draft.ts`
- Test: `lib/cart-draft.test.ts`
- Modify: `components/pos/pos-item-config-modal.tsx` (baris 14-22 — hapus deklarasi tipe, impor dari lib)
- Modify: `components/pos/pos-client.tsx` (baris 20 — arahkan impor tipe)
- Modify: `components/monitor-add-item-modal.tsx` (baris 13 — arahkan impor tipe)

**Interfaces:**
- Consumes: tidak ada (murni, tanpa dependensi)
- Produces — dipakai Task 2, 3, dan 4:
  ```ts
  export type AppliedChipRef = { label: string; price_delta: number };
  export type PosCartItemDraft = {
    menu_id: string;
    menu_name_snapshot: string;
    category: 'makanan' | 'nasi' | 'minuman';
    unit_price_snapshot: number;
    qty: number;
    notes: string | null;
    applied_chips: AppliedChipRef[];
  };
  export type DraftRow = PosCartItemDraft & { _localId: string };
  export const MAX_QTY = 99;
  export function needsChipConfig(menu: { chips: Array<{ mutex_group: string | null }> }): boolean;
  export function addOrIncrementDraft(
    rows: DraftRow[],
    menu: { id: string; name: string; category: PosCartItemDraft['category']; price: number },
    newLocalId: string,
  ): DraftRow[];
  ```

- [ ] **Step 1: Tulis test yang gagal**

Buat `lib/cart-draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { needsChipConfig, addOrIncrementDraft, MAX_QTY, type DraftRow } from './cart-draft';

const nasi = { id: 'menu-nasi', name: 'Nasi Putih', category: 'nasi' as const, price: 5000 };
const teh = { id: 'menu-teh', name: 'Es Teh', category: 'minuman' as const, price: 4000 };

function row(over: Partial<DraftRow> & { _localId: string; menu_id: string }): DraftRow {
  return {
    menu_name_snapshot: 'X',
    category: 'makanan',
    unit_price_snapshot: 1000,
    qty: 1,
    notes: null,
    applied_chips: [],
    ...over,
  };
}

describe('needsChipConfig', () => {
  it('is false for a menu with no chips', () => {
    expect(needsChipConfig({ chips: [] })).toBe(false);
  });

  it('is false when every chip is free-choice (mutex_group null)', () => {
    expect(needsChipConfig({ chips: [{ mutex_group: null }, { mutex_group: null }] })).toBe(false);
  });

  it('is true when at least one chip belongs to a mutex group', () => {
    expect(needsChipConfig({ chips: [{ mutex_group: null }, { mutex_group: 'bagian' }] })).toBe(true);
  });
});

describe('addOrIncrementDraft', () => {
  it('appends a new row with qty 1 and the menu base price', () => {
    const result = addOrIncrementDraft([], nasi, 'local-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      _localId: 'local-1',
      menu_id: 'menu-nasi',
      menu_name_snapshot: 'Nasi Putih',
      category: 'nasi',
      unit_price_snapshot: 5000,
      qty: 1,
      notes: null,
      applied_chips: [],
    });
  });

  it('increments qty when the same plain menu is tapped again', () => {
    const first = addOrIncrementDraft([], nasi, 'local-1');
    const second = addOrIncrementDraft(first, nasi, 'local-2');
    expect(second).toHaveLength(1);
    expect(second[0].qty).toBe(2);
    expect(second[0]._localId).toBe('local-1');
  });

  it('does NOT increment a row that already carries chips — appends instead', () => {
    const existing = [
      row({ _localId: 'a', menu_id: 'menu-teh', applied_chips: [{ label: 'Panas', price_delta: 0 }] }),
    ];
    const result = addOrIncrementDraft(existing, teh, 'local-new');
    expect(result).toHaveLength(2);
    expect(result[0].qty).toBe(1);
    expect(result[1]._localId).toBe('local-new');
    expect(result[1].applied_chips).toEqual([]);
  });

  it('does NOT increment a row that already carries notes — appends instead', () => {
    const existing = [row({ _localId: 'a', menu_id: 'menu-teh', notes: 'tanpa es' })];
    const result = addOrIncrementDraft(existing, teh, 'local-new');
    expect(result).toHaveLength(2);
    expect(result[0].notes).toBe('tanpa es');
  });

  it('caps qty at MAX_QTY', () => {
    const existing = [row({ _localId: 'a', menu_id: 'menu-nasi', qty: MAX_QTY })];
    const result = addOrIncrementDraft(existing, nasi, 'local-new');
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(MAX_QTY);
  });

  it('leaves other rows untouched and preserves order', () => {
    const existing = [
      row({ _localId: 'a', menu_id: 'menu-teh', qty: 3 }),
      row({ _localId: 'b', menu_id: 'menu-nasi', qty: 1 }),
    ];
    const result = addOrIncrementDraft(existing, nasi, 'local-new');
    expect(result.map((r) => r._localId)).toEqual(['a', 'b']);
    expect(result[0].qty).toBe(3);
    expect(result[1].qty).toBe(2);
  });

  it('does not mutate the input array', () => {
    const existing = [row({ _localId: 'a', menu_id: 'menu-nasi', qty: 1 })];
    addOrIncrementDraft(existing, nasi, 'local-new');
    expect(existing[0].qty).toBe(1);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test -- lib/cart-draft.test.ts`
Expected: FAIL — modul `./cart-draft` tidak ditemukan.

- [ ] **Step 3: Implementasi**

Buat `lib/cart-draft.ts`:

```ts
// lib/cart-draft.ts
export type AppliedChipRef = { label: string; price_delta: number };

/**
 * Satu baris draft item yang belum tersimpan. Dipindah ke `lib/` dari
 * `components/pos/pos-item-config-modal.tsx` supaya aturan tap di bawah bisa
 * hidup di luar komponen React dan dites langsung.
 */
export type PosCartItemDraft = {
  menu_id: string;
  menu_name_snapshot: string;
  category: 'makanan' | 'nasi' | 'minuman';
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: AppliedChipRef[];
};

export type DraftRow = PosCartItemDraft & { _localId: string };

export const MAX_QTY = 99;

/**
 * True kalau menu punya minimal satu chip bergrup mutex — pilihan yang HARUS
 * diputuskan kasir (mis. Ayam goreng: Dada/Paha), bukan opsi tambahan.
 * Menu begini tetap membuka modal konfigurasi saat di-tap; kalau dibiarkan
 * masuk diam-diam, tiket dapur keluar tanpa keterangan bagian.
 */
export function needsChipConfig(menu: { chips: Array<{ mutex_group: string | null }> }): boolean {
  return menu.chips.some((c) => c.mutex_group !== null);
}

/**
 * Aturan tap kartu menu: qty naik pada baris menu yang sama HANYA kalau baris
 * itu belum punya chip maupun catatan. Baris yang sudah dikonfigurasi kasir
 * tidak boleh diam-diam tertimpa — tap menu polos bikin baris baru.
 *
 * `newLocalId` di-inject (bukan crypto.randomUUID() di dalam) supaya fungsinya
 * tetap murni dan hasilnya bisa diperiksa di test.
 */
export function addOrIncrementDraft(
  rows: DraftRow[],
  menu: { id: string; name: string; category: PosCartItemDraft['category']; price: number },
  newLocalId: string,
): DraftRow[] {
  const idx = rows.findIndex(
    (d) => d.menu_id === menu.id && d.applied_chips.length === 0 && d.notes === null,
  );
  if (idx === -1) {
    return [
      ...rows,
      {
        _localId: newLocalId,
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
  return rows.map((d, i) => (i === idx ? { ...d, qty: Math.min(MAX_QTY, d.qty + 1) } : d));
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm run test -- lib/cart-draft.test.ts`
Expected: PASS (10 test).

- [ ] **Step 5: Pindahkan tipe `PosCartItemDraft` ke lib**

Di `components/pos/pos-item-config-modal.tsx`:
1. Hapus deklarasi `export type PosCartItemDraft = { … };` (baris 14-22).
2. Tambahkan pada blok impor: `import type { PosCartItemDraft } from '@/lib/cart-draft';`

Jangan menambahkan re-export dari file ini — arahkan setiap situs impor langsung ke `@/lib/cart-draft` (dua di antaranya di langkah ini). Re-export hanya menambah lapisan tanpa manfaat.

Di `components/pos/pos-client.tsx` baris 20, pecah impornya:

```tsx
import { PosItemConfigModal } from './pos-item-config-modal';
import type { PosCartItemDraft } from '@/lib/cart-draft';
```

Di `components/monitor-add-item-modal.tsx` baris 13, sama:

```tsx
import { PosItemConfigModal } from '@/components/pos/pos-item-config-modal';
import type { PosCartItemDraft } from '@/lib/cart-draft';
```

- [ ] **Step 6: Verifikasi tidak ada yang putus**

Run: `npm run test && npm run lint && npx tsc --noEmit`
Expected: 250 test lulus (240 baseline + 10 baru), lint & tsc bersih.

Kalau `tsc` mengeluh ada situs impor `PosCartItemDraft` lain yang belum diarahkan, cari dengan `grep -rn "PosCartItemDraft" --include=*.tsx --include=*.ts .` dan arahkan juga ke `@/lib/cart-draft`.

- [ ] **Step 7: Commit**

```bash
git add lib/cart-draft.ts lib/cart-draft.test.ts components/pos/pos-item-config-modal.tsx components/pos/pos-client.tsx components/monitor-add-item-modal.tsx
git commit -m "feat(cart): aturan tap-to-add jadi fungsi murni di lib/cart-draft"
```

---

## Task 2: Angkat `AddItemsModal`, susutkan `MonitorAddItemModal`

**Files:**
- Create: `components/add-items-modal.tsx`
- Modify: `components/monitor-add-item-modal.tsx`

**Interfaces:**
- Consumes: `needsChipConfig`, `addOrIncrementDraft`, `PosCartItemDraft`, `DraftRow`, `MAX_QTY` dari Task 1.
- Produces — dipakai Task 4:
  ```ts
  export function AddItemsModal(props: {
    title: string;
    menus: MenuOption[];
    confirmLabel: (count: number, totalAmount: number) => string;
    submitting?: boolean;
    onCancel: () => void;
    onConfirm: (drafts: PosCartItemDraft[]) => void;
  }): JSX.Element;
  ```

**Perilaku yang WAJIB tetap sama setelah pemindahan** (semuanya hasil ronde review sebelumnya — jangan disederhanakan):
- `submitLock` ref sinkron anti double-tap, dan bendera `saved` yang di-set **sebelum** `res.json()`.
- Penanganan status 404/409 (tutup + refresh), 400 (pesan "Menu sudah berubah", modal tetap terbuka), 401 (pesan sesi habis, tanpa kesan "coba lagi").
- Pencocokan draft↔baris hasil insert lewat `sort_order`, tanpa fabrikasi UUID, plus toast peringatan kalau jumlahnya tidak cocok.
- Cabang toast sukses / agent offline / gagal kirim print.
- Baris yang sedang diedit dilacak lewat `_localId`, bukan index array.

- [ ] **Step 1: Buat `components/add-items-modal.tsx`**

```tsx
// components/add-items-modal.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';
import { PosMenuPicker } from '@/components/pos/pos-menu-picker';
import { PosItemConfigModal } from '@/components/pos/pos-item-config-modal';
import {
  addOrIncrementDraft, needsChipConfig, MAX_QTY,
  type PosCartItemDraft, type DraftRow,
} from '@/lib/cart-draft';
import type { MenuOption } from '@/components/nota-item-modal';

/**
 * Modal pilih-banyak: tap menu berkali-kali, atur qty/chip di daftar bawah,
 * lalu satu tombol konfirmasi. Sengaja TIDAK tahu apa-apa soal menyimpan —
 * monitor menyambungkannya ke API + cetak, review ke state item lokal.
 *
 * State draft hidup di sini. Selama parent belum melepas komponennya, draft
 * bertahan — itulah yang bikin "gagal simpan → modal tetap terbuka, draft
 * utuh" jalan tanpa parent perlu menyimpan salinan.
 */
export function AddItemsModal({
  title,
  menus,
  confirmLabel,
  submitting = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  menus: MenuOption[];
  confirmLabel: (count: number, totalAmount: number) => string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (drafts: PosCartItemDraft[]) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  // Dilacak via _localId (bukan index array) — index bisa geser kalau daftar
  // berubah selagi modal konfigurasi terbuka, dan overwrite baris yang salah.
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [pickingMenu, setPickingMenu] = useState<MenuOption | null>(null);

  const totalAmount = rows.reduce((s, it) => s + it.unit_price_snapshot * it.qty, 0);

  /**
   * Menu bergrup mutex (mis. Ayam goreng: Dada/Paha) buka modal konfigurasi
   * dulu — bagiannya harus diputuskan, bukan didiamkan. Menu lain langsung
   * masuk daftar.
   */
  function handleMenuTap(menu: MenuOption) {
    if (needsChipConfig(menu)) {
      setEditingLocalId(null);
      setPickingMenu(menu);
      return;
    }
    setRows((prev) => addOrIncrementDraft(prev, menu, crypto.randomUUID()));
  }

  function handleQtyChange(localId: string, nextQty: number) {
    setRows((prev) => prev.map((d) => (d._localId === localId ? { ...d, qty: nextQty } : d)));
  }

  function handleDelete(localId: string) {
    setRows((prev) => prev.filter((d) => d._localId !== localId));
  }

  function handleEdit(localId: string) {
    const target = rows.find((d) => d._localId === localId);
    if (!target) return;
    const menu = menus.find((m) => m.id === target.menu_id);
    if (!menu) return;
    setEditingLocalId(localId);
    setPickingMenu(menu);
  }

  /**
   * Dua jalur masuk ke sini: ✏️ pada baris yang sudah ada (editingLocalId
   * terisi → timpa baris itu), dan tap menu bergrup mutex (editingLocalId
   * null → baris baru). Batal di modal konfigurasi untuk jalur kedua berarti
   * tidak ada baris yang ditambahkan sama sekali.
   */
  function handleConfigSave(item: PosCartItemDraft) {
    if (editingLocalId !== null) {
      setRows((prev) =>
        prev.map((d) => (d._localId === editingLocalId ? { ...item, _localId: d._localId } : d)),
      );
    } else {
      setRows((prev) => [...prev, { ...item, _localId: crypto.randomUUID() }]);
    }
    setEditingLocalId(null);
    setPickingMenu(null);
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !submitting) onCancel(); }}>
        <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            <PosMenuPicker menus={menus} onMenuTap={handleMenuTap} />
          </div>

          <div className="shrink-0 border-t border-clay-soft/60 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-clay">
              Item baru
            </p>

            {rows.length === 0 ? (
              <p className="py-4 text-center text-sm text-clay">
                Tap menu di atas untuk menambah item.
              </p>
            ) : (
              <ul className="max-h-52 divide-y divide-clay-soft/60 overflow-y-auto">
                {rows.map((it) => (
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
                        onClick={() => handleQtyChange(it._localId, Math.max(1, it.qty - 1))}
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
                        onClick={() => handleQtyChange(it._localId, Math.min(MAX_QTY, it.qty + 1))}
                        disabled={it.qty >= MAX_QTY}
                        aria-label={`Tambah jumlah ${it.menu_name_snapshot}`}
                        className="rounded-l-none text-lg leading-none"
                      >
                        +
                      </Button>
                    </div>

                    <span className="w-24 shrink-0 text-right font-display text-base tracking-tight tabular-nums text-coal">
                      {formatRp(it.unit_price_snapshot * it.qty)}
                    </span>

                    <Button size="icon" variant="ghost" onClick={() => handleEdit(it._localId)} aria-label={`Ubah ${it.menu_name_snapshot}`}>
                      ✏️
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(it._localId)} aria-label={`Hapus ${it.menu_name_snapshot}`}>
                      🗑️
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex gap-2 pb-[max(0px,env(safe-area-inset-bottom))]">
              <Button variant="secondary" onClick={onCancel} disabled={submitting}>
                Batal
              </Button>
              <Button
                onClick={() => onConfirm(rows.map(({ _localId, ...rest }) => rest))}
                disabled={submitting || rows.length === 0}
                className="flex-1"
              >
                {confirmLabel(rows.length, totalAmount)}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {pickingMenu && (
        <PosItemConfigModal
          menu={pickingMenu}
          initial={editingLocalId !== null ? rows.find((d) => d._localId === editingLocalId) : undefined}
          onSave={handleConfigSave}
          onClose={() => { setPickingMenu(null); setEditingLocalId(null); }}
        />
      )}
    </>
  );
}
```

> Catatan: `rows.map(({ _localId, ...rest }) => rest)` sengaja membuang `_localId` — itu identitas internal modal, bukan bagian dari data yang diserahkan ke parent. Kalau ESLint mengeluh soal variabel `_localId` yang tidak dipakai, prefiks `_` sudah cocok dengan konvensi `argsIgnorePattern` bawaan; kalau tetap mengeluh, laporkan alih-alih mengubah bentuk destructuring-nya.

- [ ] **Step 2: Susutkan `components/monitor-add-item-modal.tsx`**

Ganti **seluruh isi file** dengan:

```tsx
// components/monitor-add-item-modal.tsx
'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { dispatchKitchenPrintJob, splitItemsByPrintTarget, type PrintTarget } from '@/lib/print-dispatch';
import { AddItemsModal } from '@/components/add-items-modal';
import { formatRp } from '@/lib/currency';
import type { PosCartItemDraft } from '@/lib/cart-draft';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';
import type { MonitorRow } from '@/lib/monitor';

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
  const [submitting, setSubmitting] = useState(false);
  // Sync guard: setSubmitting async, tap kedua yang cepat bisa masuk
  // handleConfirm sebelum React commit state-nya.
  const submitLock = useRef(false);

  async function handleConfirm(drafts: PosCartItemDraft[]) {
    if (drafts.length === 0) return;
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    // Dilacak terpisah dari submitLock: insert bisa sukses lalu tahap cetak
    // yang gagal (lihat catch di bawah) — begitu insert commit, retry via
    // "Simpan" lagi akan dobel-insert item ke tagihan yang sama.
    let saved = false;
    try {
      const res = await fetch(`/api/transactions/${row.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: drafts.map((it) => ({
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
        // 400 = menu/chip request ga cocok lagi sama master data — biasanya
        // owner ubah menu selagi dashboard ini kebuka lama (data SSR basi).
        // Reload, bukan retry, yang bisa menolong; modal tetap terbuka biar
        // draft ga hilang selagi kasir reload.
        if (res.status === 400) {
          toast.error('Menu sudah berubah', {
            description: 'Reload halaman ini dulu, lalu coba tambah item lagi.',
          });
          submitLock.current = false;
          return;
        }
        // 401 = sesi login habis (tablet nyala lama semalaman). Retry pasti
        // gagal lagi — jangan kasih kesan "coba lagi" di pesan errornya.
        if (res.status === 401) {
          toast.error('Sesi login habis', {
            description: 'Login ulang untuk lanjut menambah item.',
          });
          submitLock.current = false;
          return;
        }
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'save-failed');
      }

      // Status 201 = insert SUDAH commit di server, titik ini juga — bukan
      // setelah body ke-parse. Body 201 bisa gagal dibaca sendiri (WiFi tablet
      // kasir putus di tengah stream setelah status line terkirim); kalau
      // `saved` baru di-set setelah res.json(), skenario itu jatuh ke jalur
      // retry catch dan bikin item ke-insert dobel. Jangan pindahkan ke bawah
      // parsing lagi.
      saved = true;
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
      // Jangan fabrikasi id kalau response lebih pendek dari draft — id palsu
      // tidak match trigger DB (`id = ANY(item_ids)`), item itu tercetak di
      // kertas tapi tercatat permanen sebagai belum tercetak. Pasangkan
      // positional hanya sepanjang baris yang benar-benar dikembalikan server.
      const pairCount = Math.min(created.length, drafts.length);
      const withIds = drafts.slice(0, pairCount).map((it, idx) => ({
        ...it,
        id: created[idx].id,
      }));
      if (created.length !== drafts.length) {
        toast.warning(
          'Jumlah item yang tersimpan tidak sesuai dengan yang dikirim. Cek detail transaksi.',
          { duration: 10000 },
        );
      }

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
        toast.success(`${drafts.length} item ditambahkan, ${results.length} print job dikirim`);
      } else if (offlineCount > 0) {
        toast.success(`${drafts.length} item ditambahkan`);
        toast.warning(
          'Agent printer offline. Nyalakan agent lalu cetak manual dari detail transaksi.',
          { duration: 10000 },
        );
      } else {
        toast.success(`${drafts.length} item ditambahkan`);
        toast.error(`Gagal kirim print: ${failed.map((f) => f.target).join(', ')}`);
      }

      onSaved();
    } catch (err) {
      if (!saved) {
        // Insert belum commit — modal sengaja tetap terbuka & draft
        // dipertahankan (state-nya hidup di AddItemsModal yang masih
        // ter-mount), kasir tinggal menekan Simpan lagi tanpa mengetik ulang.
        toast.error('Gagal menambah item', {
          description: err instanceof Error ? err.message : 'Coba lagi.',
        });
        submitLock.current = false;
      } else {
        // Insert sudah commit, error ini terjadi di tahap cetak (mis.
        // renderKitchenTicket melempar sebelum request /api/print/send
        // sempat jalan). Item SUDAH tersimpan — jangan undang retry (dobel
        // insert ke tagihan yang sama), tutup modal & refresh daftar supaya
        // kasir lihat total yang benar, minta cetak manual.
        toast.success('Item tersimpan');
        toast.error('Gagal cetak tiket. Cetak manual dari detail transaksi.');
        onSaved();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AddItemsModal
      title={titleFor(row)}
      menus={menus}
      submitting={submitting}
      confirmLabel={(count, total) =>
        submitting ? 'Menyimpan…' : `✓ Simpan & Cetak ${count > 0 ? formatRp(total) : ''}`
      }
      onCancel={onClose}
      onConfirm={handleConfirm}
    />
  );
}
```

- [ ] **Step 3: Verifikasi**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`
Expected: 250 test lulus, lint/tsc bersih, build sukses.

Lalu baca ulang `monitor-add-item-modal.tsx` hasil tulisan sendiri dan konfirmasi di laporan bahwa setiap butir di daftar "Perilaku yang WAJIB tetap sama" di atas masih ada, sebut nomor barisnya masing-masing.

- [ ] **Step 4: Commit**

```bash
git add components/add-items-modal.tsx components/monitor-add-item-modal.tsx
git commit -m "refactor(monitor): angkat AddItemsModal, monitor tinggal simpan + cetak"
```

---

## Task 3: `/pos` tap-to-add

**Files:**
- Modify: `components/pos/pos-client.tsx`

**Interfaces:**
- Consumes: `needsChipConfig`, `addOrIncrementDraft` dari Task 1.
- Produces: tidak ada.

- [ ] **Step 1: Tambah impor**

Di `components/pos/pos-client.tsx`, tambahkan:

```tsx
import { addOrIncrementDraft, needsChipConfig } from '@/lib/cart-draft';
```

- [ ] **Step 2: Ganti `onMenuTap`**

Cari baris yang sekarang berbunyi:

```tsx
<PosMenuPicker menus={menus} onMenuTap={(m) => { setEditingIdx(null); setPickingMenu(m); }} />
```

Ganti dengan:

```tsx
<PosMenuPicker
  menus={menus}
  onMenuTap={(m) => {
    setEditingIdx(null);
    // Menu bergrup mutex (mis. Ayam goreng: Dada/Paha) tetap buka modal
    // konfigurasi — bagiannya harus diputuskan, bukan didiamkan. Menu lain
    // langsung masuk cart qty 1, tap lagi qty naik.
    if (needsChipConfig(m)) {
      setPickingMenu(m);
      return;
    }
    setCart((prev) => addOrIncrementDraft(prev, m, crypto.randomUUID()));
  }}
/>
```

Tidak ada perubahan lain. `handleEditItem` (✏️ pada baris cart), `handleAddOrEditItem`, `handleQtyChange`, `handleDeleteItem`, dan `handleSave` tetap seperti sekarang — jalur "tambah lewat modal konfigurasi" masih dipakai untuk menu bergrup, dan `handleAddOrEditItem` dengan `editingIdx === null` sudah meng-append seperti seharusnya.

`CartRow` di file ini bertipe `PosCartItemDraft & { _localId: string }`, struktur yang sama dengan `DraftRow` — `addOrIncrementDraft` cocok tanpa cast. Kalau `tsc` protes, laporkan alih-alih menambahkan `as`.

- [ ] **Step 3: Verifikasi**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`
Expected: semua bersih/hijau.

- [ ] **Step 4: Commit**

```bash
git add components/pos/pos-client.tsx
git commit -m "feat(pos): tap menu langsung masuk cart, kecuali menu bergrup pilihan"
```

---

## Task 4: Halaman review pakai `AddItemsModal`

**Files:**
- Modify: `components/nota-review-form.tsx`

**Interfaces:**
- Consumes: `AddItemsModal` dari Task 2, `PosCartItemDraft` dari Task 1.
- Produces: tidak ada.

**Konteks:** `nota-review-form.tsx` memegang state `items: NotaItem[]`. `NotaItem` (dari `components/nota-item-row.tsx`) berbentuk:

```ts
type NotaItem = {
  id?: string;                 // ada = item lama dari DB; kosong = item baru
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: Array<{ label: string; price_delta: number }>;
  sort_order: number;
  confidence: number | null;
  _localId: string;
};
```

`PosCartItemDraft` punya `category` yang `NotaItem` tidak punya — dibuang saat memetakan. `NotaItem` punya `sort_order` dan `confidence` yang draft tidak punya — diisi saat memetakan.

- [ ] **Step 1: Tukar state `adding` jadi `addingItems`**

Di `components/nota-review-form.tsx` baris 134, ganti:

```tsx
  const [adding, setAdding] = useState(false);
```

dengan:

```tsx
  const [addingItems, setAddingItems] = useState(false);
```

- [ ] **Step 2: Tambah impor**

```tsx
import { AddItemsModal } from '@/components/add-items-modal';
import type { PosCartItemDraft } from '@/lib/cart-draft';
```

- [ ] **Step 3: Buang `setAdding(false)` dari `upsertItem`**

Fungsi `upsertItem` (baris 163-176) sekarang hanya melayani jalur edit lewat `NotaItemModal`. Hapus baris `setAdding(false);` di akhirnya; `setEditing(null);` tetap.

- [ ] **Step 4: Tambah handler untuk item dari modal**

Sisipkan setelah `upsertItem`:

```tsx
  /**
   * Item dari AddItemsModal masuk sebagai item BARU (tanpa `id` DB), jadi
   * detectModalContext tetap menggolongkannya sebagai newItems — modal
   * "Cetak ulang ke dapur" tidak muncul dan cetaknya tetap auto_additional.
   */
  function appendItems(drafts: PosCartItemDraft[]) {
    setItems((prev) => [
      ...prev,
      ...drafts.map((d, idx) => ({
        _localId: crypto.randomUUID(),
        menu_id: d.menu_id,
        menu_name_snapshot: d.menu_name_snapshot,
        unit_price_snapshot: d.unit_price_snapshot,
        qty: d.qty,
        notes: d.notes,
        applied_chips: d.applied_chips,
        sort_order: prev.length + idx,
        confidence: null,
      })),
    ]);
    setAddingItems(false);
  }
```

- [ ] **Step 5: Ganti tombol "+ Tambah item"**

Baris 530-532 sekarang berbunyi:

```tsx
          <Button variant="secondary" onClick={() => setAdding(true)} className="w-full">
            + Tambah item
          </Button>
```

Ganti dengan:

```tsx
          <Button variant="outline" onClick={() => setAddingItems(true)} className="w-full">
            + Tambah item
          </Button>
```

(`outline`, bukan `secondary` — tombol ini duduk tepat di bawah `Card variant="paper"`, dan `secondary` bernilai warna yang sama dengan card itu.)

- [ ] **Step 6: Pisahkan render dua modal**

Baris 562-573 sekarang berbunyi:

```tsx
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
```

Ganti dengan:

```tsx
      {/* Edit item lama: modal lengkap (ganti menu, hapus). Sengaja tetap
          NotaItemModal — kebutuhannya beda dari sekadar menambah. */}
      {editing && (
        <NotaItemModal
          initial={editing}
          menus={menus}
          onSave={upsertItem}
          onClose={() => setEditing(null)}
          onDelete={() => removeItem(editing._localId)}
        />
      )}

      {addingItems && (
        <AddItemsModal
          title="Tambah item"
          menus={menus}
          confirmLabel={(count) => (count === 0 ? '+ Tambah item' : `+ Tambah ${count} item`)}
          onCancel={() => setAddingItems(false)}
          onConfirm={appendItems}
        />
      )}
```

- [ ] **Step 7: Verifikasi**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`
Expected: semua bersih/hijau. Kalau lint melaporkan `adding` / `setAdding` tersisa di tempat lain, cari dengan `grep -n "setAdding\|\badding\b" components/nota-review-form.tsx` dan bereskan.

- [ ] **Step 8: Commit**

```bash
git add components/nota-review-form.tsx
git commit -m "feat(review): + Tambah item pakai modal pilih-banyak"
```

---

## Task 5: Dokumentasi

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/tasks.md`
- Modify: `docs/superpowers/specs/2026-08-07-unified-tap-to-add-design.md`

- [ ] **Step 1: `CLAUDE.md`**

Di bagian `## POS direct order + per-menu chips (shipped 2026-07-08)`, tambahkan bullet di akhir:

```markdown
- **Tap-to-add seragam (2026-08-07)**: `/pos`, `/transactions/[id]/review`, dan `/monitor` pakai aturan tap yang sama — tap kartu menu = baris masuk qty 1, tap lagi qty naik, tapi baris yang sudah punya chip/catatan **tidak** ikut naik (tap bikin baris baru). Aturannya fungsi murni di `lib/cart-draft.ts` (`addOrIncrementDraft`, `needsChipConfig`) + test `lib/cart-draft.test.ts`. **Pengecualian**: menu dengan chip bergrup `mutex_group` (produksi: cuma Ayam goreng — Dada/Paha) tetap membuka `PosItemConfigModal` saat di-tap, karena bagiannya wajib diputuskan buat dapur; batal di modal itu = tidak ada baris yang ditambah. UI modal pilih-banyak ada di `components/add-items-modal.tsx` (tidak tahu apa-apa soal menyimpan) — dipakai `MonitorAddItemModal` (sambung ke API + cetak) dan `nota-review-form` (sambung ke state item lokal). Edit item lama di review tetap lewat `NotaItemModal`. Spec `docs/superpowers/specs/2026-08-07-unified-tap-to-add-design.md`.
```

- [ ] **Step 2: `docs/tasks.md`**

Baca file itu dulu, ikuti format entri terakhir, dan tambahkan entri untuk plan ini. Tulis statusnya sebagai **implemented, menunggu verifikasi manual** — bukan selesai/terverifikasi — karena tidak ada test komponen React di repo ini dan perubahan perilakunya cuma bisa dibuktikan di browser.

- [ ] **Step 3: Status spec**

Di `docs/superpowers/specs/2026-08-07-unified-tap-to-add-design.md`, ganti baris:

```
**Status:** Approved (brainstorm), pending implementation plan
```

menjadi:

```
**Status:** Implemented 2026-08-07, pending manual browser verification — plan: `docs/superpowers/plans/2026-08-07-unified-tap-to-add.md`
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/tasks.md docs/superpowers/specs/2026-08-07-unified-tap-to-add-design.md docs/superpowers/plans/2026-08-07-unified-tap-to-add.md
git commit -m "docs: catat tap-to-add seragam di pos, review, monitor"
```

---

## Verifikasi manual (butuh manusia + browser)

Tidak ada test komponen React di repo ini, jadi perilaku di bawah hanya bisa dibuktikan di browser. Jalankan `npm run dev`.

1. `/pos`: tap Nasi 3× → **satu** baris qty 3, bukan tiga baris.
2. `/pos`: tap Ayam goreng → modal chip terbuka (bukan langsung masuk). Pilih Dada → Tambah ke cart. Tap Ayam goreng lagi → modal terbuka lagi, pilih Paha → **baris kedua terpisah**.
3. `/pos`: tap Ayam goreng lalu **Batal** di modal chip → tidak ada baris yang masuk cart.
4. `/pos`: ✏️ pada baris cart masih bisa ubah qty/chip/catatan. Simpan & Cetak jalan seperti biasa, tiket benar.
5. Review (`/transactions/[id]/review`): "+ Tambah item" → tap 3 menu berbeda → naikkan qty salah satunya → "+ Tambah 3 item" → ketiganya masuk daftar nota dengan harga benar, modal tertutup.
6. Review: ✏️ pada baris nota **lama** tetap membuka modal lengkap, masih bisa ganti menu dan ada tombol 🗑️ Hapus.
7. Review pada transaksi `confirmed`: tambah item lalu Simpan → tiket dapur hanya berisi item baru, **tanpa** modal "Ada items yang diubah".
8. Monitor: tap Ayam goreng sekarang membuka modal chip (ini perubahan perilaku dari sebelumnya). Menu lain tetap langsung masuk. Simpan & cetak tetap jalan.
9. Monitor: matikan koneksi di DevTools → Simpan → toast merah, **modal tetap terbuka dan draft utuh**; nyalakan lagi → Simpan → item masuk **sekali saja**.
10. HP ~390px: grid menu scroll, daftar item baru + tombol tetap terlihat di bawah, di `/pos` maupun di modal.

## Catatan implementasi

**Kenapa diangkat, bukan disalin.** Dua temuan review paling serius di fitur sebelumnya persis soal duplikasi verbatim (query menu di dua halaman, `splitByTarget` di dua file). Menyalin UI modal ke halaman ketiga akan mengulang pola yang sama, dan aturan tap yang tersebar di tiga komponen tidak bisa dites sama sekali.

**Yang paling rawan di task ini adalah Task 2.** `monitor-add-item-modal.tsx` memuat perilaku hasil beberapa ronde review — urutan `saved = true` sebelum `res.json()`, penanganan 400/401/404/409 yang berbeda-beda, dan larangan memfabrikasi UUID. Semuanya harus pindah utuh. Kalau ragu apakah suatu baris masih diperlukan, pertahankan dan laporkan sebagai concern; jangan sederhanakan.
