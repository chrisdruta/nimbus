/** Lightweight per-instance limiter. Vercel instances do not share this
 * state, so durable play quotas remain the hard budget; this absorbs bursts
 * and accidental loops without adding infrastructure at friends scale. */

interface Bucket {
  count: number;
  resetsAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("too many requests");
  }
}

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): void {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetsAt <= now) {
    bucket = { count: 0, resetsAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) {
    throw new RateLimitError(
      Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000)),
    );
  }
  bucket.count += 1;

  if (buckets.size > MAX_BUCKETS) {
    for (const [candidate, value] of buckets) {
      if (value.resetsAt <= now || buckets.size > MAX_BUCKETS) {
        buckets.delete(candidate);
      }
      if (buckets.size <= MAX_BUCKETS) break;
    }
  }
}

export function requestIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
