'use client';

import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';
import type { Alternative } from '@/lib/transactions';
import type { MenuOption } from './nota-item-modal';

export type { Alternative };

export type NotaItem = {
  id?: string;
  menu_id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  sort_order: number;
  confidence: number | null;
  alternatives: Alternative[] | null;
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

export function NotaItemRow({
  item,
  menusByName,
  onEdit,
  onDelete,
  onSwapMenu,
}: {
  item: NotaItem;
  menusByName: Map<string, MenuOption>;
  onEdit: () => void;
  onDelete: () => void;
  onSwapMenu: (localId: string, newMenu: MenuOption) => void;
}) {
  const tier = tierOf(item.confidence);
  const tierClass = tier ? TIER_CLASS[tier] : null;

  // Filter alternatives: skip if name matches primary or menu not in master (inactive/removed)
  const validAlts = (item.alternatives ?? []).filter(
    (alt) =>
      alt.menu_name !== item.menu_name_snapshot &&
      menusByName.has(alt.menu_name)
  );

  // Show alts whenever AI bothered to suggest them — even on high-confidence items.
  // Rationale: AI's self-reported confidence is unreliable on look-alike pairs
  // (goreng/bakar). If AI noticed an alt is plausible, surfacing it is cheap and
  // gives kasir a one-click correction option.
  const showAlts = validAlts.length > 0;

  return (
    <li className={['px-5 py-3.5', tierClass?.row ?? ''].join(' ')}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-coal truncate">{item.menu_name_snapshot}</span>
            <span className="text-xs text-clay">× {item.qty}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-clay">
            <span>{formatRp(item.unit_price_snapshot)} ea</span>
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
      </div>

      {showAlts && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {tierClass && (
            <span className={['font-semibold', tierClass.badge].join(' ')}>
              ⚠ {item.confidence}%
            </span>
          )}
          <span className="text-clay">Mungkin:</span>
          {validAlts.map((alt) => {
            const altMenu = menusByName.get(alt.menu_name)!;
            return (
              <button
                key={alt.menu_name}
                type="button"
                onClick={() => onSwapMenu(item._localId, altMenu)}
                aria-label={`Ganti ke ${altMenu.name}`}
                className="rounded-md border border-clay-soft bg-paper-soft px-2 py-1 text-coal transition-colors hover:border-coal hover:bg-cream"
              >
                {altMenu.name}
              </button>
            );
          })}
        </div>
      )}

      {tierClass && !showAlts && (
        <div className="mt-2 text-xs">
          <span className={['font-semibold', tierClass.badge].join(' ')}>
            ⚠ {item.confidence}% — periksa item ini
          </span>
        </div>
      )}
    </li>
  );
}
