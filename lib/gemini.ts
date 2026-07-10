import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { buildScanSchema, buildScanResponseSchema, OCR_SYSTEM_PROMPT, type MenuRef, type ScanResult } from './prompts';

// Single model only — fallback Pro dihapus per plan 2026-06-30.
const MODEL = process.env.GEMINI_FAST_MODEL ?? 'gemini-3.5-flash';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export type ScanAttempt = {
  model: string;
  duration_ms: number;
  outcome: 'success' | 'api_error' | 'empty_response' | 'invalid_json' | 'schema_mismatch';

  error_message?: string;
  raw_text_preview?: string;
  schema_issues?: unknown[];
  items_count?: number;
  handwritten_total?: number;

  input_tokens?: number;
  output_tokens?: number;
  thoughts_tokens?: number;
  total_tokens?: number;
};

export type ScanMeta = {
  attempts: ScanAttempt[];
  final_model: string | null;
  fell_back: boolean; // selalu false — dipertahankan supaya log shape backward-compat
};

export type ScanNotaResult = {
  result: ScanResult;
  meta: ScanMeta;
};

const EMPTY_RESULT: ScanResult = {
  items: [],
  handwritten_total: 0,
  customer_name: null,
  table_no: null,
};

function truncate(s: string, n = 400): string {
  return s.length > n ? s.slice(0, n) + `… [+${s.length - n} chars]` : s;
}

export async function scanNota(
  base64Image: string,
  mimeType: string,
  menus: MenuRef[]
): Promise<ScanNotaResult> {
  const schema = buildScanSchema(menus);
  const responseSchema = buildScanResponseSchema(menus);
  const attempts: ScanAttempt[] = [];

  const t0 = Date.now();
  const attempt: ScanAttempt = {
    model: MODEL,
    duration_ms: 0,
    outcome: 'success',
  };

  let response;
  try {
    response = await client.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: OCR_SYSTEM_PROMPT },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: responseSchema as any,
        // Gemini 3.x pakai `thinkingLevel` (minimal/low/medium/high, default medium),
        // BUKAN `thinkingBudget` (itu API 2.5 — silently ignored di 3.x).
        // A/B 2026-07-03: 5 foto identik di medium vs minimal → akurasi item/qty/total
        // 100% match, cost/scan turun 78% ($0.017 → $0.004), latency turun 4× (9.9s → 2.5s).
        // Task OCR menu-enum-constrained ternyata ga butuh reasoning berat. Sticking with minimal.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });
  } catch (err) {
    attempt.duration_ms = Date.now() - t0;
    attempt.outcome = 'api_error';
    attempt.error_message = err instanceof Error ? err.message : String(err);
    attempts.push(attempt);
    return { result: EMPTY_RESULT, meta: { attempts, final_model: null, fell_back: false } };
  }

  attempt.duration_ms = Date.now() - t0;

  const usage = response.usageMetadata;
  if (usage) {
    // Gemini 3.x charges thoughtsTokenCount at output rate even though `thinkingBudget: 0`
    // is set — the model doesn't honor budget=0 for structured output. Roll them into
    // output_tokens so billing math matches the Google Cloud dashboard; keep the raw
    // thoughts count in its own field for visibility.
    const candidates = usage.candidatesTokenCount ?? 0;
    const thoughts = usage.thoughtsTokenCount ?? 0;
    attempt.input_tokens = usage.promptTokenCount;
    attempt.output_tokens = candidates + thoughts;
    attempt.thoughts_tokens = thoughts;
    attempt.total_tokens = usage.totalTokenCount;
  }

  console.log(usage);

  const text = response.text;
  if (!text) {
    attempt.outcome = 'empty_response';
    attempts.push(attempt);
    return { result: EMPTY_RESULT, meta: { attempts, final_model: null, fell_back: false } };
  }

  attempt.raw_text_preview = truncate(text);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (err) {
    attempt.outcome = 'invalid_json';
    attempt.error_message = err instanceof Error ? err.message : String(err);
    attempts.push(attempt);
    return { result: EMPTY_RESULT, meta: { attempts, final_model: null, fell_back: false } };
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    attempt.outcome = 'schema_mismatch';
    attempt.schema_issues = parsed.error.issues.slice(0, 6);
    attempts.push(attempt);
    return { result: EMPTY_RESULT, meta: { attempts, final_model: null, fell_back: false } };
  }

  attempt.items_count = parsed.data.items.length;
  attempt.handwritten_total = parsed.data.handwritten_total;
  attempts.push(attempt);

  return {
    result: parsed.data,
    meta: { attempts, final_model: MODEL, fell_back: false },
  };
}
