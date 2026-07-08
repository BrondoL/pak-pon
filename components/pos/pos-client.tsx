'use client';

import type { MenuOption } from '@/components/nota-item-modal';
import type { PrinterSettings } from '@/lib/printer-settings';

export function PosClient({
  menus,
  printerSettings,
}: {
  menus: MenuOption[];
  printerSettings: PrinterSettings;
}) {
  // Placeholder to reference props (Task 16 will wire menu picker + modal).
  void menus;
  void printerSettings;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="min-h-96 rounded-lg border border-clay-soft bg-paper p-4">
        <p className="text-clay text-sm">Menu picker (Task 16)</p>
      </div>
      <div className="min-h-96 rounded-lg border border-clay-soft bg-paper p-4">
        <p className="text-clay text-sm">Cart (Task 17)</p>
      </div>
    </div>
  );
}
