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

function formatTimeWIB(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: WIB,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateWIB(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    timeZone: WIB,
    day: '2-digit',
    month: 'short',
  });
}

export function TransactionList({
  items,
  page,
  pageSize,
  totalCount,
  hasActiveFilter,
}: {
  items: TxRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasActiveFilter?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function goPage(p: number) {
    const next = new URLSearchParams(sp.toString());
    next.set('page', String(p));
    router.replace(`?${next.toString()}`);
  }

  function clearFilters() {
    router.replace('/transactions');
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <Card variant="paper" className="px-6 py-14 text-center">
          <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-clay-mist text-clay">
            <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden>
              <path d="M7 5h14l3 3v19a1 1 0 01-1.5 0L21 25l-2.5 2-2.5-2-2.5 2L11 25l-2.5 2L7 27V5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M11 11h10M11 15h10M11 19h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <p className="font-display text-xl italic text-coal">Belum ada transaksi</p>
          <p className="mt-2 text-sm text-coal-soft">
            {hasActiveFilter
              ? 'Coba longgarkan filter atau ubah rentang tanggal.'
              : 'Mulai dengan scan nota pertama hari ini.'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {hasActiveFilter && (
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                Reset filter
              </Button>
            )}
            <Link href="/scan">
              <Button size="sm">📷 Scan nota</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <Card variant="paper">
          <ul className="divide-y divide-clay-soft/60">
            {items.map((tx) => {
              const mismatch =
                tx.status === 'confirmed' &&
                tx.handwritten_total != null &&
                tx.handwritten_total !== tx.total;
              return (
                <li key={tx.id}>
                  <Link
                    href={`/transactions/${tx.id}`}
                    className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-cream/50"
                  >
                    <div className="flex w-14 shrink-0 flex-col items-center rounded-md bg-clay-mist/60 py-1.5 font-display text-coal">
                      <span className="text-base leading-none">{formatTimeWIB(tx.created_at)}</span>
                      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-clay">
                        {formatDateWIB(tx.created_at)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-coal">
                          {tx.customer_name || <span className="italic text-clay">tanpa nama</span>}
                        </span>
                        {tx.table_no && (
                          <span className="rounded bg-clay-mist/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-coal-soft">
                            Meja {tx.table_no}
                          </span>
                        )}
                        {tx.status === 'pending_review' && (
                          <span className="rounded-full bg-mustard-faint px-2 py-0.5 text-[10px] uppercase tracking-wide text-coal">
                            Draft
                          </span>
                        )}
                        {mismatch && (
                          <span
                            title={`Tulis ${formatRp(tx.handwritten_total!)} ≠ Sistem ${formatRp(tx.total)}`}
                            className="rounded-full bg-brick-faint px-2 py-0.5 text-[10px] uppercase tracking-wide text-brick-dark"
                          >
                            ⚠ tidak cocok
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-clay">
                        {tx.item_count} {tx.item_count === 1 ? 'item' : 'item'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-lg tracking-tight text-coal">
                        {formatRp(tx.total)}
                      </div>
                    </div>
                    <span
                      aria-hidden
                      className="text-clay-soft transition-transform group-hover:translate-x-0.5 group-hover:text-coal-soft"
                    >
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
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
