import { describe, expect, test } from "bun:test";
import type { QueueTrack } from "../lib/queue";
import {
  DRIFT_TOLERANCE_MS,
  END_GRACE_MS,
  STALE_MS,
  WINDOW_SIZE,
  clockOffset,
  expectedPositionMs,
  isStale,
  nextInWindow,
  parseHeartbeat,
  planSync,
  type FollowerLocal,
  type SlipstreamSnapshot,
} from "../lib/slipstream";

const T0 = 1_700_000_000_000; // fixed epoch base for all clocks

function track(id: number, durationMs = 200_000): QueueTrack {
  return {
    id,
    title: `track ${id}`,
    artist: `artist ${id}`,
    artistUrl: `https://soundcloud.com/a${id}`,
    artworkUrl: null,
    permalinkUrl: `https://soundcloud.com/a${id}/t${id}`,
    durationMs,
  };
}

function snap(over: Partial<SlipstreamSnapshot> = {}): SlipstreamSnapshot {
  return {
    hostId: 1,
    trackId: 10,
    positionMs: 60_000,
    playing: true,
    window: [track(10), track(20), track(30)],
    updatedAtMs: T0,
    ...over,
  };
}

function local(over: Partial<FollowerLocal> = {}): FollowerLocal {
  return {
    trackId: 10,
    positionMs: 60_000,
    playing: true,
    userPaused: false,
    endedEarlyOn: null,
    unavailable: new Set<number>(),
    ...over,
  };
}

describe("clockOffset", () => {
  test("round trips server time", () => {
    const offset = clockOffset(T0 + 2_500, T0);
    expect(T0 + offset).toBe(T0 + 2_500);
    expect(clockOffset(T0, T0 + 1_000)).toBe(-1_000);
  });
});

describe("expectedPositionMs", () => {
  test("extrapolates while playing", () => {
    expect(expectedPositionMs(snap(), T0 + 4_000)).toBe(64_000);
  });

  test("frozen while paused", () => {
    expect(expectedPositionMs(snap({ playing: false }), T0 + 60_000)).toBe(
      60_000,
    );
  });

  test("clamps to track duration", () => {
    expect(expectedPositionMs(snap(), T0 + 500_000)).toBe(200_000);
  });

  test("clamps below zero and ignores skewed past clocks", () => {
    expect(expectedPositionMs(snap({ positionMs: 0 }), T0 - 10_000)).toBe(0);
  });

  test("uncapped when the window is empty", () => {
    expect(expectedPositionMs(snap({ window: [] }), T0 + 4_000)).toBe(64_000);
  });
});

describe("isStale", () => {
  test("boundary: exactly STALE_MS is fresh, beyond is stale", () => {
    expect(isStale(T0, T0 + STALE_MS)).toBe(false);
    expect(isStale(T0, T0 + STALE_MS + 1)).toBe(true);
  });
});

describe("nextInWindow", () => {
  const window = [track(10), track(20), track(30)];

  test("advances to the next entry", () => {
    expect(nextInWindow(window, 10, new Set())).toBe(20);
    expect(nextInWindow(window, 20, new Set())).toBe(30);
  });

  test("skips unavailable entries", () => {
    expect(nextInWindow(window, 10, new Set([20]))).toBe(30);
  });

  test("null at window end or when all remaining are unavailable", () => {
    expect(nextInWindow(window, 30, new Set())).toBeNull();
    expect(nextInWindow(window, 10, new Set([20, 30]))).toBeNull();
  });

  test("unknown afterId restarts from the window head", () => {
    expect(nextInWindow(window, 999, new Set())).toBe(10);
    expect(nextInWindow(window, 999, new Set([10]))).toBe(20);
  });
});

describe("planSync", () => {
  test("stale snapshot ends the follow (and beats userPaused)", () => {
    expect(
      planSync(snap(), local({ userPaused: true }), T0 + STALE_MS + 1),
    ).toEqual({ type: "ended", reason: "stale" });
  });

  test("userPaused holds everything else (even track mismatch)", () => {
    expect(
      planSync(snap({ trackId: 20 }), local({ userPaused: true }), T0 + 1_000),
    ).toEqual({ type: "none" });
  });

  test("track mismatch switches at the host's expected position", () => {
    const action = planSync(
      snap({ trackId: 20, window: [track(20), track(30)], positionMs: 5_000 }),
      local({ trackId: 10 }),
      T0 + 2_000,
    );
    expect(action).toEqual({ type: "play-track", trackId: 20, atMs: 7_000 });
  });

  test("host current unavailable for us: play next window entry from 0", () => {
    const action = planSync(
      snap({ trackId: 20, window: [track(20), track(30)] }),
      local({ trackId: 10, unavailable: new Set([20]) }),
      T0 + 1_000,
    );
    expect(action).toEqual({ type: "play-track", trackId: 30, atMs: 0 });
  });

  test("window exhausted for us: hold", () => {
    const action = planSync(
      snap({ trackId: 20, window: [track(20)] }),
      local({ trackId: 10, unavailable: new Set([20]) }),
      T0 + 1_000,
    );
    expect(action).toEqual({ type: "none" });
  });

  test("optimistic-advance hold inside END_GRACE_MS", () => {
    // Host is 5s from track end; we already advanced to its next track.
    const s = snap({ positionMs: 195_000 });
    const action = planSync(s, local({ trackId: 20, positionMs: 1_000 }), T0);
    expect(action).toEqual({ type: "none" });
  });

  test("no hold outside END_GRACE_MS: pulled back to the host's track", () => {
    const s = snap({ positionMs: 200_000 - END_GRACE_MS - 5_000 });
    const action = planSync(s, local({ trackId: 20, positionMs: 1_000 }), T0);
    expect(action).toEqual({
      type: "play-track",
      trackId: 10,
      atMs: 200_000 - END_GRACE_MS - 5_000,
    });
  });

  test("early-end hold: never re-resolves a track our copy finished", () => {
    const action = planSync(
      snap(),
      local({ trackId: 20, endedEarlyOn: 10 }),
      T0 + 1_000,
    );
    expect(action).toEqual({ type: "none" });
  });

  test("host paused, local playing: pause", () => {
    expect(planSync(snap({ playing: false }), local(), T0 + 1_000)).toEqual({
      type: "pause",
    });
  });

  test("host playing, local paused (not user-initiated): resume at expected", () => {
    expect(
      planSync(snap(), local({ playing: false, positionMs: 0 }), T0 + 2_000),
    ).toEqual({ type: "resume", atMs: 62_000 });
  });

  test("both paused: none", () => {
    expect(
      planSync(snap({ playing: false }), local({ playing: false }), T0 + 1_000),
    ).toEqual({ type: "none" });
  });

  test("drift just inside tolerance: none", () => {
    const action = planSync(
      snap(),
      local({ positionMs: 60_000 + DRIFT_TOLERANCE_MS }),
      T0,
    );
    expect(action).toEqual({ type: "none" });
  });

  test("drift beyond tolerance: seek to expected", () => {
    const action = planSync(
      snap(),
      local({ positionMs: 60_000 + DRIFT_TOLERANCE_MS + 1_000 }),
      T0,
    );
    expect(action).toEqual({ type: "seek", toMs: 60_000 });
  });
});

describe("parseHeartbeat", () => {
  const valid = {
    trackId: 10,
    positionMs: 1234.7,
    playing: true,
    window: [track(10), track(20)],
  };

  test("accepts a valid beat and floors positionMs", () => {
    const hb = parseHeartbeat(valid);
    expect(hb).not.toBeNull();
    expect(hb!.positionMs).toBe(1234);
    expect(hb!.window!.map((t) => t.id)).toEqual([10, 20]);
  });

  test("keepalive without window parses with window null", () => {
    const hb = parseHeartbeat({ trackId: 10, positionMs: 0, playing: true });
    expect(hb).toEqual({
      trackId: 10,
      positionMs: 0,
      playing: true,
      window: null,
    });
  });

  test("strips unknown fields from window entries", () => {
    const hb = parseHeartbeat({
      ...valid,
      window: [{ ...track(10), streamUrl: "https://evil" }],
    });
    expect(hb!.window![0]).not.toHaveProperty("streamUrl");
  });

  test("rejects malformed shapes", () => {
    expect(parseHeartbeat(null)).toBeNull();
    expect(parseHeartbeat("hi")).toBeNull();
    expect(parseHeartbeat({ ...valid, trackId: "10" })).toBeNull();
    expect(parseHeartbeat({ ...valid, positionMs: -5 })).toBeNull();
    expect(parseHeartbeat({ ...valid, playing: 1 })).toBeNull();
    expect(parseHeartbeat({ ...valid, window: [{ id: 10 }] })).toBeNull();
  });

  test("rejects unsafe or database-incompatible numeric fields", () => {
    expect(parseHeartbeat({ ...valid, trackId: -1 })).toBeNull();
    expect(parseHeartbeat({ ...valid, trackId: Number.MAX_VALUE })).toBeNull();
    expect(parseHeartbeat({ ...valid, positionMs: 86_400_001 })).toBeNull();
  });

  test("rejects a javascript: url in a link field (stored XSS guard)", () => {
    expect(
      parseHeartbeat({
        ...valid,
        window: [{ ...track(10), permalinkUrl: "javascript:alert(1)" }],
      }),
    ).toBeNull();
    expect(
      parseHeartbeat({
        ...valid,
        window: [{ ...track(10), artistUrl: "javascript:alert(1)" }],
      }),
    ).toBeNull();
  });

  test("rejects non-SoundCloud and spoofed attribution links", () => {
    for (const permalinkUrl of [
      "https://attacker.example/track",
      "http://soundcloud.com/artist/track",
      "https://soundcloud.com@attacker.example/track",
    ]) {
      expect(
        parseHeartbeat({
          ...valid,
          window: [{ ...track(10), permalinkUrl }],
        }),
      ).toBeNull();
    }
    expect(
      parseHeartbeat({
        ...valid,
        window: [
          { ...track(10), artistUrl: "https://m.soundcloud.com/artist" },
        ],
      }),
    ).not.toBeNull();
  });

  test("rejects a non-CDN artwork host, accepts sndcdn + null", () => {
    expect(
      parseHeartbeat({
        ...valid,
        window: [{ ...track(10), artworkUrl: "https://evil.example/x.gif" }],
      }),
    ).toBeNull();
    // http (non-https) sndcdn is also rejected
    expect(
      parseHeartbeat({
        ...valid,
        window: [{ ...track(10), artworkUrl: "http://i1.sndcdn.com/x.jpg" }],
      }),
    ).toBeNull();
    const ok = parseHeartbeat({
      ...valid,
      window: [
        { ...track(10), artworkUrl: "https://i1.sndcdn.com/artworks-x.jpg" },
        track(20),
      ],
    });
    expect(ok).not.toBeNull();
    expect(ok!.window![0].artworkUrl).toBe(
      "https://i1.sndcdn.com/artworks-x.jpg",
    );
  });

  test("rejects an oversized window", () => {
    const window = Array.from({ length: WINDOW_SIZE + 1 }, (_, i) =>
      track(i + 1),
    );
    expect(
      parseHeartbeat({ trackId: 1, positionMs: 0, playing: true, window }),
    ).toBeNull();
  });

  test("rejects window[0] not matching trackId", () => {
    expect(
      parseHeartbeat({ ...valid, window: [track(20), track(10)] }),
    ).toBeNull();
  });

  test("rejects oversized strings", () => {
    const t = { ...track(10), title: "x".repeat(501) };
    expect(parseHeartbeat({ ...valid, window: [t] })).toBeNull();
  });
});
