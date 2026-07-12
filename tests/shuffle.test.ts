import { describe, expect, test } from "bun:test";
import {
  seededShuffle,
  shuffleOrder,
  type ShuffleContext,
} from "../lib/queue";

const IDS = Array.from({ length: 12 }, (_, i) => (i + 1) * 10);

// 3 artists × 4 tracks: 10,20,30,40 → a; 50..80 → b; 90..120 → c.
const ARTISTS = new Map<number, string>(
  IDS.map((id, i) => [id, ["a", "b", "c"][Math.floor(i / 4)]]),
);
const artistOf = (id: number) => ARTISTS.get(id);

const SEEDS = Array.from({ length: 20 }, (_, i) => i * 7 + 1);

function isPermutation(out: number[], ids: readonly number[]): boolean {
  return out.length === ids.length && new Set(out).size === ids.length &&
    out.every((id) => ids.includes(id));
}

describe("shuffleOrder / classic", () => {
  test("is byte-identical to seededShuffle + pin (persisted-queue lock)", () => {
    for (const seed of SEEDS) {
      const legacy = seededShuffle(IDS, seed);
      const pinned = [50, ...legacy.filter((id) => id !== 50)];
      expect(shuffleOrder(IDS, { mode: "classic", seed, first: 50 })).toEqual(
        pinned,
      );
      expect(shuffleOrder(IDS, { mode: "classic", seed })).toEqual(legacy);
    }
  });
});

describe("shuffleOrder / artist-spaced", () => {
  const ctx: ShuffleContext = { artistOf };

  test("never plays the same artist back-to-back", () => {
    for (const seed of SEEDS) {
      const out = shuffleOrder(IDS, { mode: "artist-spaced", seed, ctx });
      expect(isPermutation(out, IDS)).toBe(true);
      for (let i = 1; i < out.length; i++) {
        expect(artistOf(out[i])).not.toBe(artistOf(out[i - 1]));
      }
    }
  });

  test("is deterministic per seed", () => {
    const a = shuffleOrder(IDS, { mode: "artist-spaced", seed: 42, ctx });
    const b = shuffleOrder(IDS, { mode: "artist-spaced", seed: 42, ctx });
    expect(a).toEqual(b);
  });

  test("keeps the start track at index 0", () => {
    for (const seed of SEEDS) {
      const out = shuffleOrder(IDS, {
        mode: "artist-spaced",
        seed,
        first: 70,
        ctx,
      });
      expect(out[0]).toBe(70);
      expect(isPermutation(out, IDS)).toBe(true);
    }
  });

  test("all-same-artist input terminates and stays a permutation", () => {
    const mono: ShuffleContext = { artistOf: () => "same" };
    const out = shuffleOrder(IDS, { mode: "artist-spaced", seed: 3, ctx: mono });
    expect(isPermutation(out, IDS)).toBe(true);
  });

  test("missing artist data degrades to classic", () => {
    const empty: ShuffleContext = { artistOf: () => undefined };
    const out = shuffleOrder(IDS, { mode: "artist-spaced", seed: 5, ctx: empty });
    expect(out).toEqual(shuffleOrder(IDS, { mode: "classic", seed: 5 }));
  });

  test("no ctx at all degrades to classic", () => {
    const out = shuffleOrder(IDS, { mode: "artist-spaced", seed: 5 });
    expect(out).toEqual(shuffleOrder(IDS, { mode: "classic", seed: 5 }));
  });
});

describe("shuffleOrder / rediscovery", () => {
  const NOW = Date.parse("2026-07-12T00:00:00Z");
  const DAY = 86_400_000;

  // First half of IDS: never played. Second half: played a lot, recently.
  const heavyPlays: ShuffleContext = {
    now: NOW,
    playsOf: (id) =>
      IDS.indexOf(id) < 6
        ? undefined
        : { playCount: 25, lastPlayedAt: NOW - DAY },
  };

  test("is deterministic per seed and a permutation", () => {
    const a = shuffleOrder(IDS, { mode: "rediscovery", seed: 9, ctx: heavyPlays });
    const b = shuffleOrder(IDS, { mode: "rediscovery", seed: 9, ctx: heavyPlays });
    expect(a).toEqual(b);
    expect(isPermutation(a, IDS)).toBe(true);
  });

  test("front-loads never-played tracks on average", () => {
    let neverSum = 0;
    let playedSum = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const out = shuffleOrder(IDS, { mode: "rediscovery", seed, ctx: heavyPlays });
      out.forEach((id, idx) => {
        if (IDS.indexOf(id) < 6) neverSum += idx;
        else playedSum += idx;
      });
    }
    // Same track counts per group, so mean index comparison is fair.
    expect(neverSum / (6 * 50)).toBeLessThan(playedSum / (6 * 50) - 1);
  });

  test("stale plays outrank fresh plays of equal count", () => {
    const half = IDS.length / 2;
    const ctx: ShuffleContext = {
      now: NOW,
      playsOf: (id) => ({
        playCount: 5,
        lastPlayedAt: IDS.indexOf(id) < half ? NOW - 90 * DAY : NOW - DAY,
      }),
    };
    let staleSum = 0;
    let freshSum = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const out = shuffleOrder(IDS, { mode: "rediscovery", seed, ctx });
      out.forEach((id, idx) => {
        if (IDS.indexOf(id) < half) staleSum += idx;
        else freshSum += idx;
      });
    }
    expect(staleSum / (half * 50)).toBeLessThan(freshSum / (half * 50));
  });

  test("missing play data still yields a valid shuffle", () => {
    const out = shuffleOrder(IDS, { mode: "rediscovery", seed: 4 });
    expect(isPermutation(out, IDS)).toBe(true);
  });

  test("keeps the start track at index 0", () => {
    const out = shuffleOrder(IDS, {
      mode: "rediscovery",
      seed: 8,
      first: 110,
      ctx: heavyPlays,
    });
    expect(out[0]).toBe(110);
  });
});
