'use client';

import { useState } from 'react';
import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';
import { PosMenuPicker } from './pos-menu-picker';
import { PosItemConfigModal, type PosCartItemDraft } from './pos-item-config-modal';

export function PosClient({
  menus,
  printerSettings,
}: {
  menus: MenuOption[];
  printerSettings: PrinterSettings;
}) {
  const [pickingMenu, setPickingMenu] = useState<MenuOption | null>(null);
  const [cart, setCart] = useState<Array<PosCartItemDraft & { _localId: string }>>([]);

  void printerSettings; // Task 17 wires save + print dispatch

  function handleAddItem(draft: PosCartItemDraft) {
    setCart((prev) => [...prev, { ...draft, _localId: crypto.randomUUID() }]);
    setPickingMenu(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <PosMenuPicker menus={menus} onMenuTap={setPickingMenu} />

      <div className="min-h-96 rounded-lg border border-clay-soft bg-paper p-4">
        <p className="text-clay text-sm">Cart items ({cart.length}) — full UI in Task 17</p>
        <ul className="mt-2 space-y-1 text-xs text-coal">
          {cart.map((it) => (
            <li key={it._localId}>{it.qty}× {it.menu_name_snapshot} — {it.applied_chips.map((c) => c.label).join(', ')}</li>
          ))}
        </ul>
      </div>

      {pickingMenu && (
        <PosItemConfigModal
          menu={pickingMenu}
          onSave={handleAddItem}
          onClose={() => setPickingMenu(null)}
        />
      )}
    </div>
  );
}
