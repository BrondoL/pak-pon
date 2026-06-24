'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { renderTicket, uint8ToBase64 } from '@/lib/escpos';
import type { PrinterSettings } from '@/lib/printer-settings';

export type MenuCategory = 'makanan' | 'nasi' | 'minuman';
export type PrinterTarget = 'dapur' | 'minuman';

export type TransactionItemForPrint = {
  id: string;
  menu_name_snapshot: string;
  menu_category: MenuCategory;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
};

type TxBase = {
  id: string;
  daily_seq: number | null;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
};

function splitByTarget(items: TransactionItemForPrint[]) {
  const dapur: TransactionItemForPrint[] = [];
  const minuman: TransactionItemForPrint[] = [];
  for (const it of items) {
    if (it.menu_category === 'minuman') minuman.push(it);
    else if (it.menu_category === 'makanan' || it.menu_category === 'nasi') dapur.push(it);
  }
  return { dapur, minuman };
}

async function submitJob(args: {
  tx: TxBase;
  target: PrinterTarget;
  targetItems: TransactionItemForPrint[];
  printerSettings: PrinterSettings;
}): Promise<{ ok: boolean; error?: string }> {
  const bytes = renderTicket(
    {
      target: args.target,
      daily_seq: args.tx.daily_seq ?? 0,
      created_at: new Date(args.tx.created_at),
      customer_name: args.tx.customer_name,
      table_no: args.tx.table_no,
      items: args.targetItems.map((i) => ({
        qty: i.qty,
        name: i.menu_name_snapshot,
        unit_price: i.unit_price_snapshot,
        note: i.notes,
      })),
    },
    args.printerSettings,
  );
  const bytes_b64 = uint8ToBase64(bytes);
  try {
    const res = await fetch('/api/print/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: 'reprint',
        bytes_b64,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
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
  const [submitting, setSubmitting] = useState<PrinterTarget | 'both' | null>(null);
  const split = splitByTarget(items);
  const hasDapur = split.dapur.length > 0;
  const hasMinuman = split.minuman.length > 0;

  async function fireFor(target: PrinterTarget) {
    setSubmitting(target);
    const targetItems = target === 'dapur' ? split.dapur : split.minuman;
    const result = await submitJob({ tx: transaction, target, targetItems, printerSettings });
    setSubmitting(null);
    if (result.ok) {
      toast.success(`Job cetak ${target} dikirim ke agent`);
    } else {
      toast.error(`Gagal kirim job ${target}: ${result.error}`);
    }
  }

  async function fireBoth() {
    setSubmitting('both');
    const jobs: Promise<{ ok: boolean; error?: string; target: PrinterTarget }>[] = [];
    if (hasDapur) {
      jobs.push(submitJob({ tx: transaction, target: 'dapur', targetItems: split.dapur, printerSettings }).then((r) => ({ ...r, target: 'dapur' as const })));
    }
    if (hasMinuman) {
      jobs.push(submitJob({ tx: transaction, target: 'minuman', targetItems: split.minuman, printerSettings }).then((r) => ({ ...r, target: 'minuman' as const })));
    }
    const results = await Promise.all(jobs);
    setSubmitting(null);
    const succeeded = results.filter((r) => r.ok).map((r) => r.target);
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      toast.success(`${succeeded.length} job dikirim ke agent`);
    } else {
      toast.error(`${succeeded.length} sukses, ${failed.length} gagal: ${failed.map((f) => `${f.target}=${f.error}`).join(', ')}`);
    }
  }

  return (
    <div className="rounded-md border border-clay-soft bg-paper-soft p-4 space-y-3">
      <h3 className="font-medium text-coal">Cetak ulang</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => fireFor('dapur')}
          disabled={!hasDapur || submitting !== null}
          className="rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
        >
          {submitting === 'dapur' ? 'Mengirim...' : 'Cetak Dapur'}
        </button>
        <button
          onClick={() => fireFor('minuman')}
          disabled={!hasMinuman || submitting !== null}
          className="rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
        >
          {submitting === 'minuman' ? 'Mengirim...' : 'Cetak Minuman'}
        </button>
      </div>
      <button
        onClick={fireBoth}
        disabled={(!hasDapur && !hasMinuman) || submitting !== null}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {submitting === 'both' ? 'Mengirim...' : 'Cetak Keduanya'}
      </button>
    </div>
  );
}
