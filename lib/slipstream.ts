/**
 * Pure slipstream sync engine — no fetch, no DOM, injectable clock (the
 * ShuffleContext precedent). A slipstream is a member's live listening:
 * the host heartbeats {track, position, playing, window}; followers poll a
 * snapshot and this module decides what the follower's audio element should
 * do next. Wire window entries reuse the QueueTrack shape — exactly the
 * metadata a follower needs to render and to resolve streams via their own
 * token.
 */

import type { QueueTrack } from "./queue";

/** Host keepalive cadence while playing; beats are otherwise event-driven. */
export const HEARTBEAT_MS = 15_000;
/** Follower snapshot poll cadence. */
export const POLL_MS = 5_000;
/** Sidebar live-feed poll cadence. */
export const FEED_POLL_MS = 15_000;
/** A host is gone after 3 missed keepalives. Server-side filters use the
 * same number (interval '45 seconds') — keep them in lockstep. */
export const STALE_MS = 45_000;
/** Follower drift beyond this triggers a plain seek. */
export const DRIFT_TOLERANCE_MS = 3_000;
/** Near-track-end window where an optimistically advanced follower holds
 * instead of being yanked back to a host that's about to advance too. */
export const END_GRACE_MS = 8_000;
/** Current track + up to 9 upcoming ride in each window snapshot. */
export const WINDOW_SIZE = 10;

export interface SlipstreamSnapshot {
  hostId: number;
  trackId: number;
  positionMs: number;
  playing: boolean;
  /** window[0] is the current track. */
  window: QueueTrack[];
  /** Server clock, ms epoch. Compare only against server-corrected time. */
  updatedAtMs: number;
}

/** Add to Date.now() to get server time; derived per response. */
export function clockOffset(serverNowMs: number, clientNowMs: number): number {
  return serverNowMs - clientNowMs;
}

/** Host playhead extrapolated to now (server-corrected). Paused snapshots
 * don't advance. Clamped to [0, current track duration]. */
export function expectedPositionMs(
  snap: SlipstreamSnapshot,
  correctedNowMs: number,
): number {
  const elapsed = snap.playing
    ? Math.max(0, correctedNowMs - snap.updatedAtMs)
    : 0;
  const raw = snap.positionMs + elapsed;
  const duration = snap.window[0]?.durationMs;
  const cap = duration !== undefined && duration > 0 ? duration : raw;
  return Math.min(Math.max(0, raw), cap);
}

export function isStale(
  updatedAtMs: number,
  correctedNowMs: number,
  thresholdMs: number = STALE_MS,
): boolean {
  return correctedNowMs - updatedAtMs > thresholdMs;
}

/**
 * Next window track after `afterId`, skipping ids the follower couldn't
 * stream. `afterId` absent from the window means the follower is off-map
 * (host rewrote the window) — start over from the window head. Null means
 * the window is exhausted: wait for the next poll.
 */
export function nextInWindow(
  window: readonly QueueTrack[],
  afterId: number,
  unavailable: ReadonlySet<number>,
): number | null {
  const at = window.findIndex((t) => t.id === afterId);
  const from = at === -1 ? 0 : at + 1;
  for (let i = from; i < window.length; i++) {
    if (!unavailable.has(window[i].id)) return window[i].id;
  }
  return null;
}

export interface FollowerLocal {
  trackId: number | null;
  positionMs: number;
  playing: boolean;
  /** Local pause (or 429 backoff) overrides everything but staleness. */
  userPaused: boolean;
  /** Our copy of this track ended before the host's (30s preview or shorter
   * encode) — don't re-resolve it every poll. */
  endedEarlyOn: number | null;
  /** Follower-side 422s this session. */
  unavailable: ReadonlySet<number>;
}

export type FollowAction =
  | { type: "none" }
  | { type: "seek"; toMs: number }
  | { type: "play-track"; trackId: number; atMs: number }
  | { type: "pause" }
  | { type: "resume"; atMs: number }
  | { type: "ended"; reason: "stale" };

/**
 * One poll tick → one decision. Precedence: stale > userPaused > holds >
 * track mismatch > play/pause mismatch > drift.
 */
export function planSync(
  snap: SlipstreamSnapshot,
  local: FollowerLocal,
  correctedNowMs: number,
): FollowAction {
  if (isStale(snap.updatedAtMs, correctedNowMs)) {
    return { type: "ended", reason: "stale" };
  }
  if (local.userPaused) return { type: "none" };

  const expected = expectedPositionMs(snap, correctedNowMs);

  if (local.trackId !== snap.trackId) {
    // Optimistic-advance hold: our track ended and we moved to the host's
    // next while the host is about to finish the same track — don't yank
    // the follower back for a few seconds of overlap.
    const hostDuration = snap.window[0]?.durationMs ?? 0;
    const hostNearEnd =
      snap.playing &&
      hostDuration > 0 &&
      hostDuration - expected <= END_GRACE_MS;
    const weAdvanced =
      local.trackId !== null &&
      local.trackId === nextInWindow(snap.window, snap.trackId, new Set());
    if (hostNearEnd && weAdvanced) return { type: "none" };

    // Early-end hold: our copy of the host's current track ended already
    // (preview/short encode) — re-resolving it every poll would burn quota.
    if (local.endedEarlyOn === snap.trackId) return { type: "none" };

    const target = local.unavailable.has(snap.trackId)
      ? nextInWindow(snap.window, snap.trackId, local.unavailable)
      : snap.trackId;
    if (target === null) return { type: "none" }; // window exhausted for us
    if (target === local.trackId) return { type: "none" }; // already there
    return {
      type: "play-track",
      trackId: target,
      atMs: target === snap.trackId ? expected : 0,
    };
  }

  if (!snap.playing && local.playing) return { type: "pause" };
  if (snap.playing && !local.playing) return { type: "resume", atMs: expected };
  if (!snap.playing && !local.playing) return { type: "none" };

  if (Math.abs(local.positionMs - expected) > DRIFT_TOLERANCE_MS) {
    return { type: "seek", toMs: expected };
  }
  return { type: "none" };
}

// ------------------------------------------------------------- heartbeat

export interface Heartbeat {
  trackId: number;
  positionMs: number;
  playing: boolean;
  /** null = keepalive without a window (server keeps the stored one). */
  window: QueueTrack[] | null;
  /** Present only while hosting a shared session: the host's last-seen
   * queue revision. Its absence on any beat deletes the sender's session
   * row server-side, so stale sessions self-heal. */
  sharedRev?: number;
  /** Last control_seq the host has applied (rides with sharedRev). */
  controlSeq?: number;
}

const MAX_STRING = 500;

/** Link-context fields are rendered as SoundCloud attribution links in every
 * participant's DOM. Keep them on canonical HTTPS SoundCloud hosts so a
 * member cannot store a phishing URL under trusted-looking link text. */
function isSoundCloudUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_STRING) {
    return false;
  }
  try {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      u.username === "" &&
      u.password === "" &&
      (u.hostname === "soundcloud.com" || u.hostname.endsWith(".soundcloud.com"))
    );
  } catch {
    return false;
  }
}

/** Artwork is rendered as <img src> — restrict to the SoundCloud CDN
 * (matches next.config remotePatterns) so a host can't point followers'
 * browsers at an arbitrary tracker/host. Null = no artwork. */
function isArtworkUrl(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== "string" || v.length > MAX_STRING) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.endsWith(".sndcdn.com");
  } catch {
    return false;
  }
}

function isWindowEntry(v: unknown): v is QueueTrack {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === "number" &&
    Number.isSafeInteger(t.id) &&
    t.id > 0 &&
    typeof t.title === "string" &&
    t.title.length <= MAX_STRING &&
    typeof t.artist === "string" &&
    t.artist.length <= MAX_STRING &&
    (t.artistId === undefined ||
      (typeof t.artistId === "number" &&
        Number.isSafeInteger(t.artistId) &&
        t.artistId > 0)) &&
    isSoundCloudUrl(t.artistUrl) &&
    isArtworkUrl(t.artworkUrl) &&
    isSoundCloudUrl(t.permalinkUrl) &&
    typeof t.durationMs === "number" &&
    Number.isSafeInteger(t.durationMs) &&
    t.durationMs >= 0 &&
    t.durationMs <= 24 * 60 * 60 * 1000
  );
}

/**
 * Validated, stripped parse of a wire QueueTrack[]; null on any violation.
 * Canonical validation for member-supplied track metadata that other
 * members' browsers will render (slipstream windows, shared-session
 * queues) — nothing beyond the QueueTrack shape survives.
 */
export function parseQueueTracks(
  v: unknown,
  max: number,
): QueueTrack[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  if (!v.every(isWindowEntry)) return null;
  return v.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    ...(typeof t.artistId === "number" ? { artistId: t.artistId } : {}),
    artistUrl: t.artistUrl,
    artworkUrl: t.artworkUrl,
    permalinkUrl: t.permalinkUrl,
    durationMs: t.durationMs,
  }));
}

const isCounter = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Validated parse of a heartbeat body; null on any shape violation. Strips
 * unknown fields so nothing beyond the QueueTrack shape reaches the DB. */
export function parseHeartbeat(body: unknown): Heartbeat | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.trackId !== "number" ||
    !Number.isSafeInteger(b.trackId) ||
    b.trackId <= 0 ||
    typeof b.positionMs !== "number" ||
    !Number.isFinite(b.positionMs) ||
    b.positionMs < 0 ||
    b.positionMs > 24 * 60 * 60 * 1000 ||
    typeof b.playing !== "boolean"
  ) {
    return null;
  }
  let window: QueueTrack[] | null = null;
  if (b.window !== undefined && b.window !== null) {
    window = parseQueueTracks(b.window, WINDOW_SIZE);
    if (window === null) return null;
    if (window.length > 0 && window[0].id !== b.trackId) return null;
  }
  if (b.sharedRev !== undefined && !isCounter(b.sharedRev)) return null;
  if (b.controlSeq !== undefined && !isCounter(b.controlSeq)) return null;
  return {
    trackId: b.trackId,
    positionMs: Math.floor(b.positionMs),
    playing: b.playing,
    window,
    ...(b.sharedRev !== undefined ? { sharedRev: b.sharedRev } : {}),
    ...(b.controlSeq !== undefined ? { controlSeq: b.controlSeq } : {}),
  };
}
