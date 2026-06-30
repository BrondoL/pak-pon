import { GoogleGenAI } from '@google/genai';
import { buildScanSchema, buildMenuRefText, OCR_SYSTEM_PROMPT, type MenuRef, type ScanResult } from './prompts';

// Model selection — overridable via env (.env.local) for easy A/B without code change.
const FAST_MODEL = process.env.GEMINI_FAST_MODEL ?? 'gemini-3.5-flash';
const CAREFUL_MODEL = process.env.GEMINI_CAREFUL_MODEL ?? 'gemini-2.5-pro';

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

  // 🆕 token usage
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export type ScanMeta = {
  attempts: ScanAttempt[];
  final_model: string | null;
  fell_back: boolean;
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

export type ScanOptions = {
  mode?: 'fast' | 'careful';
};

export async function scanNota(
  base64Image: string,
  mimeType: string,
  menus: MenuRef[],
  options: ScanOptions = {}
): Promise<ScanNotaResult> {
  const mode = options.mode ?? 'fast';
  const schema = buildScanSchema(menus);
  const menuRefText = buildMenuRefText(menus);
  const attempts: ScanAttempt[] = [];

  async function callModel(model: string): Promise<ScanResult | null> {
    const t0 = Date.now();

    const attempt: ScanAttempt = {
      model,
      duration_ms: 0,
      outcome: 'success',
    };

    let response;

    try {
      const isFlash = model.includes('flash');

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
          ...(isFlash ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      });
    } catch (err) {
      attempt.duration_ms = Date.now() - t0;
      attempt.outcome = 'api_error';
      attempt.error_message = err instanceof Error ? err.message : String(err);
      attempts.push(attempt);
      return null;
    }

    attempt.duration_ms = Date.now() - t0;

    // 🆕 TOKEN USAGE CAPTURE
    const usage = response.usageMetadata;
    if (usage) {
      attempt.input_tokens = usage.promptTokenCount;
      attempt.output_tokens = usage.candidatesTokenCount;
      attempt.total_tokens = usage.totalTokenCount;
    }

    const text = response.text;

    if (!text) {
      attempt.outcome = 'empty_response';
      attempts.push(attempt);
      return null;
    }

    attempt.raw_text_preview = truncate(text);

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(text);
    } catch (err) {
      attempt.outcome = 'invalid_json';
      attempt.error_message = err instanceof Error ? err.message : String(err);
      attempts.push(attempt);
      return null;
    }

    const parsed = schema.safeParse(parsedJson);

    if (!parsed.success) {
      attempt.outcome = 'schema_mismatch';
      attempt.schema_issues = parsed.error.issues.slice(0, 6);
      attempts.push(attempt);
      return null;
    }

    attempt.items_count = parsed.data.items.length;
    attempt.handwritten_total = parsed.data.handwritten_total;

    attempts.push(attempt);

    return parsed.data;
  }

  if (mode === 'careful') {
    const result = await callModel(CAREFUL_MODEL);

    return {
      result: result ?? EMPTY_RESULT,
      meta: {
        attempts,
        final_model: result ? CAREFUL_MODEL : null,
        fell_back: false,
      },
    };
  }

  const fastResult = await callModel(FAST_MODEL);

  if (fastResult && (fastResult.items.length > 0 || fastResult.handwritten_total > 0)) {
    return {
      result: fastResult,
      meta: {
        attempts,
        final_model: FAST_MODEL,
        fell_back: false,
      },
    };
  }

  const carefulResult = await callModel(CAREFUL_MODEL);

  if (carefulResult) {
    return {
      result: carefulResult,
      meta: {
        attempts,
        final_model: CAREFUL_MODEL,
        fell_back: true,
      },
    };
  }

  return {
    result: fastResult ?? EMPTY_RESULT,
    meta: {
      attempts,
      final_model: fastResult ? FAST_MODEL : null,
      fell_back: true,
    },
  };
}
