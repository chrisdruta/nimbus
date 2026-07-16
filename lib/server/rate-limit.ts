import "server-only";

/**
 * Lightweight per-instance limiter — loop protection, not a security
 * boundary. State is in-memory: it resets on cold starts and is not shared
 * between serverless instances, so a distributed burst can exceed these
 * numbers by the instance count. The durable control that actually bounds
 * spend is the daily play quota (lib/server/quota.ts); this layer absorbs
 * client bugs and accidental loops without adding infrastructure at
 * friends scale.
 */

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

/** Expensive provider-backed routes get a tighter per-user bucket than the
 * generic 600/min ceiling: every one of these requests costs a SoundCloud
 * API call. 120/min still dwarfs legitimate use (a full library walk is 4
 * pages, feed pagination 6, search is debounced) while the 5–15s polling
 * routes never touch this bucket, so client cadences are unaffected. */
export function consumeProviderLimit(userId: number): void {
  consumeRateLimit(`provider:${userId}`, 120, 60_000);
}

// Loose shape checks — enough to reject header garbage, not a validator.
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-fA-F:.]{2,45}$/;

function looksLikeIp(value: string): boolean {
  if (value.length > 45) return false;
  if (IPV4_RE.test(value)) return true;
  return value.includes(":") && IPV6_RE.test(value);
}

/**
 * Pure client-IP derivation. Prefers x-real-ip — on Vercel it is set by the
 * platform and not client-spoofable — and falls back to the first
 * x-forwarded-for hop. Anything that doesn't look like an IP collapses to
 * "unknown" (which is also what all local-dev traffic shares: no proxy
 * headers exist there, and the pre-auth limits are generous enough).
 */
export function clientIpFrom(
  realIp: string | null,
  xff: string | null,
): string {
  const real = realIp?.trim();
  if (real && looksLikeIp(real)) return real;
  const first = xff?.split(",")[0]?.trim();
  if (first && looksLikeIp(first)) return first;
  return "unknown";
}

export function requestIp(headers: Headers): string {
  return clientIpFrom(
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for"),
  );
}
