/**
 * Histogram bucket scales. Distributions are stored as fixed-size count
 * arrays per row — never raw values (spec §3).
 */

/** Reply latency: 0–10s, 10–30s, 30s–2m, 2m–10m, 10m–1h, 1h–6h, 6h+ */
export const REPLY_BUCKET_BOUNDS_MS: readonly number[] = [10_000, 30_000, 120_000, 600_000, 3_600_000, 21_600_000];
export const REPLY_BUCKET_COUNT = REPLY_BUCKET_BOUNDS_MS.length + 1;

/** Time-to-delete: 0–10s, 10–60s, 1–10m, 10m–1h, 1–6h, 6–24h, 24h+ */
export const DELETE_BUCKET_BOUNDS_MS: readonly number[] = [10_000, 60_000, 600_000, 3_600_000, 21_600_000, 86_400_000];
export const DELETE_BUCKET_COUNT = DELETE_BUCKET_BOUNDS_MS.length + 1;

/** Session length: <5m, 5–15m, 15–30m, 30m–1h, 1–2h, 2–4h, 4h+ */
export const SESSION_BUCKET_BOUNDS_MS: readonly number[] = [300_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000];
export const SESSION_BUCKET_COUNT = SESSION_BUCKET_BOUNDS_MS.length + 1;

/** Message length in characters: <10, 10–50, 50–200, 200–1k, 1k+ */
export const LENGTH_BUCKET_BOUNDS_CHARS: readonly number[] = [10, 50, 200, 1_000];
export const LENGTH_BUCKET_COUNT = LENGTH_BUCKET_BOUNDS_CHARS.length + 1;

export function bucketIndex(ms: number, bounds: readonly number[]): number {
  for (let i = 0; i < bounds.length; i++) {
    if (ms < bounds[i]!) return i;
  }
  return bounds.length;
}

export function emptyBuckets(count: number): number[] {
  return new Array(count).fill(0) as number[];
}

export function addToBuckets(buckets: number[], count: number, ms: number, bounds: readonly number[]): number[] {
  const normalized = buckets.length === count ? buckets : emptyBuckets(count);
  normalized[bucketIndex(ms, bounds)]! += 1;
  return normalized;
}
