import { describe, it, expect } from 'vitest';
import { renderCustomerReceipt, renderKitchenTicket, uint8ToBase64, type TicketInput } from './escpos';

const baseInput: TicketInput = {
  daily_seq: 45,
  created_at: new Date('2026-06-24T14:07:00.000Z'), // 21:07 WIB
  customer_name: 'Pak Budi',
  table_no: '5',
  items: [
    { qty: 1, name: 'Nasi ayam bakar dada', unit_price: 26000, note: null },
    { qty: 2, name: 'Pete Goreng', unit_price: 10000, note: 'pedas' },
  ],
};

describe('renderCustomerReceipt', () => {
  it('produces non-empty Uint8Array for valid input', () => {
    const bytes = renderCustomerReceipt(baseInput);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(20);
  });

  it('includes Date, Order Number, Customer, Meja info lines', () => {
    const bytes = renderCustomerReceipt(baseInput);
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
    const bytes = renderCustomerReceipt({ ...baseInput, table_no: null });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Meja');
  });

  it('omits Customer line when customer_name null', () => {
    const bytes = renderCustomerReceipt({ ...baseInput, customer_name: null });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Pak Budi');
    expect(ascii).not.toContain('Customer');
  });

  it('renders each item with name + qty/price line + right-aligned line total', () => {
    const bytes = renderCustomerReceipt(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Nasi ayam bakar dada');
    expect(ascii).toContain('1x 26.000');
    expect(ascii).toContain('Pete Goreng');
    expect(ascii).toContain('2x 10.000');
    expect(ascii).toContain('20.000');
  });

  it('does not render item notes (customer receipt strips notes)', () => {
    const bytes = renderCustomerReceipt(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('pedas');
    expect(ascii).not.toMatch(/^\s*>/m);
  });

  it('computes Total Item from sum of qty', () => {
    const bytes = renderCustomerReceipt(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    // base: qty 1 + qty 2 = 3
    expect(ascii).toContain('Total Item 3');
  });

  it('computes Total amount from sum of qty * unit_price', () => {
    const bytes = renderCustomerReceipt(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    // base: 1*26000 + 2*10000 = 46000 → "46.000"
    expect(ascii).toContain('46.000');
  });

  it('uses header_text when provided', () => {
    const bytes = renderCustomerReceipt(baseInput, {
      paper_width: '58mm',
      feed_lines_before_cut: 0,
      cut_mode: 'none',
      beep_on_print: false,
      header_text: 'PECEL LELE PAK PON',
      footer_text: '',
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('PECEL LELE PAK PON');
  });

  it('ends with cut command when cut_mode=full', () => {
    const bytes = renderCustomerReceipt(baseInput);
    const last5 = Array.from(bytes.slice(-5));
    expect(last5).toContain(0x1d);
    expect(last5).toContain(0x56);
  });

  it('renders footer_text when non-empty', () => {
    const bytes = renderCustomerReceipt(baseInput, {
      paper_width: '58mm',
      feed_lines_before_cut: 0,
      cut_mode: 'none',
      beep_on_print: false,
      header_text: null,
      footer_text: 'Terima kasih\n~ Pak Pon ~',
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Terima kasih');
    expect(ascii).toContain('~ Pak Pon ~');
  });

  it('does NOT render footer when footer_text empty', () => {
    const bytes = renderCustomerReceipt(baseInput, {
      paper_width: '58mm',
      feed_lines_before_cut: 0,
      cut_mode: 'none',
      beep_on_print: false,
      header_text: null,
      footer_text: '',
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Terima kasih');
  });

  it('replaces non-Latin-1 chars in footer with ?', () => {
    const bytes = renderCustomerReceipt(baseInput, {
      paper_width: '58mm',
      feed_lines_before_cut: 0,
      cut_mode: 'none',
      beep_on_print: false,
      header_text: null,
      footer_text: 'Terima kasih 🙏',
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Terima kasih');
    expect(ascii).toContain('?');
  });
});

describe('renderKitchenTicket', () => {
  it('produces non-empty Uint8Array for valid input', () => {
    const bytes = renderKitchenTicket(baseInput);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(20);
  });

  it('includes header info block (Date, Order Number, Customer, Meja)', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Date');
    expect(ascii).toContain('24/06/2026 21:07');
    expect(ascii).toContain('Order Number');
    expect(ascii).toContain('POS-240626-45');
    expect(ascii).toContain('Customer');
    expect(ascii).toContain('Pak Budi');
    expect(ascii).toContain('Meja');
  });

  it('renders qty + name uppercase per item', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('1x NASI AYAM BAKAR DADA');
    expect(ascii).toContain('2x PETE GORENG');
  });

  it('does NOT print unit_price or line total (kitchen format)', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('26.000');
    expect(ascii).not.toContain('46.000');
  });

  it('includes Total Item from sum of qty', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Total Item 3');
  });

  it('does NOT include "Total Rp" line (only kitchen receipt)', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    // Indirect: ensure formatted amounts (26.000, 46.000) absent.
    expect(ascii).not.toContain('46.000');
  });

  it('uses double-size ESC/POS bytes (GS ! 0x11) for item lines', () => {
    const bytes = renderKitchenTicket(baseInput);
    let found = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x1d && bytes[i+1] === 0x21 && bytes[i+2] === 0x11) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('renders notes per item in normal size below double-size name', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('> pedas');
  });

  it('omits Meja line when table_no null', () => {
    const bytes = renderKitchenTicket({ ...baseInput, table_no: null });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Meja');
  });

  it('handles empty items list', () => {
    const bytes = renderKitchenTicket({ ...baseInput, items: [] });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Total Item 0');
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
