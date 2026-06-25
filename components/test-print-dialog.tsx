'use client';

import { useState } from 'react';
import { renderKitchenTicket, uint8ToBase64 } from '@/lib/escpos';

type Phase = 'idle' | 'submitting' | 'awaiting_agent' | 'error';
type Target = 'dapur' | 'minuman';

function buildTestPayload(target: Target): string {
  const bytes = renderKitchenTicket({
    target,
    daily_seq: 0,
    created_at: new Date(),
    customer_name: null,
    table_no: null,
    items: [{ qty: 1, name: `TES PRINTER ${target.toUpperCase()}`, unit_price: 0, note: null }],
  });
  return uint8ToBase64(bytes);
}

export function TestPrintDialog({
  target,
  onClose,
}: {
  target: Target;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleFire() {
    setPhase('submitting');
    setError(null);
    try {
      const res = await fetch('/api/print/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_id: null,
          target,
          trigger: 'test',
          bytes_b64: buildTestPayload(target),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`gagal mengirim: ${data.error ?? `HTTP ${res.status}`}`);
        setPhase('error');
        return;
      }
      setPhase('awaiting_agent');
    } catch (err) {
      setError(`gagal mengirim: ${err instanceof Error ? err.message : 'unknown'}`);
      setPhase('error');
    }
  }

  const label = target.toUpperCase();

  if (phase === 'idle') {
    return (
      <div className="space-y-3 rounded-md border border-clay-soft bg-paper-soft p-4">
        <h3 className="font-medium text-coal">Cetak tes printer {label}</h3>
        <p className="text-sm text-coal-soft">
          Pastikan agent app jalan &amp; printer siap. Lalu tekan tombol di bawah.
        </p>
        <button
          onClick={handleFire}
          className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Cetak Tes Sekarang
        </button>
        <button
          onClick={onClose}
          className="w-full rounded-md border border-clay-soft px-4 py-2 text-coal"
        >
          Batal
        </button>
      </div>
    );
  }

  if (phase === 'submitting') {
    return (
      <div className="space-y-3 rounded-md border border-clay-soft bg-paper-soft p-4">
        <p className="text-sm text-coal">Mengirim...</p>
      </div>
    );
  }

  if (phase === 'awaiting_agent') {
    return (
      <div className="space-y-3 rounded-md border border-clay-soft bg-paper-soft p-4">
        <h3 className="font-medium text-coal">Job dikirim ke agent</h3>
        <p className="text-sm text-coal-soft">
          Tunggu agent process &amp; cetak. Cek halaman <a href="/setup/printer/debug" className="underline">diagnostic</a> untuk status terkini.
        </p>
        <button
          onClick={onClose}
          className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Tutup
        </button>
      </div>
    );
  }

  // phase === 'error'
  return (
    <div className="space-y-3 rounded-md border border-brick-soft bg-brick-faint p-4">
      <h3 className="font-medium text-brick-dark">Gagal kirim job ke queue</h3>
      <p className="text-sm text-brick-dark">{error ?? 'unknown error'}</p>
      <div className="flex gap-2">
        <button
          onClick={() => setPhase('idle')}
          className="flex-1 rounded-md border border-brick-soft px-4 py-2 text-brick"
        >
          Coba Lagi
        </button>
        <button
          onClick={onClose}
          className="flex-1 rounded-md bg-brick px-4 py-2 text-white"
        >
          Tutup
        </button>
      </div>
    </div>
  );
}
