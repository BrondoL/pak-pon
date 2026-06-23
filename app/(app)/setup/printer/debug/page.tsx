'use client';

import { useEffect, useState } from 'react';
import { getPrinterStatus, type PrinterStatusMap } from '@/lib/printer-status';

type PrintEvent = {
  id: string;
  tx_id: string;
  daily_seq: number | null;
  target: 'dapur' | 'minuman';
  trigger: 'auto' | 'reprint' | 'test';
  outcome: 'dispatched' | 'reported_success' | 'reported_failed';
  failure_note: string | null;
  url_scheme_variant: string | null;
  created_at: string;
};

export default function PrinterDebugPage() {
  const [status, setStatus] = useState<PrinterStatusMap | null>(null);
  const [events, setEvents] = useState<PrintEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(getPrinterStatus());
    fetch('/api/print/log/recent?limit=30')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setEvents(d.events))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Printer Diagnostic</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Status (localStorage)</h2>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">
{JSON.stringify(status, null, 2)}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Recent print events (server)</h2>
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="text-sm text-red-600">Error: {error}</p>}
        {!loading && !error && events.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada event.</p>
        )}
        {!loading && events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Target</th>
                  <th className="text-left p-2">Trigger</th>
                  <th className="text-left p-2">Outcome</th>
                  <th className="text-left p-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b">
                    <td className="p-2">{new Date(e.created_at).toLocaleString('id-ID')}</td>
                    <td className="p-2">{e.target}</td>
                    <td className="p-2">{e.trigger}</td>
                    <td className="p-2">{e.outcome}</td>
                    <td className="p-2">{e.failure_note ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2 pt-4 border-t">
        <h2 className="text-lg font-medium">User Agent</h2>
        <p className="text-xs text-muted-foreground">
          {typeof window !== 'undefined' ? window.navigator.userAgent : '(SSR)'}
        </p>
      </section>
    </div>
  );
}
