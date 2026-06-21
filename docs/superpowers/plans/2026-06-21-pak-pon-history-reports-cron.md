# Pak Pon — Plan 3: History + Reports + Cron

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiga subsystem nyambung jadi satu workflow — kasir/owner bisa cari & buka history transaksi dengan filter tanggal + nama, edit/hapus dari detail, lihat closingan harian (cocokkan kas fisik) + laporan bulanan dengan bar chart pemasukan per hari + top-5 menu, dan cron 02:00 WIB auto-hapus transaksi soft-deleted >7 hari termasuk foto Storage-nya.

**Architecture:** Server components untuk semua halaman list/detail (data fetch langsung di RSC, no client query). API routes thin — fetch dari Supabase, agregasi di JS (volume kecil). Filter tanggal pakai search params (`?date=`, `?ym=`). Cron pakai service-role Supabase client (bypass RLS) di `lib/supabase/admin.ts` + Vercel cron config. Bar chart bulanan = pure CSS bars (no chart library). Edit transaksi reuse `/transactions/[id]/review` yang sudah ada — detail page link ke situ.

**Tech Stack:** Next.js 16 App Router · server components default · Supabase JS (nested select untuk fetch tx+items) · Asia/Jakarta timezone via custom helper · Vercel Cron (UTC scheduling) · Tailwind v4 design tokens.

**Source spec:** `docs/superpowers/specs/2026-06-20-pak-pon-design.md` (§3 US-2/3/4, §6 routes, §7 API contract, §12 cron)

**Logging:** semua route handler wajib pakai wide-event pattern (`lib/logger.ts`, `try/catch/finally`, `evt.emit()`). Lihat `docs/logging.md`.

**Prerequisites:**
- Plan 1 + Plan 2 selesai
- `CRON_SECRET` harus diisi di `.env.local` (generate random 32-char) + Vercel env vars sebelum deploy
- `SUPABASE_SECRET_KEY` (service role key) sudah ada di env (sudah di-set sejak Plan 1)

---

## File map

```
pak-pon/
├── lib/
│   ├── date.ts                                   # (T1) WIB helpers — startOfDay, endOfDay, today, parseYmd, parseYm
│   ├── date.test.ts                              # (T1)
│   └── supabase/
│       └── admin.ts                              # (T12) service-role client untuk cron
├── app/
│   ├── api/
│   │   ├── transactions/
│   │   │   ├── route.ts                          # (T2) GET list with filters
│   │   │   └── [id]/route.ts                     # (T3) ADD: DELETE handler + fix confirmed_at preservation
│   │   ├── reports/
│   │   │   ├── daily/route.ts                    # (T7) GET ?date=YYYY-MM-DD
│   │   │   └── monthly/route.ts                  # (T8) GET ?ym=YYYY-MM
│   │   └── cron/
│   │       └── cleanup/route.ts                  # (T12) POST — hard delete + Storage cleanup
│   └── (app)/
│       ├── transactions/
│       │   ├── page.tsx                          # (T5) history list page
│       │   └── [id]/page.tsx                     # (T6) detail (read-only) — review screen tetap di /review
│       └── reports/
│           ├── page.tsx                          # (T11) landing → 2 tile link
│           ├── daily/page.tsx                    # (T9)
│           └── monthly/page.tsx                  # (T10)
├── components/
│   ├── date-filter.tsx                           # (T4) date range + search bar UI
│   ├── transaction-list.tsx                      # (T4) list rendering + pagination controls
│   ├── transaction-detail.tsx                    # (T6) read-only render of tx + items + foto + buttons
│   ├── daily-summary.tsx                         # (T9) big total + count + top items
│   └── monthly-chart.tsx                         # (T10) CSS bar chart + month nav
├── vercel.json                                   # (T12) ADD: crons[] entry
└── docs/tasks.md                                 # (T13) mark Plan 3 complete
```

**Responsibilities:**
- `lib/date.ts` = single source of truth for WIB datetime math. All routes/pages use it — never `new Date().toISOString().slice(0,10)` ad-hoc.
- `lib/supabase/admin.ts` = service-role client. ONLY for cron + admin scripts. Never imported from user-facing API.
- `components/transaction-list.tsx` = pagination + sorting. Pure presentation, receives data + page nav as props.
- `components/transaction-detail.tsx` = read-only mirror of nota-review-form layout. No editing logic.
- API routes = thin (fetch + aggregate + return). All aggregation logic in JS, volume kecil cukup.

---

## Task 1: `lib/date.ts` — WIB date helpers (TDD)

**Files:**
- Create: `lib/date.ts`
- Create: `lib/date.test.ts`

WIB = UTC+7, no DST. We need: `today()` returns `YYYY-MM-DD` of current WIB date, `startOfDayWIB(ymd)` and `endOfDayWIB(ymd)` return ISO timestamps usable as Postgres `created_at` filters, `parseYmd(s)` validates `YYYY-MM-DD`, `parseYm(s)` validates `YYYY-MM` and gives month boundary.

- [ ] **Step 1.1: Write failing tests**

Create `lib/date.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { today, startOfDayWIB, endOfDayWIB, parseYmd, parseYm, monthBoundsWIB } from './date';

describe('today()', () => {
  it('returns YYYY-MM-DD string', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('startOfDayWIB', () => {
  it('returns UTC ISO at 17:00 previous day (00:00 WIB = 17:00 UTC prev)', () => {
    // 2026-06-15 00:00 WIB → 2026-06-14 17:00 UTC
    expect(startOfDayWIB('2026-06-15')).toBe('2026-06-14T17:00:00.000Z');
  });
});

describe('endOfDayWIB', () => {
  it('returns start of next day (exclusive upper bound)', () => {
    expect(endOfDayWIB('2026-06-15')).toBe('2026-06-15T17:00:00.000Z');
  });
});

describe('parseYmd', () => {
  it('accepts valid YYYY-MM-DD', () => {
    expect(parseYmd('2026-06-15')).toBe('2026-06-15');
  });
  it('rejects invalid format', () => {
    expect(parseYmd('2026-6-15')).toBeNull();
    expect(parseYmd('not-a-date')).toBeNull();
    expect(parseYmd('2026-13-01')).toBeNull();
  });
});

describe('parseYm', () => {
  it('accepts valid YYYY-MM', () => {
    expect(parseYm('2026-06')).toBe('2026-06');
  });
  it('rejects invalid', () => {
    expect(parseYm('2026-6')).toBeNull();
    expect(parseYm('2026-13')).toBeNull();
  });
});

describe('monthBoundsWIB', () => {
  it('returns [startOfMonth, startOfNextMonth] in UTC', () => {
    const { from, to } = monthBoundsWIB('2026-06');
    expect(from).toBe('2026-05-31T17:00:00.000Z'); // 2026-06-01 00:00 WIB
    expect(to).toBe('2026-06-30T17:00:00.000Z');   // 2026-07-01 00:00 WIB
  });
  it('wraps year correctly for December', () => {
    const { to } = monthBoundsWIB('2026-12');
    expect(to).toBe('2026-12-31T17:00:00.000Z'); // 2027-01-01 00:00 WIB
  });
});
```

- [ ] **Step 1.2: Run failing tests**

```bash
npm run test -- lib/date.test.ts
```

Expected: FAIL "Failed to resolve import './date'".

- [ ] **Step 1.3: Implement `lib/date.ts`**

```ts
/**
 * WIB (Asia/Jakarta, UTC+7, no DST) date helpers.
 * All Postgres `created_at` filters MUST use these — never inline date math.
 */

const WIB_OFFSET_HOURS = 7;

/**
 * Current date in WIB as YYYY-MM-DD.
 */
export function today(): string {
  const now = new Date();
  // Shift to WIB-local time, then take ISO date portion
  const wibMs = now.getTime() + WIB_OFFSET_HOURS * 3600 * 1000;
  return new Date(wibMs).toISOString().slice(0, 10);
}

/**
 * Start of given YYYY-MM-DD in WIB, as UTC ISO timestamp.
 * Use as inclusive lower bound for `created_at >= startOfDayWIB(ymd)`.
 */
export function startOfDayWIB(ymd: string): string {
  // 00:00 WIB = 17:00 UTC previous day
  // Easier: '2026-06-15T00:00:00+07:00' → ISO
  return new Date(`${ymd}T00:00:00+07:00`).toISOString();
}

/**
 * Exclusive upper bound — start of NEXT day in WIB, as UTC ISO timestamp.
 * Use as `created_at < endOfDayWIB(ymd)`.
 */
export function endOfDayWIB(ymd: string): string {
  const start = new Date(`${ymd}T00:00:00+07:00`);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString();
}

/**
 * Validate YYYY-MM-DD. Returns the same string if valid, null otherwise.
 * Rejects '2026-6-15' (no zero padding), '2026-13-01' (invalid month),
 * '2026-02-30' (auto-corrected by JS Date).
 */
export function parseYmd(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+07:00`);
  if (isNaN(d.getTime())) return null;
  // Reject auto-corrected dates by re-deriving the WIB date from the parsed value
  // and comparing — '2026-02-30' would roll to '2026-03-02' and fail the check.
  const wibMs = d.getTime() + WIB_OFFSET_HOURS * 3600 * 1000;
  const wibDate = new Date(wibMs).toISOString().slice(0, 10);
  return wibDate === s ? s : null;
}

/**
 * Validate YYYY-MM. Returns the same string if valid, null otherwise.
 */
export function parseYm(s: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const [, mStr] = s.split('-');
  const m = parseInt(mStr, 10);
  if (m < 1 || m > 12) return null;
  return s;
}

/**
 * Get [start, end) UTC bounds for a YYYY-MM in WIB.
 * start = first day of month 00:00 WIB
 * end = first day of NEXT month 00:00 WIB
 */
export function monthBoundsWIB(ym: string): { from: string; to: string } {
  const [yStr, mStr] = ym.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const fromYmd = `${ym}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return {
    from: startOfDayWIB(fromYmd),
    to: startOfDayWIB(nextMonth),
  };
}
```

- [ ] **Step 1.4: Run tests — verify pass**

```bash
npm run test -- lib/date.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add lib/date.ts lib/date.test.ts
git commit -m "feat(lib): WIB date helpers (today, startOfDayWIB, parseYmd, monthBoundsWIB)"
```

---

## Task 2: `GET /api/transactions` — list with filters

**Files:**
- Create: `app/api/transactions/route.ts`

Query params:
- `date_from` (YYYY-MM-DD, default = today WIB)
- `date_to` (YYYY-MM-DD, default = `date_from`)
- `q` (search customer_name, optional)
- `status` (`pending_review` | `confirmed`, optional)
- `page` (default 1, 50 per page)

Returns: `{ items: [{id, created_at, total, status, customer_name, item_count}], page, page_size, total_count }`.

Aggregation: fetch transactions with nested transaction_items (qty, unit_price_snapshot), sum in JS per row.

- [ ] **Step 2.1: Implement handler**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { today, parseYmd, startOfDayWIB, endOfDayWIB } from '@/lib/date';

const PAGE_SIZE = 50;

const QuerySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  q: z.string().optional(),
  status: z.enum(['pending_review', 'confirmed']).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/transactions');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const sp = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QuerySchema.safeParse(sp);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ reject_reason: 'invalid_query', zod_issues: parsed.error.issues });
      return NextResponse.json({ error: 'invalid_query', details: parsed.error.flatten() }, { status: 400 });
    }

    const defaultDay = today();
    const dateFrom = (parsed.data.date_from && parseYmd(parsed.data.date_from)) ?? defaultDay;
    const dateTo = (parsed.data.date_to && parseYmd(parsed.data.date_to)) ?? dateFrom;
    const page = parsed.data.page;
    evt.merge({ date_from: dateFrom, date_to: dateTo, page, q: parsed.data.q, status_filter: parsed.data.status });

    let query = supabase
      .from('transactions')
      .select(
        'id, created_at, status, customer_name, table_no, handwritten_total, transaction_items(qty, unit_price_snapshot)',
        { count: 'exact' }
      )
      .is('deleted_at', null)
      .gte('created_at', startOfDayWIB(dateFrom))
      .lt('created_at', endOfDayWIB(dateTo))
      .order('created_at', { ascending: false });

    if (parsed.data.q && parsed.data.q.trim() !== '') {
      query = query.ilike('customer_name', `%${parsed.data.q.trim()}%`);
    }
    if (parsed.data.status) {
      query = query.eq('status', parsed.data.status);
    }

    const offset = (page - 1) * PAGE_SIZE;
    query = query.range(offset, offset + PAGE_SIZE - 1);

    const { data, error, count } = await query;
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = (data ?? []).map((tx) => {
      const lines = (tx.transaction_items ?? []) as Array<{ qty: number; unit_price_snapshot: number }>;
      const total = lines.reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
      return {
        id: tx.id,
        created_at: tx.created_at,
        status: tx.status,
        customer_name: tx.customer_name,
        table_no: tx.table_no,
        handwritten_total: tx.handwritten_total,
        total,
        item_count: lines.length,
      };
    });

    evt.merge({ items_count: items.length, total_count: count ?? 0 });
    tagStatus(evt, 200);
    return NextResponse.json({
      items,
      page,
      page_size: PAGE_SIZE,
      total_count: count ?? 0,
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2.2: Typecheck + build**

```bash
npx tsc --noEmit && npm run build
```

Expected: zero errors. Route `ƒ /api/transactions` appears.

- [ ] **Step 2.3: Commit**

```bash
git add app/api/transactions/route.ts
git commit -m "feat(api): GET /api/transactions list with date/search/status filters + pagination"
```

---

## Task 3: `DELETE /api/transactions/[id]` + preserve `confirmed_at`

**Files:**
- Modify: `app/api/transactions/[id]/route.ts`

Soft delete = `update({ deleted_at: now() })`. Also fix: PATCH currently overwrites `confirmed_at` every time `status='confirmed'` is sent. Should only set on transition pending → confirmed.

- [ ] **Step 3.1: Read current file**

```bash
cat "app/api/transactions/[id]/route.ts"
```

You'll modify the PATCH handler's header update block, and append a DELETE export.

- [ ] **Step 3.2: Fix `confirmed_at` preservation in PATCH**

Find this block inside the `applyHeaderUpdate` helper:

```ts
  if (patch.status !== undefined) {
    headerUpdate.status = patch.status;
    if (patch.status === 'confirmed') {
      headerUpdate.confirmed_at = new Date().toISOString();
    }
  }
```

Replace with:

```ts
  if (patch.status !== undefined) {
    headerUpdate.status = patch.status;
    if (patch.status === 'confirmed') {
      // Only set confirmed_at on transition (preserve original timestamp on re-edit)
      const { data: existing } = await supabase
        .from('transactions')
        .select('confirmed_at')
        .eq('id', id)
        .single();
      if (!existing?.confirmed_at) {
        headerUpdate.confirmed_at = new Date().toISOString();
      }
    }
  }
```

- [ ] **Step 3.3: Add DELETE handler**

Append at the bottom of `app/api/transactions/[id]/route.ts`, before the file ends:

```ts
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('DELETE /api/transactions/[id]', { tx_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { error } = await supabase
      .from('transactions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
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
    tagStatus(evt, 200);
    return NextResponse.json({ ok: true });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 3.4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3.5: Commit**

```bash
git add "app/api/transactions/[id]/route.ts"
git commit -m "feat(api): DELETE /api/transactions/[id] (soft) + preserve confirmed_at on re-edit"
```

---

## Task 4: `components/date-filter.tsx` + `components/transaction-list.tsx`

**Files:**
- Create: `components/date-filter.tsx`
- Create: `components/transaction-list.tsx`

`DateFilter` = controlled date range + search input + status select. Updates URL search params (uses `next/navigation` router.replace).

`TransactionList` = pure presentation. Receives `items`, renders rows. Pagination buttons.

- [ ] **Step 4.1: Implement `components/date-filter.tsx`**

```tsx
'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { today } from '@/lib/date';

export function DateFilter() {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const dateFrom = sp.get('date_from') ?? today();
  const dateTo = sp.get('date_to') ?? dateFrom;
  const q = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';

  function update(key: string, value: string) {
    const next = new URLSearchParams(sp.toString());
    if (value === '') next.delete(key);
    else next.set(key, value);
    // reset page on any filter change
    next.delete('page');
    startTransition(() => {
      router.replace(`?${next.toString()}`);
    });
  }

  function quickRange(days: number) {
    const to = today();
    const fromDate = new Date(`${to}T00:00:00+07:00`);
    fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
    const from = fromDate.toISOString().slice(0, 10);
    const next = new URLSearchParams(sp.toString());
    next.set('date_from', from);
    next.set('date_to', to);
    next.delete('page');
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="date_from">Dari tanggal</Label>
          <Input
            id="date_from"
            type="date"
            value={dateFrom}
            onChange={(e) => update('date_from', e.target.value)}
            className="mt-2"
          />
        </div>
        <div>
          <Label htmlFor="date_to">Sampai tanggal</Label>
          <Input
            id="date_to"
            type="date"
            value={dateTo}
            onChange={(e) => update('date_to', e.target.value)}
            className="mt-2"
          />
        </div>
        <div>
          <Label htmlFor="q">Cari nama</Label>
          <Input
            id="q"
            value={q}
            placeholder="cth: Pak Budi"
            onChange={(e) => update('q', e.target.value)}
            className="mt-2"
          />
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            value={status}
            onChange={(e) => update('status', e.target.value)}
            className="mt-2 block w-full rounded-md border border-clay-soft bg-paper-soft px-3 py-2 text-sm text-coal"
          >
            <option value="">Semua</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending_review">Pending Review</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => quickRange(1)} disabled={pending}>Hari ini</Button>
        <Button size="sm" variant="ghost" onClick={() => quickRange(7)} disabled={pending}>7 hari</Button>
        <Button size="sm" variant="ghost" onClick={() => quickRange(30)} disabled={pending}>30 hari</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2: Implement `components/transaction-list.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';

export type TxRow = {
  id: string;
  created_at: string;
  status: 'pending_review' | 'confirmed';
  customer_name: string | null;
  table_no: string | null;
  handwritten_total: number | null;
  total: number;
  item_count: number;
};

const WIB = 'Asia/Jakarta';

function formatWIB(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('id-ID', {
    timeZone: WIB,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function TransactionList({
  items,
  page,
  pageSize,
  totalCount,
}: {
  items: TxRow[];
  page: number;
  pageSize: number;
  totalCount: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function goPage(p: number) {
    const next = new URLSearchParams(sp.toString());
    next.set('page', String(p));
    router.replace(`?${next.toString()}`);
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <Card variant="paper" className="px-5 py-10 text-center text-sm text-clay">
          Tidak ada transaksi dalam rentang ini.
        </Card>
      ) : (
        <Card variant="paper">
          <ul className="divide-y divide-clay-soft/60">
            {items.map((tx) => (
              <li key={tx.id}>
                <Link
                  href={`/transactions/${tx.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-cream/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-coal">
                        {tx.customer_name || <span className="text-clay italic">— tanpa nama</span>}
                      </span>
                      {tx.table_no && (
                        <span className="text-xs text-clay">Meja {tx.table_no}</span>
                      )}
                      {tx.status === 'pending_review' && (
                        <span className="rounded-full bg-mustard-faint px-2 py-0.5 text-[10px] uppercase tracking-wide text-coal">
                          Draft
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-clay">
                      {formatWIB(tx.created_at)} · {tx.item_count} item
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-lg tracking-tight text-coal">
                      {formatRp(tx.total)}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-clay">
            Halaman {page} dari {totalPages} ({totalCount} transaksi)
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => goPage(page - 1)} disabled={page <= 1}>
              ‹ Prev
            </Button>
            <Button size="sm" variant="secondary" onClick={() => goPage(page + 1)} disabled={page >= totalPages}>
              Next ›
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4.3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4.4: Commit**

```bash
git add components/date-filter.tsx components/transaction-list.tsx
git commit -m "feat(history): DateFilter (URL-driven) + TransactionList with pagination"
```

---

## Task 5: `app/(app)/transactions/page.tsx` — history list page

**Files:**
- Create: `app/(app)/transactions/page.tsx`

Server component. Fetch list via internal call to `/api/transactions` route logic… actually duplicate the fetch directly (no extra HTTP hop). Use same Zod schema + helpers.

- [ ] **Step 5.1: Implement page**

```tsx
import { Suspense } from 'react';
import { getSupabaseServer } from '@/lib/supabase/server';
import { today, parseYmd, startOfDayWIB, endOfDayWIB } from '@/lib/date';
import { DateFilter } from '@/components/date-filter';
import { TransactionList, type TxRow } from '@/components/transaction-list';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SearchParams = {
  date_from?: string;
  date_to?: string;
  q?: string;
  status?: string;
  page?: string;
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await getSupabaseServer();

  const defaultDay = today();
  const dateFrom = (sp.date_from && parseYmd(sp.date_from)) ?? defaultDay;
  const dateTo = (sp.date_to && parseYmd(sp.date_to)) ?? dateFrom;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const q = (sp.q ?? '').trim();
  const statusFilter =
    sp.status === 'pending_review' || sp.status === 'confirmed' ? sp.status : null;

  let query = supabase
    .from('transactions')
    .select(
      'id, created_at, status, customer_name, table_no, handwritten_total, transaction_items(qty, unit_price_snapshot)',
      { count: 'exact' }
    )
    .is('deleted_at', null)
    .gte('created_at', startOfDayWIB(dateFrom))
    .lt('created_at', endOfDayWIB(dateTo))
    .order('created_at', { ascending: false });

  if (q !== '') query = query.ilike('customer_name', `%${q}%`);
  if (statusFilter) query = query.eq('status', statusFilter);

  const offset = (page - 1) * PAGE_SIZE;
  query = query.range(offset, offset + PAGE_SIZE - 1);

  const { data, count } = await query;

  const items: TxRow[] = (data ?? []).map((tx) => {
    const lines = (tx.transaction_items ?? []) as Array<{ qty: number; unit_price_snapshot: number }>;
    const total = lines.reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
    return {
      id: tx.id,
      created_at: tx.created_at,
      status: tx.status,
      customer_name: tx.customer_name,
      table_no: tx.table_no,
      handwritten_total: tx.handwritten_total,
      total,
      item_count: lines.length,
    };
  });

  return (
    <div className="space-y-8">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          History
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Transaksi <span className="italic">tersimpan</span>
        </h1>
      </div>

      <Suspense>
        <DateFilter />
      </Suspense>

      <Suspense>
        <TransactionList
          items={items}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={count ?? 0}
        />
      </Suspense>
    </div>
  );
}
```

> Note: `DateFilter` & `TransactionList` are client components using `useSearchParams` — Next 16 requires wrapping them in `<Suspense>` when rendered from a server component, otherwise build fails with "useSearchParams() should be wrapped in a suspense boundary".

- [ ] **Step 5.2: Build to verify**

```bash
npm run build
```

Expected: `/transactions` listed as `ƒ`, no useSearchParams warning.

- [ ] **Step 5.3: Commit**

```bash
git add "app/(app)/transactions/page.tsx"
git commit -m "feat(history): /transactions page with filter + paginated list"
```

---

## Task 6: `app/(app)/transactions/[id]/page.tsx` — detail (read-only)

**Files:**
- Create: `components/transaction-detail.tsx`
- Create: `app/(app)/transactions/[id]/page.tsx`

Read-only detail page. Two buttons: "Edit" (link to `/transactions/[id]/review`) + "Hapus" (DELETE + redirect to `/transactions`).

- [ ] **Step 6.1: Implement `components/transaction-detail.tsx`**

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';

type Item = {
  id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
};

type Transaction = {
  id: string;
  status: 'pending_review' | 'confirmed';
  handwritten_total: number | null;
  customer_name: string | null;
  table_no: string | null;
  created_at: string;
};

const WIB = 'Asia/Jakarta';

function formatWIB(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    timeZone: WIB,
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function TransactionDetail({
  transaction,
  items,
  scanUrl,
}: {
  transaction: Transaction;
  items: Item[];
  scanUrl: string | null;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((acc, it) => acc + it.qty * it.unit_price_snapshot, 0);
  const mismatch =
    !!transaction.handwritten_total && transaction.handwritten_total !== total;

  async function handleDelete() {
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'delete-failed');
      }
      startTransition(() => router.push('/transactions'));
    } catch (err) {
      setError(err instanceof Error ? `Gagal menghapus: ${err.message}` : 'Gagal menghapus');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Detail Transaksi
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          {transaction.customer_name || <span className="italic">tanpa nama</span>}
        </h1>
        <p className="mt-2 text-sm text-coal-soft">
          {formatWIB(transaction.created_at)}
          {transaction.table_no && <> · Meja {transaction.table_no}</>}
          {transaction.status === 'pending_review' && (
            <span className="ml-2 rounded-full bg-mustard-faint px-2 py-0.5 text-[10px] uppercase tracking-wide text-coal">
              Draft
            </span>
          )}
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
          {mismatch && (
            <div
              className="rounded-md border border-mustard/40 bg-mustard-faint px-4 py-3 text-sm text-coal"
              role="alert"
            >
              ⚠️ Total tulisan tangan {formatRp(transaction.handwritten_total!)} ≠ perhitungan sistem {formatRp(total)}.
            </div>
          )}

          <Card variant="paper">
            <ul className="divide-y divide-clay-soft/60">
              {items.length === 0 ? (
                <li className="px-5 py-8 text-center text-sm text-clay">Tidak ada item.</li>
              ) : (
                items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-coal">{it.menu_name_snapshot}</span>
                        <span className="text-xs text-clay">× {it.qty}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-clay">
                        {formatRp(it.unit_price_snapshot)} ea
                        {it.notes && <> · <span className="italic">{it.notes}</span></>}
                      </div>
                    </div>
                    <div className="font-display text-base text-coal">
                      {formatRp(it.unit_price_snapshot * it.qty)}
                    </div>
                  </li>
                ))
              )}
            </ul>
            <div className="border-t border-clay-soft/60 px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm uppercase tracking-wide text-clay">Total sistem</span>
                <span className="font-display text-2xl tracking-tight text-coal">
                  {formatRp(total)}
                </span>
              </div>
            </div>
          </Card>

          {error && (
            <p
              className="rounded-md border border-brick/30 bg-brick-faint px-3 py-2 text-sm text-brick-dark"
              role="alert"
            >
              {error}
            </p>
          )}

          {!confirmDelete ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => router.push('/transactions')} disabled={pending}>
                ‹ Kembali
              </Button>
              <Link href={`/transactions/${transaction.id}/review`} className="ml-auto">
                <Button variant="secondary" disabled={pending}>✏️ Edit</Button>
              </Link>
              <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={pending}>
                🗑️ Hapus
              </Button>
            </div>
          ) : (
            <Card variant="paper" className="space-y-3 p-4">
              <p className="text-sm text-coal">
                Yakin hapus transaksi ini? Bisa di-restore dalam 7 hari (cron auto-cleanup setelah itu).
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={pending}>
                  Batal
                </Button>
                <Button variant="danger" onClick={handleDelete} disabled={pending}>
                  {pending ? 'Menghapus…' : 'Ya, hapus'}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6.2: Implement `app/(app)/transactions/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { TransactionDetail } from '@/components/transaction-detail';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'notas';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getSupabaseServer();

  const { data: tx } = await supabase
    .from('transactions')
    .select('id, status, handwritten_total, customer_name, table_no, created_at, scan_image_path')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (!tx) notFound();

  const { data: items } = await supabase
    .from('transaction_items')
    .select('id, menu_name_snapshot, unit_price_snapshot, qty, notes, sort_order')
    .eq('transaction_id', id)
    .order('sort_order');

  let scanUrl: string | null = null;
  if (tx.scan_image_path) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(tx.scan_image_path, SIGNED_URL_TTL_SECONDS);
    scanUrl = signed?.signedUrl ?? null;
  }

  return (
    <TransactionDetail
      transaction={{
        id: tx.id,
        status: tx.status,
        handwritten_total: tx.handwritten_total,
        customer_name: tx.customer_name,
        table_no: tx.table_no,
        created_at: tx.created_at,
      }}
      items={items ?? []}
      scanUrl={scanUrl}
    />
  );
}
```

- [ ] **Step 6.3: Build**

```bash
npm run build
```

Expected: `ƒ /transactions/[id]` listed.

- [ ] **Step 6.4: Commit**

```bash
git add components/transaction-detail.tsx "app/(app)/transactions/[id]/page.tsx"
git commit -m "feat(history): detail page (read-only) with Edit/Delete + soft-delete confirmation"
```

---

## Task 7: `GET /api/reports/daily`

**Files:**
- Create: `app/api/reports/daily/route.ts`

Returns: `{ date, total, count, top_items: [{menu_name, qty, revenue}] }`.

- [ ] **Step 7.1: Implement**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { today, parseYmd, startOfDayWIB, endOfDayWIB } from '@/lib/date';

const QuerySchema = z.object({
  date: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/reports/daily');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      tagStatus(evt, 400);
      return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
    }
    const date = (parsed.data.date && parseYmd(parsed.data.date)) ?? today();
    evt.set('date', date);

    const { data, error } = await supabase
      .from('transactions')
      .select('id, transaction_items(qty, unit_price_snapshot, menu_name_snapshot)')
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .gte('created_at', startOfDayWIB(date))
      .lt('created_at', endOfDayWIB(date));

    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const txs = data ?? [];
    let total = 0;
    const byMenu = new Map<string, { qty: number; revenue: number }>();

    for (const tx of txs) {
      const lines = (tx.transaction_items ?? []) as Array<{
        qty: number; unit_price_snapshot: number; menu_name_snapshot: string;
      }>;
      for (const l of lines) {
        const lineTotal = l.qty * l.unit_price_snapshot;
        total += lineTotal;
        const prev = byMenu.get(l.menu_name_snapshot) ?? { qty: 0, revenue: 0 };
        byMenu.set(l.menu_name_snapshot, {
          qty: prev.qty + l.qty,
          revenue: prev.revenue + lineTotal,
        });
      }
    }

    const topItems = [...byMenu.entries()]
      .map(([menu_name, v]) => ({ menu_name, qty: v.qty, revenue: v.revenue }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    evt.merge({ tx_count: txs.length, total, top_items_count: topItems.length });
    tagStatus(evt, 200);
    return NextResponse.json({
      date,
      total,
      count: txs.length,
      top_items: topItems,
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 7.2: Build + commit**

```bash
npm run build
git add app/api/reports/daily/route.ts
git commit -m "feat(api): GET /api/reports/daily — total + count + top-5 items"
```

---

## Task 8: `GET /api/reports/monthly`

**Files:**
- Create: `app/api/reports/monthly/route.ts`

Returns: `{ month, total, count, daily: [{date, total, count}], top_items: [...] }`. Daily breakdown ada untuk semua tanggal di bulan itu (zero-fill yang tidak ada transaksi).

- [ ] **Step 8.1: Implement**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { parseYm, monthBoundsWIB } from '@/lib/date';

const QuerySchema = z.object({ ym: z.string().optional() });

function currentYmWIB(): string {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  return now.toISOString().slice(0, 7);
}

function daysInMonthWIB(ym: string): string[] {
  const [yStr, mStr] = ym.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  // last day = day 0 of next month
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, i) =>
    `${ym}-${String(i + 1).padStart(2, '0')}`
  );
}

const WIB = 'Asia/Jakarta';

function ymdInWIB(iso: string): string {
  // Postgres timestamptz → WIB date
  const d = new Date(iso);
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/reports/monthly');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      tagStatus(evt, 400);
      return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
    }
    const ym = (parsed.data.ym && parseYm(parsed.data.ym)) ?? currentYmWIB();
    evt.set('ym', ym);

    const { from, to } = monthBoundsWIB(ym);
    const { data, error } = await supabase
      .from('transactions')
      .select('id, created_at, transaction_items(qty, unit_price_snapshot, menu_name_snapshot)')
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .gte('created_at', from)
      .lt('created_at', to);

    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const txs = data ?? [];
    const byDay = new Map<string, { total: number; count: number }>();
    const byMenu = new Map<string, { qty: number; revenue: number }>();
    let grandTotal = 0;

    for (const tx of txs) {
      const day = ymdInWIB(tx.created_at);
      const lines = (tx.transaction_items ?? []) as Array<{
        qty: number; unit_price_snapshot: number; menu_name_snapshot: string;
      }>;
      const txTotal = lines.reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
      grandTotal += txTotal;
      const day_ = byDay.get(day) ?? { total: 0, count: 0 };
      byDay.set(day, { total: day_.total + txTotal, count: day_.count + 1 });

      for (const l of lines) {
        const prev = byMenu.get(l.menu_name_snapshot) ?? { qty: 0, revenue: 0 };
        byMenu.set(l.menu_name_snapshot, {
          qty: prev.qty + l.qty,
          revenue: prev.revenue + l.qty * l.unit_price_snapshot,
        });
      }
    }

    const allDays = daysInMonthWIB(ym);
    const daily = allDays.map((date) => {
      const v = byDay.get(date) ?? { total: 0, count: 0 };
      return { date, total: v.total, count: v.count };
    });

    const topItems = [...byMenu.entries()]
      .map(([menu_name, v]) => ({ menu_name, qty: v.qty, revenue: v.revenue }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    evt.merge({ tx_count: txs.length, grand_total: grandTotal, days_with_tx: byDay.size });
    tagStatus(evt, 200);
    return NextResponse.json({
      month: ym,
      total: grandTotal,
      count: txs.length,
      daily,
      top_items: topItems,
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 8.2: Build + commit**

```bash
npm run build
git add app/api/reports/monthly/route.ts
git commit -m "feat(api): GET /api/reports/monthly — daily breakdown + top-5 items"
```

---

## Task 9: `components/daily-summary.tsx` + `app/(app)/reports/daily/page.tsx`

**Files:**
- Create: `components/daily-summary.tsx`
- Create: `app/(app)/reports/daily/page.tsx`

Big total in the middle, count + top-5 list, date picker that updates URL.

- [ ] **Step 9.1: Implement `components/daily-summary.tsx`**

```tsx
'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';
import { today } from '@/lib/date';

type TopItem = { menu_name: string; qty: number; revenue: number };

export function DailySummary({
  date,
  total,
  count,
  topItems,
}: {
  date: string;
  total: number;
  count: number;
  topItems: TopItem[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setDate(d: string) {
    const next = new URLSearchParams(sp.toString());
    next.set('date', d);
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  function shiftDay(days: number) {
    const d = new Date(`${date}T00:00:00+07:00`);
    d.setUTCDate(d.getUTCDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="date">Tanggal</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-2"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => shiftDay(-1)} disabled={pending}>‹ kemarin</Button>
          <Button size="sm" variant="ghost" onClick={() => setDate(today())} disabled={pending}>hari ini</Button>
          <Button size="sm" variant="ghost" onClick={() => shiftDay(1)} disabled={pending}>besok ›</Button>
        </div>
      </div>

      <Card variant="paper" className="px-6 py-10 text-center">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Total Pemasukan
        </p>
        <p className="mt-3 font-display text-5xl tracking-tight text-coal md:text-6xl">
          {formatRp(total)}
        </p>
        <p className="mt-3 text-sm text-coal-soft">
          dari <strong>{count}</strong> transaksi
        </p>
      </Card>

      {topItems.length > 0 && (
        <Card variant="paper">
          <div className="border-b border-clay-soft/60 px-5 py-3">
            <p className="text-xs uppercase tracking-wider text-clay">Top menu hari ini</p>
          </div>
          <ul className="divide-y divide-clay-soft/60">
            {topItems.map((it, i) => (
              <li key={it.menu_name} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-display text-lg text-clay w-6">{i + 1}</span>
                  <div>
                    <div className="font-medium text-coal">{it.menu_name}</div>
                    <div className="text-xs text-clay">{it.qty} porsi</div>
                  </div>
                </div>
                <div className="font-display text-base text-coal">{formatRp(it.revenue)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 9.2: Implement `app/(app)/reports/daily/page.tsx`**

```tsx
import { Suspense } from 'react';
import { getSupabaseServer } from '@/lib/supabase/server';
import { today, parseYmd, startOfDayWIB, endOfDayWIB } from '@/lib/date';
import { DailySummary } from '@/components/daily-summary';

export const dynamic = 'force-dynamic';

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date = (sp.date && parseYmd(sp.date)) ?? today();
  const supabase = await getSupabaseServer();

  const { data } = await supabase
    .from('transactions')
    .select('id, transaction_items(qty, unit_price_snapshot, menu_name_snapshot)')
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .gte('created_at', startOfDayWIB(date))
    .lt('created_at', endOfDayWIB(date));

  const txs = data ?? [];
  let total = 0;
  const byMenu = new Map<string, { qty: number; revenue: number }>();
  for (const tx of txs) {
    const lines = (tx.transaction_items ?? []) as Array<{
      qty: number; unit_price_snapshot: number; menu_name_snapshot: string;
    }>;
    for (const l of lines) {
      const lt = l.qty * l.unit_price_snapshot;
      total += lt;
      const prev = byMenu.get(l.menu_name_snapshot) ?? { qty: 0, revenue: 0 };
      byMenu.set(l.menu_name_snapshot, { qty: prev.qty + l.qty, revenue: prev.revenue + lt });
    }
  }
  const topItems = [...byMenu.entries()]
    .map(([menu_name, v]) => ({ menu_name, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Laporan Harian
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Closingan <span className="italic">harian</span>
        </h1>
        <p className="mt-2 text-sm text-coal-soft">
          Cocokkan total sistem dengan uang fisik di laci.
        </p>
      </div>

      <Suspense>
        <DailySummary date={date} total={total} count={txs.length} topItems={topItems} />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 9.3: Build + commit**

```bash
npm run build
git add components/daily-summary.tsx "app/(app)/reports/daily/page.tsx"
git commit -m "feat(reports): /reports/daily closingan page with date picker + top-5 items"
```

---

## Task 10: `components/monthly-chart.tsx` + `app/(app)/reports/monthly/page.tsx`

**Files:**
- Create: `components/monthly-chart.tsx`
- Create: `app/(app)/reports/monthly/page.tsx`

CSS bar chart: each day = `<div>` with height % of max. Day with no tx shows empty bar. Month nav `‹ Mei` / `Juli ›`.

- [ ] **Step 10.1: Implement `components/monthly-chart.tsx`**

```tsx
'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';

type DayBar = { date: string; total: number; count: number };
type TopItem = { menu_name: string; qty: number; revenue: number };

function ymLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [yStr, mStr] = ym.split('-');
  let y = parseInt(yStr, 10);
  let m = parseInt(mStr, 10) + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function MonthlyChart({
  month,
  total,
  count,
  daily,
  topItems,
}: {
  month: string;
  total: number;
  count: number;
  daily: DayBar[];
  topItems: TopItem[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const max = Math.max(1, ...daily.map((d) => d.total));

  function setMonth(ym: string) {
    const next = new URLSearchParams(sp.toString());
    next.set('ym', ym);
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setMonth(shiftMonth(month, -1))} disabled={pending}>
            ‹ {ymLabel(shiftMonth(month, -1))}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMonth(shiftMonth(month, 1))} disabled={pending}>
            {ymLabel(shiftMonth(month, 1))} ›
          </Button>
        </div>
        <span className="font-display text-xl text-coal italic">{ymLabel(month)}</span>
      </div>

      <Card variant="paper" className="px-6 py-8 text-center">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Total Pemasukan Bulan {ymLabel(month)}
        </p>
        <p className="mt-3 font-display text-4xl tracking-tight text-coal md:text-5xl">
          {formatRp(total)}
        </p>
        <p className="mt-2 text-sm text-coal-soft">
          dari <strong>{count}</strong> transaksi
        </p>
      </Card>

      <Card variant="paper" className="px-5 py-5">
        <p className="text-xs uppercase tracking-wider text-clay">Pemasukan per hari</p>
        <div className="mt-4 flex h-40 items-end gap-1">
          {daily.map((d) => {
            const heightPct = (d.total / max) * 100;
            const day = parseInt(d.date.slice(-2), 10);
            return (
              <div key={d.date} className="group relative flex-1 flex flex-col items-center justify-end">
                <div
                  className="w-full rounded-t bg-gold/80 transition-all hover:bg-gold"
                  style={{ height: `${heightPct}%`, minHeight: d.total > 0 ? 2 : 0 }}
                  title={`${d.date}: ${formatRp(d.total)} (${d.count} tx)`}
                />
                <span className="mt-1 text-[9px] text-clay">{day}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {topItems.length > 0 && (
        <Card variant="paper">
          <div className="border-b border-clay-soft/60 px-5 py-3">
            <p className="text-xs uppercase tracking-wider text-clay">Top menu bulan ini</p>
          </div>
          <ul className="divide-y divide-clay-soft/60">
            {topItems.map((it, i) => (
              <li key={it.menu_name} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-display text-lg text-clay w-6">{i + 1}</span>
                  <div>
                    <div className="font-medium text-coal">{it.menu_name}</div>
                    <div className="text-xs text-clay">{it.qty} porsi</div>
                  </div>
                </div>
                <div className="font-display text-base text-coal">{formatRp(it.revenue)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 10.2: Implement `app/(app)/reports/monthly/page.tsx`**

```tsx
import { Suspense } from 'react';
import { getSupabaseServer } from '@/lib/supabase/server';
import { parseYm, monthBoundsWIB } from '@/lib/date';
import { MonthlyChart } from '@/components/monthly-chart';

export const dynamic = 'force-dynamic';

function currentYmWIB(): string {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  return now.toISOString().slice(0, 7);
}

function daysInMonthWIB(ym: string): string[] {
  const [yStr, mStr] = ym.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, i) =>
    `${ym}-${String(i + 1).padStart(2, '0')}`
  );
}

function ymdInWIB(iso: string): string {
  const d = new Date(iso);
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}

export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const sp = await searchParams;
  const ym = (sp.ym && parseYm(sp.ym)) ?? currentYmWIB();
  const supabase = await getSupabaseServer();

  const { from, to } = monthBoundsWIB(ym);
  const { data } = await supabase
    .from('transactions')
    .select('id, created_at, transaction_items(qty, unit_price_snapshot, menu_name_snapshot)')
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .gte('created_at', from)
    .lt('created_at', to);

  const txs = data ?? [];
  const byDay = new Map<string, { total: number; count: number }>();
  const byMenu = new Map<string, { qty: number; revenue: number }>();
  let grandTotal = 0;

  for (const tx of txs) {
    const day = ymdInWIB(tx.created_at);
    const lines = (tx.transaction_items ?? []) as Array<{
      qty: number; unit_price_snapshot: number; menu_name_snapshot: string;
    }>;
    const txTotal = lines.reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
    grandTotal += txTotal;
    const d = byDay.get(day) ?? { total: 0, count: 0 };
    byDay.set(day, { total: d.total + txTotal, count: d.count + 1 });

    for (const l of lines) {
      const prev = byMenu.get(l.menu_name_snapshot) ?? { qty: 0, revenue: 0 };
      byMenu.set(l.menu_name_snapshot, {
        qty: prev.qty + l.qty,
        revenue: prev.revenue + l.qty * l.unit_price_snapshot,
      });
    }
  }

  const daily = daysInMonthWIB(ym).map((date) => {
    const v = byDay.get(date) ?? { total: 0, count: 0 };
    return { date, total: v.total, count: v.count };
  });

  const topItems = [...byMenu.entries()]
    .map(([menu_name, v]) => ({ menu_name, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Laporan Bulanan
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Performa <span className="italic">bulanan</span>
        </h1>
      </div>

      <Suspense>
        <MonthlyChart
          month={ym}
          total={grandTotal}
          count={txs.length}
          daily={daily}
          topItems={topItems}
        />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 10.3: Build + commit**

```bash
npm run build
git add components/monthly-chart.tsx "app/(app)/reports/monthly/page.tsx"
git commit -m "feat(reports): /reports/monthly CSS bar chart + top-5 + month nav"
```

---

## Task 11: `app/(app)/reports/page.tsx` — landing

**Files:**
- Create: `app/(app)/reports/page.tsx`

Two big tiles: Daily / Monthly.

- [ ] **Step 11.1: Implement**

```tsx
import Link from 'next/link';
import { Card } from '@/components/ui/card';

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Laporan
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Pilih <span className="italic">laporan</span>
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/reports/daily">
          <Card variant="paper" className="px-6 py-8 hover:bg-cream/50 transition-colors cursor-pointer">
            <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
              Harian
            </p>
            <h2 className="mt-2 font-display text-2xl text-coal">Closingan</h2>
            <p className="mt-2 text-sm text-coal-soft">
              Total pemasukan hari ini & top menu. Untuk cocokkan dengan kas fisik.
            </p>
          </Card>
        </Link>
        <Link href="/reports/monthly">
          <Card variant="paper" className="px-6 py-8 hover:bg-cream/50 transition-colors cursor-pointer">
            <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
              Bulanan
            </p>
            <h2 className="mt-2 font-display text-2xl text-coal">Performa</h2>
            <p className="mt-2 text-sm text-coal-soft">
              Total bulan ini, chart per hari, menu paling laris.
            </p>
          </Card>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.2: Build + commit**

```bash
npm run build
git add "app/(app)/reports/page.tsx"
git commit -m "feat(reports): landing with daily/monthly tiles"
```

---

## Task 12: `lib/supabase/admin.ts` + cron cleanup + Vercel cron config

**Files:**
- Create: `lib/supabase/admin.ts`
- Create: `app/api/cron/cleanup/route.ts`
- Modify: `vercel.json`

Cron 02:00 WIB = 19:00 UTC. Auth via `Authorization: Bearer <CRON_SECRET>`.

- [ ] **Step 12.1: Implement `lib/supabase/admin.ts`**

```ts
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. BYPASSES Row-Level Security.
 * USE ONLY in cron jobs and admin scripts. NEVER import from user-facing API routes.
 */
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY');
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 12.2: Implement `app/api/cron/cleanup/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { newEvent, tagStatus } from '@/lib/logger';

const STORAGE_BUCKET = 'notas';
const RETENTION_DAYS = 7;

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/cron/cleanup');
  try {
    const authHeader = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      tagStatus(evt, 401);
      evt.set('reject_reason', 'invalid_cron_token');
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
    evt.set('cutoff', cutoff);

    const supabase = getSupabaseAdmin();
    const { data: targets, error: selectError } = await supabase
      .from('transactions')
      .select('id, scan_image_path')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff);

    if (selectError) {
      tagStatus(evt, 500);
      evt.error(selectError);
      return NextResponse.json({ error: selectError.message }, { status: 500 });
    }

    const ids = (targets ?? []).map((t) => t.id);
    const paths = (targets ?? []).map((t) => t.scan_image_path).filter((p): p is string => !!p);
    evt.merge({ targets_count: ids.length, storage_paths_count: paths.length });

    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      if (storageError) {
        evt.warn(`storage_cleanup_partial: ${storageError.message}`);
      }
    }

    if (ids.length > 0) {
      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .in('id', ids);
      if (deleteError) {
        tagStatus(evt, 500);
        evt.error(deleteError);
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }
    }

    tagStatus(evt, 200);
    return NextResponse.json({ deleted_count: ids.length });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 12.3: Update `vercel.json` with cron entry**

Replace entire contents with:

```json
{
  "framework": "nextjs",
  "regions": ["sin1"],
  "functions": {
    "app/api/scan/route.ts": {
      "maxDuration": 60
    }
  },
  "crons": [
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 19 * * *"
    }
  ]
}
```

> 19:00 UTC = 02:00 WIB. Vercel cron sends a POST to `/api/cron/cleanup`. To enable auth, we need to map `Authorization: Bearer $CRON_SECRET` header. Vercel sends `Authorization: Bearer <CRON_SECRET env var>` automatically when the env var is set and the route is in `crons[]`.

- [ ] **Step 12.4: User confirms `CRON_SECRET` is set in Vercel env vars**

User-facing instruction:
> Generate random secret: `openssl rand -hex 32`. Set in `.env.local` AND Vercel dashboard → Settings → Environment Variables → `CRON_SECRET` (all environments). Without this, the cron auth check rejects all requests.

- [ ] **Step 12.5: Typecheck + build**

```bash
npx tsc --noEmit && npm run build
```

Expected: `/api/cron/cleanup` listed as `ƒ`.

- [ ] **Step 12.6: Commit**

```bash
git add lib/supabase/admin.ts app/api/cron/cleanup/route.ts vercel.json
git commit -m "feat(cron): /api/cron/cleanup daily 02:00 WIB — hard delete soft-deleted >7d + Storage"
```

---

## Task 13: Mark Plan 3 complete in `docs/tasks.md` + push

**Files:**
- Modify: `docs/tasks.md`

- [ ] **Step 13.1: Update tasks.md**

Replace Plan 3 section with:

```markdown
## Plan 3 — History + Reports + Cron ✅ COMPLETE
- [x] T1 lib/date.ts WIB helpers (TDD)
- [x] T2 GET /api/transactions list with filters + pagination
- [x] T3 DELETE /api/transactions/[id] + preserve confirmed_at
- [x] T4 components/date-filter + transaction-list
- [x] T5 /transactions history list page
- [x] T6 /transactions/[id] detail (read-only) + delete confirm
- [x] T7 GET /api/reports/daily
- [x] T8 GET /api/reports/monthly
- [x] T9 /reports/daily closingan page
- [x] T10 /reports/monthly CSS bar chart page
- [x] T11 /reports landing
- [x] T12 lib/supabase/admin + /api/cron/cleanup + vercel.json cron

End-to-end: history searchable + filtered + editable + soft-deletable, reports harian & bulanan dengan top-5, cron 02:00 WIB auto-clean.
```

- [ ] **Step 13.2: Commit + push**

```bash
git add docs/tasks.md
git commit -m "docs: mark Plan 3 complete"
git push origin master
```

---

## Acceptance criteria — Plan 3 complete

- [ ] `npm run test` passes (currency + prompts + transactions + date tests green)
- [ ] `npm run build` passes
- [ ] `npx tsc --noEmit` zero errors
- [ ] `/transactions` shows confirmed + draft tx from current day by default; filter date range + nama + status semua jalan; pagination muncul kalau >50
- [ ] `/transactions/[id]` shows read-only detail with foto + items + total; "Edit" routes to `/review`; "Hapus" → confirmation modal → DELETE → redirect to `/transactions`
- [ ] After delete, transaksi tidak muncul lagi di list (deleted_at filter)
- [ ] `/transactions/[id]/review` masih bisa edit transaksi yang sudah confirmed; `confirmed_at` TIDAK berubah saat edit (verified via Supabase dashboard)
- [ ] `/reports/daily` default = today, total + count + top-5 sesuai data DB; date picker + ‹ kemarin / hari ini / besok › navigate dengan benar
- [ ] `/reports/monthly` default = current month; total + count + bar chart 30 batang + top-5; bar height proportional to max; tooltip muncul saat hover
- [ ] Month nav ‹ Mei / Juli › update URL `?ym=` dan refetch
- [ ] `/reports` landing show 2 tile yang link ke daily/monthly
- [ ] POST `/api/cron/cleanup` without Bearer header → 401
- [ ] POST `/api/cron/cleanup` with correct `Authorization: Bearer $CRON_SECRET` → 200 dengan `{deleted_count: N}` (test manually: soft-delete 1 tx, manually set `deleted_at` ke >7 hari lalu di Supabase dashboard, panggil cron, lihat tx + foto Storage hilang)
- [ ] All routes log wide JSON event di stdout (`npm run dev` terminal shows `{"route":"GET /api/transactions",...}`)
- [ ] Vercel cron entry visible di Vercel dashboard → Settings → Cron Jobs setelah deploy

After all checked: Plan 3 done. App is feature-complete for MVP.

---

## Out of scope (defer)

Per spec §15 + brainstorming Q's:
- CSV / Excel export of reports
- Restore deleted transaction (current UX: soft-delete is "delete", recovery only via Supabase dashboard)
- Compare period (week-over-week, MoM growth %)
- Push notifications when daily total hits target
- Hourly breakdown chart
- Per-table revenue breakdown
- Multi-currency
