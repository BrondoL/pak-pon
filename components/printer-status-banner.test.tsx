import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrinterStatusBanner } from './printer-status-banner';
import { STORAGE_KEY } from '@/lib/printer-status';

describe('<PrinterStatusBanner />', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders red banner when both targets not_configured', () => {
    render(<PrinterStatusBanner />);
    expect(screen.getByText(/setup printer/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /setup printer/i })).toHaveAttribute('href', '/setup/printer');
  });

  it('renders red banner when any target failed', () => {
    const recentISO = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      dapur: { state: 'success', last_check: recentISO },
      minuman: { state: 'failed', last_check: recentISO },
    }));
    render(<PrinterStatusBanner />);
    expect(screen.getByText(/printer minuman/i)).toBeInTheDocument();
  });

  it('renders nothing (or hidden) when both success within 24h', () => {
    const recentISO = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      dapur: { state: 'success', last_check: recentISO },
      minuman: { state: 'success', last_check: recentISO },
    }));
    const { container } = render(<PrinterStatusBanner />);
    expect(container.querySelector('[data-testid="printer-banner"]')).toBeNull();
  });

  it('renders yellow stale warning when success >24h ago', () => {
    const staleISO = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      dapur: { state: 'success', last_check: staleISO },
      minuman: { state: 'success', last_check: staleISO },
    }));
    render(<PrinterStatusBanner />);
    expect(screen.getByText(/sudah lama tidak dites/i)).toBeInTheDocument();
  });
});
