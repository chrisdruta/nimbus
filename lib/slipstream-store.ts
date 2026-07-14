/**
 * DB accessors for slipstream presence (server-only). All single-statement
 * sql() one-shots — no transactions needed: the row is a last-writer-wins
 * snapshot per host.
 *
 * Design notes:
 * - Chained follows are impossible by construction, not by rule: clients
 *   only heartbeat while playing their own queue (the publisher is inert
 *   while following), so a host who joins someone else's slipstream goes
 *   stale and drops out of the feed on their own.
 * - Two tabs of the same user both playing = last-writer-wins flapping;
 *   same pre-existing wart as two tabs playing locally. Accepted at
 *   friends scale.
 */

import { sql } from "./db";
import { STALE_MS, type Heartbeat } from "./slipstream";
import type { QueueTrack } from "./queue";
import type { SharedControl, SharedQueueEntry } from "./shared-queue";

const STALE_SECS = STALE_MS / 1000;

/** Shared-session state returned to a hosting client with its beat. */
export interface HeartbeatSessionRow {
  revision: number;
  controlSeq: number;
  control: SharedControl | null;
  queue: SharedQueueEntry[];
}

/**
 * One statement per beat, whatever the mode. Shared beats (hb.sharedRev
 * present) additionally prune the just-started track from the session
 * queue — a played entry leaves the shared list, bumping revision exactly
 * once — and return session state so the heartbeat response doubles as the
 * host's poll. Plain beats instead delete any lingering session row, so a
 * host that moved on to normal listening self-heals the session away.
 */
export async function upsertSlipstream(
  userId: number,
  hb: Heartbeat,
): Promise<HeartbeatSessionRow | null> {
  // Keepalives omit the window (null) — COALESCE keeps the stored one.
  const windowJson = hb.window === null ? null : JSON.stringify(hb.window);
  const shared = hb.sharedRev !== undefined;
  const rows = await sql().query(
    `WITH beat AS (
       INSERT INTO slipstreams (user_id, track_id, position_ms, playing, track_window)
       VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '[]'::jsonb))
       ON CONFLICT (user_id) DO UPDATE SET
         track_id     = $2,
         position_ms  = $3,
         playing      = $4,
         track_window = COALESCE($5::jsonb, slipstreams.track_window),
         updated_at   = now()
     ),
     pruned AS (
       UPDATE slipstream_sessions s
       SET queue = (
             SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
             FROM jsonb_array_elements(s.queue) AS e
             WHERE (e->>'id')::bigint <> $2
           ),
           revision   = s.revision + 1,
           updated_at = now()
       WHERE $6::boolean AND s.host_id = $1
         AND s.queue @> jsonb_build_array(jsonb_build_object('id', $2::bigint))
       RETURNING queue, revision, control, control_seq
     ),
     removed AS (
       DELETE FROM slipstream_sessions
       WHERE NOT $6::boolean AND host_id = $1
     )
     SELECT COALESCE(p.queue, s.queue)             AS queue,
            COALESCE(p.revision, s.revision)       AS revision,
            COALESCE(p.control, s.control)         AS control,
            COALESCE(p.control_seq, s.control_seq) AS control_seq
     FROM slipstream_sessions s
     LEFT JOIN pruned p ON true
     WHERE $6::boolean AND s.host_id = $1`,
    [userId, hb.trackId, hb.positionMs, hb.playing, windowJson, shared],
  );
  const row = rows[0];
  if (!shared || !row) return null;
  return {
    revision: Number(row.revision),
    controlSeq: Number(row.control_seq),
    control: (row.control as SharedControl | null) ?? null,
    queue: (row.queue as SharedQueueEntry[]) ?? [],
  };
}

export interface SlipstreamFeedRow {
  hostId: number;
  username: string | null;
  avatarUrl: string | null;
  track: {
    id: number;
    title: string;
    artist: string;
    artworkUrl: string | null;
  } | null;
  /** ISO timestamp of the host's last heartbeat. */
  updatedAt: string;
  /** Host is running a shared (collaborative) session. */
  shared: boolean;
}

/** Hosts currently live: playing and heartbeat-fresh. Includes the caller
 * (the client renders an inert "(you)" row as you're-live feedback). */
export async function listActiveSlipstreams(): Promise<SlipstreamFeedRow[]> {
  const rows = await sql()`
    SELECT s.user_id, s.updated_at, s.track_window -> 0 AS current,
           u.sc_username, u.avatar_url,
           (ss.host_id IS NOT NULL) AS shared
    FROM slipstreams s
    JOIN users u ON u.id = s.user_id AND NOT u.disabled
    LEFT JOIN slipstream_sessions ss ON ss.host_id = s.user_id
    WHERE s.playing AND s.updated_at > now() - make_interval(secs => ${STALE_SECS})
    ORDER BY s.updated_at DESC
  `;
  return rows.map((row) => {
    const current = row.current as QueueTrack | null;
    return {
      hostId: Number(row.user_id), // bigint arrives as a string
      username: (row.sc_username as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      track: current
        ? {
            id: current.id,
            title: current.title,
            artist: current.artist,
            artworkUrl: current.artworkUrl,
          }
        : null,
      updatedAt: new Date(row.updated_at as string | Date).toISOString(),
      shared: Boolean(row.shared),
    };
  });
}

export interface SlipstreamSnapshotRow {
  hostId: number;
  username: string | null;
  avatarUrl: string | null;
  trackId: number;
  positionMs: number;
  playing: boolean;
  window: QueueTrack[];
  /** ms epoch, DB clock — pair only with serverNowMs from the same read. */
  updatedAtMs: number;
  serverNowMs: number;
  /** Shared-session state; null when the host isn't sharing. Followers
   * never see `control` — only the host applies intents. */
  shared: {
    revision: number;
    controlSeq: number;
    queue: SharedQueueEntry[];
  } | null;
}

/** Full snapshot for a follower poll; null when the host has no row or has
 * gone stale (stale ≡ ended ≡ missing from a follower's perspective).
 * updated_at and now() come from the same DB read so follower clock-offset
 * math never mixes clocks. */
export async function getSlipstream(
  hostId: number,
): Promise<SlipstreamSnapshotRow | null> {
  const rows = await sql()`
    SELECT s.user_id, s.track_id, s.position_ms, s.playing, s.track_window,
           s.updated_at, now() AS server_now, u.sc_username, u.avatar_url,
           ss.revision AS shared_revision, ss.control_seq AS shared_control_seq,
           ss.queue AS shared_queue
    FROM slipstreams s
    JOIN users u ON u.id = s.user_id AND NOT u.disabled
    LEFT JOIN slipstream_sessions ss ON ss.host_id = s.user_id
    WHERE s.user_id = ${hostId}
      AND s.updated_at > now() - make_interval(secs => ${STALE_SECS})
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    hostId: Number(row.user_id),
    username: (row.sc_username as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    trackId: Number(row.track_id),
    positionMs: Number(row.position_ms),
    playing: Boolean(row.playing),
    window: (row.track_window as QueueTrack[]) ?? [],
    updatedAtMs: new Date(row.updated_at as string | Date).getTime(),
    serverNowMs: new Date(row.server_now as string | Date).getTime(),
    shared:
      row.shared_revision !== null
        ? {
            revision: Number(row.shared_revision),
            controlSeq: Number(row.shared_control_seq),
            queue: (row.shared_queue as SharedQueueEntry[]) ?? [],
          }
        : null,
  };
}
