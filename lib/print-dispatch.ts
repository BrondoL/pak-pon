import { renderKitchenTicket, uint8ToBase64 } from './escpos';
import type { PrinterSettings } from './printer-settings';

export type PrintTarget = 'dapur' | 'minuman';
export type PrintTrigger = 'auto' | 'auto_additional' | 'reprint';

export type PrintJobItem = {
  id: string;
  qty: number;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  notes: string | null;
  applied_chips: Array<{ label: string; price_delta: number }>;
};

export type PrintJobTx = {
  id: string;
  daily_seq: number | null;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
  is_takeaway: boolean;
};

/**
 * Routing item ke printer: minuman → printer minuman, makanan & nasi → dapur.
 *
 * Dipakai bersama oleh POS (`pos-client`) dan modal tambah item di monitor
 * (`monitor-add-item-modal`) — sengaja satu tempat supaya penambahan kategori
 * baru tidak perlu diingat di dua file.
 */
export function splitItemsByPrintTarget<
  T extends { category: 'makanan' | 'nasi' | 'minuman' },
>(items: T[]): { dapur: T[]; minuman: T[] } {
  const dapur: T[] = [];
  const minuman: T[] = [];
  for (const it of items) {
    if (it.category === 'minuman') minuman.push(it);
    else dapur.push(it);
  }
  return { dapur, minuman };
}

/**
 * Render an ESC/POS kitchen ticket for the given items and POST it to
 * `/api/print/send` as a base64 payload. Shared between the OCR review flow
 * (nota-review-form) and the POS quick-order flow (pos-client) so a single
 * dispatch path exists for kitchen jobs.
 *
 * Returns `{ ok, offline }` — `offline = true` when the API responds with 503
 * (primary agent offline / not set) so callers can surface a clearer message.
 */
export async function dispatchKitchenPrintJob(args: {
  tx: PrintJobTx;
  target: PrintTarget;
  items: PrintJobItem[];
  trigger: PrintTrigger;
  printerSettings: PrinterSettings;
}): Promise<{ ok: boolean; offline: boolean }> {
  const bytes = renderKitchenTicket(
    {
      daily_seq: args.tx.daily_seq ?? 0,
      created_at: new Date(args.tx.created_at),
      customer_name: args.tx.customer_name,
      table_no: args.tx.table_no,
      is_takeaway: args.tx.is_takeaway,
      items: args.items.map((i) => ({
        qty: i.qty,
        name: i.menu_name_snapshot,
        unit_price: i.unit_price_snapshot,
        note: i.notes,
        applied_chips: i.applied_chips,
      })),
    },
    args.printerSettings,
  );
  const bytes_b64 = uint8ToBase64(bytes);
  try {
    const res = await fetch('/api/print/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: args.trigger,
        item_ids: args.items.map((i) => i.id),
        bytes_b64,
      }),
    });
    if (res.ok) return { ok: true, offline: false };
    return { ok: false, offline: res.status === 503 };
  } catch {
    return { ok: false, offline: false };
  }
}
