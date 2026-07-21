// components/monitor-detail-modal.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatRp } from '@/lib/currency';

const WIB = 'Asia/Jakarta';

type DetailItem = {
  id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: { label: string; price_delta: number }[] | null;
};

type Detail = {
  transaction: {
    id: string;
    customer_name: string | null;
    table_no: string | null;
    created_at: string;
    is_takeaway: boolean;
  };
  items: DetailItem[];
};

function formatTimeWIB(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: WIB, hour: '2-digit', minute: '2-digit',
  });
}

export function MonitorDetailModal({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(id)
      .then((resolvedId) => {
        if (!resolvedId) {
          if (!cancelled) setDetail(null);
          return;
        }
        if (!cancelled) setLoading(true);
        return fetch(`/api/transactions/${resolvedId}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((d: Detail) => {
            if (!cancelled) setDetail(d);
          })
          .catch(() => {
            if (!cancelled) setDetail(null);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const total = (detail?.items ?? []).reduce(
    (acc, it) => acc + it.qty * it.unit_price_snapshot,
    0,
  );

  return (
    <Dialog
      open={id !== null}
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detail Transaksi</DialogTitle>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-clay">Memuat…</p>}

        {!loading && detail && (
          <div className="space-y-4">
            <div className="text-sm text-coal-soft">
              <span className="font-medium text-coal">
                {detail.transaction.customer_name || 'Tanpa nama'}
              </span>
              {detail.transaction.table_no && <> · Meja {detail.transaction.table_no}</>}
              {' · '}{formatTimeWIB(detail.transaction.created_at)} WIB
            </div>

            <ul className="divide-y divide-clay-soft/60 rounded-md border border-clay-soft/60">
              {detail.items.map((it) => (
                <li key={it.id} className="flex items-start justify-between gap-4 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-medium text-coal">{it.menu_name_snapshot}</span>
                      <span className="shrink-0 text-xs text-clay">× {it.qty}</span>
                    </div>
                    {(it.applied_chips ?? []).length > 0 && (
                      <div className="mt-0.5 text-xs text-coal-soft">
                        {(it.applied_chips ?? []).map((c) => c.label).join(', ')}
                      </div>
                    )}
                    {it.notes && <div className="mt-0.5 text-xs italic text-clay">{it.notes}</div>}
                  </div>
                  <div className="shrink-0 font-display text-sm text-coal tabular-nums">
                    {formatRp(it.unit_price_snapshot * it.qty)}
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex items-baseline justify-between border-t-2 border-clay-soft/80 pt-3">
              <span className="text-sm uppercase tracking-[0.18em] text-clay">Total</span>
              <span className="font-display text-2xl tracking-tight text-coal">{formatRp(total)}</span>
            </div>
          </div>
        )}

        {!loading && !detail && id !== null && (
          <p className="py-6 text-center text-sm text-brick-dark">Gagal memuat detail.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
