import "server-only";

import { sql } from "./db";

export interface TrackPlay {
  trackId: number;
  playCount: number;
  /** ISO timestamp. */
  lastPlayedAt: string;
}

/**
 * Tally one play. Called best-effort after a successful stream
 * resolution — callers .catch() so a DB hiccup never fails a good play.
 */
export async function recordTrackPlay(
  userId: number,
  trackId: number,
): Promise<void> {
  await sql()`
    INSERT INTO track_plays (user_id, track_id)
    VALUES (${userId}, ${trackId})
    ON CONFLICT (user_id, track_id) DO UPDATE
      SET play_count = track_plays.play_count + 1,
          last_played_at = now()
  `;
}

/** Every tally for the user — bounded by tracks they've actually played. */
export async function getTrackPlays(userId: number): Promise<TrackPlay[]> {
  const rows = await sql()`
    SELECT track_id, play_count, last_played_at
    FROM track_plays WHERE user_id = ${userId}
  `;
  return rows.map((row) => ({
    trackId: Number(row.track_id), // bigint arrives as a string
    playCount: Number(row.play_count),
    lastPlayedAt: new Date(row.last_played_at as string | Date).toISOString(),
  }));
}
