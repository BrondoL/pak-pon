'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRp } from '@/lib/currency';
import { NotaItemRow, type NotaItem } from './nota-item-row';
import { NotaItemModal, type MenuOption } from './nota-item-modal';

type Transaction = {
  id: string;
  status: 'pending_review' | 'confirmed';
  handwritten_total: number | null;
  customer_name: string | null;
  table_no: string | null;
  created_at: string;
};

export function NotaReviewForm({
  transaction,
  initialItems,
  menus,
  scanUrl,
}: {
  transaction: Transaction;
  initialItems: Omit<NotaItem, '_localId'>[];
  menus: MenuOption[];
  scanUrl: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<NotaItem[]>(
    initialItems.map((it) => ({ ...it, _localId: crypto.randomUUID() }))
  );
  const [customerName, setCustomerName] = useState<string>(transaction.customer_name ?? '');
  const [tableNo, setTableNo] = useState<string>(transaction.table_no ?? '');
  const [editing, setEditing] = useState<NotaItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const computedSum = items.reduce(
    (acc, it) => acc + it.unit_price_snapshot * it.qty,
    0
  );
  const mismatch =
    !!transaction.handwritten_total &&
    transaction.handwritten_total !== computedSum;

  function upsertItem(item: NotaItem) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p._localId === item._localId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      const nextSort = prev.length;
      return [...prev, { ...item, sort_order: nextSort }];
    });
    setEditing(null);
    setAdding(false);
  }

  function removeItem(localId: string) {
    setItems((prev) => prev.filter((p) => p._localId !== localId));
    setEditing(null);
  }

  async function handleConfirm() {
    setSubmitError(null);
    const payload = {
      status: 'confirmed' as const,
      customer_name: customerName.trim() === '' ? null : customerName.trim(),
      table_no: tableNo.trim() === '' ? null : tableNo.trim(),
      items: items.map((it, idx) => ({
        id: it.id,
        menu_id: it.menu_id,
        qty: it.qty,
        notes: it.notes,
        sort_order: idx,
      })),
    };
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'patch-failed');
      }
      startTransition(() => {
        router.push('/');
      });
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? `Gagal menyimpan: ${err.message}. Coba lagi.`
          : 'Gagal menyimpan. Coba lagi.'
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Review Hasil OCR
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Periksa <span className="italic">nota</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-coal-soft">
          Pastikan item dan jumlah sudah benar. Klik ✏️ untuk edit, 🗑️ untuk hapus.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left: foto nota (sticky on lg+) */}
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

        {/* Right: form */}
        <div className="space-y-6">
          <Card variant="paper" className="p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="customer-name">Nama</Label>
                <Input
                  id="customer-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="kosongkan kalau tidak ada"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="table-no">No. Meja</Label>
                <Input
                  id="table-no"
                  value={tableNo}
                  onChange={(e) => setTableNo(e.target.value)}
                  placeholder="kosongkan kalau tidak ada"
                  className="mt-2"
                />
              </div>
            </div>
          </Card>

          {mismatch && (
            <div
              className="rounded-md border border-mustard/40 bg-mustard-faint px-4 py-3 text-sm text-coal"
              role="alert"
            >
              ⚠️ Total tulisan tangan {formatRp(transaction.handwritten_total!)} berbeda
              dari perhitungan item {formatRp(computedSum)}. Selisih{' '}
              <strong>{formatRp(Math.abs(transaction.handwritten_total! - computedSum))}</strong>.
              Periksa lagi sebelum menyimpan.
            </div>
          )}

          <Card variant="paper">
            <ul className="divide-y divide-clay-soft/60">
              {items.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-clay">
                  Belum ada item. Klik &quot;Tambah item&quot; di bawah.
                </li>
              )}
              {items.map((it) => (
                <NotaItemRow
                  key={it._localId}
                  item={it}
                  onEdit={() => setEditing(it)}
                  onDelete={() => removeItem(it._localId)}
                />
              ))}
            </ul>

            <div className="border-t border-clay-soft/60 px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm uppercase tracking-wide text-clay">Total sistem</span>
                <span className="font-display text-2xl tracking-tight text-coal">
                  {formatRp(computedSum)}
                </span>
              </div>
            </div>
          </Card>

          <Button variant="secondary" onClick={() => setAdding(true)} className="w-full">
            + Tambah item
          </Button>

          {submitError && (
            <p
              className="rounded-md border border-brick/30 bg-brick-faint px-3 py-2 text-sm text-brick-dark"
              role="alert"
            >
              {submitError}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push('/')}
              disabled={pending}
            >
              Batal
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={pending || items.length === 0}
              className="flex-1"
            >
              {pending ? 'Menyimpan…' : '✓ Konfirmasi'}
            </Button>
          </div>
        </div>
      </div>

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
    </div>
  );
}
