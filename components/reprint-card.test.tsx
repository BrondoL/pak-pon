import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReprintCard } from './reprint-card';
import type { TransactionItemForPrint } from '@/lib/print-intent';

const txBase = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  daily_seq: 42,
  created_at: '2026-06-23T07:32:00.000Z',
  customer_name: 'Pak Budi',
  table_no: '5',
};

const itemsBoth: TransactionItemForPrint[] = [
  { id: '1', menu_name_snapshot: 'Ayam', menu_category: 'makanan', qty: 2, notes: null },
  { id: '2', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', qty: 1, notes: null },
];
const itemsDapurOnly: TransactionItemForPrint[] = [
  { id: '1', menu_name_snapshot: 'Ayam', menu_category: 'makanan', qty: 2, notes: null },
];
const itemsMinumanOnly: TransactionItemForPrint[] = [
  { id: '1', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', qty: 1, notes: null },
];

describe('<ReprintCard />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.spyOn(window, 'open').mockImplementation(() => null);
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '' },
      writable: true,
    });
    // sendBeacon is the navigation-resilient log path — mock it for jsdom.
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn(() => true),
      writable: true,
      configurable: true,
    });
    global.fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch;
  });

  it('renders 3 buttons when both categories present', () => {
    render(<ReprintCard transaction={txBase} items={itemsBoth} />);
    expect(screen.getByRole('button', { name: /cetak dapur/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cetak minuman/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cetak keduanya/i })).toBeEnabled();
  });

  it('disables minuman button when no minuman item', () => {
    render(<ReprintCard transaction={txBase} items={itemsDapurOnly} />);
    expect(screen.getByRole('button', { name: /cetak minuman/i })).toBeDisabled();
  });

  it('disables dapur button when no makanan/nasi item', () => {
    render(<ReprintCard transaction={txBase} items={itemsMinumanOnly} />);
    expect(screen.getByRole('button', { name: /cetak dapur/i })).toBeDisabled();
  });

  it('shows confirmation prompt after print', async () => {
    const user = userEvent.setup();
    render(<ReprintCard transaction={txBase} items={itemsBoth} />);
    await user.click(screen.getByRole('button', { name: /cetak dapur/i }));
    expect(screen.getByText(/berhasil/i)).toBeInTheDocument();
  });

  it('queues both confirmations when "Cetak Keduanya" fired', async () => {
    const user = userEvent.setup();
    render(<ReprintCard transaction={txBase} items={itemsBoth} />);
    await user.click(screen.getByRole('button', { name: /cetak keduanya/i }));
    // First target queued immediately (dapur)
    expect(screen.getByText(/cetak ulang ke dapur/i)).toBeInTheDocument();
    // Wait for the 300ms delayed minuman fire to enqueue
    await new Promise((r) => setTimeout(r, 350));
    // Confirm dapur — should advance queue to minuman
    await user.click(screen.getByRole('button', { name: /berhasil/i }));
    expect(screen.getByText(/cetak ulang ke minuman/i)).toBeInTheDocument();
    // Confirm minuman — queue should empty, back to main panel
    await user.click(screen.getByRole('button', { name: /berhasil/i }));
    expect(screen.getByRole('button', { name: /cetak keduanya/i })).toBeInTheDocument();
  });
});
