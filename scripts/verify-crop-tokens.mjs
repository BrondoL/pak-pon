// Smoke test: verify Gemini image tokens scale with image dimensions.
// Run: node --env-file=.env.local scripts/verify-crop-tokens.mjs
//
// Downloads 1 recent nota dari Supabase storage, generate crop variations
// via sharp, send each ke Gemini, report input_tokens.

import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

const MODEL = process.env.GEMINI_FAST_MODEL ?? 'gemini-3.5-flash';

// Pick a recent nota — user tested with same nota; storage_path from log:
const STORAGE_PATH = '2026-07/6e0a51d6-9474-4ff3-ab55-3505da7830f4.jpg';

console.log(`Downloading ${STORAGE_PATH}...`);
const { data: file, error } = await supabase.storage.from('notas').download(STORAGE_PATH);
if (error) {
  console.error('Download failed:', error);
  process.exit(1);
}
const buf = Buffer.from(await file.arrayBuffer());
const meta = await sharp(buf).metadata();
console.log(`Original: ${meta.width}×${meta.height}, ${buf.length} bytes\n`);

async function scanTokens(label, imageBuf) {
  const b64 = imageBuf.toString('base64');
  const t0 = Date.now();
  const res = await genai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [
      { text: 'OCR nota. Return JSON: {"i":[{"m":"<menu>","q":1}],"t":0}' },
      { inlineData: { mimeType: 'image/jpeg', data: b64 } },
    ]}],
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  const usage = res.usageMetadata;
  const dur = Date.now() - t0;
  const dims = await sharp(imageBuf).metadata();
  console.log(`[${label.padEnd(30)}] ${dims.width}×${dims.height} bytes=${(imageBuf.length/1024).toFixed(0)}KB input=${usage?.promptTokenCount} output=${usage?.candidatesTokenCount} dur=${dur}ms`);
  return { input: usage?.promptTokenCount ?? 0, output: usage?.candidatesTokenCount ?? 0 };
}

// Variations. Assume nota portrait ~800×1067 after compress.
const W = meta.width, H = meta.height;

const variations = [
  { label: 'A: full',                buf },
  { label: 'B: half-height (top)',   buf: await sharp(buf).extract({ left: 0, top: 0, width: W, height: Math.floor(H/2) }).jpeg({ quality: 80 }).toBuffer() },
  { label: 'C: half-width (left)',   buf: await sharp(buf).extract({ left: 0, top: 0, width: Math.floor(W/2), height: H }).jpeg({ quality: 80 }).toBuffer() },
  { label: 'D: quarter (top-left)',  buf: await sharp(buf).extract({ left: 0, top: 0, width: Math.floor(W/2), height: Math.floor(H/2) }).jpeg({ quality: 80 }).toBuffer() },
  { label: 'E: resize 512 longest',  buf: await sharp(buf).resize({ width: 512, height: 512, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer() },
  { label: 'F: resize 384 longest',  buf: await sharp(buf).resize({ width: 384, height: 384, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer() },
  { label: 'G: resize 256 longest',  buf: await sharp(buf).resize({ width: 256, height: 256, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer() },
];

const results = [];
for (const v of variations) {
  const r = await scanTokens(v.label, v.buf);
  results.push({ ...v, ...r });
}

console.log('\n--- Analysis ---');
const baseline = results[0].input;
for (const r of results) {
  const delta = r.input - baseline;
  const pct = ((r.input - baseline) / baseline * 100).toFixed(1);
  console.log(`${r.label.padEnd(30)} input=${r.input.toString().padStart(4)} delta=${delta >= 0 ? '+' : ''}${delta} (${pct}%)`);
}
console.log('---');

// Heuristic conclusion
const minInput = Math.min(...results.map(r => r.input));
const maxInput = Math.max(...results.map(r => r.input));
if (maxInput - minInput < 50) {
  console.log('✗ Image tok LOCKED — cropping/resize tidak bantu. Phase 2 tidak akan turunkan bill.');
} else {
  console.log(`✓ Image tok RESPONSIVE ke dimensions — range ${minInput}..${maxInput} tok. Phase 2 viable.`);
}
