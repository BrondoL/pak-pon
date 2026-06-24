import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReprintCard } from './reprint-card';
import type { TransactionItemForPrint } from './reprint-card';
import { DEFAULT_PRINTER_SETTINGS } from '@/lib/printer-settings';

const txBase = {
  id: '11111111-1111-4111-8111-111111111111',
  daily_seq: 42,
  created_at: '2026-06-23T07:32:00.000Z',
  customer_name: 'Pak Budi',
  table_no: '5',
};

const itemsBoth: TransactionItemForPrint[] = [
  { id: '1', menu_name_snapshot: 'Ayam', menu_category: 'makanan', unit_price_snapshot: 25000, qty: 2, notes: null },
  { id: '2', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', unit_price_snapshot: 5000, qty: 1, notes: null },
];
const itemsDapurOnly: TransactionItemForPrint[] = [
  { id: '1', menu_name_snapshot: 'Ayam', menu_category: 'makanan', unit_price_snapshot: 25000, qty: 2, notes: null },
];
const itemsMinumanOnly: TransactionItemForPrint[] = [
  { id: '1', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', unit_price_snapshot: 5000, qty: 1, notes: null },
];

const mockFetchOk = () =>
  vi.fn((..._args: [RequestInfo | URL, RequestInit?]) => {
    void _args;
    return Promise.resolve(new Response(JSON.stringify({ job_id: 'job-1' }), { status: 201 }));
  });

describe('<ReprintCard />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders 3 buttons when both categories present', () => {
    render(<ReprintCard transaction={txBase} items={itemsBoth} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
    expect(screen.getByRole('button', { name: /cetak dapur/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cetak minuman/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cetak keduanya/i })).toBeEnabled();
  });

  it('disables minuman button when no minuman item', () => {
    render(<ReprintCard transaction={txBase} items={itemsDapurOnly} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
    expect(screen.getByRole('button', { name: /cetak minuman/i })).toBeDisabled();
  });

  it('disables dapur button when no makanan/nasi item', () => {
    render(<ReprintCard transaction={txBase} items={itemsMinumanOnly} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
    expect(screen.getByRole('button', { name: /cetak dapur/i })).toBeDisabled();
  });

  it('POSTs job for single target with correct shape', async () => {
    const fetchMock = mockFetchOk();
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<ReprintCard transaction={txBase} items={itemsBoth} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
    await user.click(screen.getByRole('button', { name: /cetak dapur/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.target).toBe('dapur');
    expect(body.trigger).toBe('reprint');
    expect(body.tx_id).toBe(txBase.id);
    expect(body.bytes_b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('POSTs 2 jobs (dapur + minuman) when "Cetak Keduanya" clicked', async () => {
    const fetchMock = mockFetchOk();
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<ReprintCard transaction={txBase} items={itemsBoth} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
    await user.click(screen.getByRole('button', { name: /cetak keduanya/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body0 = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    const body1 = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect([body0.target, body1.target].sort()).toEqual(['dapur', 'minuman']);
  });
});
