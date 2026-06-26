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
  is_primary: boolean;
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
  const primary = agents.find((a) => a.is_primary);

  // No primary di tabel — owner belum pernah pilih, atau primary baru di-delete.
  if (!primary) {
    return (
      <div
        data-testid="printer-banner"
        className="mx-0 my-2 rounded-md border border-brick-soft bg-brick-faint p-3 text-sm text-brick-dark"
      >
        <div className="flex items-center justify-between gap-2">
          <span>Belum ada primary agent. Print tidak akan jalan.</span>
          <Link
            href="/setup/printer/debug"
            className="rounded bg-brick px-3 py-1 text-xs font-medium text-white"
          >
            Pilih Primary
          </Link>
        </div>
      </div>
    );
  }

  // Primary online — happy path, no banner.
  if (primary.display_state === 'online') return null;

  // STALE: status='online' tapi heartbeat >= 1 jam. Kemungkinan ke-freeze OEM,
  // FCM masih bisa wake — banner info kuning bukan alarm.
  if (primary.display_state === 'stale') {
    return (
      <div
        data-testid="printer-banner"
        className="mx-0 my-2 rounded-md border border-mustard/40 bg-mustard-faint p-3 text-sm text-coal"
      >
        <div className="flex items-center justify-between gap-2">
          <span>
            Primary ({primary.agent_label}) kemungkinan di-background. Cek HP kalau cetak ngga jalan.
          </span>
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

  // OFFLINE: status='offline' (Stop button). Alarm merah.
  return (
    <div
      data-testid="printer-banner"
      className="mx-0 my-2 rounded-md border border-brick-soft bg-brick-faint p-3 text-sm text-brick-dark"
    >
      <div className="flex items-center justify-between gap-2">
        <span>Primary ({primary.agent_label}) belum jalan. Pencet Start di device.</span>
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
