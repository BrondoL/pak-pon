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
