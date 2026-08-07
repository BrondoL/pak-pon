import { describe, it, expect, vi, afterEach } from 'vitest';
import { splitItemsByPrintTarget, dispatchCustomerReceiptJob } from './print-dispatch';
import { DEFAULT_PRINTER_SETTINGS } from './printer-settings';

describe('splitItemsByPrintTarget', () => {
  it('routes minuman to the drinks printer', () => {
    const result = splitItemsByPrintTarget([{ category: 'minuman' as const, name: 'Es Teh' }]);
    expect(result.minuman).toHaveLength(1);
    expect(result.dapur).toHaveLength(0);
  });

  it('routes makanan and nasi to the kitchen printer', () => {
    const result = splitItemsByPrintTarget([
      { category: 'makanan' as const, name: 'Pecel Lele' },
      { category: 'nasi' as const, name: 'Nasi Putih' },
    ]);
    expect(result.dapur.map((i) => i.name)).toEqual(['Pecel Lele', 'Nasi Putih']);
    expect(result.minuman).toHaveLength(0);
  });

  it('preserves input order within each target', () => {
    const result = splitItemsByPrintTarget([
      { category: 'minuman' as const, name: 'A' },
      { category: 'makanan' as const, name: 'B' },
      { category: 'minuman' as const, name: 'C' },
    ]);
    expect(result.minuman.map((i) => i.name)).toEqual(['A', 'C']);
    expect(result.dapur.map((i) => i.name)).toEqual(['B']);
  });

  it('returns empty buckets for empty input', () => {
    const result = splitItemsByPrintTarget([]);
    expect(result).toEqual({ dapur: [], minuman: [] });
  });
});

const tx = {
  id: 'tx-1',
  daily_seq: 7,
  created_at: '2026-08-07T05:00:00.000Z',
  customer_name: 'Budi',
  table_no: '5',
  is_takeaway: true,
};

const items = [
  {
    id: 'item-1',
    qty: 2,
    menu_name_snapshot: 'Ayam goreng',
    unit_price_snapshot: 23000,
    notes: null,
    applied_chips: [{ label: 'Jumbo', price_delta: 3000 }],
  },
];

/** Ambil body JSON dari panggilan fetch ke-`callIndex`. */
function bodyOf(mock: ReturnType<typeof vi.fn>, callIndex = 0) {
  return JSON.parse(mock.mock.calls[callIndex][1].body as string);
}

describe('dispatchCustomerReceiptJob', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to the print endpoint with the customer target and trigger', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchCustomerReceiptJob({
      tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS,
    });

    expect(result).toEqual({ ok: true, offline: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/print/send');
    const body = bodyOf(fetchMock);
    expect(body.tx_id).toBe('tx-1');
    expect(body.target).toBe('customer');
    expect(body.trigger).toBe('customer');
  });

  it('sends item_ids as null so the DB trigger does not mark items kitchen-printed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatchCustomerReceiptJob({ tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS });

    expect(bodyOf(fetchMock).item_ids).toBeNull();
  });

  it('sends a non-empty rendered payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatchCustomerReceiptJob({ tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS });

    expect(bodyOf(fetchMock).bytes_b64.length).toBeGreaterThan(0);
  });

  it('reports offline on HTTP 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await dispatchCustomerReceiptJob({ tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS });
    expect(result).toEqual({ ok: false, offline: true });
  });

  it('reports a plain failure on HTTP 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await dispatchCustomerReceiptJob({ tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS });
    expect(result).toEqual({ ok: false, offline: false });
  });

  it('swallows a network throw instead of rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await dispatchCustomerReceiptJob({ tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS });
    expect(result).toEqual({ ok: false, offline: false });
  });
});
