'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatRp } from '@/lib/currency';
import {
  dispatchKitchenPrintJob, splitItemsByPrintTarget,
  type PrintTarget,
} from '@/lib/print-dispatch';
import { PosMenuPicker } from './pos-menu-picker';
import { PosItemConfigModal } from './pos-item-config-modal';
import { addOrIncrementDraft, needsChipConfig, MAX_QTY } from '@/lib/cart-draft';
import type { DraftRow, PosCartItemDraft } from '@/lib/cart-draft';

export function PosClient({
  menus,
  printerSettings,
}: {
  menus: MenuOption[];
  printerSettings: PrinterSettings;
}) {
  const router = useRouter();
  const [pickingMenu, setPickingMenu] = useState<MenuOption | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [cart, setCart] = useState<DraftRow[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [tableNo, setTableNo] = useState('');
  const [isTakeaway, setIsTakeaway] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();
  // Sync guard against double-tap Simpan — setSubmitting is async so a
  // rapid second tap can enter handleSave before React commits the state.
  const submitLock = useRef(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const totalAmount = cart.reduce((s, it) => s + it.unit_price_snapshot * it.qty, 0);

  function handleAddOrEditItem(draft: PosCartItemDraft) {
    if (editingIdx !== null) {
      setCart((prev) => prev.map((c, i) => (i === editingIdx ? { ...draft, _localId: c._localId } : c)));
      setEditingIdx(null);
    } else {
      setCart((prev) => [...prev, { ...draft, _localId: crypto.randomUUID() }]);
    }
    setPickingMenu(null);
  }

  function handleEditItem(idx: number) {
    const item = cart[idx];
    const menu = menus.find((m) => m.id === item.menu_id);
    if (!menu) return;
    setEditingIdx(idx);
    setPickingMenu(menu);
  }

  function handleDeleteItem(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleQtyChange(idx: number, nextQty: number) {
    setCart((prev) => prev.map((c, i) => (i === idx ? { ...c, qty: nextQty } : c)));
  }

  function handleCancel() {
    if (cart.length === 0) {
      router.push('/');
      return;
    }
    setConfirmingCancel(true);
  }

  async function handleSave() {
    if (cart.length === 0) return;
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const payload = {
        customer_name: customerName.trim() === '' ? null : customerName.trim(),
        table_no: tableNo.trim() === '' ? null : tableNo.trim(),
        is_takeaway: isTakeaway,
        items: cart.map((it, idx) => ({
          menu_id: it.menu_id,
          qty: it.qty,
          chip_labels: it.applied_chips.map((c) => c.label),
          notes: it.notes,
          sort_order: idx,
        })),
      };
      const res = await fetch('/api/pos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'save-failed');
      }
      const data = await res.json() as {
        transaction: { id: string; daily_seq: number | null; created_at: string; customer_name: string | null; table_no: string | null; is_takeaway: boolean };
        items: Array<{ id: string }>;
      };

      const cartWithIds: Array<DraftRow & { id: string }> = cart.map((it, idx) => ({
        ...it,
        id: data.items[idx]?.id ?? crypto.randomUUID(),
      }));
      const split = splitItemsByPrintTarget(cartWithIds);
      const jobs: Promise<{ target: PrintTarget; ok: boolean; offline: boolean }>[] = [];
      if (split.dapur.length > 0) {
        jobs.push(dispatchKitchenPrintJob({ tx: data.transaction, target: 'dapur', items: split.dapur, trigger: 'auto', printerSettings })
          .then((r) => ({ ...r, target: 'dapur' as const })));
      }
      if (split.minuman.length > 0) {
        jobs.push(dispatchKitchenPrintJob({ tx: data.transaction, target: 'minuman', items: split.minuman, trigger: 'auto', printerSettings })
          .then((r) => ({ ...r, target: 'minuman' as const })));
      }
      const results = await Promise.all(jobs);
      const failed = results.filter((r) => !r.ok);
      const offlineCount = failed.filter((f) => f.offline).length;

      if (failed.length === 0) {
        toast.success(`Pesanan tersimpan, ${results.length} print job dikirim`);
      } else if (offlineCount > 0) {
        toast.success('Pesanan tersimpan');
        toast.warning('Agent printer offline. Nyalakan agent lalu cetak manual dari detail transaksi.', { duration: 10000 });
      } else {
        toast.success('Pesanan tersimpan');
        toast.error(`Gagal kirim print: ${failed.map((f) => f.target).join(', ')}`);
      }

      startTransition(() => { router.push('/'); });
    } catch (err) {
      toast.error('Gagal menyimpan pesanan', {
        description: err instanceof Error ? err.message : 'Coba lagi.',
      });
      // Only release the lock on error — successful save redirects away.
      submitLock.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PosMenuPicker
          menus={menus}
          onMenuTap={(m) => {
            setEditingIdx(null);
            // Menu bergrup mutex (mis. Ayam goreng: Dada/Paha) tetap buka modal
            // konfigurasi — bagiannya harus diputuskan, bukan didiamkan. Menu lain
            // langsung masuk cart qty 1, tap lagi qty naik.
            if (needsChipConfig(m)) {
              setPickingMenu(m);
              return;
            }
            setCart((prev) => addOrIncrementDraft(prev, m, crypto.randomUUID()));
          }}
        />

        <div className="space-y-4 pb-24 lg:pb-0">
          <Card variant="paper" className="p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="pos-customer">Nama</Label>
                <Input id="pos-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="opsional" className="mt-2" />
              </div>
              <div>
                <Label htmlFor="pos-table">No. Meja</Label>
                <Input id="pos-table" value={tableNo} onChange={(e) => setTableNo(e.target.value)} placeholder="opsional" className="mt-2" />
              </div>
            </div>

            <label
              htmlFor="pos-takeaway"
              className={[
                'mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-lg border px-4 py-3 transition-colors',
                isTakeaway ? 'border-gold/60 bg-gold-faint' : 'border-clay-soft/60 bg-paper',
              ].join(' ')}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-coal">
                  <span aria-hidden>📦</span><span>Dibungkus</span>
                </div>
                <p className="mt-0.5 text-xs text-coal-soft">
                  {isTakeaway ? 'Tiket dapur akan bertanda BUNGKUS besar.' : 'Nyalakan kalau pesanan bungkus.'}
                </p>
              </div>
              <Switch id="pos-takeaway" checked={isTakeaway} onCheckedChange={setIsTakeaway} />
            </label>
          </Card>

          <Card variant="paper">
            <ul className="divide-y divide-clay-soft/60">
              {cart.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-clay">
                  Cart kosong. Tap menu di sebelah kiri untuk mulai order.
                </li>
              )}
              {cart.map((it, idx) => (
                <li key={it._localId} className="px-4 py-3 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-coal truncate">{it.menu_name_snapshot}</div>
                      <div className="mt-0.5 text-xs text-clay">{formatRp(it.unit_price_snapshot)}</div>
                      {it.applied_chips.length > 0 && (
                        <p className="mt-0.5 text-xs text-clay">
                          {it.applied_chips.map((c) => c.label).join(', ')}
                        </p>
                      )}
                      {it.notes && (
                        <p className="mt-0.5 text-xs italic text-clay-soft">{it.notes}</p>
                      )}
                    </div>
                    <div className="shrink-0 font-display text-base tracking-tight text-coal tabular-nums">
                      {formatRp(it.unit_price_snapshot * it.qty)}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="inline-flex items-center rounded-lg border border-clay-soft/60 bg-paper">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleQtyChange(idx, Math.max(1, it.qty - 1))}
                        disabled={it.qty <= 1}
                        aria-label={`Kurangi jumlah ${it.menu_name_snapshot}`}
                        className="rounded-r-none text-lg leading-none"
                      >
                        −
                      </Button>
                      <span
                        className="min-w-8 px-1 text-center text-sm font-semibold tabular-nums text-coal"
                        aria-live="polite"
                      >
                        {it.qty}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleQtyChange(idx, Math.min(MAX_QTY, it.qty + 1))}
                        disabled={it.qty >= MAX_QTY}
                        aria-label={`Tambah jumlah ${it.menu_name_snapshot}`}
                        className="rounded-l-none text-lg leading-none"
                      >
                        +
                      </Button>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => handleEditItem(idx)} aria-label={`Edit ${it.menu_name_snapshot}`}>
                        ✏️
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDeleteItem(idx)} aria-label={`Hapus ${it.menu_name_snapshot}`}>
                        🗑️
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="border-t border-clay-soft/60 px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm uppercase tracking-wide text-clay">Total sistem</span>
                <span className="font-display text-2xl tracking-tight text-coal">{formatRp(totalAmount)}</span>
              </div>
            </div>
          </Card>

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-clay-soft/60 bg-paper/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_16px_-8px_rgba(0,0,0,0.08)] backdrop-blur-sm lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:shadow-none lg:backdrop-blur-none">
            <div className="mx-auto flex max-w-6xl gap-2">
              <Button variant="secondary" onClick={handleCancel} disabled={pending || submitting}>Batal</Button>
              <Button
                onClick={handleSave}
                disabled={pending || submitting || cart.length === 0}
                className="flex-1"
              >
                {submitting ? 'Menyimpan…' : `✓ Simpan & Cetak ${cart.length > 0 ? formatRp(totalAmount) : ''}`}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {pickingMenu && (
        <PosItemConfigModal
          menu={pickingMenu}
          initial={editingIdx !== null ? cart[editingIdx] : undefined}
          onSave={handleAddOrEditItem}
          onClose={() => { setPickingMenu(null); setEditingIdx(null); }}
        />
      )}

      <AlertDialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan pesanan?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua {cart.length} item di cart akan hilang. Ga bisa di-undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Kembali</AlertDialogCancel>
            <AlertDialogAction onClick={() => router.push('/')}>Ya, batalkan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
