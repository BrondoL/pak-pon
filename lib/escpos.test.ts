import { describe, it, expect } from 'vitest';
import { renderTicket, uint8ToBase64, type TicketInput } from './escpos';

const baseInput: TicketInput = {
  target: 'dapur',
  daily_seq: 45,
  created_at: new Date('2026-06-24T14:07:00.000Z'), // 21:07 WIB
  customer_name: 'Pak Budi',
  table_no: '5',
  items: [
    { qty: 1, name: 'Nasi ayam bakar dada', unit_price: 26000, note: null },
    { qty: 2, name: 'Pete Goreng', unit_price: 10000, note: 'pedas' },
  ],
};

describe('renderTicket', () => {
  it('produces non-empty Uint8Array for valid input', () => {
    const bytes = renderTicket(baseInput);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(20);
  });

  it('includes Date, Order Number, Customer, Meja info lines', () => {
    const bytes = renderTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Date');
    expect(ascii).toContain('24/06/2026 21:07');
    expect(ascii).toContain('Order Number');
    expect(ascii).toContain('POS-240626-45');
    expect(ascii).toContain('Customer');
    expect(ascii).toContain('Pak Budi');
    expect(ascii).toContain('Meja');
  });

  it('omits Meja line when table_no null', () => {
    const bytes = renderTicket({ ...baseInput, table_no: null });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Meja');
  });

  it('omits Customer line when customer_name null', () => {
    const bytes = renderTicket({ ...baseInput, customer_name: null });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Pak Budi');
    expect(ascii).not.toContain('Customer');
  });

  it('renders each item with name + qty/price line + right-aligned line total', () => {
    const bytes = renderTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Nasi ayam bakar dada');
    expect(ascii).toContain('1x 26.000');
    expect(ascii).toContain('Pete Goreng');
    expect(ascii).toContain('2x 10.000');
    expect(ascii).toContain('20.000');
  });

  it('renders note line when present', () => {
    const bytes = renderTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('> pedas');
  });

  it('omits note line when null', () => {
    const bytes = renderTicket({
      ...baseInput,
      items: [{ qty: 1, name: 'Nasi Putih', unit_price: 5000, note: null }],
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toMatch(/^\s*>/m);
  });

  it('computes Total Item from sum of qty', () => {
    const bytes = renderTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    // base: qty 1 + qty 2 = 3
    expect(ascii).toContain('Total Item 3');
  });

  it('computes Total amount from sum of qty * unit_price', () => {
    const bytes = renderTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    // base: 1*26000 + 2*10000 = 46000 → "46.000"
    expect(ascii).toContain('46.000');
  });

  it('uses header_text when provided', () => {
    const bytes = renderTicket(baseInput, {
      paper_width: '58mm',
      feed_lines_before_cut: 0,
      cut_mode: 'none',
      beep_on_print: false,
      header_text: 'PECEL LELE PAK PON',
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('PECEL LELE PAK PON');
  });

  it('ends with cut command when cut_mode=full', () => {
    const bytes = renderTicket(baseInput);
    const last5 = Array.from(bytes.slice(-5));
    expect(last5).toContain(0x1d);
    expect(last5).toContain(0x56);
  });
});

describe('uint8ToBase64', () => {
  it('encodes empty array as empty string', () => {
    expect(uint8ToBase64(new Uint8Array([]))).toBe('');
  });

  it('encodes simple ASCII bytes', () => {
    expect(uint8ToBase64(new Uint8Array([0x48, 0x49]))).toBe('SEk=');
  });

  it('encodes ESC/POS control bytes round-trip', () => {
    expect(uint8ToBase64(new Uint8Array([0x1b, 0x40, 0x48, 0x49]))).toBe('G0BISQ==');
  });

  it('encodes high-byte (>0x7f) correctly', () => {
    expect(uint8ToBase64(new Uint8Array([0xff]))).toBe('/w==');
  });
});
