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

// Navigation-resilient log POST. sendBeacon survives the Android intent
// teardown that follows `window.location.href = url`. Falls back to
// keepalive fetch for environments without sendBeacon (e.g., jsdom).
function postPrintLogBeacon(payload: {
  tx_id: string | null;
  daily_seq: number | null;
  target: PrinterTarget;
  trigger: 'auto' | 'reprint' | 'test';
  outcome: 'dispatched' | 'reported_success' | 'reported_failed';
  failure_note?: string;
}) {
  const body = JSON.stringify({
    ...payload,
    url_scheme_variant: 'rawbt-intent-v1',
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  });
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/print/log', blob);
      return;
    } catch {
      // fall through to fetch fallback
    }
  }
  fetch('/api/print/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function ReprintCard({
  transaction,
  items,
}: {
  transaction: TxBase;
  items: TransactionItemForPrint[];
}) {
  // Queue of targets awaiting user confirmation. After firing each intent
  // we push the target; user confirm shifts the head. This lets
  // "Cetak Keduanya" sequentially confirm dapur THEN minuman.
  const [pendingQueue, setPendingQueue] = useState<PrinterTarget[]>([]);
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
    // Enqueue the beacon BEFORE navigation so the request is flushed
    // even when the Android intent tears down the page.
    postPrintLogBeacon({
      tx_id: transaction.id,
      daily_seq: transaction.daily_seq,
      target,
      trigger: 'reprint',
      outcome: 'dispatched',
    });
    // Update React state FIRST so "Cetak ulang ke X — Apakah berhasil?"
    // renders before Android hands off to RawBT. Defer the actual
    // navigation by 50ms so the commit cycle completes.
    setPendingQueue((q) => [...q, target]);
    setTimeout(() => { window.location.href = url; }, 50);
  }

  function fireBoth() {
    if (hasDapur) fireFor('dapur');
    if (hasMinuman) {
      // Sequential dengan delay supaya RawBT gak overlap
      setTimeout(() => fireFor('minuman'), 300);
    }
  }

  function confirmSuccess() {
    const target = pendingQueue[0];
    if (!target) return;
    setPrinterStatus(target, {
      state: 'success',
      last_check: new Date().toISOString(),
      last_outcome_note: `reprint ${target}`,
    });
    postPrintLogBeacon({
      tx_id: transaction.id,
      daily_seq: transaction.daily_seq,
      target,
      trigger: 'reprint',
      outcome: 'reported_success',
    });
    setPendingQueue((q) => q.slice(1));
  }

  function confirmFailed() {
    const target = pendingQueue[0];
    if (!target) return;
    setPrinterStatus(target, {
      state: 'failed',
      last_check: new Date().toISOString(),
      last_outcome_note: `reprint ${target} failed`,
    });
    postPrintLogBeacon({
      tx_id: transaction.id,
      daily_seq: transaction.daily_seq,
      target,
      trigger: 'reprint',
      outcome: 'reported_failed',
    });
    setPendingQueue((q) => q.slice(1));
  }

  if (pendingQueue.length > 0) {
    const current = pendingQueue[0];
    return (
      <div className="rounded-md border border-clay-soft bg-paper-soft p-4 space-y-3">
        <h3 className="font-medium text-coal">Cetak ulang ke {current.toUpperCase()}</h3>
        <p className="text-sm text-coal-soft">Apakah kertas keluar?</p>
        <div className="flex gap-2">
          <button onClick={confirmSuccess} className="flex-1 rounded-md bg-leaf px-4 py-2 text-white">
            ✓ Berhasil
          </button>
          <button onClick={confirmFailed} className="flex-1 rounded-md border border-brick-soft px-4 py-2 text-brick">
            ✗ Gagal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-clay-soft bg-paper-soft p-4 space-y-3">
      <h3 className="font-medium text-coal">Cetak ulang</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => fireFor('dapur')}
          disabled={!hasDapur}
          className="rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
        >
          Cetak Dapur
        </button>
        <button
          onClick={() => fireFor('minuman')}
          disabled={!hasMinuman}
          className="rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
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
