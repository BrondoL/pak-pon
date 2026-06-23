export type ThousandsHint =
  | { suggest: false }
  | { suggest: true; suggested_total: number };

const TOLERANCE = 0.15;
const RIBUAN_CUTOFF = 1000;

/**
 * Detect kemungkinan handwritten_total ditulis ringkas tanpa zero-suffix ribuan.
 * Cth: kasir tulis "92" padahal maksudnya Rp 92.000.
 */
export function detectThousandsMissing(
  handwritten_total: number | null,
  computed_sum: number
): ThousandsHint {
  if (!handwritten_total || handwritten_total <= 0) return { suggest: false };
  if (computed_sum === 0) return { suggest: false };
  if (handwritten_total >= RIBUAN_CUTOFF) return { suggest: false };

  const expanded = handwritten_total * 1000;
  const ratio = Math.abs(expanded - computed_sum) / expanded;
  if (ratio <= TOLERANCE) {
    return { suggest: true, suggested_total: expanded };
  }
  return { suggest: false };
}
