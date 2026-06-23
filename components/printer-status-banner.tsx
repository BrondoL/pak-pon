'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPrinterStatus, type PrinterStatusMap } from '@/lib/printer-status';

const STALE_MS = 24 * 3600 * 1000;

type BannerState = 'hidden' | 'red' | 'yellow';

function computeBannerState(status: PrinterStatusMap): {
  level: BannerState;
  failed_targets: string[];
} {
  const targets = ['dapur', 'minuman'] as const;
  const failed: string[] = [];
  let anyNotConfigured = false;
  let anyStale = false;

  for (const t of targets) {
    const s = status[t];
    if (s.state === 'not_configured') anyNotConfigured = true;
    else if (s.state === 'failed') failed.push(t);
    else if (s.state === 'success') {
      if (!s.last_check || (Date.now() - new Date(s.last_check).getTime() > STALE_MS)) {
        anyStale = true;
      }
    }
  }

  if (anyNotConfigured || failed.length > 0) return { level: 'red', failed_targets: failed };
  if (anyStale) return { level: 'yellow', failed_targets: [] };
  return { level: 'hidden', failed_targets: [] };
}

export function PrinterStatusBanner() {
  const [status, setStatus] = useState<PrinterStatusMap | null>(null);

  // Hydrate from localStorage on mount. SSR-safe: localStorage is browser-only,
  // so we deliberately defer reading it until after hydration to avoid mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(getPrinterStatus());
  }, []);

  if (!status) return null;
  const banner = computeBannerState(status);
  if (banner.level === 'hidden') return null;

  if (banner.level === 'red') {
    const msg =
      banner.failed_targets.length > 0
        ? `Printer ${banner.failed_targets.join(' & ')} bermasalah`
        : 'Printer belum di-setup';
    return (
      <div
        data-testid="printer-banner"
        className="mx-4 my-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
      >
        <div className="flex items-center justify-between gap-2">
          <span>{msg}</span>
          <Link
            href="/setup/printer"
            className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white"
          >
            Setup printer
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="printer-banner"
      className="mx-4 my-2 rounded-md border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-900"
    >
      <div className="flex items-center justify-between gap-2">
        <span>Sudah lama tidak dites — coba tes printer?</span>
        <Link href="/setup/printer" className="underline">
          Tes printer
        </Link>
      </div>
    </div>
  );
}
