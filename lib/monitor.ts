// lib/monitor.ts
export type MonitorItemRow = { qty: number; unit_price_snapshot: number };

export type MonitorRawRow = {
  id: string;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
  is_takeaway: boolean;
  transaction_items: MonitorItemRow[] | null;
};

export type MonitorRow = {
  id: string;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
  is_takeaway: boolean;
  total: number;
  item_count: number;
};

export function computeItemsTotal(items: MonitorItemRow[] | null): number {
  return (items ?? []).reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
}

export function mapMonitorRow(raw: MonitorRawRow): MonitorRow {
  const items = raw.transaction_items ?? [];
  return {
    id: raw.id,
    created_at: raw.created_at,
    customer_name: raw.customer_name,
    table_no: raw.table_no,
    is_takeaway: raw.is_takeaway,
    total: computeItemsTotal(items),
    item_count: items.length,
  };
}

export function buildPaidUpdate(paid: boolean, nowIso: string): { paid_at: string | null } {
  return { paid_at: paid ? nowIso : null };
}
