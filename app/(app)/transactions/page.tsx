import { Suspense } from 'react';
import Link from 'next/link';
import { getSupabaseServer } from '@/lib/supabase/server';
import { currentBusinessDate, parseYmd, businessDayRange } from '@/lib/date';
import { Card } from '@/components/ui/card';
import { DateFilter } from '@/components/date-filter';
import { TransactionList, type TxRow } from '@/components/transaction-list';
import { formatRp } from '@/lib/currency';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SearchParams = {
  date_from?: string;
  date_to?: string;
  q?: string;
  status?: string;
  takeaway?: string;
  page?: string;
};

const WIB = 'Asia/Jakarta';

function formatRangeLabel(from: string, to: string): string {
  const fmt = (ymd: string) =>
    new Date(`${ymd}T12:00:00+07:00`).toLocaleDateString('id-ID', {
      timeZone: WIB,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  if (from === to) return fmt(from);
  return `${fmt(from)} — ${fmt(to)}`;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await getSupabaseServer();

  const defaultDay = currentBusinessDate();
  const dateFrom = (sp.date_from && parseYmd(sp.date_from)) ?? defaultDay;
  const dateTo = (sp.date_to && parseYmd(sp.date_to)) ?? dateFrom;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const q = (sp.q ?? '').trim();
  const statusFilter =
    sp.status === 'pending_review' || sp.status === 'confirmed' ? sp.status : null;
  const takeawayFilter =
    sp.takeaway === 'yes' ? true : sp.takeaway === 'no' ? false : null;

  const fromIso = businessDayRange(dateFrom).start;
  const toIso = businessDayRange(dateTo).end;

  // Summary aggregation via DB RPC — bypasses PostgREST default 1000-row cap
  // that silently truncates JS-side sums over multi-day ranges.
  const { data: summary } = await supabase.rpc('report_transactions_summary', {
    p_start: fromIso,
    p_end: toIso,
    p_q: q === '' ? null : q,
    p_status: statusFilter,
    p_takeaway: takeawayFilter,
  });
  const summaryStats = (summary as {
    total_count: number;
    confirmed_total: number;
    confirmed_count: number;
    pending_count: number;
  } | null) ?? { total_count: 0, confirmed_total: 0, confirmed_count: 0, pending_count: 0 };
  const summaryTotal = summaryStats.confirmed_total;
  const summaryConfirmed = summaryStats.confirmed_count;
  const summaryPending = summaryStats.pending_count;
  const totalMatching = summaryStats.total_count;

  // Paginated list query
  let listQuery = supabase
    .from('transactions')
    .select(
      'id, created_at, status, customer_name, table_no, handwritten_total, is_takeaway, scan_image_path, transaction_items(qty, unit_price_snapshot)',
      { count: 'exact' }
    )
    .is('deleted_at', null)
    .gte('created_at', fromIso)
    .lt('created_at', toIso)
    .order('created_at', { ascending: false });

  if (q !== '') listQuery = listQuery.ilike('customer_name', `%${q}%`);
  if (statusFilter) listQuery = listQuery.eq('status', statusFilter);
  if (takeawayFilter !== null) listQuery = listQuery.eq('is_takeaway', takeawayFilter);

  const offset = (page - 1) * PAGE_SIZE;
  listQuery = listQuery.range(offset, offset + PAGE_SIZE - 1);

  const { data, count } = await listQuery;

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
      is_takeaway: tx.is_takeaway,
      // scan_image_path === null reliably means POS (created via POST /api/pos).
      // OCR/scan flow always uploads image first. Retention cron for cleaning
      // old scan images (backlog) not yet shipped — when it lands, revisit.
      source: tx.scan_image_path === null ? 'pos' as const : 'ocr' as const,
      total,
      item_count: lines.length,
    };
  });

  const rangeLabel = formatRangeLabel(dateFrom, dateTo);
  const hasActiveFilter = q !== '' || statusFilter !== null || takeawayFilter !== null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
            History
          </p>
          <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
            Transaksi <span className="italic">tersimpan</span>
          </h1>
          <p className="mt-2 text-sm text-coal-soft">{rangeLabel}</p>
        </div>
        <Link
          href="/transactions/trash"
          className="text-xs text-clay underline-offset-4 hover:text-coal hover:underline"
        >
          🗑️ Yang baru dihapus →
        </Link>
      </div>

      <Card variant="paper" className="grid grid-cols-2 divide-x divide-clay-soft/60 px-6 py-5 sm:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Total pemasukan</div>
          <div className="mt-1 font-display text-2xl tracking-tight text-coal">
            {formatRp(summaryTotal)}
          </div>
          <div className="text-[11px] text-clay">dari {summaryConfirmed} transaksi confirmed</div>
        </div>
        <div className="pl-6">
          <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Total transaksi</div>
          <div className="mt-1 font-display text-2xl text-coal">{totalMatching}</div>
          <div className="text-[11px] text-clay">{summaryConfirmed} confirmed · {summaryPending} draft</div>
        </div>
        <div className="mt-4 pl-0 sm:mt-0 sm:pl-6">
          <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Rata-rata/tx</div>
          <div className="mt-1 font-display text-2xl text-coal">
            {summaryConfirmed > 0 ? formatRp(Math.round(summaryTotal / summaryConfirmed)) : '—'}
          </div>
          <div className="text-[11px] text-clay">dari yang confirmed</div>
        </div>
        <div className="mt-4 pl-6 sm:mt-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Tampil di halaman</div>
          <div className="mt-1 font-display text-2xl text-coal">
            {items.length}
            <span className="text-sm text-clay">/{count ?? 0}</span>
          </div>
          <div className="text-[11px] text-clay">halaman {page}</div>
        </div>
      </Card>

      <Suspense>
        <DateFilter />
      </Suspense>

      <Suspense>
        <TransactionList
          items={items}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={count ?? 0}
          hasActiveFilter={hasActiveFilter}
        />
      </Suspense>
    </div>
  );
}
