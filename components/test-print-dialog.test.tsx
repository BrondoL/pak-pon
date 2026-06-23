import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestPrintDialog } from './test-print-dialog';
import { getPrinterStatus } from '@/lib/printer-status';

describe('<TestPrintDialog />', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // Prevent jsdom navigation error from intent URL trigger
    vi.spyOn(window, 'open').mockImplementation(() => null);
    // Mock window.location.href assignment — jsdom throws on real navigation
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '' },
      writable: true,
      configurable: true,
    });
    // Mock fetch for /api/print/log
    global.fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch;
  });

  it('renders trigger button initially', () => {
    render(<TestPrintDialog target="dapur" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cetak tes/i })).toBeInTheDocument();
  });

  it('shows confirmation prompt after firing test', async () => {
    const user = userEvent.setup();
    render(<TestPrintDialog target="dapur" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    expect(screen.getByText(/berhasil/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /berhasil/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gagal/i })).toBeInTheDocument();
  });

  it('sets status success when user confirms berhasil', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestPrintDialog target="dapur" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await user.click(screen.getByRole('button', { name: /berhasil/i }));
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('success');
    expect(onClose).toHaveBeenCalled();
  });

  it('sets status failed when user confirms gagal & tutup', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestPrintDialog target="dapur" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await user.click(screen.getByRole('button', { name: /gagal/i }));
    await user.click(screen.getByRole('button', { name: /tutup/i }));
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('failed');
    expect(onClose).toHaveBeenCalled();
  });
});
