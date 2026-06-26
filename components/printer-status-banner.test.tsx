import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PrinterStatusBanner } from './printer-status-banner';

const mockFetch = (response: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(response), { status })));

const nowISO = () => new Date().toISOString();
const staleISO = () => new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago

describe('<PrinterStatusBanner />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders red "belum ada primary" banner when no agent flagged primary', async () => {
    global.fetch = mockFetch({
      agents: [
        {
          agent_label: 'HP A',
          last_seen_at: nowISO(),
          status: 'online',
          is_primary: false,
          display_state: 'online',
          online: true,
        },
      ],
    }) as unknown as typeof fetch;
    render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/belum ada primary agent/i)).toBeInTheDocument();
    });
  });

  it('renders nothing when primary online', async () => {
    global.fetch = mockFetch({
      agents: [
        {
          agent_label: 'HP A',
          last_seen_at: nowISO(),
          status: 'online',
          is_primary: true,
          display_state: 'online',
          online: true,
        },
      ],
    }) as unknown as typeof fetch;
    const { container } = render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="printer-banner"]')).toBeNull();
    });
  });

  it('renders yellow banner with primary label when primary stale', async () => {
    global.fetch = mockFetch({
      agents: [
        {
          agent_label: 'HP A',
          last_seen_at: staleISO(),
          status: 'online',
          is_primary: true,
          display_state: 'stale',
          online: false,
        },
      ],
    }) as unknown as typeof fetch;
    render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/HP A/)).toBeInTheDocument();
      expect(screen.getByText(/di-background/i)).toBeInTheDocument();
    });
  });

  it('renders red "primary belum jalan" banner when primary offline', async () => {
    global.fetch = mockFetch({
      agents: [
        {
          agent_label: 'HP A',
          last_seen_at: nowISO(),
          status: 'offline',
          is_primary: true,
          display_state: 'offline',
          online: false,
        },
        {
          agent_label: 'HP B',
          last_seen_at: nowISO(),
          status: 'online',
          is_primary: false,
          display_state: 'online',
          online: true,
        },
      ],
    }) as unknown as typeof fetch;
    render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/HP A/)).toBeInTheDocument();
      expect(screen.getByText(/belum jalan/i)).toBeInTheDocument();
    });
  });

  it('renders red "belum ada primary" banner when agents list empty', async () => {
    global.fetch = mockFetch({ agents: [] }) as unknown as typeof fetch;
    const { container } = render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/belum ada primary agent/i)).toBeInTheDocument();
    });
    expect(container.querySelector('[data-testid="printer-banner"]')).not.toBeNull();
  });

  it('handles fetch error gracefully (renders nothing)', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
    const { container } = render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="printer-banner"]')).toBeNull();
    });
  });
});
