/** Shared helpers for the stored fixed-size histograms (reply/delete/session buckets). */

/** Index of the bucket containing the median observation, or null when empty. */
export function medianBucket(buckets: number[]): number | null {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const target = (total + 1) / 2;
  let cumulative = 0;
  for (let i = 0; i < buckets.length; i++) {
    cumulative += buckets[i]!;
    if (cumulative >= target) return i;
  }
  return buckets.length - 1;
}

/** Adds `source` into `target` index-wise; tolerates missing/short arrays (legacy rows). */
export function sumInto(target: number[], source: number[] | undefined | null): void {
  if (!Array.isArray(source)) return;
  const n = Math.min(target.length, source.length);
  for (let i = 0; i < n; i++) target[i]! += source[i]!;
}
