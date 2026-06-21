import { GoogleGenAI } from '@google/genai';
import { buildScanSchema, buildMenuRefText, OCR_SYSTEM_PROMPT, type MenuRef, type ScanResult } from './prompts';

const PRIMARY_MODEL = 'gemini-3.5-flash';
const FALLBACK_MODEL = 'gemini-3.1-pro-preview';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

function truncate(s: string, n = 800): string {
  return s.length > n ? s.slice(0, n) + `… [+${s.length - n} chars]` : s;
}

/**
 * OCR sebuah foto nota.
 * - Try PRIMARY_MODEL (Flash) dulu — cepat & murah.
 * - Kalau hasil "kosong" (items kosong DAN handwritten_total = 0), retry sekali pakai FALLBACK_MODEL (Pro).
 * - Return parsed result, throw kalau dua-duanya gagal.
 */
export async function scanNota(
  base64Image: string,
  mimeType: string,
  menus: MenuRef[]
): Promise<ScanResult> {
  const schema = buildScanSchema(menus);
  const menuRefText = buildMenuRefText(menus);

  console.log(`[gemini] scanNota start — image=${base64Image.length}B base64, mime=${mimeType}, menus=${menus.length}`);

  async function callModel(model: string): Promise<ScanResult> {
    const t0 = Date.now();
    console.log(`[gemini] → calling model="${model}"`);
    let response;
    try {
      response = await client.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: OCR_SYSTEM_PROMPT + '\n\n' + menuRefText },
              { inlineData: { mimeType, data: base64Image } },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
    } catch (err) {
      const dt = Date.now() - t0;
      console.error(`[gemini] ✗ model="${model}" API error after ${dt}ms:`, err instanceof Error ? err.message : err);
      throw new Error(`gemini-api-error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    const dt = Date.now() - t0;
    console.log(`[gemini] ✓ model="${model}" responded in ${dt}ms`);

    const text = response.text;
    if (!text) {
      console.error(`[gemini] ✗ model="${model}" returned empty text. Full response:`, JSON.stringify(response).slice(0, 600));
      throw new Error('gemini-empty-response');
    }
    console.log(`[gemini]   raw text (${text.length} chars): ${truncate(text)}`);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch (err) {
      console.error(`[gemini] ✗ model="${model}" invalid JSON:`, err instanceof Error ? err.message : err);
      throw new Error('gemini-invalid-json');
    }

    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) {
      console.error(`[gemini] ✗ model="${model}" schema mismatch. Issues:`, JSON.stringify(parsed.error.issues, null, 2));
      console.error(`[gemini]   parsed JSON was:`, JSON.stringify(parsedJson).slice(0, 600));
      throw new Error('gemini-schema-mismatch');
    }
    console.log(`[gemini]   ✓ parsed: ${parsed.data.items.length} items, handwritten_total=${parsed.data.handwritten_total}`);
    return parsed.data;
  }

  let result: ScanResult;
  try {
    result = await callModel(PRIMARY_MODEL);
  } catch (err) {
    console.warn(`[gemini] primary model failed (${err instanceof Error ? err.message : err}), trying fallback…`);
    return await callModel(FALLBACK_MODEL);
  }

  if (result.items.length === 0 && result.handwritten_total === 0) {
    console.warn(`[gemini] primary returned empty result — retrying with fallback`);
    try {
      return await callModel(FALLBACK_MODEL);
    } catch (err) {
      console.warn(`[gemini] fallback also failed, returning primary's empty result. err=`, err instanceof Error ? err.message : err);
      return result;
    }
  }

  return result;
}
