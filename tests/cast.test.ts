import { describe, expect, test } from "bun:test";
import {
  RETRY_MIN_PROGRESS_MS,
  canStartCasting,
  castPositionMs,
  isStreamUrl,
  parseReceiverMessage,
  parseSenderMessage,
  shouldReresolve,
  type CastPlayhead,
} from "../lib/cast";

const track = {
  id: 42,
  title: "night drive",
  artist: "someone",
  artistUrl: "https://soundcloud.com/someone",
  artworkUrl: "https://i1.sndcdn.com/artworks-x-large.jpg",
  permalinkUrl: "https://soundcloud.com/someone/night-drive",
  durationMs: 180_000,
};

const load = {
  type: "load",
  trackId: 42,
  url: "https://cf-media.sndcdn.com/abc123?Policy=x&Signature=y",
  protocol: "hls",
  positionMs: 1_500.7,
  gainDb: -3.5,
  track,
};

describe("isStreamUrl", () => {
  test("accepts signed CDN hosts", () => {
    expect(isStreamUrl("https://cf-media.sndcdn.com/x?sig=1")).toBe(true);
    expect(isStreamUrl("https://playback.media-streaming.soundcloud.cloud/x")).toBe(
      true,
    );
    expect(isStreamUrl("https://sndcdn.com/x")).toBe(true);
  });

  test("rejects other hosts, schemes, and credential smuggling", () => {
    expect(isStreamUrl("https://evil.com/x")).toBe(false);
    expect(isStreamUrl("https://sndcdn.com.evil.com/x")).toBe(false);
    expect(isStreamUrl("http://cf-media.sndcdn.com/x")).toBe(false);
    expect(isStreamUrl("https://user:pw@cf-media.sndcdn.com/x")).toBe(false);
    expect(isStreamUrl("not a url")).toBe(false);
    expect(isStreamUrl("")).toBe(false);
    expect(isStreamUrl(42)).toBe(false);
    expect(isStreamUrl(`https://sndcdn.com/${"a".repeat(4100)}`)).toBe(false);
  });
});

describe("parseSenderMessage", () => {
  test("accepts a full load and floors the position", () => {
    const m = parseSenderMessage(load);
    expect(m).not.toBeNull();
    if (m?.type !== "load") throw new Error("expected load");
    expect(m.positionMs).toBe(1_500);
    expect(m.gainDb).toBe(-3.5);
    expect(m.track.id).toBe(42);
  });

  test("strips unknown fields from load tracks", () => {
    const m = parseSenderMessage({
      ...load,
      track: { ...track, evil: "<script>" },
    });
    if (m?.type !== "load") throw new Error("expected load");
    expect("evil" in m.track).toBe(false);
  });

  test("rejects a load whose track id disagrees", () => {
    expect(
      parseSenderMessage({ ...load, track: { ...track, id: 7 } }),
    ).toBeNull();
  });

  test("rejects bad urls, protocols, gains, and positions", () => {
    expect(parseSenderMessage({ ...load, url: "https://evil.com/x" })).toBeNull();
    expect(parseSenderMessage({ ...load, protocol: "dash" })).toBeNull();
    expect(parseSenderMessage({ ...load, gainDb: Infinity })).toBeNull();
    expect(parseSenderMessage({ ...load, gainDb: 25 })).toBeNull();
    expect(parseSenderMessage({ ...load, positionMs: -1 })).toBeNull();
    expect(
      parseSenderMessage({ ...load, positionMs: 25 * 60 * 60 * 1000 }),
    ).toBeNull();
    expect(parseSenderMessage({ ...load, trackId: 0 })).toBeNull();
    expect(parseSenderMessage({ ...load, trackId: 1.5 })).toBeNull();
  });

  test("rejects a load with malformed track metadata", () => {
    expect(
      parseSenderMessage({
        ...load,
        track: { ...track, permalinkUrl: "https://evil.com/t" },
      }),
    ).toBeNull();
    expect(parseSenderMessage({ ...load, track: null })).toBeNull();
  });

  test("transport messages parse bare", () => {
    expect(parseSenderMessage({ type: "play" })).toEqual({ type: "play" });
    expect(parseSenderMessage({ type: "pause" })).toEqual({ type: "pause" });
    expect(parseSenderMessage({ type: "stop" })).toEqual({ type: "stop" });
    expect(parseSenderMessage({ type: "seek", ms: 9_000.9 })).toEqual({
      type: "seek",
      ms: 9_000,
    });
    expect(parseSenderMessage({ type: "seek", ms: -1 })).toBeNull();
  });

  test("unknown types and non-objects are null", () => {
    expect(parseSenderMessage({ type: "scene", mode: "bars" })).toBeNull();
    expect(parseSenderMessage(null)).toBeNull();
    expect(parseSenderMessage("load")).toBeNull();
    expect(parseSenderMessage(undefined)).toBeNull();
  });
});

describe("parseReceiverMessage", () => {
  test("accepts the four kinds", () => {
    expect(parseReceiverMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(
      parseReceiverMessage({
        type: "status",
        trackId: 42,
        positionMs: 10_500.4,
        playing: true,
        buffering: false,
      }),
    ).toEqual({
      type: "status",
      trackId: 42,
      positionMs: 10_500,
      playing: true,
      buffering: false,
    });
    expect(parseReceiverMessage({ type: "ended", trackId: 42 })).toEqual({
      type: "ended",
      trackId: 42,
    });
    expect(
      parseReceiverMessage({ type: "error", trackId: 42, code: "load" }),
    ).toEqual({ type: "error", trackId: 42, code: "load" });
  });

  test("rejects malformed statuses and unknown error codes", () => {
    expect(
      parseReceiverMessage({
        type: "status",
        trackId: 42,
        positionMs: 1,
        playing: "yes",
        buffering: false,
      }),
    ).toBeNull();
    expect(
      parseReceiverMessage({ type: "error", trackId: 42, code: "expired" }),
    ).toBeNull();
    expect(parseReceiverMessage({ type: "ended", trackId: -1 })).toBeNull();
    expect(parseReceiverMessage({ type: "boop" })).toBeNull();
    expect(parseReceiverMessage(null)).toBeNull();
  });
});

describe("castPositionMs", () => {
  const at = 1_000_000;
  const playhead = (over: Partial<CastPlayhead> = {}): CastPlayhead => ({
    trackId: 42,
    positionMs: 30_000,
    playing: true,
    atLocalMs: at,
    ...over,
  });

  test("extrapolates while playing", () => {
    expect(castPositionMs(playhead(), at + 2_500)).toBe(32_500);
  });

  test("paused beats do not advance", () => {
    expect(castPositionMs(playhead({ playing: false }), at + 60_000)).toBe(
      30_000,
    );
  });

  test("clock skew (beat from the future) never rewinds", () => {
    expect(castPositionMs(playhead(), at - 5_000)).toBe(30_000);
  });

  test("clamps to duration when known", () => {
    expect(castPositionMs(playhead(), at + 500_000, 180_000)).toBe(180_000);
    expect(castPositionMs(playhead(), at + 500_000)).toBe(530_000);
    expect(castPositionMs(playhead(), at + 500_000, 0)).toBe(530_000);
  });
});

describe("canStartCasting", () => {
  test("truth table", () => {
    expect(canStartCasting({ following: false, hostingShared: false })).toBe(
      true,
    );
    expect(canStartCasting({ following: true, hostingShared: false })).toBe(
      false,
    );
    expect(canStartCasting({ following: false, hostingShared: true })).toBe(
      false,
    );
    expect(canStartCasting({ following: true, hostingShared: true })).toBe(
      false,
    );
  });
});

describe("shouldReresolve", () => {
  test("first failure for a track always retries", () => {
    expect(shouldReresolve(null, 42, 0)).toBe(true);
    expect(shouldReresolve({ trackId: 7, positionMs: 0 }, 42, 0)).toBe(true);
  });

  test("same track at the same spot is a loop — no retry", () => {
    expect(shouldReresolve({ trackId: 42, positionMs: 0 }, 42, 0)).toBe(false);
    expect(
      shouldReresolve(
        { trackId: 42, positionMs: 10_000 },
        42,
        10_000 + RETRY_MIN_PROGRESS_MS - 1,
      ),
    ).toBe(false);
  });

  test("meaningful progress since the last retry earns another", () => {
    expect(
      shouldReresolve(
        { trackId: 42, positionMs: 10_000 },
        42,
        10_000 + RETRY_MIN_PROGRESS_MS,
      ),
    ).toBe(true);
  });

  test("a rewind (seek back then error) does not retry", () => {
    expect(shouldReresolve({ trackId: 42, positionMs: 60_000 }, 42, 0)).toBe(
      false,
    );
  });
});
