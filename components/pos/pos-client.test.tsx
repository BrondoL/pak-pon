import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PosClient } from './pos-client';
import type { MenuOption } from '@/components/nota-item-modal';
import { DEFAULT_PRINTER_SETTINGS } from '@/lib/printer-settings';

// PosClient pakai useRouter; jsdom ga punya router provider.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

const menus: MenuOption[] = [
  { id: 'menu-nasi', name: 'Nasi Putih', category: 'nasi', price: 5000, chips: [] },
];

function mockFetch() {
  return vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    void _init;
    const url = String(input);
    if (url === '/api/pos') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            transaction: {
              id: 'tx-1', daily_seq: 3, created_at: '2026-08-08T05:00:00.000Z',
              customer_name: null, table_no: null, is_takeaway: true,
            },
            items: [{ id: 'item-1' }],
          }),
          { status: 201 },
        ),
      );
    }
    return Promise.resolve(new Response('{}', { status: 201 }));
  });
}

describe('<PosClient /> — cetak saat simpan', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT print a customer receipt when saving a takeaway order', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<PosClient menus={menus} printerSettings={DEFAULT_PRINTER_SETTINGS} />);

    // Menu di fixture berkategori "nasi" — tab aktif default "makanan", jadi
    // pindah tab dulu supaya kartu menunya kelihatan.
    await user.click(screen.getByRole('button', { name: /nasi/i }));
    await user.click(screen.getByRole('button', { name: /nasi putih/i }));
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: /simpan & cetak/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/pos');
    });

    // Tiket dapur boleh keluar; nota customer TIDAK.
    const printBodies = fetchMock.mock.calls
      .filter((c) => String(c[0]) === '/api/print/send')
      .map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(printBodies.some((b) => b.target === 'customer')).toBe(false);
    expect(printBodies.some((b) => b.target === 'dapur')).toBe(true);
  });
});
