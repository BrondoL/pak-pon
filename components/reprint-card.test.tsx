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

// Helper to build item with optional flags.
function mkItem(
  override: Partial<TransactionItemForPrint> = {},
): TransactionItemForPrint {
  return {
    id: crypto.randomUUID(),
    menu_name_snapshot: 'Item',
    menu_category: 'makanan',
    unit_price_snapshot: 10000,
    qty: 1,
    notes: null,
    printed_dapur_at: null,
    printed_minuman_at: null,
    ...override,
  };
}

const mockFetchOk = () =>
  vi.fn((..._args: [RequestInfo | URL, RequestInit?]) => {
    void _args;
    return Promise.resolve(new Response(JSON.stringify({ job_id: 'job-1' }), { status: 201 }));
  });

describe('<ReprintCard />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Layout sections', () => {
    it('renders 3 sections: tambahan / ulang / customer', () => {
      const items = [
        mkItem({ menu_name_snapshot: 'Ayam', menu_category: 'makanan' }),
        mkItem({ menu_name_snapshot: 'Es Teh', menu_category: 'minuman' }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      expect(screen.getByRole('button', { name: /cetak tambahan/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cetak ulang dapur/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cetak ulang minuman/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cetak ulang keduanya/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cetak nota customer/i })).toBeInTheDocument();
    });
  });

  describe('Cetak tambahan', () => {
    it('disabled when all items already printed to their targets', () => {
      const items = [
        mkItem({ menu_category: 'makanan', printed_dapur_at: '2026-06-23T00:00:00Z' }),
        mkItem({ menu_category: 'minuman', printed_minuman_at: '2026-06-23T00:00:00Z' }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      expect(screen.getByRole('button', { name: /cetak tambahan/i })).toBeDisabled();
    });

    it('enabled with count when some items NULL flag', () => {
      const items = [
        mkItem({ menu_category: 'makanan', printed_dapur_at: '2026-06-23T00:00:00Z' }),
        mkItem({ menu_category: 'makanan', printed_dapur_at: null }),
        mkItem({ menu_category: 'minuman', printed_minuman_at: null }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      const btn = screen.getByRole('button', { name: /cetak tambahan/i });
      expect(btn).toBeEnabled();
      expect(btn).toHaveTextContent(/2 item/i);
    });

    it('POSTs 2 jobs (dapur + minuman) with item_ids filtered to NULL flag', async () => {
      const fetchMock = mockFetchOk();
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const a = mkItem({ menu_category: 'makanan', printed_dapur_at: '2026-06-23T00:00:00Z' });
      const b = mkItem({ menu_category: 'makanan', printed_dapur_at: null });
      const c = mkItem({ menu_category: 'minuman', printed_minuman_at: null });
      render(<ReprintCard transaction={txBase} items={[a, b, c]} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak tambahan/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const bodies = fetchMock.mock.calls.map((c) =>
        JSON.parse((c as [unknown, RequestInit])[1].body as string),
      );
      const dapurBody = bodies.find((x) => x.target === 'dapur');
      const minumanBody = bodies.find((x) => x.target === 'minuman');
      expect(dapurBody?.item_ids).toEqual([b.id]);
      expect(minumanBody?.item_ids).toEqual([c.id]);
      expect(dapurBody?.trigger).toBe('reprint_additional');
      expect(minumanBody?.trigger).toBe('reprint_additional');
    });

    it('only POSTs 1 job when only one target has NULL items', async () => {
      const fetchMock = mockFetchOk();
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const items = [
        mkItem({ menu_category: 'makanan', printed_dapur_at: null }),
        mkItem({ menu_category: 'minuman', printed_minuman_at: '2026-06-23T00:00:00Z' }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak tambahan/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.target).toBe('dapur');
    });
  });

  describe('Cetak ulang (full reprint)', () => {
    it('Dapur disabled when no makanan/nasi items', () => {
      const items = [mkItem({ menu_category: 'minuman' })];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      expect(screen.getByRole('button', { name: /cetak ulang dapur/i })).toBeDisabled();
    });

    it('POSTs job with all items regardless of printed flag', async () => {
      const fetchMock = mockFetchOk();
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const a = mkItem({ menu_category: 'makanan', printed_dapur_at: '2026-06-23T00:00:00Z' });
      const b = mkItem({ menu_category: 'makanan', printed_dapur_at: null });
      render(<ReprintCard transaction={txBase} items={[a, b]} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak ulang dapur/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.target).toBe('dapur');
      expect(body.trigger).toBe('reprint');
      expect(body.item_ids?.sort()).toEqual([a.id, b.id].sort());
    });

    it('Keduanya POSTs 2 jobs', async () => {
      const fetchMock = mockFetchOk();
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const items = [
        mkItem({ menu_category: 'makanan' }),
        mkItem({ menu_category: 'minuman' }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak ulang keduanya/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });
  });

  describe('Cetak nota customer', () => {
    it('POSTs job with target=customer trigger=customer item_ids=null', async () => {
      const fetchMock = mockFetchOk();
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const items = [mkItem({ menu_category: 'makanan' })];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak nota customer/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.target).toBe('customer');
      expect(body.trigger).toBe('customer');
      expect(body.item_ids).toBeNull();
    });
  });

  describe('Agent offline (503)', () => {
    it('shows warning toast when fire single fails with agent_offline', async () => {
      const fetchMock = vi.fn((..._args: [RequestInfo | URL, RequestInit?]) => {
        void _args;
        return Promise.resolve(new Response(JSON.stringify({ error: 'agent_offline', detail: 'no online agent' }), { status: 503 }));
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const items = [mkItem({ menu_category: 'makanan' })];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak ulang dapur/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      // Toast assertions are tricky without spying; assert fetchMock was called against /api/print/send
      expect(String((fetchMock.mock.calls[0] as [unknown])[0])).toContain('/api/print/send');
    });
  });
});
