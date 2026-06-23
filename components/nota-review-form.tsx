'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRp } from '@/lib/currency';
import { NotaItemRow, type NotaItem } from './nota-item-row';
import { NotaItemModal, type MenuOption } from './nota-item-modal';
import { renderTicket, uint8ToBase64 } from '@/lib/escpos';
import { detectThousandsMissing } from '@/lib/total-parser';

type Transaction = {
  id: string;
  status: 'pending_review' | 'confirmed';
  handwritten_total: number | null;
  customer_name: string | null;
  table_no: string | null;
  created_at: string;
};

type PrinterTarget = 'dapur' | 'minuman';

type ItemForQueue = {
  qty: number;
  menu_name_snapshot: string;
  menu_category: string;
  notes: string | null;
};

function splitItems(items: ItemForQueue[]) {
  const dapur: ItemForQueue[] = [];
  const minuman: ItemForQueue[] = [];
  for (const it of items) {
    if (it.menu_category === 'minuman') minuman.push(it);
    else if (it.menu_category === 'makanan' || it.menu_category === 'nasi') dapur.push(it);
  }
  return { dapur, minuman };
}

async function submitPrintJob(args: {
  tx: { id: string; daily_seq: number | null; created_at: string; customer_name: string | null; table_no: string | null };
  target: PrinterTarget;
  items: ItemForQueue[];
}): Promise<boolean> {
  const bytes = renderTicket({
    target: args.target,
    daily_seq: args.tx.daily_seq ?? 0,
    created_at: new Date(args.tx.created_at),
    customer_name: args.tx.customer_name,
    table_no: args.tx.table_no,
    items: args.items.map((i) => ({
      qty: i.qty,
      name: i.menu_name_snapshot,
      note: i.notes,
    })),
  });
  const bytes_b64 = uint8ToBase64(bytes);
  try {
    const res = await fetch('/api/print/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: 'auto',
        bytes_b64,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
  const [handwrittenTotal, setHandwrittenTotal] = useState<number | null>(transaction.handwritten_total);
  const [thousandsDismissed, setThousandsDismissed] = useState(false);
  const [thousandsApplying, setThousandsApplying] = useState(false);

  const menusByName = useMemo(
    () => new Map(menus.map((m) => [m.name, m])),
    [menus]
  );

  const computedSum = items.reduce(
    (acc, it) => acc + it.unit_price_snapshot * it.qty,
    0
  );
  const mismatch = !!handwrittenTotal && handwrittenTotal !== computedSum;

  // Recompute every render so banner reacts to live item edits, not just
  // the server-rendered snapshot.
  const suggestThousands = useMemo(
    () => detectThousandsMissing(handwrittenTotal, computedSum),
    [handwrittenTotal, computedSum]
  );

  const showThousandsBanner =
    suggestThousands.suggest &&
    !thousandsDismissed &&
    handwrittenTotal !== null &&
    handwrittenTotal < 1000;

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

  function swapMenu(localId: string, newMenu: MenuOption) {
    setItems((prev) =>
      prev.map((it) =>
        it._localId === localId
          ? {
              ...it,
              menu_id: newMenu.id,
              menu_name_snapshot: newMenu.name,
              unit_price_snapshot: newMenu.price,
              confidence: null,
              alternatives: [],
            }
          : it
      )
    );
    toast.success(`Diganti ke ${newMenu.name}`);
  }

  async function applyThousands() {
    if (!suggestThousands.suggest) return;
    const newTotal = suggestThousands.suggested_total;
    setThousandsApplying(true);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handwritten_total: newTotal }),
      });
      if (!res.ok) {
        throw new Error('patch-failed');
      }
      setHandwrittenTotal(newTotal);
      setThousandsDismissed(true);
      toast.success(`Total disesuaikan ke ${formatRp(newTotal)}`);
    } catch {
      toast.error('Gagal update total. Coba lagi.');
    } finally {
      setThousandsApplying(false);
    }
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
        confidence: it.confidence,
        alternatives: it.alternatives ?? [],
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
      const data = await res.json() as {
        transaction: {
          id: string;
          daily_seq: number | null;
          created_at: string;
          customer_name: string | null;
          table_no: string | null;
        };
        items: Array<{ id: string; menu_id: string; menu_name_snapshot: string; qty: number; notes: string | null }>;
      };

      const itemsForQueue: ItemForQueue[] = data.items.map((it) => {
        const menu = menus.find((m) => m.id === it.menu_id);
        return {
          qty: it.qty,
          menu_name_snapshot: it.menu_name_snapshot,
          menu_category: menu?.category ?? 'makanan',
          notes: it.notes,
        };
      });
      const split = splitItems(itemsForQueue);
      const submitJobs: Promise<{ target: PrinterTarget; ok: boolean }>[] = [];
      if (split.dapur.length > 0) {
        submitJobs.push(
          submitPrintJob({ tx: data.transaction, target: 'dapur', items: split.dapur }).then((ok) => ({ target: 'dapur', ok }))
        );
      }
      if (split.minuman.length > 0) {
        submitJobs.push(
          submitPrintJob({ tx: data.transaction, target: 'minuman', items: split.minuman }).then((ok) => ({ target: 'minuman', ok }))
        );
      }
      const results = await Promise.all(submitJobs);
      const succeeded = results.filter((r) => r.ok).map((r) => r.target);
      const failed = results.filter((r) => !r.ok).map((r) => r.target);

      if (failed.length === 0 && succeeded.length > 0) {
        toast.success(`Nota tersimpan, ${succeeded.length} print job dikirim ke agent`);
      } else if (failed.length > 0) {
        toast.success('Nota tersimpan');
        toast.error(`Gagal kirim print job ke: ${failed.join(', ')}. Coba reprint manual dari halaman detail.`);
      } else {
        toast.success('Nota tersimpan');
      }

      startTransition(() => {
        router.push('/');
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? `Gagal menyimpan: ${err.message}. Coba lagi.`
          : 'Gagal menyimpan. Coba lagi.';
      setSubmitError(message);
      toast.error('Gagal menyimpan nota', {
        description: err instanceof Error ? err.message : 'Coba lagi.',
      });
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
          Pastikan item dan jumlah sudah benar. Item kuning/merah perlu lebih teliti. Klik chip alternatif untuk ganti menu cepat.
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

          {showThousandsBanner && suggestThousands.suggest && (
            <div
              className="rounded-md border border-mustard/40 bg-mustard-faint px-4 py-3 text-sm text-coal"
              role="alert"
            >
              💡 Total tertulis <strong>{formatRp(handwrittenTotal!)}</strong>.
              Mungkin maksudnya <strong>{formatRp(suggestThousands.suggested_total)}</strong>?
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={applyThousands} disabled={thousandsApplying}>
                  {thousandsApplying ? 'Menyimpan…' : `Pakai ${formatRp(suggestThousands.suggested_total)}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setThousandsDismissed(true)}>
                  Tetap {formatRp(handwrittenTotal!)}
                </Button>
              </div>
            </div>
          )}

          {mismatch && (
            <div
              className="rounded-md border border-mustard/40 bg-mustard-faint px-4 py-3 text-sm text-coal"
              role="alert"
            >
              ⚠️ Total tulisan tangan {formatRp(handwrittenTotal!)} berbeda
              dari perhitungan item {formatRp(computedSum)}. Selisih{' '}
              <strong>{formatRp(Math.abs(handwrittenTotal! - computedSum))}</strong>.
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
                  menusByName={menusByName}
                  onEdit={() => setEditing(it)}
                  onDelete={() => removeItem(it._localId)}
                  onSwapMenu={swapMenu}
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
              disabled={pending || thousandsApplying || items.length === 0}
              className="flex-1"
            >
              {pending ? 'Menyimpan…' : '✓ Simpan & Cetak'}
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
