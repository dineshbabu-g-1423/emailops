/**
 * Small statistics helpers used for anomaly detection (V2 in the roadmap).
 * Kept dependency-free and pure so they are trivially testable.
 */

/** Ratio of current to baseline, guarding against divide-by-zero. */
export function ratio(current: number, baseline: number): number {
  if (baseline <= 0) return current > 0 ? Infinity : 1;
  return current / baseline;
}

/** z-score = (current - mean) / std. Returns 0 when std is unusable. */
export function zScore(current: number, mean: number, std?: number): number {
  if (!std || std <= 0) return 0;
  return (current - mean) / std;
}

/** Human readable percent-change string from a ratio, e.g. 6.2 -> "+520%". */
export function pctChange(r: number): string {
  if (!Number.isFinite(r)) return "+∞%";
  const pct = Math.round((r - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

/** Round to a fixed number of decimals. */
export function round(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
