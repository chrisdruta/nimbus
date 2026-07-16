import "server-only";

/**
 * DB accessors for shared slipstream sessions (server-only). The session
 * row is server-authoritative queue truth: reads are sql() one-shots,
 * queue mutations serialize under a FOR UPDATE row lock (the lib/tokens.ts
 * transaction pattern) so concurrent edits from several members can't lose
 * writes. Liveness ≡ the row exists AND the host's slipstreams presence is
 * fresh — a dead host makes the session invisible everywhere.
 */

import { getPool, sql } from "./db";
import { NotFoundError } from "./route-helpers";
import { STALE_MS } from "../slipstream";
import type { SharedControl, SharedQueueEntry } from "../shared-queue";

const STALE_SECS = STALE_MS / 1000;

export interface SessionState {
  sessionId: string;
  revision: number;
  controlSeq: number;
  queue: SharedQueueEntry[];
}

/** Start (or restart) the caller's shared session with a seed queue.
 * revision strictly increases across restarts so a follower's cached
 * revision from a previous session never aliases the new queue. */
export async function startSession(
  hostId: number,
  entries: SharedQueueEntry[],
): Promise<{ sessionId: string; revision: number; queue: SharedQueueEntry[] }> {
  const rows = await sql().query(
    `INSERT INTO slipstream_sessions (host_id, queue)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (host_id) DO UPDATE SET
       queue      = EXCLUDED.queue,
       revision   = slipstream_sessions.revision + 1,
       control    = NULL,
       started_at = now(),
       updated_at = now()
     RETURNING extract(epoch FROM started_at)::text AS session_id,
               revision, queue`,
    [hostId, JSON.stringify(entries)],
  );
  return {
    sessionId: String(rows[0].session_id),
    revision: Number(rows[0].revision),
    queue: rows[0].queue as SharedQueueEntry[],
  };
}

export async function stopSession(hostId: number): Promise<void> {
  await sql()`DELETE FROM slipstream_sessions WHERE host_id = ${hostId}`;
}

/** The caller's own live session, for reload revival; null when the row is
 * gone or the host's presence has staled out (session over). */
export async function getSession(
  hostId: number,
): Promise<SessionState | null> {
  const rows = await sql()`
    SELECT extract(epoch FROM s.started_at)::text AS session_id,
           s.revision, s.control_seq, s.queue
    FROM slipstream_sessions s
    JOIN slipstreams p ON p.user_id = s.host_id
      AND p.updated_at > now() - make_interval(secs => ${STALE_SECS})
    WHERE s.host_id = ${hostId}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: String(row.session_id),
    revision: Number(row.revision),
    controlSeq: Number(row.control_seq),
    queue: (row.queue as SharedQueueEntry[]) ?? [],
  };
}

/**
 * Apply a pure queue mutation under the session row lock. `fn` returns the
 * next queue, or null for a no-op (revision unchanged); typed errors it
 * throws (BadRequest/Conflict) propagate through the rollback. Throws
 * NotFoundError when the session is missing or the host has gone stale.
 */
export async function mutateQueue(
  hostId: number,
  sessionId: string,
  fn: (queue: SharedQueueEntry[], revision: number) => SharedQueueEntry[] | null,
): Promise<{ revision: number; queue: SharedQueueEntry[] }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `SELECT s.queue, s.revision,
              (p.updated_at > now() - make_interval(secs => $2)) AS fresh
       FROM slipstream_sessions s
       LEFT JOIN slipstreams p ON p.user_id = s.host_id
       WHERE s.host_id = $1
         AND extract(epoch FROM s.started_at)::text = $3
       FOR UPDATE OF s`,
      [hostId, STALE_SECS, sessionId],
    );
    const row = res.rows[0];
    if (!row || !row.fresh) throw new NotFoundError("no live shared session");
    const queue = (row.queue as SharedQueueEntry[]) ?? [];
    const revision = Number(row.revision);

    const next = fn(queue, revision);
    if (next === null) {
      await client.query("COMMIT");
      return { revision, queue };
    }
    const updated = await client.query(
      `UPDATE slipstream_sessions
       SET queue = $2::jsonb, revision = revision + 1, updated_at = now()
       WHERE host_id = $1
       RETURNING revision`,
      [hostId, JSON.stringify(next)],
    );
    await client.query("COMMIT");
    return { revision: Number(updated.rows[0].revision), queue: next };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** One-slot last-writer-wins transport intent. Single statement; the
 * freshness join makes controls against a dead host a 404, and control_seq
 * strictly increases so the host never re-applies an old intent. */
export async function writeControl(
  hostId: number,
  sessionId: string,
  control: SharedControl,
): Promise<number> {
  const rows = await sql().query(
    `UPDATE slipstream_sessions s
     SET control = $2::jsonb, control_seq = s.control_seq + 1,
         updated_at = now()
     FROM slipstreams p
     WHERE s.host_id = $1 AND p.user_id = $1
       AND extract(epoch FROM s.started_at)::text = $3
       AND p.updated_at > now() - make_interval(secs => $4)
     RETURNING s.control_seq`,
    [hostId, JSON.stringify(control), sessionId, STALE_SECS],
  );
  if (!rows[0]) throw new NotFoundError("no live shared session");
  return Number(rows[0].control_seq);
}
