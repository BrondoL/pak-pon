import { describe, it, expect } from 'vitest';
import { renderTicket, type TicketInput } from './escpos';

const baseInput: TicketInput = {
  target: 'dapur',
  daily_seq: 42,
  created_at: new Date('2026-06-23T07:32:00.000Z'), // 14:32 WIB
  customer_name: 'Pak Budi',
  table_no: '5',
  items: [
    { qty: 2, name: 'Ayam Goreng', note: 'Dada, DP' },
    { qty: 1, name: 'Nasi Putih', note: null },
  ],
};

describe('renderTicket', () => {
  it('produces non-empty Uint8Array for valid input', () => {
    const bytes = renderTicket(baseInput);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(20);
  });

  it('includes target header text', () => {
    const bytes = renderTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('DAPUR');
  });

  it('includes daily_seq with hash prefix', () => {
    const bytes = renderTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('#0042');
  });

  it('omits Meja line when table_no null', () => {
    const bytes = renderTicket({ ...baseInput, table_no: null });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Meja:');
  });

  it('omits customer line when customer_name null', () => {
    const bytes = renderTicket({ ...baseInput, customer_name: null });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Pak Budi');
  });

  it('omits note line when note null', () => {
    const bytes = renderTicket({
      ...baseInput,
      items: [{ qty: 1, name: 'Nasi Putih', note: null }],
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toMatch(/>\s*$/m);
  });

  it('renders MINUMAN header for minuman target', () => {
    const bytes = renderTicket({ ...baseInput, target: 'minuman' });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('MINUMAN');
  });

  it('ends with cut command', () => {
    const bytes = renderTicket(baseInput);
    // ESC/POS cut: 0x1D 0x56 0x00 (full cut) or 0x1D 0x56 0x42 0x00
    const last5 = Array.from(bytes.slice(-5));
    expect(last5).toContain(0x1d);
    expect(last5).toContain(0x56);
  });
});
