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
