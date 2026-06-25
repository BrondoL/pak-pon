'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { renderKitchenTicket, renderCustomerReceipt, uint8ToBase64 } from '@/lib/escpos';
import type { PrinterSettings } from '@/lib/printer-settings';

export type MenuCategory = 'makanan' | 'nasi' | 'minuman';
export type PrinterTarget = 'dapur' | 'minuman' | 'customer';

export type TransactionItemForPrint = {
  id: string;
  menu_name_snapshot: string;
  menu_category: MenuCategory;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};

type TxBase = {
  id: string;
  daily_seq: number | null;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
};

type Trigger =
  | 'reprint'
  | 'reprint_additional'
  | 'customer';

function isKitchenItem(it: TransactionItemForPrint): boolean {
  return it.menu_category === 'makanan' || it.menu_category === 'nasi';
}

async function submitJob(args: {
  tx: TxBase;
  target: PrinterTarget;
  items: TransactionItemForPrint[];
  trigger: Trigger;
  printerSettings: PrinterSettings;
}): Promise<{ ok: boolean; error?: string }> {
  const ticketInput = {
    daily_seq: args.tx.daily_seq ?? 0,
    created_at: new Date(args.tx.created_at),
    customer_name: args.tx.customer_name,
    table_no: args.tx.table_no,
    items: args.items.map((i) => ({
      qty: i.qty,
      name: i.menu_name_snapshot,
      unit_price: i.unit_price_snapshot,
      note: i.notes,
    })),
  };

  const bytes =
    args.target === 'customer'
      ? renderCustomerReceipt(ticketInput, args.printerSettings)
      : renderKitchenTicket(ticketInput, args.printerSettings);

  const item_ids =
    args.target === 'customer' ? null : args.items.map((i) => i.id);

  try {
    const res = await fetch('/api/print/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: args.trigger,
        item_ids,
        bytes_b64: uint8ToBase64(bytes),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = (data as { error?: string }).error ?? `HTTP ${res.status}`;
      // 503 = agent_offline: special handling supaya UX bisa show toast tertentu.
      const isOffline = res.status === 503 && err === 'agent_offline';
      return { ok: false, error: isOffline ? 'agent_offline' : err };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export function ReprintCard({
  transaction,
  items,
  printerSettings,
}: {
  transaction: TxBase;
  items: TransactionItemForPrint[];
  printerSettings: PrinterSettings;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);

  const dapurAll = useMemo(() => items.filter(isKitchenItem), [items]);
  const minumanAll = useMemo(() => items.filter((i) => i.menu_category === 'minuman'), [items]);

  const dapurPending = useMemo(
    () => dapurAll.filter((i) => i.printed_dapur_at === null),
    [dapurAll],
  );
  const minumanPending = useMemo(
    () => minumanAll.filter((i) => i.printed_minuman_at === null),
    [minumanAll],
  );

  const hasDapur = dapurAll.length > 0;
  const hasMinuman = minumanAll.length > 0;
  const pendingCount = dapurPending.length + minumanPending.length;
  const hasPending = pendingCount > 0;
  const hasAnyItems = items.length > 0;

  async function fireAdditional() {
    setSubmitting('tambahan');
    const jobs: Promise<{ target: PrinterTarget; ok: boolean; error?: string }>[] = [];
    if (dapurPending.length > 0) {
      jobs.push(
        submitJob({
          tx: transaction,
          target: 'dapur',
          items: dapurPending,
          trigger: 'reprint_additional',
          printerSettings,
        }).then((r) => ({ ...r, target: 'dapur' as const })),
      );
    }
    if (minumanPending.length > 0) {
      jobs.push(
        submitJob({
          tx: transaction,
          target: 'minuman',
          items: minumanPending,
          trigger: 'reprint_additional',
          printerSettings,
        }).then((r) => ({ ...r, target: 'minuman' as const })),
      );
    }
    const results = await Promise.all(jobs);
    setSubmitting(null);
    const ok = results.filter((r) => r.ok).map((r) => r.target);
    const fail = results.filter((r) => !r.ok);
    if (fail.length === 0) toast.success(`${ok.length} job tambahan dikirim ke agent`);
    else {
      const offline = fail.some((f) => f.error === 'agent_offline');
      if (offline) {
        toast.warning('Agent printer offline', {
          description: 'Nyalakan agent di Android dulu, lalu coba lagi.',
          duration: 8000,
        });
      } else {
        toast.error(`${ok.length} sukses, ${fail.length} gagal: ${fail.map((f) => `${f.target}=${f.error}`).join(', ')}`);
      }
    }
  }

  async function fireReprintTarget(target: 'dapur' | 'minuman') {
    setSubmitting(`ulang-${target}`);
    const targetItems = target === 'dapur' ? dapurAll : minumanAll;
    const result = await submitJob({
      tx: transaction,
      target,
      items: targetItems,
      trigger: 'reprint',
      printerSettings,
    });
    setSubmitting(null);
    if (result.ok) toast.success(`Cetak ulang ${target} dikirim ke agent`);
    else if (result.error === 'agent_offline') {
      toast.warning('Agent printer offline', { description: 'Nyalakan agent di Android dulu, lalu coba lagi.', duration: 8000 });
    } else {
      toast.error(`Gagal kirim job ${target}: ${result.error}`);
    }
  }

  async function fireReprintBoth() {
    setSubmitting('ulang-keduanya');
    const jobs: Promise<{ target: PrinterTarget; ok: boolean; error?: string }>[] = [];
    if (hasDapur) {
      jobs.push(
        submitJob({
          tx: transaction,
          target: 'dapur',
          items: dapurAll,
          trigger: 'reprint',
          printerSettings,
        }).then((r) => ({ ...r, target: 'dapur' as const })),
      );
    }
    if (hasMinuman) {
      jobs.push(
        submitJob({
          tx: transaction,
          target: 'minuman',
          items: minumanAll,
          trigger: 'reprint',
          printerSettings,
        }).then((r) => ({ ...r, target: 'minuman' as const })),
      );
    }
    const results = await Promise.all(jobs);
    setSubmitting(null);
    const ok = results.filter((r) => r.ok).map((r) => r.target);
    const fail = results.filter((r) => !r.ok);
    if (fail.length === 0) toast.success(`${ok.length} job dikirim ke agent`);
    else {
      const offline = fail.some((f) => f.error === 'agent_offline');
      if (offline) {
        toast.warning('Agent printer offline', {
          description: 'Nyalakan agent di Android dulu, lalu coba lagi.',
          duration: 8000,
        });
      } else {
        toast.error(`${ok.length} sukses, ${fail.length} gagal: ${fail.map((f) => `${f.target}=${f.error}`).join(', ')}`);
      }
    }
  }

  async function fireCustomer() {
    setSubmitting('customer');
    const result = await submitJob({
      tx: transaction,
      target: 'customer',
      items, // all items, customer receipt shows everything with prices
      trigger: 'customer',
      printerSettings,
    });
    setSubmitting(null);
    if (result.ok) toast.success('Cetak nota customer dikirim ke agent');
    else if (result.error === 'agent_offline') {
      toast.warning('Agent printer offline', { description: 'Nyalakan agent di Android dulu, lalu coba lagi.', duration: 8000 });
    } else {
      toast.error(`Gagal kirim job customer: ${result.error}`);
    }
  }

  const isBusy = submitting !== null;

  return (
    <div className="rounded-md border border-clay-soft bg-paper-soft p-4 space-y-4">
      <h3 className="font-medium text-coal">Cetak</h3>

      <button
        type="button"
        onClick={fireAdditional}
        disabled={!hasPending || isBusy}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {submitting === 'tambahan'
          ? 'Mengirim…'
          : hasPending
            ? `⚡ Cetak tambahan (${pendingCount} item)`
            : '⚡ Cetak tambahan (tidak ada)'}
      </button>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-clay">Cetak ulang lengkap</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => fireReprintTarget('dapur')}
            disabled={!hasDapur || isBusy}
            className="rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
          >
            {submitting === 'ulang-dapur' ? 'Mengirim…' : 'Cetak ulang Dapur'}
          </button>
          <button
            type="button"
            onClick={() => fireReprintTarget('minuman')}
            disabled={!hasMinuman || isBusy}
            className="rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
          >
            {submitting === 'ulang-minuman' ? 'Mengirim…' : 'Cetak ulang Minuman'}
          </button>
        </div>
        <button
          type="button"
          onClick={fireReprintBoth}
          disabled={(!hasDapur && !hasMinuman) || isBusy}
          className="w-full rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
        >
          {submitting === 'ulang-keduanya' ? 'Mengirim…' : 'Cetak ulang Keduanya'}
        </button>
      </div>

      <button
        type="button"
        onClick={fireCustomer}
        disabled={!hasAnyItems || isBusy}
        className="w-full rounded-md border border-mustard/40 bg-mustard-faint px-3 py-2 text-sm text-coal disabled:opacity-50"
      >
        {submitting === 'customer' ? 'Mengirim…' : '🧾 Cetak nota customer'}
      </button>
    </div>
  );
}
