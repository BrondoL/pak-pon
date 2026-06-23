#!/usr/bin/env node
/**
 * Printer emulator untuk dev self-test (§9.5 design spec).
 *
 * Listen TCP socket, capture ESC/POS bytes dari RawBT, dump ke file
 * dan print ASCII preview di terminal.
 *
 * Usage:
 *   node scripts/printer-emulator.js [port] [label]
 *
 * Examples:
 *   node scripts/printer-emulator.js 9100 dapur
 *   node scripts/printer-emulator.js 9101 minuman
 *
 * Run dua paralel di terminal berbeda untuk simulate 2 printer.
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const PORT = parseInt(process.argv[2] || '9100', 10);
const LABEL = process.argv[3] || 'dapur';
const OUT_DIR = path.resolve('tmp/print-emulator', LABEL);

fs.mkdirSync(OUT_DIR, { recursive: true });

const server = net.createServer((socket) => {
  const chunks = [];
  socket.on('data', (chunk) => chunks.push(chunk));
  socket.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(OUT_DIR, `print-${ts}.bin`);
    fs.writeFileSync(filename, buffer);

    // ASCII preview: strip ESC/POS commands (any byte < 0x20 except 0x0A LF; any byte > 0x7E)
    const asciiPreview = buffer
      .toString('latin1')
      .replace(/[\x00-\x09\x0B-\x1F\x7F-\xFF]/g, '');
    console.log('━'.repeat(50));
    console.log(`✓ [${LABEL}] ${buffer.byteLength} bytes → ${filename}`);
    console.log('--- preview ---');
    console.log(asciiPreview);
    console.log('━'.repeat(50));
  });
  socket.on('error', (err) => console.error(`[${LABEL}] socket error:`, err.message));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${LABEL}] listening on 0.0.0.0:${PORT}`);
  console.log(`[${LABEL}] output dir: ${OUT_DIR}`);
});

process.on('SIGINT', () => {
  console.log(`\n[${LABEL}] shutting down`);
  server.close(() => process.exit(0));
});
