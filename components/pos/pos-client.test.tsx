import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { PosClient } from './pos-client';
import type { MenuOption } from '@/components/nota-item-modal';
import { DEFAULT_PRINTER_SETTINGS } from '@/lib/printer-settings';

// PosClient pakai useRouter; jsdom ga punya router provider.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

const menus: MenuOption[] = [
  { id: 'menu-nasi', name: 'Nasi Putih', category: 'nasi', price: 5000, chips: [] },
  { id: 'menu-nasi-uduk', name: 'Nasi Uduk', category: 'nasi', price: 6000, chips: [] },
];

function mockFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/pos') {
      // Gema is_takeaway dari body request, bukan hardcode — kalau switchnya
      // rusak (ga pernah update state), body kirim false dan respons ini
      // ikut bilang false, jadi test benar-benar gantung ke switch, bukan
      // cuma ke fixture mock.
      const body = JSON.parse((init?.body as string) ?? '{}') as { is_takeaway?: boolean };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            transaction: {
              id: 'tx-1', daily_seq: 3, created_at: '2026-08-08T05:00:00.000Z',
              customer_name: null, table_no: null, is_takeaway: body.is_takeaway ?? false,
            },
            items: [{ id: 'item-1', sort_order: 0 }],
          }),
          { status: 201 },
        ),
      );
    }
    return Promise.resolve(new Response('{}', { status: 201 }));
  });
}

// Simulasi server yang cuma insert sebagian item (kirim 2, balik 1) — jalur
// yang harus dijaga supaya id palsu ga pernah masuk item_ids print job.
function mockFetchShortResponse() {
  return vi.fn<typeof fetch>((input) => {
    const url = String(input);
    if (url === '/api/pos') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            transaction: {
              id: 'tx-1', daily_seq: 3, created_at: '2026-08-08T05:00:00.000Z',
              customer_name: null, table_no: null, is_takeaway: false,
            },
            items: [{ id: 'item-1', sort_order: 0 }],
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
    await user.click(screen.getByRole('button', { name: /^nasi putih rp 5\.000$/i }));
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: /simpan & cetak/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/pos');
    });

    // Tanpa cek ini, test tetap lulus meski switch bungkus ga pernah nyala —
    // mock cuma gema apa yang dikirim, jadi kalau body-nya salah, ini yang
    // ketahuan duluan, bukan gejala di bawahnya yang membingungkan.
    const posCall = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/pos')!;
    const posBody = JSON.parse((posCall[1] as RequestInit).body as string);
    expect(posBody.is_takeaway).toBe(true);

    // Tiket dapur boleh keluar; nota customer TIDAK.
    const printBodies = fetchMock.mock.calls
      .filter((c) => String(c[0]) === '/api/print/send')
      .map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(printBodies.some((b) => b.target === 'customer')).toBe(false);
    expect(printBodies.some((b) => b.target === 'dapur')).toBe(true);
  });

  it('does not fabricate a print id when the server returns fewer items than the cart', async () => {
    const fetchMock = mockFetchShortResponse();
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(toast, 'warning');
    const user = userEvent.setup();
    render(<PosClient menus={menus} printerSettings={DEFAULT_PRINTER_SETTINGS} />);

    await user.click(screen.getByRole('button', { name: /nasi/i }));
    await user.click(screen.getByRole('button', { name: /^nasi putih rp 5\.000$/i }));
    await user.click(screen.getByRole('button', { name: /^nasi uduk rp 6\.000$/i }));
    await user.click(screen.getByRole('button', { name: /simpan & cetak/i }));

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/jumlah item yang tersimpan tidak sesuai/i),
        expect.anything(),
      );
    });

    // Load-bearing: item_ids yang dikirim ke tiket dapur harus PERSIS satu id
    // asli dari server — bukan dua (cart), dan bukan id fabrikasi.
    const printBodies = fetchMock.mock.calls
      .filter((c) => String(c[0]) === '/api/print/send')
      .map((c) => JSON.parse((c[1] as RequestInit).body as string));
    const dapurBody = printBodies.find((b) => b.target === 'dapur');
    expect(dapurBody.item_ids).toEqual(['item-1']);
  });
});
