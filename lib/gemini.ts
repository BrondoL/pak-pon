import { GoogleGenAI } from '@google/genai';
import { buildScanSchema, buildMenuRefText, OCR_SYSTEM_PROMPT, type MenuRef, type ScanResult } from './prompts';

const PRIMARY_MODEL = 'gemini-3.5-flash';
const FALLBACK_MODEL = 'gemini-3.1-pro-preview';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

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

  async function callModel(model: string): Promise<ScanResult> {
    const response = await client.models.generateContent({
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

    const text = response.text;
    if (!text) throw new Error('gemini-empty-response');

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      throw new Error('gemini-invalid-json');
    }

    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) throw new Error('gemini-schema-mismatch');
    return parsed.data;
  }

  let result: ScanResult;
  try {
    result = await callModel(PRIMARY_MODEL);
  } catch {
    return await callModel(FALLBACK_MODEL);
  }

  if (result.items.length === 0 && result.handwritten_total === 0) {
    try {
      return await callModel(FALLBACK_MODEL);
    } catch {
      return result;
    }
  }

  return result;
}
