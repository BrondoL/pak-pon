import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestPrintDialog } from './test-print-dialog';

const mockFetchOk = (body: unknown, status = 201) =>
  vi.fn(
    (...args: [input: RequestInfo | URL, init?: RequestInit]) => {
      void args;
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    },
  );

describe('<TestPrintDialog />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders idle state with submit button', () => {
    render(<TestPrintDialog target="dapur" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cetak tes/i })).toBeInTheDocument();
  });

  it('shows submitting then awaiting_agent after POST success', async () => {
    global.fetch = mockFetchOk({ job_id: 'job-1' }) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<TestPrintDialog target="dapur" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await waitFor(() => {
      expect(screen.getByText(/job dikirim/i)).toBeInTheDocument();
    });
  });

  it('shows error state when POST fails', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'server' }), { status: 500 }))
    ) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<TestPrintDialog target="dapur" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await waitFor(() => {
      expect(screen.getByText(/gagal mengirim/i)).toBeInTheDocument();
    });
  });

  it('posts correct payload (target, trigger=test, tx_id=null, bytes_b64 non-empty)', async () => {
    const fetchMock = mockFetchOk({ job_id: 'job-1' });
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<TestPrintDialog target="minuman" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('/api/print/queue');
    const body = JSON.parse(call[1]!.body as string);
    expect(body.target).toBe('minuman');
    expect(body.trigger).toBe('test');
    expect(body.tx_id).toBeNull();
    expect(body.bytes_b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('close button returns to closed state via onClose callback', async () => {
    global.fetch = mockFetchOk({ job_id: 'job-1' }) as unknown as typeof fetch;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TestPrintDialog target="dapur" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await waitFor(() => expect(screen.getByText(/job dikirim/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /tutup/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
