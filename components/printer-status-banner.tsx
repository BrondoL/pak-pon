'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type DisplayState = 'online' | 'stale' | 'offline';

type Agent = {
  agent_label: string;
  last_seen_at: string;
  agent_version: string | null;
  device_info: string | null;
  status: string;
  display_state: DisplayState;
  online: boolean;
};

export function PrinterStatusBanner() {
  const [agents, setAgents] = useState<Agent[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    function fetchAgents() {
      fetch('/api/agent/heartbeat')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => {
          if (!cancelled) setAgents(d.agents as Agent[]);
        })
        .catch(() => {
          // SSR-safe: on fetch error, leave agents as-is
        });
    }

    fetchAgents();
    const intervalId = setInterval(fetchAgents, 30_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  if (agents === null) return null;
  const hasOnline = agents.some((a) => a.display_state === 'online');
  if (hasOnline) return null;
  const hasStale = agents.some((a) => a.display_state === 'stale');

  // STALE: status='online' tapi heartbeat >= 1 jam. Kemungkinan agent
  // ke-freeze OEM tapi FCM masih bisa wake. Tampilkan info kuning (bukan
  // alarm merah) — print masih dispatched, tinggal cek HP kalau ngga jalan.
  if (hasStale) {
    return (
      <div
        data-testid="printer-banner"
        className="mx-0 my-2 rounded-md border border-mustard/40 bg-mustard-faint p-3 text-sm text-coal"
      >
        <div className="flex items-center justify-between gap-2">
          <span>Print agent kemungkinan di-background. Cek HP kalau cetak ngga jalan.</span>
          <Link
            href="/setup/printer/debug"
            className="rounded border border-mustard/60 px-3 py-1 text-xs font-medium text-coal"
          >
            Detail
          </Link>
        </div>
      </div>
    );
  }

  // OFFLINE: status='offline' (Stop button atau belum start). Alarm merah.
  return (
    <div
      data-testid="printer-banner"
      className="mx-0 my-2 rounded-md border border-brick-soft bg-brick-faint p-3 text-sm text-brick-dark"
    >
      <div className="flex items-center justify-between gap-2">
        <span>Print agent belum jalan</span>
        <Link
          href="/setup/printer"
          className="rounded bg-brick px-3 py-1 text-xs font-medium text-white"
        >
          Setup
        </Link>
      </div>
    </div>
  );
}
