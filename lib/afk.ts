/**
 * AFK policy — pure decision logic for what an unattended client should
 * stop doing. The costs being guarded (measured 2026-07-14): an unattended
 * playing client burns its whole daily play quota in ~7½ h and heartbeats
 * the whole way, and any client polling keeps Neon compute awake
 * (autosuspend needs ~5 quiet minutes). Pausing playback silences the
 * heartbeat publisher for free (it's gated on `playing`); the feed poll
 * gets its own idle gate.
 */

/** Uninterrupted playback with no interaction before the auto-pause. */
export const AFK_PAUSE_MS = 3 * 60 * 60_000;

/** Idle time after which the visible-tab feed poll stops (any interaction
 * resumes it on the next tick). */
export const FEED_IDLE_MS = 30 * 60_000;

/** How often the player checks the AFK policy. */
export const AFK_CHECK_MS = 60_000;

export type AfkAction = "none" | "pause" | "leave";

/**
 * One check → one decision. A paused client is already quiet (no
 * heartbeats, no play resolutions), so only playing clients act. A
 * follower leaves rather than pauses — a local pause would keep the 5s
 * snapshot poll running forever, while leaving stops it and restores the
 * parked queue exactly as a manual leave does.
 */
export function afkAction(input: {
  playing: boolean;
  /** Attached to someone's slipstream (read-only or shared). */
  following: boolean;
  idleForMs: number;
}): AfkAction {
  if (!input.playing || input.idleForMs < AFK_PAUSE_MS) return "none";
  return input.following ? "leave" : "pause";
}
