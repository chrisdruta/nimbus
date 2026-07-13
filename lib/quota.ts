import { sql } from "./db";
import { getSettings } from "./settings";

export type QuotaScope = "user" | "global";

export class QuotaExceededError extends Error {
  constructor(
    public scope: QuotaScope,
    public used: number,
    public limit: number,
    public resetsAt: Date,
  ) {
    super(`${scope} stream-start quota exceeded (${used}/${limit})`);
  }
}

export interface QuotaInput {
  userCount: number;
  globalCount: number;
  userLimit: number;
  globalLimit: number;
  /** Owner bypasses the per-user cap but still counts against the global one. */
  ownerExempt: boolean;
}

/**
 * Pure quota decision over already-fetched counters. Global takes precedence
 * when both are exceeded — it's the constraint that protects the client id.
 */
export function decideQuota(
  q: QuotaInput,
): { allowed: true } | { allowed: false; scope: QuotaScope } {
  if (q.globalCount >= q.globalLimit)
    return { allowed: false, scope: "global" };
  if (!q.ownerExempt && q.userCount >= q.userLimit) {
    return { allowed: false, scope: "user" };
  }
  return { allowed: true };
}

/** UTC calendar day, e.g. "2026-07-12" — the quota bucket key. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** When today's counters reset (start of the next UTC day). */
export function nextUtcMidnight(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

/**
 * Atomically check-and-increment the caller's counter for today, or throw
 * QuotaExceededError. The per-user guard is exact (ON CONFLICT DO UPDATE
 * evaluates against the row-locked value); the global SUM guard is
 * approximate under concurrency (READ COMMITTED) and can overshoot by a few
 * plays — the headroom between our global limit and SoundCloud's real
 * 15,000/day cap absorbs that. Do not "fix" it with a lock row: that would
 * serialize every play in the app.
 */
export async function consumePlayStart(
  userId: number,
  ownerExempt: boolean,
): Promise<void> {
  const { userDailyPlayLimit, globalDailyPlayLimit } = await getSettings();
  const day = utcDayKey();

  const rows = await sql()`
    INSERT INTO play_counts (user_id, day, count)
    SELECT ${userId}, ${day}::date, 1
    WHERE (${ownerExempt}::bool OR ${userDailyPlayLimit}::int >= 1)
      AND (SELECT COALESCE(SUM(count), 0) FROM play_counts
           WHERE day = ${day}::date) < ${globalDailyPlayLimit}::int
    ON CONFLICT (user_id, day) DO UPDATE
      SET count = play_counts.count + 1
      WHERE (${ownerExempt}::bool OR play_counts.count < ${userDailyPlayLimit}::int)
        AND (SELECT COALESCE(SUM(count), 0) FROM play_counts
             WHERE day = ${day}::date) < ${globalDailyPlayLimit}::int
    RETURNING count
  `;
  if (rows.length > 0) return;

  // Denied — fetch both counters once to report coherent numbers.
  const counts = await sql()`
    SELECT
      COALESCE(SUM(count) FILTER (WHERE user_id = ${userId}), 0) AS user_count,
      COALESCE(SUM(count), 0) AS global_count
    FROM play_counts WHERE day = ${day}::date
  `;
  const userCount = Number(counts[0]?.user_count ?? 0);
  const globalCount = Number(counts[0]?.global_count ?? 0);
  const verdict = decideQuota({
    userCount,
    globalCount,
    userLimit: userDailyPlayLimit,
    globalLimit: globalDailyPlayLimit,
    ownerExempt,
  });
  if (verdict.allowed) {
    // The deny raced a reset/settings change; treat as a user-scope denial
    // rather than letting the play through without a counted start.
    throw new QuotaExceededError(
      "user",
      userCount,
      userDailyPlayLimit,
      nextUtcMidnight(),
    );
  }
  throw verdict.scope === "global"
    ? new QuotaExceededError(
        "global",
        globalCount,
        globalDailyPlayLimit,
        nextUtcMidnight(),
      )
    : new QuotaExceededError(
        "user",
        userCount,
        userDailyPlayLimit,
        nextUtcMidnight(),
      );
}

/** Today's total stream starts across all users (admin gauge). */
export async function getGlobalUsage(day: string): Promise<number> {
  const rows = await sql()`
    SELECT COALESCE(SUM(count), 0) AS total
    FROM play_counts WHERE day = ${day}::date
  `;
  return Number(rows[0]?.total ?? 0);
}
