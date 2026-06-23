/**
 * Compute next daily_seq dari array existing seq dalam business-day yang sama.
 * Pure function — caller bertanggung jawab query DB untuk dapat existing seqs.
 *
 * Race condition: caller harus pakai SELECT ... FOR UPDATE atau retry-on-conflict
 * di DB transaction. Lib ini tidak handle locking.
 */
export function computeNextDailySeq(existingSeqs: Array<number | null>): number {
  const nonNull = existingSeqs.filter((s): s is number => s !== null);
  if (nonNull.length === 0) return 1;
  return Math.max(...nonNull) + 1;
}
