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
  _localId: string;
};

export function NotaItemRow({
  item,
  onEdit,
  onDelete,
}: {
  item: NotaItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-coal truncate">{item.menu_name_snapshot}</span>
          <span className="text-xs text-clay">× {item.qty}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-clay">
          <span>
            {formatRp(item.unit_price_snapshot)} ea
          </span>
          {item.notes && (
            <>
              <span className="text-clay-soft">·</span>
              <span className="italic">{item.notes}</span>
            </>
          )}
        </div>
      </div>

      <div className="text-right">
        <div className="font-display text-base tracking-tight text-coal">
          {formatRp(item.unit_price_snapshot * item.qty)}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${item.menu_name_snapshot}`}>
          ✏️
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Hapus ${item.menu_name_snapshot}`}>
          🗑️
        </Button>
      </div>
    </li>
  );
}
