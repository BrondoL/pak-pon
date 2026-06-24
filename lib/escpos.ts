/**
 * ESC/POS bytes generator untuk kitchen/bar ticket.
 *
 * Subset minimal command supaya compatible dengan banyak printer thermal:
 * - ESC @         (0x1B 0x40)        Init
 * - ESC a n       (0x1B 0x61 n)       Align (0=left 1=center 2=right)
 * - ESC E n       (0x1B 0x45 n)       Bold on/off
 * - ESC B n t     (0x1B 0x42 n t)     Buzzer (n beeps, t × 50ms each)
 * - GS ! n        (0x1D 0x21 n)       Char size (0=normal, 0x11=double)
 * - LF            (0x0A)              Line feed
 * - GS V 0        (0x1D 0x56 0x00)    Full cut
 * - GS V 1        (0x1D 0x56 0x01)    Partial cut
 *
 * Codepage default: CP437 / Latin-1 compatible ASCII (no full UTF-8 for non-ASCII glyphs).
 */

import {
  DEFAULT_PRINTER_SETTINGS,
  charsPerLine,
  type PrinterSettings,
} from './printer-settings';

export type TicketInput = {
  target: 'dapur' | 'minuman';
  daily_seq: number;
  created_at: Date;
  customer_name: string | null;
  table_no: string | null;
  items: Array<{
    qty: number;
    name: string;
    note: string | null;
  }>;
};

// ESC/POS command constants
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const INIT = new Uint8Array([ESC, 0x40]);
const ALIGN_CENTER = new Uint8Array([ESC, 0x61, 0x01]);
const ALIGN_LEFT = new Uint8Array([ESC, 0x61, 0x00]);
const BOLD_ON = new Uint8Array([ESC, 0x45, 0x01]);
const BOLD_OFF = new Uint8Array([ESC, 0x45, 0x00]);
const SIZE_DOUBLE = new Uint8Array([GS, 0x21, 0x11]);
const SIZE_NORMAL = new Uint8Array([GS, 0x21, 0x00]);
const CUT_FULL = new Uint8Array([GS, 0x56, 0x00]);
const CUT_PARTIAL = new Uint8Array([GS, 0x56, 0x01]);
const BEEP_3X = new Uint8Array([ESC, 0x42, 0x03, 0x03]);

function encodeText(s: string): Uint8Array {
  // Latin-1 / CP437 encoding for thermal printer compatibility
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    bytes[i] = code > 0xff ? 0x3f : code; // '?' for non-Latin-1
  }
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function lineFeed(n = 1): Uint8Array {
  return new Uint8Array(new Array(n).fill(LF));
}

function formatSeq(n: number): string {
  return `#${n.toString().padStart(4, '0')}`;
}

function formatTimestamp(d: Date): string {
  // Format ke WIB (UTC+7) DD/MM/YYYY HH:MM
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(wib.getUTCDate())}/${pad(wib.getUTCMonth() + 1)}/${wib.getUTCFullYear()} ${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}`;
}

export function renderTicket(
  input: TicketInput,
  settings: PrinterSettings = DEFAULT_PRINTER_SETTINGS,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const separator = '-'.repeat(charsPerLine(settings.paper_width));
  const trimmedHeader = settings.header_text?.trim();

  // 1. Init + optional buzzer
  parts.push(INIT);
  if (settings.beep_on_print) parts.push(BEEP_3X);

  parts.push(ALIGN_CENTER);

  // 2. Custom header (kalau diset) — normal weight, normal size
  if (trimmedHeader) {
    for (const line of trimmedHeader.split('\n')) {
      parts.push(encodeText(line));
      parts.push(lineFeed(1));
    }
  }

  // 3. Bold + double size: DAPUR / MINUMAN
  parts.push(BOLD_ON);
  parts.push(SIZE_DOUBLE);
  parts.push(encodeText(input.target === 'dapur' ? 'DAPUR' : 'MINUMAN'));
  parts.push(lineFeed(1));
  parts.push(SIZE_NORMAL);
  parts.push(BOLD_OFF);

  // 4. Center align: No. antrian + meja (kalau ada)
  let line2 = formatSeq(input.daily_seq);
  if (input.table_no) line2 += `  |  Meja: ${input.table_no}`;
  parts.push(encodeText(line2));
  parts.push(lineFeed(1));

  // 5. Customer name (kalau ada)
  if (input.customer_name) {
    parts.push(encodeText(input.customer_name));
    parts.push(lineFeed(1));
  }

  // 6. Timestamp
  parts.push(encodeText(formatTimestamp(input.created_at)));
  parts.push(lineFeed(1));

  // 7. Separator
  parts.push(ALIGN_LEFT);
  parts.push(encodeText(separator));
  parts.push(lineFeed(1));

  // 8. Items
  for (const item of input.items) {
    parts.push(encodeText(`${item.qty}x ${item.name}`));
    parts.push(lineFeed(1));
    if (item.note) {
      parts.push(encodeText(`    > ${item.note}`));
      parts.push(lineFeed(1));
    }
  }

  // 9. Bottom separator + configurable feed
  parts.push(encodeText(separator));
  if (settings.feed_lines_before_cut > 0) {
    parts.push(lineFeed(settings.feed_lines_before_cut));
  }

  // 10. Cut (skip kalau 'none' — printer tanpa cutter, sobek manual)
  if (settings.cut_mode === 'full') parts.push(CUT_FULL);
  else if (settings.cut_mode === 'partial') parts.push(CUT_PARTIAL);

  return concat(...parts);
}

/**
 * Convert Uint8Array ke base64 string. Browser-safe (no Node Buffer).
 * Cocok untuk encode ESC/POS bytes ke text yang aman dikirim via JSON/URL.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
