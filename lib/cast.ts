/**
 * Pure cast engine — wire protocol, position extrapolation, gating, and
 * retry policy for Google Cast. The sender resolves streams through the
 * normal quota path and ships the signed CDN URL plus track metadata to
 * the receiver page (app/cast) over a device-local custom message
 * channel; the receiver plays it with its own audio element and reports
 * status back. No fetch, no DOM, injectable clocks (the slipstream
 * precedent).
 */

import type { QueueTrack } from "./queue";
import { parseQueueTracks } from "./slipstream";
import { isStageMode, type StageMode } from "./stage";

/** Custom message channel both sides speak (type-discriminated JSON). */
export const CAST_NAMESPACE = "urn:x-cast:com.nimbus.cast";

/** Receiver → sender status cadence while a track is loaded. */
export const STATUS_BEAT_MS = 1_000;

/** Rendering profile for TV hardware: the Cast runtime's CPU budget is
 * small, and at couch distance a soft upscale is invisible — so the
 * receiver caps frame rate, renders at reduced resolution (dpr < 1),
 * and thins the spectrum instead of dropping frames. Tuned on a Google
 * TV Streamer (2026-07: dpr 1 / 48 bars read as laggy). */
export const TV_PROFILE = {
  maxFps: 30,
  dpr: 0.75,
  barCount: 40,
} as const;

// ------------------------------------------------------------------ wire

export type CastProtocol = "progressive" | "hls" | "unknown";

/** Up-next entries shipped to the TV (display only — the queue brain
 * stays on the sender). */
export const UPNEXT_MAX = 5;

/** Sender → receiver. `load` replaces whatever is playing; transport
 * messages apply to the loaded track and are otherwise ignored. */
export type SenderMessage =
  | {
      type: "load";
      trackId: number;
      url: string;
      protocol: CastProtocol;
      positionMs: number;
      /** Leveler make-up gain from the sender's loudness cache (dB);
       * 0 when unknown. The receiver has no measurement history. */
      gainDb: number;
      track: QueueTrack;
    }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; ms: number }
  | { type: "stop" }
  /** Switch the TV's stage mode ("art" or a viz scene). */
  | { type: "scene"; mode: StageMode }
  /** Replace the TV's up-next strip (empty clears it). */
  | { type: "upnext"; tracks: QueueTrack[] };

/** Receiver → sender. `status` beats every STATUS_BEAT_MS and on every
 * transition; `ended`/`error` hand control back to the sender's queue. */
export type ReceiverMessage =
  | { type: "ready" }
  | {
      type: "status";
      trackId: number;
      positionMs: number;
      playing: boolean;
      buffering: boolean;
    }
  | { type: "ended"; trackId: number }
  | { type: "error"; trackId: number; code: "load" | "stall" };

const MAX_POSITION_MS = 24 * 60 * 60 * 1000;

const isTrackId = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

const isPositionMs = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= MAX_POSITION_MS;

/** The receiver hands this straight to its audio element / hls.js — keep
 * it on the signed-CDN hosts the play route can actually return (matches
 * the server-side origin validation in lib/soundcloud/api.ts). */
export function isStreamUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 4096) {
    return false;
  }
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username !== "" || u.password !== "") {
      return false;
    }
    const h = u.hostname;
    return (
      h === "sndcdn.com" ||
      h.endsWith(".sndcdn.com") ||
      h === "soundcloud.cloud" ||
      h.endsWith(".soundcloud.cloud")
    );
  } catch {
    return false;
  }
}

const isProtocol = (v: unknown): v is CastProtocol =>
  v === "progressive" || v === "hls" || v === "unknown";

/** Validated, stripped parse of a sender message; null on any violation
 * (including unknown types — the receiver ignores what it doesn't know,
 * which is also what makes future message kinds safe to add). */
export function parseSenderMessage(v: unknown): SenderMessage | null {
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  switch (m.type) {
    case "load": {
      if (
        !isTrackId(m.trackId) ||
        !isStreamUrl(m.url) ||
        !isProtocol(m.protocol) ||
        !isPositionMs(m.positionMs) ||
        typeof m.gainDb !== "number" ||
        !Number.isFinite(m.gainDb) ||
        Math.abs(m.gainDb) > 24
      ) {
        return null;
      }
      const tracks = parseQueueTracks([m.track], 1);
      if (tracks === null || tracks[0].id !== m.trackId) return null;
      return {
        type: "load",
        trackId: m.trackId,
        url: m.url,
        protocol: m.protocol,
        positionMs: Math.floor(m.positionMs),
        gainDb: m.gainDb,
        track: tracks[0],
      };
    }
    case "play":
    case "pause":
    case "stop":
      return { type: m.type };
    case "seek":
      if (!isPositionMs(m.ms)) return null;
      return { type: "seek", ms: Math.floor(m.ms) };
    case "scene":
      if (!isStageMode(m.mode)) return null;
      return { type: "scene", mode: m.mode };
    case "upnext": {
      const tracks = parseQueueTracks(m.tracks, UPNEXT_MAX);
      if (tracks === null) return null;
      return { type: "upnext", tracks };
    }
    default:
      return null;
  }
}

/** Validated, stripped parse of a receiver message; null on any violation. */
export function parseReceiverMessage(v: unknown): ReceiverMessage | null {
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  switch (m.type) {
    case "ready":
      return { type: "ready" };
    case "status":
      if (
        !isTrackId(m.trackId) ||
        !isPositionMs(m.positionMs) ||
        typeof m.playing !== "boolean" ||
        typeof m.buffering !== "boolean"
      ) {
        return null;
      }
      return {
        type: "status",
        trackId: m.trackId,
        positionMs: Math.floor(m.positionMs),
        playing: m.playing,
        buffering: m.buffering,
      };
    case "ended":
      if (!isTrackId(m.trackId)) return null;
      return { type: "ended", trackId: m.trackId };
    case "error":
      if (!isTrackId(m.trackId)) return null;
      if (m.code !== "load" && m.code !== "stall") return null;
      return { type: "error", trackId: m.trackId, code: m.code };
    default:
      return null;
  }
}

// -------------------------------------------------------------- position

/** The sender's view of the receiver's playhead: the last status beat
 * plus when it arrived (sender-local clock). */
export interface CastPlayhead {
  trackId: number;
  positionMs: number;
  playing: boolean;
  /** Sender-local receipt time (ms epoch of the same clock as `nowMs`). */
  atLocalMs: number;
}

/** Receiver playhead extrapolated to now. Paused beats don't advance.
 * Clamped to [0, durationMs] when a duration is known. */
export function castPositionMs(
  playhead: CastPlayhead,
  nowMs: number,
  durationMs?: number,
): number {
  const elapsed = playhead.playing
    ? Math.max(0, nowMs - playhead.atLocalMs)
    : 0;
  const raw = playhead.positionMs + elapsed;
  const cap = durationMs !== undefined && durationMs > 0 ? durationMs : raw;
  return Math.min(Math.max(0, raw), cap);
}

// ---------------------------------------------------------------- gating

/** Casting swaps the audio output, but slipstream modes make some other
 * client (or clock) authoritative — keep v1's state matrix small by
 * making them mutually exclusive. Covers both shared-session roles: a
 * guest is following, a host is hostingShared. */
export function canStartCasting(opts: {
  following: boolean;
  hostingShared: boolean;
}): boolean {
  return !opts.following && !opts.hostingShared;
}

// ----------------------------------------------------------------- retry

/** How far playback must have progressed since the last retry before an
 * error is "a stale URL after listening a while" rather than a loop. */
export const RETRY_MIN_PROGRESS_MS = 30_000;

/** Decide whether a receiver error justifies burning one more play
 * resolution (each re-resolve consumes quota). At most one retry per
 * track, unless the playhead moved meaningfully since the last one — a
 * signed URL expiring mid-track is a new situation, a dead track erroring
 * at the same spot is a loop the fail streak should end instead. */
export function shouldReresolve(
  last: { trackId: number; positionMs: number } | null,
  trackId: number,
  positionMs: number,
  minProgressMs: number = RETRY_MIN_PROGRESS_MS,
): boolean {
  if (last === null || last.trackId !== trackId) return true;
  return positionMs - last.positionMs >= minProgressMs;
}
