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

const STALE_SECS = STALE_MS / 1000;

export async function upsertSlipstream(
  userId: number,
  hb: Heartbeat,
): Promise<void> {
  // Keepalives omit the window (null) — COALESCE keeps the stored one.
  const windowJson = hb.window === null ? null : JSON.stringify(hb.window);
  await sql()`
    INSERT INTO slipstreams (user_id, track_id, position_ms, playing, track_window)
    VALUES (${userId}, ${hb.trackId}, ${hb.positionMs}, ${hb.playing},
            COALESCE(${windowJson}::jsonb, '[]'::jsonb))
    ON CONFLICT (user_id) DO UPDATE SET
      track_id     = ${hb.trackId},
      position_ms  = ${hb.positionMs},
      playing      = ${hb.playing},
      track_window = COALESCE(${windowJson}::jsonb, slipstreams.track_window),
      updated_at   = now()
  `;
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
}

/** Hosts currently live: playing and heartbeat-fresh. Includes the caller
 * (the client renders an inert "(you)" row as you're-live feedback). */
export async function listActiveSlipstreams(): Promise<SlipstreamFeedRow[]> {
  const rows = await sql()`
    SELECT s.user_id, s.updated_at, s.track_window -> 0 AS current,
           u.sc_username, u.avatar_url
    FROM slipstreams s
    JOIN users u ON u.id = s.user_id AND NOT u.disabled
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
           s.updated_at, now() AS server_now, u.sc_username, u.avatar_url
    FROM slipstreams s
    JOIN users u ON u.id = s.user_id AND NOT u.disabled
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
  };
}
