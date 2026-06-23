'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Agent = {
  agent_label: string;
  last_seen_at: string;
  agent_version: string | null;
  device_info: string | null;
  online: boolean;
};

export function PrinterStatusBanner() {
  const [agents, setAgents] = useState<Agent[] | null>(null);

  useEffect(() => {
    fetch('/api/agent/heartbeat')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setAgents(d.agents as Agent[]))
      .catch(() => {
        // SSR-safe: on fetch error, leave agents=null (banner hidden, defensive)
      });
  }, []);

  if (agents === null) return null;
  const onlineCount = agents.filter((a) => a.online).length;
  if (onlineCount > 0) return null;

  return (
    <div
      data-testid="printer-banner"
      className="mx-4 my-2 rounded-md border border-brick-soft bg-brick-faint p-3 text-sm text-brick-dark"
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
