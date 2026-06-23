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

// Navigation-resilient log POST. sendBeacon survives the Android intent
// teardown that follows `window.location.href = url`. Falls back to
// keepalive fetch for environments without sendBeacon (e.g., jsdom).
function postPrintLogBeacon(payload: {
  target: PrinterTarget;
  outcome: 'dispatched' | 'reported_success' | 'reported_failed';
  failure_note?: string;
}) {
  const body = JSON.stringify({
    tx_id: null, // test print gak terkait tx
    daily_seq: null,
    target: payload.target,
    trigger: 'test' as const,
    outcome: payload.outcome,
    failure_note: payload.failure_note,
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
    // Beacon BEFORE navigation so it survives Android intent teardown.
    postPrintLogBeacon({ target, outcome: 'dispatched' });
    // Update state FIRST so React commits "Apakah kertas keluar?" view
    // before Android hands the page off to RawBT. Defer navigation by a
    // microtask + small timeout so the render cycle completes first.
    setPhase('awaiting_confirm');
    setTimeout(() => fireTestIntent(target), 50);
  }

  function handleSuccess() {
    setPrinterStatus(target, {
      state: 'success',
      last_check: new Date().toISOString(),
      last_outcome_note: 'test print success',
    });
    postPrintLogBeacon({ target, outcome: 'reported_success' });
    onClose();
  }

  function handleFailedClicked() {
    setPhase('failed_followup');
  }

  function handleRetry() {
    postPrintLogBeacon({ target, outcome: 'dispatched' });
    setPhase('awaiting_confirm');
    setFailureNote('');
    setTimeout(() => fireTestIntent(target), 50);
  }

  function handleCloseAsFailed() {
    setPrinterStatus(target, {
      state: 'failed',
      last_check: new Date().toISOString(),
      last_outcome_note: failureNote || 'test print failed',
    });
    postPrintLogBeacon({ target, outcome: 'reported_failed', failure_note: failureNote || undefined });
    onClose();
  }

  const label = target.toUpperCase();

  if (phase === 'idle') {
    return (
      <div className="space-y-3 rounded-md border border-clay-soft bg-paper-soft p-4">
        <h3 className="font-medium text-coal">Cetak tes printer {label}</h3>
        <p className="text-sm text-coal-soft">
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
      <div className="space-y-3 rounded-md border border-clay-soft bg-paper-soft p-4">
        <h3 className="font-medium text-coal">Apakah kertas keluar?</h3>
        <p className="text-sm text-coal-soft">
          Bertuliskan &quot;TES PRINTER {label}&quot;
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleSuccess}
            className="flex-1 rounded-md bg-leaf px-4 py-2 text-white"
          >
            ✓ Berhasil
          </button>
          <button
            onClick={handleFailedClicked}
            className="flex-1 rounded-md border border-brick-soft px-4 py-2 text-brick"
          >
            ✗ Gagal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-clay-soft bg-paper-soft p-4">
      <h3 className="font-medium text-coal">Apa yang terjadi?</h3>
      <textarea
        value={failureNote}
        onChange={(e) => setFailureNote(e.target.value)}
        placeholder="Kertas tidak keluar, error, dll (opsional)"
        className="w-full rounded-md border border-clay-soft p-2 text-sm text-coal"
        rows={3}
      />
      <div className="flex gap-2">
        <button onClick={handleRetry} className="flex-1 rounded-md border border-clay-soft px-4 py-2 text-coal">
          Coba Lagi
        </button>
        <button
          onClick={handleCloseAsFailed}
          className="flex-1 rounded-md bg-brick px-4 py-2 text-white"
        >
          Tutup
        </button>
      </div>
    </div>
  );
}
