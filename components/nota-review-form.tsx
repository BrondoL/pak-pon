'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatRp } from '@/lib/currency';
import { NotaItemRow, type NotaItem } from './nota-item-row';
import { NotaItemModal, type MenuOption } from './nota-item-modal';
import { ZoomableNotaImage } from './zoomable-nota-image';
import { dispatchKitchenPrintJob, type PrintTarget, type PrintTrigger } from '@/lib/print-dispatch';
import { detectThousandsMissing } from '@/lib/total-parser';
import type { PrinterSettings } from '@/lib/printer-settings';

type Transaction = {
  id: string;
  status: 'pending_review' | 'confirmed';
  handwritten_total: number | null;
  customer_name: string | null;
  table_no: string | null;
  is_takeaway: boolean;
  created_at: string;
};

type ItemForQueue = {
  id: string;
  qty: number;
  menu_name_snapshot: string;
  menu_category: string;
  unit_price_snapshot: number;
  notes: string | null;
  applied_chips: Array<{ label: string; price_delta: number }>;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
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

type ModalContext = {
  modified: { dapur: boolean; minuman: boolean };
  newItems: { dapur: number; minuman: number };
};

function detectModalContext(
  initial: Omit<NotaItem, '_localId'>[],
  current: NotaItem[],
  menus: MenuOption[],
): ModalContext {
  const initialById = new Map(initial.map((i) => [i.id, i]));
  const categoryByMenuId = new Map(menus.map((m) => [m.id, m.category]));
  const modified = { dapur: false, minuman: false };
  const newItems = { dapur: 0, minuman: 0 };
  function markTarget(category: string | undefined, kind: 'modified' | 'new') {
    const isKitchen = category === 'makanan' || category === 'nasi';
    const isMinuman = category === 'minuman';
    if (kind === 'modified') {
      if (isKitchen) modified.dapur = true;
      else if (isMinuman) modified.minuman = true;
    } else {
      if (isKitchen) newItems.dapur += 1;
      else if (isMinuman) newItems.minuman += 1;
    }
  }
  function chipsKey(chips: Array<{ label: string }> | undefined): string {
    return (chips ?? []).map((c) => c.label).sort().join('|');
  }
  for (const cur of current) {
    if (!cur.id) {
      // Item baru — count untuk display di modal.
      markTarget(categoryByMenuId.get(cur.menu_id), 'new');
      continue;
    }
    const orig = initialById.get(cur.id);
    if (!orig) continue;
    const chipsChanged = chipsKey(orig.applied_chips) !== chipsKey(cur.applied_chips);
    const changed =
      orig.menu_id !== cur.menu_id ||
      orig.qty !== cur.qty ||
      orig.notes !== cur.notes ||
      chipsChanged;
    if (!changed) continue;
    markTarget(categoryByMenuId.get(cur.menu_id), 'modified');
    // Swap category (e.g. makanan → minuman) → target lama juga affected.
    if (orig.menu_id !== cur.menu_id) {
      markTarget(categoryByMenuId.get(orig.menu_id), 'modified');
    }
  }
  return { modified, newItems };
}

export function NotaReviewForm({
  transaction,
  initialItems,
  menus,
  scanUrl,
  printerSettings,
}: {
  transaction: Transaction;
  initialItems: Omit<NotaItem, '_localId'>[];
  menus: MenuOption[];
  scanUrl: string | null;
  printerSettings: PrinterSettings;
}) {
  const router = useRouter();
  const [items, setItems] = useState<NotaItem[]>(
    initialItems.map((it) => ({ ...it, _localId: crypto.randomUUID() }))
  );
  const [customerName, setCustomerName] = useState<string>(transaction.customer_name ?? '');
  const [tableNo, setTableNo] = useState<string>(transaction.table_no ?? '');
  const [isTakeaway, setIsTakeaway] = useState<boolean>(transaction.is_takeaway);
  const [editing, setEditing] = useState<NotaItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [handwrittenTotal, setHandwrittenTotal] = useState<number | null>(transaction.handwritten_total);
  const [thousandsDismissed, setThousandsDismissed] = useState(false);
  const [thousandsApplying, setThousandsApplying] = useState(false);
  // Modal "Cetak ulang ke dapur" — saat edit confirmed tx + items existing dimodifikasi.
  const [modificationModal, setModificationModal] = useState<ModalContext | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  function changeItemQty(localId: string, nextQty: number) {
    setItems((prev) =>
      prev.map((p) => (p._localId === localId ? { ...p, qty: nextQty } : p))
    );
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
    // Edit save (tx sudah confirmed) + ada items existing yang dimodifikasi
    // (qty/menu/notes) atau flag bungkus di-toggle → tampilkan modal pilihan
    // reprint. Kalau bungkus berubah, mark semua target existing jadi modified
    // supaya dapur/minuman dikasih tiket baru dengan/tanpa banner BUNGKUS.
    if (transaction.status === 'confirmed') {
      const ctx = detectModalContext(initialItems, items, menus);
      const takeawayChanged = isTakeaway !== transaction.is_takeaway;
      if (takeawayChanged) {
        const categoryByMenuId = new Map(menus.map((m) => [m.id, m.category]));
        for (const it of items) {
          if (!it.id) continue;
          const cat = categoryByMenuId.get(it.menu_id);
          if (cat === 'makanan' || cat === 'nasi') ctx.modified.dapur = true;
          else if (cat === 'minuman') ctx.modified.minuman = true;
        }
      }
      if (ctx.modified.dapur || ctx.modified.minuman) {
        setModificationModal(ctx);
        return;
      }
    }
    await submitSave({ reprintModifiedTarget: { dapur: false, minuman: false } });
  }

  async function submitSave(args: { reprintModifiedTarget: { dapur: boolean; minuman: boolean } }) {
    setSubmitting(true);
    const payload = {
      status: 'confirmed' as const,
      customer_name: customerName.trim() === '' ? null : customerName.trim(),
      table_no: tableNo.trim() === '' ? null : tableNo.trim(),
      is_takeaway: isTakeaway,
      items: items.map((it, idx) => ({
        id: it.id,
        menu_id: it.menu_id,
        qty: it.qty,
        notes: it.notes,
        chip_labels: (it.applied_chips ?? []).map((c) => c.label),
        sort_order: idx,
        confidence: it.confidence,
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
          is_takeaway: boolean;
        };
        items: Array<{
          id: string;
          menu_id: string;
          menu_name_snapshot: string;
          unit_price_snapshot: number;
          qty: number;
          notes: string | null;
          applied_chips: Array<{ label: string; price_delta: number }>;
          printed_dapur_at: string | null;
          printed_minuman_at: string | null;
        }>;
      };

      const wasConfirmedBefore = transaction.status === 'confirmed';

      const itemsForQueue: ItemForQueue[] = data.items.map((it) => {
        const menu = menus.find((m) => m.id === it.menu_id);
        return {
          id: it.id,
          qty: it.qty,
          menu_name_snapshot: it.menu_name_snapshot,
          menu_category: menu?.category ?? 'makanan',
          unit_price_snapshot: it.unit_price_snapshot,
          notes: it.notes,
          applied_chips: it.applied_chips ?? [],
          printed_dapur_at: it.printed_dapur_at,
          printed_minuman_at: it.printed_minuman_at,
        };
      });

      const split = splitItems(itemsForQueue);
      const reprint = args.reprintModifiedTarget;

      // Per target: kalau reprint mode (user pilih cetak ulang via modal) →
      // full reprint semua items target. Else → auto/auto_additional delta.
      function buildJob(target: PrintTarget, targetItems: ItemForQueue[]): { items: ItemForQueue[]; trigger: PrintTrigger } | null {
        if (targetItems.length === 0) return null;
        if (reprint[target]) {
          return { items: targetItems, trigger: 'reprint' };
        }
        const trigger: PrintTrigger = wasConfirmedBefore ? 'auto_additional' : 'auto';
        const filtered = wasConfirmedBefore
          ? targetItems.filter((i) => (target === 'dapur' ? i.printed_dapur_at : i.printed_minuman_at) === null)
          : targetItems;
        if (filtered.length === 0) return null;
        return { items: filtered, trigger };
      }

      const dapurJob = buildJob('dapur', split.dapur);
      const minumanJob = buildJob('minuman', split.minuman);

      const submitJobs: Promise<{ target: PrintTarget; ok: boolean; offline: boolean; trigger: string }>[] = [];
      if (dapurJob) {
        submitJobs.push(
          dispatchKitchenPrintJob({ tx: data.transaction, target: 'dapur', items: dapurJob.items, trigger: dapurJob.trigger, printerSettings })
            .then((r) => ({ ...r, target: 'dapur' as const, trigger: dapurJob.trigger })),
        );
      }
      if (minumanJob) {
        submitJobs.push(
          dispatchKitchenPrintJob({ tx: data.transaction, target: 'minuman', items: minumanJob.items, trigger: minumanJob.trigger, printerSettings })
            .then((r) => ({ ...r, target: 'minuman' as const, trigger: minumanJob.trigger })),
        );
      }
      const results = await Promise.all(submitJobs);
      const succeeded = results.filter((r) => r.ok).map((r) => r.target);
      const failed = results.filter((r) => !r.ok);
      const offlineCount = failed.filter((f) => f.offline).length;
      const reprintCount = results.filter((r) => r.ok && r.trigger === 'reprint').length;

      if (results.length === 0) {
        toast.success('Nota tersimpan (tidak ada item baru untuk dicetak)');
      } else if (failed.length === 0) {
        const action = reprintCount > 0
          ? 'cetak ulang'
          : wasConfirmedBefore
            ? 'tambahan'
            : 'cetak';
        toast.success(`Nota tersimpan, ${succeeded.length} print job ${action} dikirim ke agent`);
      } else if (offlineCount > 0) {
        toast.success('Nota tersimpan');
        toast.warning('Agent printer offline. Nyalakan agent lalu klik Cetak tambahan dari halaman detail.', { duration: 10000 });
      } else {
        toast.success('Nota tersimpan');
        toast.error(`Gagal kirim print job ke: ${failed.map((f) => f.target).join(', ')}. Coba reprint manual dari halaman detail.`);
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
    } finally {
      setSubmitting(false);
    }
  }

  function modificationTargetLabel(mod: { dapur: boolean; minuman: boolean }): string {
    if (mod.dapur && mod.minuman) return 'dapur & minuman';
    if (mod.dapur) return 'dapur';
    return 'minuman';
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
          Pastikan item dan jumlah sudah benar. Item kuning/merah perlu lebih teliti — klik ✏️ untuk edit.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
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

            <label
              htmlFor="takeaway-switch"
              className={[
                'mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-lg border px-4 py-3 transition-colors',
                isTakeaway
                  ? 'border-gold/60 bg-gold-faint'
                  : 'border-clay-soft/60 bg-paper',
              ].join(' ')}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-coal">
                  <span aria-hidden>📦</span>
                  <span>Dibungkus</span>
                </div>
                <p className="mt-0.5 text-xs text-coal-soft">
                  {isTakeaway
                    ? 'Tiket dapur akan bertanda BUNGKUS besar.'
                    : 'Nyalakan kalau nota ini pesanan bungkus (bukan makan sini).'}
                </p>
              </div>
              <Switch
                id="takeaway-switch"
                checked={isTakeaway}
                onCheckedChange={setIsTakeaway}
                aria-label="Tandai transaksi sebagai dibungkus"
              />
            </label>
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
                  onEdit={() => setEditing(it)}
                  onDelete={() => removeItem(it._localId)}
                  onQtyChange={(qty) => changeItemQty(it._localId, qty)}
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

      <AlertDialog
        open={modificationModal !== null}
        onOpenChange={(open) => { if (!open && !submitting) setModificationModal(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ada items yang diubah</AlertDialogTitle>
            <AlertDialogDescription>
              {modificationModal && (() => {
                const modLabel = modificationTargetLabel(modificationModal.modified);
                const totalNew = modificationModal.newItems.dapur + modificationModal.newItems.minuman;
                const newParts: string[] = [];
                if (modificationModal.newItems.dapur > 0) {
                  newParts.push(`${modificationModal.newItems.dapur} ke dapur`);
                }
                if (modificationModal.newItems.minuman > 0) {
                  newParts.push(`${modificationModal.newItems.minuman} ke minuman`);
                }
                return (
                  <>
                    Items existing diubah di <strong>{modLabel}</strong> (qty / menu / catatan).
                    Cetak ulang ke {modLabel} biar mereka tau perubahannya?
                    {totalNew > 0 && (
                      <span className="block mt-2 rounded-md bg-mustard-faint px-3 py-2 text-xs text-coal">
                        ℹ Item baru ({newParts.join(' · ')}) <strong>tetap dicetak otomatis</strong> ke target masing-masing, tidak dipengaruhi pilihan di bawah.
                      </span>
                    )}
                    <span className="block mt-2 text-xs text-coal-soft">
                      Pilih Skip kalau kamu kabari modifikasi langsung ke {modLabel}.
                    </span>
                  </>
                );
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-col gap-2">
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                const ctx = modificationModal;
                setModificationModal(null);
                if (ctx) await submitSave({ reprintModifiedTarget: ctx.modified });
              }}
            >
              Cetak ulang ke {modificationModal ? modificationTargetLabel(modificationModal.modified) : ''}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={async () => {
                const ctx = modificationModal;
                setModificationModal(null);
                if (ctx) await submitSave({ reprintModifiedTarget: { dapur: false, minuman: false } });
              }}
            >
              Skip — kabari manual
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => setModificationModal(null)}
            >
              Batal — kembali ke edit
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
