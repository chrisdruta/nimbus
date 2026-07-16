import { describe, expect, test } from "bun:test";
import {
  RADIO_LOW_WATER,
  RADIO_MAX_TRACKS,
  canAutoContinue,
  filterFresh,
  nextSeed,
  radioSeedOf,
  radioSourceId,
  remainingPlayable,
  seedStation,
  shouldRefill,
} from "../lib/radio";
import { createQueue, integrate, next, type QueueState } from "../lib/queue";
import { CAPS, type SourceKind } from "../lib/sources";

/** Hand-built state so boundaries are explicit. */
function state(overrides: Partial<QueueState>): QueueState {
  return {
    sourceId: "radio:track:1",
    order: [],
    sourceOrder: [],
    position: -1,
    shuffled: false,
    shuffleMode: "classic",
    seed: 0,
    repeat: "off",
    history: [],
    unplayable: [],
    ...overrides,
  };
}

const range = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => from + i);

describe("radio source ids", () => {
  test("round-trip", () => {
    expect(radioSourceId(42)).toBe("radio:track:42");
    expect(radioSeedOf("radio:track:42")).toBe(42);
  });

  test("rejects non-radio and malformed ids", () => {
    expect(radioSeedOf("likes")).toBeNull();
    expect(radioSeedOf("playlist:42")).toBeNull();
    expect(radioSeedOf("radio:track:")).toBeNull();
    expect(radioSeedOf("radio:track:abc")).toBeNull();
    expect(radioSeedOf("radio:track:0")).toBeNull();
    expect(radioSeedOf("radio:track:1:2")).toBeNull();
  });
});

describe("remainingPlayable / shouldRefill", () => {
  test("counts playable tracks strictly after the position", () => {
    const q = state({ order: range(10), position: 3 });
    expect(remainingPlayable(q)).toBe(6);
  });

  test("unplayable tracks in the remainder don't count", () => {
    const q = state({ order: range(10), position: 3, unplayable: [5, 9, 2] });
    // 2 is behind the position; 5 and 9 are ahead.
    expect(remainingPlayable(q)).toBe(4);
  });

  test("refills at exactly the low-water mark, not above it", () => {
    const at = state({ order: range(RADIO_LOW_WATER + 1), position: 0 });
    expect(shouldRefill(at)).toBe(true);
    const above = state({ order: range(RADIO_LOW_WATER + 2), position: 0 });
    expect(shouldRefill(above)).toBe(false);
  });

  test("never refills at the station cap", () => {
    const q = state({
      order: range(RADIO_MAX_TRACKS),
      position: RADIO_MAX_TRACKS - 2,
    });
    expect(shouldRefill(q)).toBe(false);
  });
});

describe("nextSeed", () => {
  test("prefers current, then history newest-first, then the sourceId seed", () => {
    // Play 1 → 2 → 3 with the engine so history is real.
    let q = createQueue("radio:track:1", [1, 2, 3], { startTrackId: 1 });
    q = next(q).state;
    q = next(q).state; // now at 3, history [1, 2]
    expect(nextSeed(q, new Set())).toBe(3);
    expect(nextSeed(q, new Set([3]))).toBe(2);
    expect(nextSeed(q, new Set([3, 2]))).toBe(1);
    expect(nextSeed(q, new Set([3, 2, 1]))).toBeNull();
  });

  test("falls back to the sourceId seed when nothing has played", () => {
    const q = state({ sourceId: "radio:track:7" });
    expect(nextSeed(q, new Set())).toBe(7);
    expect(nextSeed(q, new Set([7]))).toBeNull();
  });
});

describe("canAutoContinue", () => {
  test("every source kind has an explicit auto-continue verdict", () => {
    // Total over SourceKind: adding a kind forces a decision here.
    const expected: Record<SourceKind, boolean> = {
      likes: true,
      playlist: true,
      feed: true,
      search: true,
      artist: true,
      radio: false, // self-refills
      shared: false, // not yours to extend
      slipstream: false,
      "slipstream-shared": false,
    };
    for (const kind of Object.keys(CAPS) as SourceKind[]) {
      expect(canAutoContinue(kind)).toBe(expected[kind]);
    }
  });
});

describe("seedStation", () => {
  test("builds a radio queue with the seed current, repeat off", () => {
    const q = seedStation(42, "artist-spaced");
    expect(q.sourceId).toBe("radio:track:42");
    expect(q.order).toEqual([42]);
    expect(q.position).toBe(0);
    expect(q.repeat).toBe("off");
    expect(q.shuffled).toBe(false);
    expect(q.shuffleMode).toBe("artist-spaced");
  });

  test("advance after refill lands on the first related track, not the seed", () => {
    const grown = integrate(seedStation(1, "classic"), [2, 3]);
    const { state, ended } = next(grown);
    expect(ended).toBe(false);
    expect(state.order[state.position]).toBe(2);
    expect(state.history).toEqual([1]); // seed consumed, chainable
  });

  test("a dry station stays stopped on the seed", () => {
    const { state, ended } = next(seedStation(1, "classic"));
    expect(ended).toBe(true);
    expect(state.position).toBe(0);
  });

  test("seed chaining works like a user-started station", () => {
    const grown = integrate(seedStation(1, "classic"), [2, 3]);
    const q = next(grown).state; // playing 2, history [1]
    expect(nextSeed(q, new Set())).toBe(2); // current
    expect(nextSeed(q, new Set([2]))).toBe(1); // history / original seed
    expect(nextSeed(q, new Set([2, 1]))).toBeNull();
  });
});

describe("filterFresh", () => {
  test("drops known ids, keeps candidate order, dedupes candidates", () => {
    const q = state({ order: [1, 2, 3] });
    expect(filterFresh([3, 4, 5, 4, 1, 6], q)).toEqual([4, 5, 6]);
  });

  test("truncates so the grown queue stays within the cap", () => {
    const q = state({ order: range(RADIO_MAX_TRACKS - 2) });
    const fresh = filterFresh(range(10, 10_000), q);
    expect(fresh).toEqual([10_000, 10_001]);
  });

  test("returns nothing at the cap", () => {
    const q = state({ order: range(RADIO_MAX_TRACKS) });
    expect(filterFresh([99_999], q)).toEqual([]);
  });
});
