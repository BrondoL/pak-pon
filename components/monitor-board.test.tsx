import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
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

  it('blocks a rapid double tap on "Lunas + nota": exactly one PATCH, one detail GET, one print POST', async () => {
    let resolvePatch!: () => void;
    const patchGate = new Promise<void>((resolve) => {
      resolvePatch = resolve;
    });

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/monitor') {
        return Promise.resolve(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
      }
      if (url === '/api/print/send') {
        return Promise.resolve(new Response(JSON.stringify({}), { status: 201 }));
      }
      if (url.startsWith('/api/transactions/') && init?.method === 'PATCH') {
        // Gated: this PATCH doesn't resolve until the test lets it, so both
        // taps below land while the first call is still mid-flight — that's
        // the actual race the `inFlight` guard defends against.
        return patchGate.then(() => new Response(JSON.stringify({}), { status: 200 }));
      }
      if (url.startsWith('/api/transactions/')) {
        return Promise.resolve(new Response(JSON.stringify(txDetail), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    const notaButton = await screen.findByRole('button', { name: /lunas \+ nota/i });

    // Two dispatches inside ONE act() call: React can't flush/re-render (and
    // therefore can't unmount the row + button, which is what normally
    // happens after the first optimistic setRows) between them, so both
    // onClick handlers run their synchronous prefix — including the
    // `inFlight` guard check — before either PATCH resolves. This is what a
    // genuine rapid double tap looks like. Two sequential
    // `await user.click()` calls would NOT reproduce the race: the first
    // click's optimistic removal unmounts the button synchronously, so a
    // second click can never reach it — that would pass even with the guard
    // deleted, for the wrong reason.
    act(() => {
      fireEvent.click(notaButton);
      fireEvent.click(notaButton);
    });

    const patchCallsWhileGated = fetchMock.mock.calls.filter(
      (c) => String(c[0]).startsWith('/api/transactions/') && (c[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    // Exactly one PATCH fired even though two clicks were dispatched before
    // either could resolve — proves the guard, not response timing, blocked
    // the second invocation.
    expect(patchCallsWhileGated).toHaveLength(1);

    resolvePatch();

    await waitFor(() => {
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/print/send');
    });

    const patchCalls = fetchMock.mock.calls.filter(
      (c) => String(c[0]).startsWith('/api/transactions/') && (c[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    const detailGetCalls = fetchMock.mock.calls.filter(
      (c) =>
        String(c[0]) === '/api/transactions/11111111-1111-4111-8111-111111111111' &&
        (c[1] as RequestInit | undefined)?.method === undefined,
    );
    const printCalls = fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/print/send');

    expect(patchCalls).toHaveLength(1);
    expect(detailGetCalls).toHaveLength(1);
    expect(printCalls).toHaveLength(1);
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
    const errorSpy = vi.spyOn(toast, 'error');
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    // Anchor on the toast that only fires once the failed detail GET has
    // actually been caught — the row is already gone at t=0 (optimistic
    // removal happens before the PATCH even resolves), so waiting on its
    // absence alone would pass vacuously even if a regression printed right
    // after `await res.json()`.
    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        'Sudah ditandai lunas, tapi gagal ambil data nota. Cetak manual dari detail transaksi.',
      );
    });
    expect(screen.queryByText(/meja 5/i)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/print/send');
  });

  it('releases the in-flight guard after a failed mark, so a retry works', async () => {
    let patchShouldFail = true;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/monitor') {
        return Promise.resolve(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
      }
      if (url.startsWith('/api/transactions/') && init?.method === 'PATCH') {
        const status = patchShouldFail ? 500 : 200;
        patchShouldFail = false; // percobaan berikutnya sukses
        return Promise.resolve(new Response(JSON.stringify({}), { status }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow()]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    // Percobaan pertama gagal → baris balik muncul.
    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas saja/i }));
    await waitFor(() => {
      expect(screen.getByText(/meja 5/i)).toBeInTheDocument();
    });

    // Percobaan kedua harus benar-benar mengirim PATCH lagi. Kalau id-nya
    // masih nyangkut di inFlight, klik ini tidak melakukan apa-apa dan
    // jumlah PATCH tetap 1.
    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas saja/i }));

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCalls).toHaveLength(2);
    });
  });

  it('warns about an offline printer agent after a successful mark', async () => {
    const fetchMock = mockFetch({ printStatus: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(toast, 'warning');
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/agent printer offline/i),
        expect.anything(),
      );
    });
    // Transaksinya tetap lunas — kartunya tidak balik muncul.
    expect(screen.queryByText(/meja 5/i)).not.toBeInTheDocument();
  });

  it('reports a plain print failure without rolling back the paid mark', async () => {
    const fetchMock = mockFetch({ printStatus: 500 });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(toast, 'error');
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/gagal kirim nota customer/i));
    });
    expect(screen.queryByText(/meja 5/i)).not.toBeInTheDocument();
  });
});
