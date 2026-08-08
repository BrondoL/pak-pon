import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonitorBoard } from './monitor-board';
import type { MonitorRow } from '@/lib/monitor';
import { DEFAULT_PRINTER_SETTINGS } from '@/lib/printer-settings';

function mkRow(override: Partial<MonitorRow> = {}): MonitorRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-08-08T05:00:00.000Z',
    customer_name: 'Budi',
    table_no: '5',
    is_takeaway: false,
    total: 84000,
    item_count: 4,
    ...override,
  };
}

const txDetail = {
  transaction: {
    id: '11111111-1111-4111-8111-111111111111',
    daily_seq: 7,
    created_at: '2026-08-08T05:00:00.000Z',
    customer_name: 'Budi',
    table_no: '5',
    is_takeaway: true,
  },
  items: [
    {
      id: 'item-1', qty: 2, menu_name_snapshot: 'Ayam goreng',
      unit_price_snapshot: 23000, notes: null,
      applied_chips: [{ label: 'Dada', price_delta: 0 }],
    },
  ],
  scan_url: null,
};

/** Router fetch mock: cocokkan berdasarkan URL + method. */
function mockFetch(handlers: {
  patchOk?: boolean;
  detailOk?: boolean;
  printStatus?: number;
}) {
  const { patchOk = true, detailOk = true, printStatus = 201 } = handlers;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/monitor') {
      return Promise.resolve(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
    }
    if (url === '/api/print/send') {
      return Promise.resolve(new Response(JSON.stringify({}), { status: printStatus }));
    }
    if (url.startsWith('/api/transactions/') && init?.method === 'PATCH') {
      return Promise.resolve(new Response(JSON.stringify({}), { status: patchOk ? 200 : 500 }));
    }
    if (url.startsWith('/api/transactions/')) {
      return Promise.resolve(
        new Response(JSON.stringify(txDetail), { status: detailOk ? 200 : 500 }),
      );
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
}

describe('<MonitorBoard /> — lunas & nota', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the BUNGKUS badge only on takeaway rows', () => {
    vi.stubGlobal('fetch', mockFetch({}));
    render(
      <MonitorBoard
        initialRows={[mkRow({ id: 'a', is_takeaway: true }), mkRow({ id: 'b', table_no: '9', is_takeaway: false })]}
        menus={[]}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
      />,
    );
    expect(screen.getAllByText(/bungkus/i)).toHaveLength(1);
  });

  it('"Lunas saja" marks paid without printing anything', async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow()]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas saja/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls).toContain('/api/transactions/11111111-1111-4111-8111-111111111111');
    });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/print/send');
  });

  it('"Lunas + nota" marks paid, fetches the transaction, then prints', async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/print/send');
    });
    const printCall = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/print/send')!;
    const body = JSON.parse((printCall[1] as RequestInit).body as string);
    expect(body.target).toBe('customer');
    expect(body.trigger).toBe('customer');
    expect(body.item_ids).toBeNull();
  });

  it('does not print when marking paid fails', async () => {
    const fetchMock = mockFetch({ patchOk: false });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    await waitFor(() => {
      expect(screen.getByText(/meja 5/i)).toBeInTheDocument(); // baris balik muncul
    });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/print/send');
  });

  it('keeps the row removed and does not throw when the detail fetch fails after a successful mark', async () => {
    const fetchMock = mockFetch({ detailOk: false });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    await waitFor(() => {
      expect(screen.queryByText(/meja 5/i)).not.toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/print/send');
  });
});
