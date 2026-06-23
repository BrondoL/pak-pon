import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PrinterStatusBanner } from './printer-status-banner';

const mockFetch = (response: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(response), { status })));

describe('<PrinterStatusBanner />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders red banner when no agents found', async () => {
    global.fetch = mockFetch({ agents: [] }) as unknown as typeof fetch;
    render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/print agent belum jalan/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /setup/i })).toHaveAttribute('href', '/setup/printer');
  });

  it('renders red banner when all agents offline (stale heartbeat)', async () => {
    const staleISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    global.fetch = mockFetch({
      agents: [{ agent_label: 'main-tab', last_seen_at: staleISO, online: false }],
    }) as unknown as typeof fetch;
    render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/print agent belum jalan/i)).toBeInTheDocument();
    });
  });

  it('renders nothing when at least 1 agent online', async () => {
    const recentISO = new Date().toISOString();
    global.fetch = mockFetch({
      agents: [{ agent_label: 'main-tab', last_seen_at: recentISO, online: true }],
    }) as unknown as typeof fetch;
    const { container } = render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="printer-banner"]')).toBeNull();
    });
  });

  it('handles fetch error gracefully (renders nothing)', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
    const { container } = render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="printer-banner"]')).toBeNull();
    });
  });
});
