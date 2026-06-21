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
