'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';

export type TrashRow = {
  id: string;
  created_at: string;
  deleted_at: string;
  status: 'pending_review' | 'confirmed';
  customer_name: string | null;
  table_no: string | null;
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

function relativeDaysAgo(deletedAt: string): string {
  const now = Date.now();
  const then = new Date(deletedAt).getTime();
  const diffMs = Math.max(0, now - then);
  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  if (days <= 0) {
    const hours = Math.floor(diffMs / (3600 * 1000));
    if (hours <= 0) return 'Dihapus baru saja';
    return `Dihapus ${hours} jam lalu`;
  }
  if (days === 1) return 'Dihapus 1 hari lalu';
  return `Dihapus ${days} hari lalu`;
}

export function TransactionTrashRow({ tx }: { tx: TrashRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${tx.id}/restore`, { method: 'POST' });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'restore-failed');
      }
      toast.success('Transaksi dipulihkan');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? `Gagal pulihkan: ${err.message}` : 'Gagal pulihkan');
      toast.error('Gagal memulihkan transaksi');
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;

  return (
    <li className="flex items-center gap-4 px-5 py-4">
      <div className="flex w-14 shrink-0 flex-col items-center rounded-md bg-clay-mist/60 py-1.5 font-display text-coal">
        <span className="text-base leading-none">{formatTimeWIB(tx.created_at)}</span>
        <span className="mt-0.5 text-[10px] uppercase tracking-wide text-clay">
          {formatDateWIB(tx.created_at)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-coal">
            {tx.customer_name || <span className="italic text-clay">tanpa nama</span>}
          </span>
          {tx.table_no && (
            <span className="rounded bg-clay-mist/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-coal-soft">
              Meja {tx.table_no}
            </span>
          )}
          <span className="rounded-full bg-brick-faint px-2 py-0.5 text-[10px] uppercase tracking-wide text-brick-dark">
            🗑️ {relativeDaysAgo(tx.deleted_at)}
          </span>
        </div>
        <div className="mt-1 text-xs text-clay">
          {tx.item_count} {tx.item_count === 1 ? 'item' : 'item'}
          {tx.status === 'pending_review' && <> · <span className="italic">draft</span></>}
        </div>
        {error && (
          <p className="mt-1 text-xs text-brick-dark" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="text-right">
        <div className="font-display text-lg tracking-tight text-coal">
          {formatRp(tx.total)}
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={handleRestore}
        disabled={disabled}
      >
        {disabled ? 'Memulihkan…' : '↺ Pulihkan'}
      </Button>
    </li>
  );
}
