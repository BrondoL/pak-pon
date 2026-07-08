'use client';

import { useState, useTransition } from 'react';
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
import { renderKitchenTicket, uint8ToBase64 } from '@/lib/escpos';
import { PosMenuPicker } from './pos-menu-picker';
import { PosItemConfigModal, type PosCartItemDraft } from './pos-item-config-modal';

type CartRow = PosCartItemDraft & { _localId: string };

type PrinterTarget = 'dapur' | 'minuman';

function splitByTarget<T extends { category: PosCartItemDraft['category'] }>(cart: T[]) {
  const dapur: T[] = [];
  const minuman: T[] = [];
  for (const it of cart) {
    if (it.category === 'minuman') minuman.push(it);
    else dapur.push(it);
  }
  return { dapur, minuman };
}

async function submitPrintJob(args: {
  tx: { id: string; daily_seq: number | null; created_at: string; customer_name: string | null; table_no: string | null; is_takeaway: boolean };
  target: PrinterTarget;
  items: Array<CartRow & { id: string }>;
  printerSettings: PrinterSettings;
}): Promise<{ ok: boolean; offline: boolean }> {
  const bytes = renderKitchenTicket(
    {
      daily_seq: args.tx.daily_seq ?? 0,
      created_at: new Date(args.tx.created_at),
      customer_name: args.tx.customer_name,
      table_no: args.tx.table_no,
      is_takeaway: args.tx.is_takeaway,
      items: args.items.map((i) => ({
        qty: i.qty,
        name: i.menu_name_snapshot,
        unit_price: i.unit_price_snapshot,
        note: i.notes,
        applied_chips: i.applied_chips,
      })),
    },
    args.printerSettings,
  );
  const bytes_b64 = uint8ToBase64(bytes);
  try {
    const res = await fetch('/api/print/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: 'auto',
        item_ids: args.items.map((i) => i.id),
        bytes_b64,
      }),
    });
    if (res.ok) return { ok: true, offline: false };
    return { ok: false, offline: res.status === 503 };
  } catch {
    return { ok: false, offline: false };
  }
}

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
  const [cart, setCart] = useState<CartRow[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [tableNo, setTableNo] = useState('');
  const [isTakeaway, setIsTakeaway] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();
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

  function handleCancel() {
    if (cart.length === 0) {
      router.push('/');
      return;
    }
    setConfirmingCancel(true);
  }

  async function handleSave() {
    if (cart.length === 0) return;
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

      const cartWithIds: Array<CartRow & { id: string }> = cart.map((it, idx) => ({
        ...it,
        id: data.items[idx]?.id ?? crypto.randomUUID(),
      }));
      const split = splitByTarget(cartWithIds);
      const jobs: Promise<{ target: PrinterTarget; ok: boolean; offline: boolean }>[] = [];
      if (split.dapur.length > 0) {
        jobs.push(submitPrintJob({ tx: data.transaction, target: 'dapur', items: split.dapur, printerSettings })
          .then((r) => ({ ...r, target: 'dapur' as const })));
      }
      if (split.minuman.length > 0) {
        jobs.push(submitPrintJob({ tx: data.transaction, target: 'minuman', items: split.minuman, printerSettings })
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
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PosMenuPicker menus={menus} onMenuTap={(m) => { setEditingIdx(null); setPickingMenu(m); }} />

        <div className="space-y-4">
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
                <li key={it._localId} className="flex items-start gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-coal">
                      {it.qty}× {it.menu_name_snapshot}
                    </div>
                    {it.applied_chips.length > 0 && (
                      <p className="text-xs text-clay">
                        {it.applied_chips.map((c) => c.label).join(', ')}
                      </p>
                    )}
                    {it.notes && <p className="text-xs italic text-clay-soft">{it.notes}</p>}
                  </div>
                  <div className="text-right">
                    <div className="font-display text-sm text-coal">{formatRp(it.unit_price_snapshot * it.qty)}</div>
                    <div className="mt-1 flex gap-1">
                      <button type="button" onClick={() => handleEditItem(idx)} aria-label="Edit item" className="rounded p-1 text-xs hover:bg-cream">✏️</button>
                      <button type="button" onClick={() => handleDeleteItem(idx)} aria-label="Hapus item" className="rounded p-1 text-xs hover:bg-brick-faint">🗑</button>
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

          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleCancel} disabled={pending || submitting}>Batal</Button>
            <Button
              onClick={handleSave}
              disabled={pending || submitting || cart.length === 0}
              className="flex-1"
            >
              {submitting ? 'Menyimpan…' : '✓ Simpan & Cetak'}
            </Button>
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
