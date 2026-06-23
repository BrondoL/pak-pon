'use client';

import { useState } from 'react';
import { renderTicket } from '@/lib/escpos';
import { buildRawBtIntentUrl, splitItemsByTarget, type TransactionItemForPrint } from '@/lib/print-intent';
import { setPrinterStatus, type PrinterTarget } from '@/lib/printer-status';

type TxBase = {
  id: string;
  daily_seq: number | null;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
};

function profileForTarget(target: PrinterTarget): string {
  return target === 'dapur' ? 'Dapur' : 'Minuman';
}

async function postLog(payload: {
  tx_id: string;
  daily_seq: number | null;
  target: PrinterTarget;
  outcome: 'dispatched' | 'reported_success' | 'reported_failed';
  trigger: 'reprint';
  failure_note?: string;
}) {
  try {
    await fetch('/api/print/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        url_scheme_variant: 'rawbt-intent-v1',
        user_agent: navigator.userAgent,
      }),
    });
  } catch {
    // best-effort
  }
}

export function ReprintCard({
  transaction,
  items,
}: {
  transaction: TxBase;
  items: TransactionItemForPrint[];
}) {
  const [pending, setPending] = useState<PrinterTarget | null>(null);
  const split = splitItemsByTarget(items);
  const hasDapur = split.dapur.length > 0;
  const hasMinuman = split.minuman.length > 0;

  function fireFor(target: PrinterTarget) {
    const targetItems = target === 'dapur' ? split.dapur : split.minuman;
    if (targetItems.length === 0) return;
    const bytes = renderTicket({
      target,
      daily_seq: transaction.daily_seq ?? 0,
      created_at: new Date(transaction.created_at),
      customer_name: transaction.customer_name,
      table_no: transaction.table_no,
      items: targetItems.map((i) => ({
        qty: i.qty,
        name: i.menu_name_snapshot,
        note: i.notes,
      })),
    });
    const url = buildRawBtIntentUrl({ profile: profileForTarget(target), bytes });
    window.location.href = url;
    postLog({
      tx_id: transaction.id,
      daily_seq: transaction.daily_seq,
      target,
      trigger: 'reprint',
      outcome: 'dispatched',
    });
    setPending(target);
  }

  function fireBoth() {
    if (hasDapur) fireFor('dapur');
    if (hasMinuman) {
      // Sequential dengan delay supaya RawBT gak overlap
      setTimeout(() => fireFor('minuman'), 300);
    }
  }

  function confirmSuccess() {
    if (!pending) return;
    setPrinterStatus(pending, {
      state: 'success',
      last_check: new Date().toISOString(),
      last_outcome_note: `reprint ${pending}`,
    });
    postLog({
      tx_id: transaction.id,
      daily_seq: transaction.daily_seq,
      target: pending,
      trigger: 'reprint',
      outcome: 'reported_success',
    });
    setPending(null);
  }

  function confirmFailed() {
    if (!pending) return;
    setPrinterStatus(pending, {
      state: 'failed',
      last_check: new Date().toISOString(),
      last_outcome_note: `reprint ${pending} failed`,
    });
    postLog({
      tx_id: transaction.id,
      daily_seq: transaction.daily_seq,
      target: pending,
      trigger: 'reprint',
      outcome: 'reported_failed',
    });
    setPending(null);
  }

  if (pending) {
    return (
      <div className="rounded-md border bg-card p-4 space-y-3">
        <h3 className="font-medium">Cetak ulang ke {pending.toUpperCase()}</h3>
        <p className="text-sm">Apakah kertas keluar?</p>
        <div className="flex gap-2">
          <button onClick={confirmSuccess} className="flex-1 rounded-md bg-green-600 px-4 py-2 text-white">
            ✓ Berhasil
          </button>
          <button onClick={confirmFailed} className="flex-1 rounded-md border border-red-300 px-4 py-2 text-red-700">
            ✗ Gagal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <h3 className="font-medium">Cetak ulang</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => fireFor('dapur')}
          disabled={!hasDapur}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          Cetak Dapur
        </button>
        <button
          onClick={() => fireFor('minuman')}
          disabled={!hasMinuman}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          Cetak Minuman
        </button>
      </div>
      <button
        onClick={fireBoth}
        disabled={!hasDapur && !hasMinuman}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        Cetak Keduanya
      </button>
    </div>
  );
}
