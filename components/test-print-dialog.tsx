'use client';

import { useState } from 'react';
import { setPrinterStatus, type PrinterTarget } from '@/lib/printer-status';
import { renderTicket } from '@/lib/escpos';
import { buildRawBtIntentUrl } from '@/lib/print-intent';

type Phase = 'idle' | 'awaiting_confirm' | 'failed_followup';

function profileForTarget(target: PrinterTarget): string {
  return target === 'dapur' ? 'Dapur' : 'Minuman';
}

function fireTestIntent(target: PrinterTarget) {
  const bytes = renderTicket({
    target,
    daily_seq: 0,
    created_at: new Date(),
    customer_name: null,
    table_no: null,
    items: [{ qty: 1, name: `TES PRINTER ${target.toUpperCase()}`, note: null }],
  });
  const url = buildRawBtIntentUrl({ profile: profileForTarget(target), bytes });
  // Trigger intent via window.location for Android Chrome
  window.location.href = url;
}

async function postLog(payload: {
  target: PrinterTarget;
  outcome: 'dispatched' | 'reported_success' | 'reported_failed';
  failure_note?: string;
}) {
  try {
    await fetch('/api/print/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: null, // test print gak terkait tx
        daily_seq: null,
        target: payload.target,
        trigger: 'test',
        outcome: payload.outcome,
        failure_note: payload.failure_note,
        url_scheme_variant: 'rawbt-intent-v1',
        user_agent: navigator.userAgent,
      }),
    });
  } catch {
    // Best-effort logging, swallow
  }
}

export function TestPrintDialog({
  target,
  onClose,
}: {
  target: PrinterTarget;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [failureNote, setFailureNote] = useState('');

  function handleFire() {
    fireTestIntent(target);
    postLog({ target, outcome: 'dispatched' });
    setPhase('awaiting_confirm');
  }

  function handleSuccess() {
    setPrinterStatus(target, {
      state: 'success',
      last_check: new Date().toISOString(),
      last_outcome_note: 'test print success',
    });
    postLog({ target, outcome: 'reported_success' });
    onClose();
  }

  function handleFailedClicked() {
    setPhase('failed_followup');
  }

  function handleRetry() {
    fireTestIntent(target);
    postLog({ target, outcome: 'dispatched' });
    setPhase('awaiting_confirm');
    setFailureNote('');
  }

  function handleCloseAsFailed() {
    setPrinterStatus(target, {
      state: 'failed',
      last_check: new Date().toISOString(),
      last_outcome_note: failureNote || 'test print failed',
    });
    postLog({ target, outcome: 'reported_failed', failure_note: failureNote || undefined });
    onClose();
  }

  const label = target.toUpperCase();

  if (phase === 'idle') {
    return (
      <div className="space-y-3 rounded-md border bg-card p-4">
        <h3 className="font-medium">Cetak tes printer {label}</h3>
        <p className="text-sm text-muted-foreground">
          Pastikan kertas terpasang, lalu tekan tombol di bawah.
        </p>
        <button
          onClick={handleFire}
          className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Cetak Tes Sekarang
        </button>
      </div>
    );
  }

  if (phase === 'awaiting_confirm') {
    return (
      <div className="space-y-3 rounded-md border bg-card p-4">
        <h3 className="font-medium">Apakah kertas keluar?</h3>
        <p className="text-sm text-muted-foreground">
          Bertuliskan &quot;TES PRINTER {label}&quot;
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleSuccess}
            className="flex-1 rounded-md bg-green-600 px-4 py-2 text-white"
          >
            ✓ Berhasil
          </button>
          <button
            onClick={handleFailedClicked}
            className="flex-1 rounded-md border border-red-300 px-4 py-2 text-red-700"
          >
            ✗ Gagal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <h3 className="font-medium">Apa yang terjadi?</h3>
      <textarea
        value={failureNote}
        onChange={(e) => setFailureNote(e.target.value)}
        placeholder="Kertas tidak keluar, error, dll (opsional)"
        className="w-full rounded-md border p-2 text-sm"
        rows={3}
      />
      <div className="flex gap-2">
        <button onClick={handleRetry} className="flex-1 rounded-md border px-4 py-2">
          Coba Lagi
        </button>
        <button
          onClick={handleCloseAsFailed}
          className="flex-1 rounded-md bg-red-600 px-4 py-2 text-white"
        >
          Tutup
        </button>
      </div>
    </div>
  );
}
