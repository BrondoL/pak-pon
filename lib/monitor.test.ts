// lib/monitor.test.ts
import { describe, expect, it } from 'vitest';
import { computeItemsTotal, mapMonitorRow, buildPaidUpdate, type MonitorRawRow } from './monitor';

describe('computeItemsTotal', () => {
  it('menjumlahkan qty × unit_price_snapshot', () => {
    expect(computeItemsTotal([
      { qty: 2, unit_price_snapshot: 15000 },
      { qty: 1, unit_price_snapshot: 8000 },
    ])).toBe(38000);
  });

  it('return 0 untuk null / kosong', () => {
    expect(computeItemsTotal(null)).toBe(0);
    expect(computeItemsTotal([])).toBe(0);
  });
});

describe('mapMonitorRow', () => {
  const raw: MonitorRawRow = {
    id: 'tx-1',
    created_at: '2026-07-21T05:30:00.000Z',
    customer_name: 'Budi',
    table_no: '5',
    transaction_items: [
      { qty: 2, unit_price_snapshot: 15000 },
      { qty: 1, unit_price_snapshot: 8000 },
    ],
  };

  it('memetakan row mentah ke MonitorRow dengan total + item_count', () => {
    expect(mapMonitorRow(raw)).toEqual({
      id: 'tx-1',
      created_at: '2026-07-21T05:30:00.000Z',
      customer_name: 'Budi',
      table_no: '5',
      total: 38000,
      item_count: 2,
    });
  });

  it('menangani transaction_items null', () => {
    const r = mapMonitorRow({ ...raw, transaction_items: null });
    expect(r.total).toBe(0);
    expect(r.item_count).toBe(0);
  });
});

describe('buildPaidUpdate', () => {
  it('paid=true → paid_at berisi nowIso', () => {
    expect(buildPaidUpdate(true, '2026-07-21T10:00:00.000Z')).toEqual({
      paid_at: '2026-07-21T10:00:00.000Z',
    });
  });

  it('paid=false → paid_at null (undo)', () => {
    expect(buildPaidUpdate(false, '2026-07-21T10:00:00.000Z')).toEqual({ paid_at: null });
  });
});
