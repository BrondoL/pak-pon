function num(envKey: string, fallback: string): number {
  const raw = process.env[envKey] ?? fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number(fallback);
}

export function estimateCostIdr(inputTokens: number, outputTokens: number): number {
  const inputUsdPer1M = num('GEMINI_INPUT_RATE_USD_PER_1M', '0.30');
  const outputUsdPer1M = num('GEMINI_OUTPUT_RATE_USD_PER_1M', '2.50');
  const usdIdr = num('USD_IDR_RATE', '16000');
  const usd = (inputTokens * inputUsdPer1M + outputTokens * outputUsdPer1M) / 1_000_000;
  return Math.round(usd * usdIdr);
}

export function pricingSnapshot() {
  return {
    inputUsdPer1M: num('GEMINI_INPUT_RATE_USD_PER_1M', '0.30'),
    outputUsdPer1M: num('GEMINI_OUTPUT_RATE_USD_PER_1M', '2.50'),
    usdIdr: num('USD_IDR_RATE', '16000'),
  };
}
