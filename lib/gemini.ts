import { GoogleGenAI } from '@google/genai';
import { buildScanSchema, buildMenuRefText, OCR_SYSTEM_PROMPT, type MenuRef, type ScanResult } from './prompts';

// Fast model: cheap default for normal scans (~$0.0001/call, ~3s).
// Careful model: slower + ~75x more expensive, used as fallback or via explicit rescan.
// No LLM is perfect at this OCR task; both miss/confuse items occasionally. Strategy:
// default to fast (cost-sensitive), let kasir trigger careful rescan when needed.
const FAST_MODEL = 'gemini-2.5-flash';
const CAREFUL_MODEL = 'gemini-2.5-pro';

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
};

export type ScanMeta = {
  attempts: ScanAttempt[];
  final_model: string | null; // null = all failed, result is the empty fallback
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
  // 'fast' (default): try FAST_MODEL first, fall back to CAREFUL_MODEL on failure/empty.
  // 'careful': skip fast model, use careful directly (kasir-triggered rescan).
  mode?: 'fast' | 'careful';
};

/**
 * OCR sebuah foto nota. Function ini PURE OF SIDE EFFECTS — tidak console.log.
 * Caller dapat seluruh meta (attempts, errors, durations) dan decide apa yang
 * mau di-include di request log.
 *
 * Default mode ('fast'):
 * - Try FAST_MODEL (Flash) dulu.
 * - Kalau gagal/empty, retry dengan CAREFUL_MODEL (Pro).
 * Mode 'careful': cuma coba Pro langsung, no fallback (rescan).
 *
 * Never throws. Kalau semua gagal → return EMPTY_RESULT dengan final_model=null.
 */
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
    const attempt: ScanAttempt = { model, duration_ms: 0, outcome: 'success' };

    let response;
    try {
      // Flash supports thinkingBudget: 0 (fast mode). Pro 2.5 rejects budget 0 — it requires thinking.
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
      meta: { attempts, final_model: result ? CAREFUL_MODEL : null, fell_back: false },
    };
  }

  // Fast mode: try fast model first
  const fastResult = await callModel(FAST_MODEL);
  if (fastResult && (fastResult.items.length > 0 || fastResult.handwritten_total > 0)) {
    return {
      result: fastResult,
      meta: { attempts, final_model: FAST_MODEL, fell_back: false },
    };
  }

  // Fast either failed OR returned empty — escalate to careful
  const carefulResult = await callModel(CAREFUL_MODEL);
  if (carefulResult) {
    return {
      result: carefulResult,
      meta: { attempts, final_model: CAREFUL_MODEL, fell_back: true },
    };
  }

  // Both failed. Prefer fast's empty result (might at least have customer/table) over EMPTY_RESULT.
  return {
    result: fastResult ?? EMPTY_RESULT,
    meta: {
      attempts,
      final_model: fastResult ? FAST_MODEL : null,
      fell_back: true,
    },
  };
}
