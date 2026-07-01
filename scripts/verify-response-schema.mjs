// One-shot smoke test — verify Gemini responseSchema token behavior.
// Run: node --env-file=.env.local scripts/verify-response-schema.mjs
import { GoogleGenAI } from '@google/genai';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_FAST_MODEL ?? 'gemini-3.5-flash';

// 31 dummy menu names mirroring produksi count.
const MENUS = Array.from({ length: 31 }, (_, i) => `Menu ${i + 1}`);

// Dummy 1x1 PNG (base64) — image tokens minimal supaya diff kelihatan di prompt/schema.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const BASE_PROMPT = 'OCR nota. Return JSON: {"i":[{"m":"<menu>","q":1}],"t":0}';

async function run(label, config, promptOverride) {
  const t0 = Date.now();
  const res = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [
      { text: promptOverride ?? BASE_PROMPT },
      { inlineData: { mimeType: 'image/png', data: TINY_PNG } },
    ]}],
    config,
  });
  const usage = res.usageMetadata;
  const input = usage?.promptTokenCount ?? 0;
  const output = usage?.candidatesTokenCount ?? 0;
  console.log(`[${label}] input=${input} output=${output} duration=${Date.now() - t0}ms`);
  return input;
}

console.log(`Model: ${MODEL}, menus: ${MENUS.length}\n`);

// Test A: baseline (no schema)
const inA = await run('A: NO SCHEMA', {
  responseMimeType: 'application/json',
  thinkingConfig: { thinkingBudget: 0 },
});

// Test B: with responseSchema having 31-menu enum
const schema = {
  type: 'object',
  properties: {
    i: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          m: { type: 'string', enum: MENUS },
          q: { type: 'integer' },
        },
        required: ['m', 'q'],
      },
    },
    t: { type: 'integer' },
  },
  required: ['i', 't'],
};

const inB = await run('B: WITH SCHEMA', {
  responseMimeType: 'application/json',
  responseSchema: schema,
  thinkingConfig: { thinkingBudget: 0 },
});

// Test C: menu list dalam prompt text (baseline our current approach)
const promptWithMenu = `${BASE_PROMPT}\n\nMenu master:\n${MENUS.map((m) => `- ${m}`).join('\n')}`;
const inC = await run('C: MENU IN PROMPT', {
  responseMimeType: 'application/json',
  thinkingConfig: { thinkingBudget: 0 },
}, promptWithMenu);

console.log('\n--- Analysis ---');
console.log(`Delta A→B (add schema):        ${inB - inA} tok`);
console.log(`Delta A→C (menu in prompt):    ${inC - inA} tok`);
console.log(`Delta B→C (savings if migrate): ${inC - inB} tok`);
console.log('---');

if (inB - inA < 30) {
  console.log('✓ SCHEMA does NOT count enum as input — A2 viable, expect ~180 tok saving');
} else if (inC - inB > 50) {
  console.log(`◐ SCHEMA counts enum partially (~${inB - inA} tok), but savings ${inC - inB} tok still worthwhile`);
} else {
  console.log(`✗ SCHEMA counts enum as ~${inB - inA} tok — A2 saving marginal, consider skip`);
}
