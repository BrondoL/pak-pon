'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Link from 'next/link';
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
import { ReprintCard } from '@/components/reprint-card';
import { ZoomableNotaImage } from '@/components/zoomable-nota-image';
import { formatRp } from '@/lib/currency';
import type { PrinterSettings } from '@/lib/printer-settings';

type Item = {
  id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  menu_category?: 'makanan' | 'nasi' | 'minuman' | string | null;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};

type Transaction = {
  id: string;
  status: 'pending_review' | 'confirmed';
  handwritten_total: number | null;
  customer_name: string | null;
  table_no: string | null;
  is_takeaway: boolean;
  created_at: string;
  daily_seq?: number | null;
  paid_at?: string | null;
};

const WIB = 'Asia/Jakarta';

function formatDateLongWIB(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    timeZone: WIB,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTimeWIB(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: WIB,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TransactionDetail({
  transaction,
  items,
  scanUrl,
  printerSettings,
}: {
  transaction: Transaction;
  items: Item[];
  scanUrl: string | null;
  printerSettings: PrinterSettings;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((acc, it) => acc + it.qty * it.unit_price_snapshot, 0);
  const totalQty = items.reduce((acc, it) => acc + it.qty, 0);
  const mismatch =
    !!transaction.handwritten_total && transaction.handwritten_total !== total;
  const diff = mismatch ? transaction.handwritten_total! - total : 0;
  const isDraft = transaction.status === 'pending_review';
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

  async function handleDelete() {
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'delete-failed');
      }
      const restoreTx = async () => {
        const restoreRes = await fetch(
          `/api/transactions/${transaction.id}/restore`,
          { method: 'POST' }
        );
        if (restoreRes.ok) {
          toast.success('Transaksi dipulihkan');
          router.push(`/transactions/${transaction.id}`);
        } else {
          toast.error('Gagal memulihkan transaksi');
        }
      };
      toast.success('Transaksi dihapus', {
        description: 'Soft-delete; permanen setelah 7 hari.',
        action: {
          label: 'Pulihkan',
          onClick: restoreTx,
        },
        duration: 10000,
      });
      startTransition(() => router.push('/transactions'));
    } catch (err) {
      const message = err instanceof Error ? `Gagal menghapus: ${err.message}` : 'Gagal menghapus';
      setError(message);
      toast.error('Gagal menghapus transaksi', {
        description: err instanceof Error ? err.message : 'Coba lagi.',
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-clay">
        <Link href="/transactions" className="hover:text-coal transition-colors">
          ‹ Kembali ke history
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
            Detail Transaksi
          </p>
          <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
            {transaction.customer_name || <span className="italic text-coal-soft">Tanpa nama</span>}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-coal-soft">
            <span>{formatDateLongWIB(transaction.created_at)}</span>
            <span className="text-clay-soft">·</span>
            <span>{formatTimeWIB(transaction.created_at)} WIB</span>
            {transaction.table_no && (
              <>
                <span className="text-clay-soft">·</span>
                <span>Meja {transaction.table_no}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {transaction.is_takeaway && (
            <span className="rounded-full bg-gold-faint px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gold-dark">
              📦 Bungkus
            </span>
          )}
          {isDraft ? (
            <span className="rounded-full bg-mustard-faint px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-coal">
              Draft — belum dikonfirmasi
            </span>
          ) : (
            <span className="rounded-full bg-leaf/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-leaf">
              ✓ Confirmed
            </span>
          )}
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
        </div>
      </div>

      <div className={scanUrl ? 'grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : ''}>
        {scanUrl && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <Card variant="paper" className="overflow-hidden">
              <ZoomableNotaImage
                src={scanUrl}
                alt="Foto nota"
                imgClassName="mx-auto w-full object-contain max-h-72 lg:max-h-[calc(100vh-6rem)]"
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
              <div className="flex items-baseline gap-2">
                <span aria-hidden>⚠️</span>
                <span className="font-semibold">Total tidak cocok</span>
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-clay">Tulis tangan</div>
                  <div className="font-display text-base text-coal">{formatRp(transaction.handwritten_total!)}</div>
                </div>
                <div>
                  <div className="text-clay">Sistem</div>
                  <div className="font-display text-base text-coal">{formatRp(total)}</div>
                </div>
                <div>
                  <div className="text-clay">Selisih</div>
                  <div className={`font-display text-base ${diff > 0 ? 'text-leaf' : 'text-brick'}`}>
                    {diff > 0 ? '+' : ''}{formatRp(diff)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <Card variant="paper">
            <div className="border-b border-clay-soft/60 px-5 py-3">
              <p className="text-xs uppercase tracking-wider text-clay">
                Pesanan ({items.length} {items.length === 1 ? 'jenis' : 'jenis'} · {totalQty} porsi)
              </p>
            </div>
            <ul className="divide-y divide-clay-soft/60">
              {items.length === 0 ? (
                <li className="px-5 py-8 text-center text-sm text-clay">Tidak ada item.</li>
              ) : (
                items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate font-medium text-coal">{it.menu_name_snapshot}</span>
                        <span className="text-xs text-clay shrink-0">× {it.qty}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-clay">
                        {formatRp(it.unit_price_snapshot)}
                        {it.notes && <> · <span className="italic">{it.notes}</span></>}
                      </div>
                    </div>
                    <div className="font-display text-base text-coal tabular-nums">
                      {formatRp(it.unit_price_snapshot * it.qty)}
                    </div>
                  </li>
                ))
              )}
            </ul>
            <div className="border-t-2 border-clay-soft/80 bg-cream/30 px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm uppercase tracking-[0.18em] text-clay">Total sistem</span>
                <span className="font-display text-3xl tracking-tight text-coal">
                  {formatRp(total)}
                </span>
              </div>
            </div>
          </Card>

          {transaction.status === 'confirmed' && (
            <ReprintCard
              transaction={{
                id: transaction.id,
                daily_seq: transaction.daily_seq ?? null,
                created_at: transaction.created_at,
                customer_name: transaction.customer_name,
                table_no: transaction.table_no,
                is_takeaway: transaction.is_takeaway,
              }}
              items={items.map((it) => ({
                id: it.id,
                menu_name_snapshot: it.menu_name_snapshot,
                menu_category: (it.menu_category ?? 'makanan') as
                  | 'makanan'
                  | 'nasi'
                  | 'minuman',
                unit_price_snapshot: it.unit_price_snapshot,
                qty: it.qty,
                notes: it.notes,
                printed_dapur_at: it.printed_dapur_at,
                printed_minuman_at: it.printed_minuman_at,
              }))}
              printerSettings={printerSettings}
            />
          )}

          {error && (
            <p
              className="rounded-md border border-brick/30 bg-brick-faint px-3 py-2 text-sm text-brick-dark"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/transactions/${transaction.id}/review`} className="flex-1 sm:flex-none">
              <Button disabled={pending} className="w-full sm:w-auto">
                ✏️ {isDraft ? 'Lanjutkan edit' : 'Edit transaksi'}
              </Button>
            </Link>

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

            <AlertDialog>
              <AlertDialogTrigger
                disabled={pending}
                className="ml-auto text-brick-dark hover:bg-brick-faint"
                render={<Button variant="ghost" />}
              >
                🗑️ Hapus
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus transaksi ini?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Transaksi disimpan sebagai soft-delete selama 7 hari. Setelah itu cron menghapus permanen (termasuk foto nota).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>Batal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={pending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {pending ? 'Menghapus…' : 'Ya, hapus'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  );
}
