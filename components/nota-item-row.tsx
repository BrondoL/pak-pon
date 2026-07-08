'use client';

import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';

export type NotaItem = {
  id?: string;
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
  confidence: number | null;
  _localId: string;
};

type Tier = 'red' | 'yellow' | null;

function tierOf(confidence: number | null): Tier {
  if (confidence === null) return null;
  if (confidence < 75) return 'red';
  if (confidence < 90) return 'yellow';
  return null;
}

const TIER_CLASS: Record<Exclude<Tier, null>, { row: string; badge: string }> = {
  red: {
    row: 'bg-brick-faint border-l-4 border-brick',
    badge: 'text-brick-dark',
  },
  yellow: {
    row: 'bg-mustard-faint border-l-4 border-mustard',
    badge: 'text-gold-dark',
  },
};

const MAX_QTY = 99;

export function NotaItemRow({
  item,
  onEdit,
  onDelete,
  onQtyChange,
}: {
  item: NotaItem;
  onEdit: () => void;
  onDelete: () => void;
  onQtyChange: (nextQty: number) => void;
}) {
  const tier = tierOf(item.confidence);
  const tierClass = tier ? TIER_CLASS[tier] : null;

  return (
    <li className={['px-4 py-3 sm:px-5', tierClass?.row ?? ''].join(' ')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-coal truncate">{item.menu_name_snapshot}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-clay">
            <span>{formatRp(item.unit_price_snapshot)}</span>
            {item.notes && (
              <>
                <span className="text-clay-soft">·</span>
                <span className="italic">{item.notes}</span>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0 font-display text-base tracking-tight text-coal tabular-nums">
          {formatRp(item.unit_price_snapshot * item.qty)}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="inline-flex items-center rounded-lg border border-clay-soft/60 bg-paper">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onQtyChange(Math.max(1, item.qty - 1))}
            disabled={item.qty <= 1}
            aria-label={`Kurangi jumlah ${item.menu_name_snapshot}`}
            className="rounded-r-none text-lg leading-none"
          >
            −
          </Button>
          <span
            className="min-w-8 px-1 text-center text-sm font-semibold tabular-nums text-coal"
            aria-live="polite"
            aria-label={`Jumlah ${item.qty}`}
          >
            {item.qty}
          </span>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onQtyChange(Math.min(MAX_QTY, item.qty + 1))}
            disabled={item.qty >= MAX_QTY}
            aria-label={`Tambah jumlah ${item.menu_name_snapshot}`}
            className="rounded-l-none text-lg leading-none"
          >
            +
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={onEdit} aria-label={`Edit ${item.menu_name_snapshot}`}>
            ✏️
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} aria-label={`Hapus ${item.menu_name_snapshot}`}>
            🗑️
          </Button>
        </div>
      </div>

      {tierClass && (
        <div className="mt-2 text-xs">
          <span className={['font-semibold', tierClass.badge].join(' ')}>
            ⚠ {item.confidence}% — periksa item ini
          </span>
        </div>
      )}
    </li>
  );
}
