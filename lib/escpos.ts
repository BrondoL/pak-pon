/**
 * ESC/POS bytes generator untuk kitchen/bar ticket.
 *
 * Subset minimal command supaya compatible dengan banyak printer thermal:
 * - ESC @         (0x1B 0x40)        Init
 * - ESC a n       (0x1B 0x61 n)       Align (0=left 1=center 2=right)
 * - ESC E n       (0x1B 0x45 n)       Bold on/off
 * - GS ! n        (0x1D 0x21 n)       Char size (0=normal, 0x11=double)
 * - LF            (0x0A)              Line feed
 * - GS V 0        (0x1D 0x56 0x00)    Full cut
 *
 * Codepage default: CP437 / Latin-1 compatible ASCII (no full UTF-8 for non-ASCII glyphs).
 */

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
const CUT = new Uint8Array([GS, 0x56, 0x00]);

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

export function renderTicket(input: TicketInput): Uint8Array {
  const parts: Uint8Array[] = [];

  // 1. Init + center align + bold + double size header
  parts.push(INIT);
  parts.push(ALIGN_CENTER);
  parts.push(BOLD_ON);
  parts.push(SIZE_DOUBLE);
  parts.push(encodeText(input.target === 'dapur' ? 'DAPUR' : 'MINUMAN'));
  parts.push(lineFeed(1));
  parts.push(SIZE_NORMAL);
  parts.push(BOLD_OFF);

  // 2. Center align: No. antrian + meja (kalau ada)
  let line2 = formatSeq(input.daily_seq);
  if (input.table_no) line2 += `  |  Meja: ${input.table_no}`;
  parts.push(encodeText(line2));
  parts.push(lineFeed(1));

  // 3. Customer name (kalau ada)
  if (input.customer_name) {
    parts.push(encodeText(input.customer_name));
    parts.push(lineFeed(1));
  }

  // 4. Timestamp
  parts.push(encodeText(formatTimestamp(input.created_at)));
  parts.push(lineFeed(1));

  // 5. Separator
  parts.push(ALIGN_LEFT);
  parts.push(encodeText('--------------------------------'));
  parts.push(lineFeed(1));

  // 6. Items
  for (const item of input.items) {
    parts.push(encodeText(`${item.qty}x ${item.name}`));
    parts.push(lineFeed(1));
    if (item.note) {
      parts.push(encodeText(`    > ${item.note}`));
      parts.push(lineFeed(1));
    }
  }

  // 7. Bottom separator + spacing
  parts.push(encodeText('--------------------------------'));
  parts.push(lineFeed(4));

  // 8. Full cut
  parts.push(CUT);

  return concat(...parts);
}
