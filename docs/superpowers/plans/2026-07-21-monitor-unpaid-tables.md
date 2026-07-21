# Monitor Meja Belum Bayar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layar `/monitor` yang menampilkan transaksi dine-in confirmed yang belum bayar hari ini; kasir menandai lunas (hilang dari layar), undo lewat detail transaksi.

**Architecture:** Kolom baru `transactions.paid_at` (NULL = belum bayar) menjadi satu-satunya state. Query difilter di sisi DB (confirmed + dine-in + belum bayar + hari bisnis ini). Layar client polling `GET /api/monitor` tiap 15 detik. Tandai lunas & undo pakai `PATCH /api/transactions/[id]` dengan field baru `paid`. Laporan (`report_*`) tidak disentuh — mengabaikan `paid_at`.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgREST), Zod, Vitest, base-ui Dialog/AlertDialog, sonner toast, Tailwind design tokens.

**Spec:** `docs/superpowers/specs/2026-07-21-monitor-unpaid-tables-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/0036_transactions_paid_at.sql` — kolom `paid_at` + partial index.
- `lib/monitor.ts` — helper murni (total, mapping row, build paid update). Testable.
- `lib/monitor.test.ts` — unit test helper murni.
- `lib/monitor-server.ts` — `fetchUnpaidRows(supabase)` (query DB + mapping). Dipakai page & API.
- `app/api/monitor/route.ts` — `GET /api/monitor` untuk polling.
- `components/monitor-detail-modal.tsx` — Dialog detail transaksi (fetch `GET /api/transactions/[id]`).
- `components/monitor-board.tsx` — board client: polling, kartu, tombol Lunas, tap→modal, refresh.
- `app/(app)/monitor/page.tsx` — server component, SSR initial rows + render board.

**Modify:**
- `app/api/transactions/[id]/route.ts` — tambah field `paid` di `PatchSchema` + handle di `applyHeaderUpdate`.
- `components/home-tiles.tsx` — tambah tile "Monitor".
- `components/nav.tsx` — tambah link "Monitor".
- `app/(app)/transactions/[id]/page.tsx` — select `paid_at`, teruskan ke `TransactionDetail`.
- `components/transaction-detail.tsx` — badge status bayar + tombol toggle lunas/undo.

---

## Task 1: Migrasi kolom `paid_at`

**Files:**
- Create: `supabase/migrations/0036_transactions_paid_at.sql`

- [ ] **Step 1: Tulis file migrasi**

```sql
-- 0036_transactions_paid_at.sql
-- Status bayar untuk fitur Monitor meja belum bayar.
-- NULL = belum bayar; timestamp = sudah bayar.
-- Operasional saja — laporan (report_*) TIDAK memakai kolom ini. Data lama paid_at=NULL
-- tidak masalah karena filter monitor dibatasi hari bisnis berjalan.

ALTER TABLE transactions ADD COLUMN paid_at timestamptz;

-- Index parsial: query monitor hanya menyentuh baris confirmed + dine-in + belum bayar + belum dihapus.
CREATE INDEX IF NOT EXISTS idx_transactions_unpaid
  ON transactions (created_at)
  WHERE status = 'confirmed' AND is_takeaway = false AND paid_at IS NULL AND deleted_at IS NULL;
```

- [ ] **Step 2: Terapkan migrasi**

Terapkan lewat alur Supabase yang biasa dipakai project ini (mis. `supabase db push`, atau MCP `apply_migration` dengan isi file di atas). Verifikasi kolom ada:

Run (via Supabase SQL / MCP `execute_sql`):
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'transactions' AND column_name = 'paid_at';
```
Expected: satu baris `paid_at | timestamp with time zone`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0036_transactions_paid_at.sql
git commit -m "feat(monitor): add transactions.paid_at column + partial index"
```

---

## Task 2: Helper murni `lib/monitor.ts` (TDD)

**Files:**
- Create: `lib/monitor.ts`
- Test: `lib/monitor.test.ts`

- [ ] **Step 1: Tulis test yang gagal**

```typescript
// lib/monitor.test.ts
import { describe, expect, it } from 'vitest';
import { computeItemsTotal, mapMonitorRow, buildPaidUpdate, type MonitorRawRow } from './monitor';

describe('computeItemsTotal', () => {
  it('menjumlahkan qty × unit_price_snapshot', () => {
    expect(computeItemsTotal([
      { qty: 2, unit_price_snapshot: 15000 },
      { qty: 1, unit_price_snapshot: 8000 },
    ])).toBe(38000);
  });

  it('return 0 untuk null / kosong', () => {
    expect(computeItemsTotal(null)).toBe(0);
    expect(computeItemsTotal([])).toBe(0);
  });
});

describe('mapMonitorRow', () => {
  const raw: MonitorRawRow = {
    id: 'tx-1',
    created_at: '2026-07-21T05:30:00.000Z',
    customer_name: 'Budi',
    table_no: '5',
    transaction_items: [
      { qty: 2, unit_price_snapshot: 15000 },
      { qty: 1, unit_price_snapshot: 8000 },
    ],
  };

  it('memetakan row mentah ke MonitorRow dengan total + item_count', () => {
    expect(mapMonitorRow(raw)).toEqual({
      id: 'tx-1',
      created_at: '2026-07-21T05:30:00.000Z',
      customer_name: 'Budi',
      table_no: '5',
      total: 38000,
      item_count: 2,
    });
  });

  it('menangani transaction_items null', () => {
    const r = mapMonitorRow({ ...raw, transaction_items: null });
    expect(r.total).toBe(0);
    expect(r.item_count).toBe(0);
  });
});

describe('buildPaidUpdate', () => {
  it('paid=true → paid_at berisi nowIso', () => {
    expect(buildPaidUpdate(true, '2026-07-21T10:00:00.000Z')).toEqual({
      paid_at: '2026-07-21T10:00:00.000Z',
    });
  });

  it('paid=false → paid_at null (undo)', () => {
    expect(buildPaidUpdate(false, '2026-07-21T10:00:00.000Z')).toEqual({ paid_at: null });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm run test -- lib/monitor.test.ts`
Expected: FAIL — `Cannot find module './monitor'`.

- [ ] **Step 3: Implementasi minimal**

```typescript
// lib/monitor.ts
export type MonitorItemRow = { qty: number; unit_price_snapshot: number };

export type MonitorRawRow = {
  id: string;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
  transaction_items: MonitorItemRow[] | null;
};

export type MonitorRow = {
  id: string;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
  total: number;
  item_count: number;
};

export function computeItemsTotal(items: MonitorItemRow[] | null): number {
  return (items ?? []).reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
}

export function mapMonitorRow(raw: MonitorRawRow): MonitorRow {
  const items = raw.transaction_items ?? [];
  return {
    id: raw.id,
    created_at: raw.created_at,
    customer_name: raw.customer_name,
    table_no: raw.table_no,
    total: computeItemsTotal(items),
    item_count: items.length,
  };
}

export function buildPaidUpdate(paid: boolean, nowIso: string): { paid_at: string | null } {
  return { paid_at: paid ? nowIso : null };
}
```

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `npm run test -- lib/monitor.test.ts`
Expected: PASS (semua describe hijau).

- [ ] **Step 5: Commit**

```bash
git add lib/monitor.ts lib/monitor.test.ts
git commit -m "feat(monitor): pure helpers for total, row mapping, paid update"
```

---

## Task 3: Query DB `lib/monitor-server.ts`

**Files:**
- Create: `lib/monitor-server.ts`

- [ ] **Step 1: Implementasi**

```typescript
// lib/monitor-server.ts
import { currentBusinessDate, businessDayRange } from '@/lib/date';
import { mapMonitorRow, type MonitorRow, type MonitorRawRow } from '@/lib/monitor';
import type { getSupabaseServer } from '@/lib/supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof getSupabaseServer>>;

/**
 * Ambil transaksi belum-bayar untuk hari bisnis berjalan.
 * Filter: confirmed + dine-in + paid_at NULL + belum dihapus + created_at dalam hari ini.
 * Himpunan kecil (belum-bayar dine-in hari ini) — aman map/total di JS, bukan agregasi 1000-row.
 */
export async function fetchUnpaidRows(supabase: SupabaseLike): Promise<MonitorRow[]> {
  const { start, end } = businessDayRange(currentBusinessDate());
  const { data, error } = await supabase
    .from('transactions')
    .select('id, created_at, customer_name, table_no, transaction_items(qty, unit_price_snapshot)')
    .eq('status', 'confirmed')
    .eq('is_takeaway', false)
    .is('paid_at', null)
    .is('deleted_at', null)
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapMonitorRow(r as unknown as MonitorRawRow));
}
```

- [ ] **Step 2: Verifikasi kompilasi**

Run: `npm run lint`
Expected: tidak ada error baru pada `lib/monitor-server.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/monitor-server.ts
git commit -m "feat(monitor): fetchUnpaidRows server query for business day"
```

---

## Task 4: Route `GET /api/monitor`

**Files:**
- Create: `app/api/monitor/route.ts`

- [ ] **Step 1: Implementasi**

```typescript
// app/api/monitor/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { fetchUnpaidRows } from '@/lib/monitor-server';

export async function GET(_request: NextRequest) {
  const evt = newEvent('GET /api/monitor');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const rows = await fetchUnpaidRows(supabase);
    const total = rows.reduce((acc, r) => acc + r.total, 0);

    evt.merge({ unpaid_count: rows.length, unpaid_total: total });
    tagStatus(evt, 200);
    return NextResponse.json({ rows, count: rows.length, total });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 500 },
    );
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Verifikasi manual**

Run: `npm run dev`, lalu (sudah login di browser) buka `http://localhost:3000/api/monitor`.
Expected: JSON `{ "rows": [...], "count": N, "total": X }`. Kalau belum login → `{ "error": "unauthorized" }` 401.

- [ ] **Step 3: Commit**

```bash
git add app/api/monitor/route.ts
git commit -m "feat(monitor): GET /api/monitor unpaid rows endpoint"
```

---

## Task 5: Extend `PATCH /api/transactions/[id]` dengan field `paid`

**Files:**
- Modify: `app/api/transactions/[id]/route.ts`

- [ ] **Step 1: Tambah import helper**

Di bagian import (dekat baris 12), tambahkan:
```typescript
import { buildPaidUpdate } from '@/lib/monitor';
```

- [ ] **Step 2: Tambah field `paid` ke `PatchSchema`**

Di `PatchSchema` (mulai baris 18), tambahkan field sebelum `items`:
```typescript
  is_takeaway: z.boolean().optional(),
  paid: z.boolean().optional(),
  items: z
```

- [ ] **Step 3: Log field paid di PATCH handler**

Di `evt.merge({...})` dalam `PATCH` (sekitar baris 127), tambahkan satu baris:
```typescript
      patch_set_is_takeaway: parsed.data.is_takeaway ?? null,
      patch_set_paid: parsed.data.paid ?? null,
```

- [ ] **Step 4: Handle `paid` di `applyHeaderUpdate`**

Di `applyHeaderUpdate`, setelah blok `is_takeaway` (baris 240 `if (patch.is_takeaway !== undefined) headerUpdate.is_takeaway = patch.is_takeaway;`), tambahkan:
```typescript
  if (patch.paid !== undefined) {
    const { paid_at } = buildPaidUpdate(patch.paid, new Date().toISOString());
    headerUpdate.paid_at = paid_at;
    evt.set('paid_set', patch.paid);
  }
```

- [ ] **Step 5: Verifikasi kompilasi + test lama tetap hijau**

Run: `npm run lint && npm run test`
Expected: tidak ada error; semua test lama tetap PASS.

- [ ] **Step 6: Verifikasi manual toggle**

Dengan `npm run dev` + login, ambil satu `id` transaksi confirmed lalu:
```bash
# ganti <ID> dan sertakan cookie sesi via browser devtools kalau perlu
curl -X PATCH http://localhost:3000/api/transactions/<ID> \
  -H 'Content-Type: application/json' -d '{"paid":true}'
```
Expected: 200 `{ "transaction": { ..., "paid_at": "<iso>" }, ... }`. Kirim `{"paid":false}` → `paid_at` jadi `null`.

- [ ] **Step 7: Commit**

```bash
git add app/api/transactions/[id]/route.ts
git commit -m "feat(monitor): PATCH transactions accepts paid toggle"
```

---

## Task 6: Modal detail `components/monitor-detail-modal.tsx`

**Files:**
- Create: `components/monitor-detail-modal.tsx`

- [ ] **Step 1: Implementasi**

```tsx
// components/monitor-detail-modal.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';

const WIB = 'Asia/Jakarta';

type DetailItem = {
  id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: { label: string; price_delta: number }[] | null;
};

type Detail = {
  transaction: {
    id: string;
    customer_name: string | null;
    table_no: string | null;
    created_at: string;
    is_takeaway: boolean;
  };
  items: DetailItem[];
};

function formatTimeWIB(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: WIB, hour: '2-digit', minute: '2-digit',
  });
}

export function MonitorDetailModal({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/transactions/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Detail) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const total = (detail?.items ?? []).reduce(
    (acc, it) => acc + it.qty * it.unit_price_snapshot,
    0,
  );

  return (
    <Dialog
      open={id !== null}
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detail Transaksi</DialogTitle>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-clay">Memuat…</p>}

        {!loading && detail && (
          <div className="space-y-4">
            <div className="text-sm text-coal-soft">
              <span className="font-medium text-coal">
                {detail.transaction.customer_name || 'Tanpa nama'}
              </span>
              {detail.transaction.table_no && <> · Meja {detail.transaction.table_no}</>}
              {' · '}{formatTimeWIB(detail.transaction.created_at)} WIB
            </div>

            <ul className="divide-y divide-clay-soft/60 rounded-md border border-clay-soft/60">
              {detail.items.map((it) => (
                <li key={it.id} className="flex items-start justify-between gap-4 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-medium text-coal">{it.menu_name_snapshot}</span>
                      <span className="shrink-0 text-xs text-clay">× {it.qty}</span>
                    </div>
                    {(it.applied_chips ?? []).length > 0 && (
                      <div className="mt-0.5 text-xs text-coal-soft">
                        {(it.applied_chips ?? []).map((c) => c.label).join(', ')}
                      </div>
                    )}
                    {it.notes && <div className="mt-0.5 text-xs italic text-clay">{it.notes}</div>}
                  </div>
                  <div className="shrink-0 font-display text-sm text-coal tabular-nums">
                    {formatRp(it.unit_price_snapshot * it.qty)}
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex items-baseline justify-between border-t-2 border-clay-soft/80 pt-3">
              <span className="text-sm uppercase tracking-[0.18em] text-clay">Total</span>
              <span className="font-display text-2xl tracking-tight text-coal">{formatRp(total)}</span>
            </div>
          </div>
        )}

        {!loading && !detail && id !== null && (
          <p className="py-6 text-center text-sm text-brick-dark">Gagal memuat detail.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verifikasi kompilasi**

Run: `npm run lint`
Expected: tidak ada error pada file ini.

- [ ] **Step 3: Commit**

```bash
git add components/monitor-detail-modal.tsx
git commit -m "feat(monitor): read-only transaction detail modal"
```

---

## Task 7: Board `components/monitor-board.tsx`

**Files:**
- Create: `components/monitor-board.tsx`

- [ ] **Step 1: Implementasi**

```tsx
// components/monitor-board.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import type { MonitorRow } from '@/lib/monitor';
import { MonitorDetailModal } from '@/components/monitor-detail-modal';

const POLL_MS = 15_000;
const WIB = 'Asia/Jakarta';

function formatTimeWIB(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: WIB, hour: '2-digit', minute: '2-digit',
  });
}

export function MonitorBoard({ initialRows }: { initialRows: MonitorRow[] }) {
  const [rows, setRows] = useState<MonitorRow[]>(initialRows);
  const [refreshing, setRefreshing] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor');
      if (!res.ok) return;
      const data: { rows: MonitorRow[] } = await res.json();
      setRows(data.rows);
    } catch {
      // biarkan data lama saat gagal fetch
    }
  }, []);

  useEffect(() => {
    const intervalId = setInterval(fetchRows, POLL_MS);
    return () => clearInterval(intervalId);
  }, [fetchRows]);

  async function handleManualRefresh() {
    setRefreshing(true);
    await fetchRows();
    setRefreshing(false);
  }

  async function markPaid(row: MonitorRow) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== row.id)); // optimistic
    try {
      const res = await fetch(`/api/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Meja ${row.table_no ?? '-'} ditandai lunas`);
    } catch {
      setRows(prev); // rollback
      toast.error('Gagal menandai lunas, coba lagi');
    }
  }

  const total = rows.reduce((acc, r) => acc + r.total, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-coal-soft">
          {rows.length === 0 ? (
            'Tidak ada meja belum bayar'
          ) : (
            <>
              <span className="font-display text-lg text-coal">{rows.length}</span> meja belum bayar
              {' · '}total <span className="font-medium text-coal">{formatRp(total)}</span>
            </>
          )}
        </p>
        <Button variant="secondary" size="sm" onClick={handleManualRefresh} disabled={refreshing}>
          {refreshing ? 'Menyegarkan…' : '↻ Refresh'}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card variant="paper" className="px-6 py-14 text-center">
          <p className="font-display text-xl italic text-coal">Semua meja sudah bayar 🎉</p>
          <p className="mt-2 text-sm text-coal-soft">Belum ada tagihan meja yang tertunda hari ini.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.id} variant="paper" className="flex flex-col gap-3 p-4">
              <button
                type="button"
                onClick={() => setDetailId(row.id)}
                className="min-w-0 text-left"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-2xl leading-none text-coal">
                    {row.table_no ? `Meja ${row.table_no}` : 'Tanpa meja'}
                  </span>
                  <span className="shrink-0 text-xs text-clay">{formatTimeWIB(row.created_at)}</span>
                </div>
                <div className="mt-1 truncate text-sm text-coal-soft">
                  {row.customer_name || <span className="italic text-clay">tanpa nama</span>}
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-xs text-clay">{row.item_count} item</span>
                  <span className="font-display text-lg tracking-tight text-coal">{formatRp(row.total)}</span>
                </div>
              </button>

              <AlertDialog>
                <AlertDialogTrigger render={<Button className="w-full" />}>
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
            </Card>
          ))}
        </div>
      )}

      <MonitorDetailModal id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Verifikasi kompilasi**

Run: `npm run lint`
Expected: tidak ada error pada file ini.

- [ ] **Step 3: Commit**

```bash
git add components/monitor-board.tsx
git commit -m "feat(monitor): polling board with mark-paid + detail modal"
```

---

## Task 8: Halaman `app/(app)/monitor/page.tsx`

**Files:**
- Create: `app/(app)/monitor/page.tsx`

- [ ] **Step 1: Implementasi**

```tsx
// app/(app)/monitor/page.tsx
import { getSupabaseServer } from '@/lib/supabase/server';
import { fetchUnpaidRows } from '@/lib/monitor-server';
import { MonitorBoard } from '@/components/monitor-board';

export const dynamic = 'force-dynamic';

export default async function MonitorPage() {
  const supabase = await getSupabaseServer();
  const rows = await fetchUnpaidRows(supabase);

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

      <MonitorBoard initialRows={rows} />
    </div>
  );
}
```

- [ ] **Step 2: Verifikasi manual**

Run: `npm run dev`, login, buka `http://localhost:3000/monitor`.
Expected: daftar meja belum bayar (transaksi confirmed dine-in hari ini). Buat transaksi POS dine-in baru → muncul dalam ≤15 detik atau setelah klik Refresh. Klik "Lunas" → dialog → konfirmasi → kartu hilang. Klik kartu → modal detail. Toggle bungkus di transaksi → hilang dari monitor.

- [ ] **Step 3: Commit**

```bash
git add app/(app)/monitor/page.tsx
git commit -m "feat(monitor): /monitor page with SSR initial rows"
```

---

## Task 9: Tile home + link navbar

**Files:**
- Modify: `components/home-tiles.tsx`
- Modify: `components/nav.tsx`

- [ ] **Step 1: Tambah tile di `home-tiles.tsx`**

Di array `tiles`, sisipkan objek berikut setelah tile `/pos` (setelah baris `},` yang menutup objek `/pos`, sebelum objek `/transactions`):
```tsx
  {
    href: '/monitor',
    title: 'Monitor',
    subtitle: 'Meja belum bayar',
    accent: 'mustard',
    glyph: (
      <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden>
        <rect x="4" y="6" width="24" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 26h8M16 22v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="16" cy="14" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
```

- [ ] **Step 2: Tambah link di `nav.tsx`**

Di array `links` (baris 5-11), sisipkan setelah baris `/pos`:
```tsx
  { href: '/monitor',      label: 'Monitor' },
```

- [ ] **Step 3: Verifikasi manual**

Run: `npm run dev`, buka `/`. Expected: tile "Monitor" muncul di grid home; link "Monitor" muncul di navbar dan mengarah ke `/monitor`.

- [ ] **Step 4: Commit**

```bash
git add components/home-tiles.tsx components/nav.tsx
git commit -m "feat(monitor): home tile + navbar link"
```

---

## Task 10: Status bayar + undo di halaman detail

**Files:**
- Modify: `app/(app)/transactions/[id]/page.tsx`
- Modify: `components/transaction-detail.tsx`

- [ ] **Step 1: Select `paid_at` + teruskan ke komponen (page.tsx)**

Di `page.tsx`, tambahkan `paid_at` pada `.select(...)` transaksi (baris 21):
```typescript
    .select('id, status, handwritten_total, customer_name, table_no, is_takeaway, created_at, scan_image_path, daily_seq, paid_at')
```
Lalu di prop `transaction={{ ... }}` (sekitar baris 45-54), tambahkan:
```typescript
        daily_seq: tx.daily_seq ?? null,
        paid_at: tx.paid_at ?? null,
```

- [ ] **Step 2: Tambah `paid_at` ke type + badge + toggle (transaction-detail.tsx)**

Di type `Transaction` (baris 36-45), tambahkan field:
```typescript
  daily_seq?: number | null;
  paid_at?: string | null;
```

Di dalam komponen, setelah `const isDraft = ...` (baris 87), tambahkan:
```typescript
  const isPaid = !!transaction.paid_at;

  async function handleTogglePaid(paid: boolean) {
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid }),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'update-failed');
      }
      toast.success(paid ? 'Ditandai lunas' : 'Status lunas dibatalkan');
      startTransition(() => router.refresh());
    } catch (err) {
      const message = err instanceof Error ? `Gagal: ${err.message}` : 'Gagal memperbarui status bayar';
      setError(message);
      toast.error('Gagal memperbarui status bayar');
    }
  }
```

- [ ] **Step 3: Tambah badge status bayar di header status**

Di blok status header (setelah badge Confirmed, sekitar baris 166-169, di dalam `<div className="flex flex-wrap items-center gap-2">`), tambahkan badge — hanya untuk transaksi confirmed:
```tsx
          {!isDraft && (
            isPaid ? (
              <span className="rounded-full bg-leaf/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-leaf">
                ✓ Sudah bayar
              </span>
            ) : (
              <span className="rounded-full bg-brick-faint px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brick-dark">
                Belum bayar
              </span>
            )
          )}
```

- [ ] **Step 4: Tambah tombol toggle lunas/undo di baris aksi**

Di baris aksi (`<div className="flex flex-wrap items-center gap-2">` sekitar baris 290), setelah tombol Edit (`</Link>` penutup blok Edit, sebelum blok AlertDialog Hapus), tambahkan — hanya untuk confirmed:
```tsx
            {!isDraft && (
              <AlertDialog>
                <AlertDialogTrigger
                  disabled={pending}
                  render={<Button variant="secondary" />}
                >
                  {isPaid ? '↩ Batalkan lunas' : '✓ Tandai lunas'}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {isPaid ? 'Batalkan status lunas?' : 'Tandai transaksi ini lunas?'}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {isPaid
                        ? 'Transaksi akan kembali muncul di monitor sebagai belum bayar (jika masih hari ini & dine-in).'
                        : 'Transaksi akan hilang dari monitor meja belum bayar.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleTogglePaid(!isPaid)} disabled={pending}>
                      {isPaid ? 'Ya, batalkan' : 'Ya, lunas'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
```

- [ ] **Step 5: Verifikasi kompilasi + manual**

Run: `npm run lint`
Expected: tidak ada error.

Manual (`npm run dev`): buka detail transaksi confirmed. Expected: badge "Belum bayar"/"Sudah bayar" tampil; tombol "Tandai lunas"/"Batalkan lunas" berfungsi (dialog → refresh → badge berubah). Setelah "Tandai lunas", transaksi hilang dari `/monitor`; setelah "Batalkan lunas", muncul lagi (jika hari ini & dine-in).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/transactions/[id]/page.tsx" components/transaction-detail.tsx
git commit -m "feat(monitor): paid status badge + mark/undo on transaction detail"
```

---

## Task 11: Verifikasi menyeluruh

- [ ] **Step 1: Lint + test + build**

Run: `npm run lint && npm run test && npm run build`
Expected: lint bersih, semua test PASS (termasuk `lib/monitor.test.ts`), build sukses.

- [ ] **Step 2: Smoke test end-to-end (`npm run dev`)**

Checklist manual:
- [ ] Buat transaksi POS dine-in → muncul di `/monitor`.
- [ ] Buat transaksi POS bungkus (`is_takeaway`) → TIDAK muncul di `/monitor`.
- [ ] Transaksi `pending_review` (scan belum confirm) → TIDAK muncul.
- [ ] Klik kartu → modal detail tampil benar (item, chip, total).
- [ ] Klik "Lunas" → dialog → konfirmasi → kartu hilang.
- [ ] Buka detail transaksi yang tadi → badge "Sudah bayar" + tombol "Batalkan lunas".
- [ ] Klik "Batalkan lunas" → kembali muncul di `/monitor`.
- [ ] Laporan harian (`/reports/daily`) angka omzet TIDAK berubah oleh status bayar (bandingkan sebelum/sesudah tandai lunas).

- [ ] **Step 3: Commit (jika ada perbaikan dari smoke test)**

```bash
git add -A
git commit -m "test(monitor): verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:** data model (T1), filter monitor (T3), route & polling (T4, T7, T8), tandai lunas + dialog (T7), modal detail tanpa redirect (T6, T7), undo di detail (T10), tile "Monitor" + nav (T9), laporan tidak disentuh (tidak ada perubahan `report_*`; diverifikasi T11 Step 2), testing (T2 pure helpers + verifikasi manual sesuai gaya repo). ✅
- **Idempotency tandai lunas:** `buildPaidUpdate` set nilai absolut; klik ganda / dua device set `paid_at` yang sama → no-op, tanpa error. Optimistic UI di board mencegah double-tap di satu device.
- **Edge cases** (soft-delete, toggle bungkus, ganti hari bisnis) tertangani oleh filter query di `fetchUnpaidRows` — tidak butuh kode tambahan.
- **Konsistensi tipe:** `MonitorRow` (T2) dipakai konsisten di `monitor-server.ts` (T3), `route.ts` (T4), `monitor-board.tsx` (T7). Field `paid`/`paid_at` konsisten antara schema PATCH (T5), `buildPaidUpdate` (T2), detail (T10).
