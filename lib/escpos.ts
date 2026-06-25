/**
 * ESC/POS bytes generator untuk customer-style receipt.
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
    unit_price: number;
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
const CUT_FULL = new Uint8Array([GS, 0x56, 0x00]);
const CUT_PARTIAL = new Uint8Array([GS, 0x56, 0x01]);
const BEEP_3X = new Uint8Array([ESC, 0x42, 0x03, 0x03]);

// GS ! n — character size. 0x11 = double width (bit 4) + double height (bit 0).
// Dipakai untuk kitchen ticket supaya dapur baca cepat dari jauh.
const DOUBLE_SIZE_ON  = new Uint8Array([GS, 0x21, 0x11]);
const DOUBLE_SIZE_OFF = new Uint8Array([GS, 0x21, 0x00]);

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

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function toWib(d: Date): Date {
  return new Date(d.getTime() + 7 * 3600 * 1000);
}

function formatTimestamp(d: Date): string {
  const wib = toWib(d);
  return `${pad2(wib.getUTCDate())}/${pad2(wib.getUTCMonth() + 1)}/${wib.getUTCFullYear()} ${pad2(wib.getUTCHours())}:${pad2(wib.getUTCMinutes())}`;
}

function formatOrderNumber(d: Date, seq: number): string {
  const wib = toWib(d);
  const yy = pad2(wib.getUTCFullYear() % 100);
  // Format follows the photo's POS-DDMMYY-seq convention.
  return `POS-${pad2(wib.getUTCDate())}${pad2(wib.getUTCMonth() + 1)}${yy}-${seq}`;
}

function formatRupiah(n: number): string {
  // Indonesian thousand separator: 26000 -> 26.000
  return n.toLocaleString('id-ID');
}

function rightAlignLine(left: string, right: string, lineWidth: number): string {
  // Wrap-safe right alignment. If left+right exceeds lineWidth, put right on
  // its own line so neither side gets truncated.
  if (left.length + 1 + right.length > lineWidth) {
    return left + '\n' + right.padStart(lineWidth, ' ');
  }
  const space = lineWidth - left.length - right.length;
  return left + ' '.repeat(space) + right;
}

function labelLine(label: string, value: string, labelWidth: number): string {
  // "Date          : 25/06/2026 10:30" — fixed-width label, colon, space, value.
  const paddedLabel = label.length >= labelWidth ? label : label + ' '.repeat(labelWidth - label.length);
  return `${paddedLabel}: ${value}`;
}

export function renderKitchenTicket(
  input: TicketInput,
  settings: PrinterSettings = DEFAULT_PRINTER_SETTINGS,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const lineWidth = charsPerLine(settings.paper_width);
  const heavySeparator = '='.repeat(lineWidth);
  const trimmedHeader = settings.header_text?.trim();
  const labelWidth = 13;

  parts.push(INIT);
  if (settings.beep_on_print) parts.push(BEEP_3X);

  // Centered bold header (warung name).
  if (trimmedHeader) {
    parts.push(ALIGN_CENTER);
    parts.push(BOLD_ON);
    for (const line of trimmedHeader.split('\n')) {
      parts.push(encodeText(line));
      parts.push(lineFeed(1));
    }
    parts.push(BOLD_OFF);
  }

  // Info block.
  parts.push(ALIGN_LEFT);
  parts.push(encodeText(heavySeparator));
  parts.push(lineFeed(1));
  parts.push(encodeText(labelLine('Date', formatTimestamp(input.created_at), labelWidth)));
  parts.push(lineFeed(1));
  parts.push(encodeText(labelLine('Order Number', formatOrderNumber(input.created_at, input.daily_seq), labelWidth)));
  parts.push(lineFeed(1));
  if (input.customer_name) {
    parts.push(encodeText(labelLine('Customer', input.customer_name, labelWidth)));
    parts.push(lineFeed(1));
  }
  if (input.table_no) {
    parts.push(encodeText(labelLine('Meja', input.table_no, labelWidth)));
    parts.push(lineFeed(1));
  }
  parts.push(encodeText(heavySeparator));
  parts.push(lineFeed(1));

  // Items in DOUBLE SIZE — qty + name uppercase. Notes in normal size below.
  let totalQty = 0;
  for (const item of input.items) {
    totalQty += item.qty;
    parts.push(DOUBLE_SIZE_ON);
    parts.push(encodeText(`${item.qty}x ${item.name.toUpperCase()}`));
    parts.push(DOUBLE_SIZE_OFF);
    parts.push(lineFeed(1));
    if (item.note) {
      parts.push(encodeText(`  > ${item.note}`));
      parts.push(lineFeed(1));
    }
  }

  // Footer count, no amount.
  parts.push(encodeText(heavySeparator));
  parts.push(lineFeed(1));
  parts.push(encodeText(`Total Item ${totalQty}`));
  parts.push(lineFeed(1));

  // Feed + cut.
  if (settings.feed_lines_before_cut > 0) {
    parts.push(lineFeed(settings.feed_lines_before_cut));
  }
  if (settings.cut_mode === 'full') parts.push(CUT_FULL);
  else if (settings.cut_mode === 'partial') parts.push(CUT_PARTIAL);

  return concat(...parts);
}

export function renderCustomerReceipt(
  input: TicketInput,
  settings: PrinterSettings = DEFAULT_PRINTER_SETTINGS,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const lineWidth = charsPerLine(settings.paper_width);
  const heavySeparator = '='.repeat(lineWidth);
  const lightSeparator = '-'.repeat(lineWidth);
  const trimmedHeader = settings.header_text?.trim();
  // Reserve enough room for the longest Indonesian label below.
  const labelWidth = 13;

  // 1. Init + optional buzzer
  parts.push(INIT);
  if (settings.beep_on_print) parts.push(BEEP_3X);

  // 2. Centered header (custom header_text). Bold so it stands out from the
  // info block below. If no header configured, skip — keeps the receipt
  // clean rather than printing a placeholder.
  if (trimmedHeader) {
    parts.push(ALIGN_CENTER);
    parts.push(BOLD_ON);
    for (const line of trimmedHeader.split('\n')) {
      parts.push(encodeText(line));
      parts.push(lineFeed(1));
    }
    parts.push(BOLD_OFF);
  }

  // 3. Info block (Date / Order Number / Customer / Meja)
  parts.push(ALIGN_LEFT);
  parts.push(encodeText(heavySeparator));
  parts.push(lineFeed(1));

  parts.push(encodeText(labelLine('Date', formatTimestamp(input.created_at), labelWidth)));
  parts.push(lineFeed(1));

  parts.push(encodeText(labelLine('Order Number', formatOrderNumber(input.created_at, input.daily_seq), labelWidth)));
  parts.push(lineFeed(1));

  if (input.customer_name) {
    parts.push(encodeText(labelLine('Customer', input.customer_name, labelWidth)));
    parts.push(lineFeed(1));
  }
  if (input.table_no) {
    parts.push(encodeText(labelLine('Meja', input.table_no, labelWidth)));
    parts.push(lineFeed(1));
  }

  // 4. Items block
  parts.push(encodeText(heavySeparator));
  parts.push(lineFeed(1));

  let totalQty = 0;
  let totalAmount = 0;
  for (const item of input.items) {
    const lineTotal = item.qty * item.unit_price;
    totalQty += item.qty;
    totalAmount += lineTotal;

    parts.push(encodeText(item.name));
    parts.push(lineFeed(1));

    const left = `${item.qty}x ${formatRupiah(item.unit_price)}`;
    const right = formatRupiah(lineTotal);
    parts.push(encodeText(rightAlignLine(left, right, lineWidth)));
    parts.push(lineFeed(1));

    if (item.note) {
      parts.push(encodeText(`  > ${item.note}`));
      parts.push(lineFeed(1));
    }
  }

  // 5. Totals block
  parts.push(encodeText(heavySeparator));
  parts.push(lineFeed(1));
  parts.push(encodeText(`Total Item ${totalQty}`));
  parts.push(lineFeed(1));
  parts.push(encodeText(lightSeparator));
  parts.push(lineFeed(1));
  parts.push(BOLD_ON);
  parts.push(encodeText(rightAlignLine('Total', formatRupiah(totalAmount), lineWidth)));
  parts.push(BOLD_OFF);
  parts.push(lineFeed(1));

  // 5b. Optional footer (Terima kasih dst). Print centered, normal size, with
  // breathing room before cut. Kosong = skip semuanya supaya tidak ada gap.
  const trimmedFooter = settings.footer_text?.trim();
  if (trimmedFooter) {
    parts.push(lineFeed(1));
    parts.push(ALIGN_CENTER);
    for (const line of trimmedFooter.split('\n')) {
      parts.push(encodeText(line));
      parts.push(lineFeed(1));
    }
    parts.push(ALIGN_LEFT);
  }

  // 6. Configurable feed + cut
  if (settings.feed_lines_before_cut > 0) {
    parts.push(lineFeed(settings.feed_lines_before_cut));
  }
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
