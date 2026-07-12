import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearQueue,
  createQueue,
  currentTrackId,
  jumpTo,
  loadQueue,
  markUnplayable,
  next,
  prev,
  reconcile,
  saveQueue,
  seededShuffle,
  setRepeat,
  toggleShuffle,
  upcoming,
  type QueueState,
} from "../lib/queue";

const IDS = [10, 20, 30, 40, 50];

describe("seededShuffle", () => {
  test("is deterministic per seed", () => {
    expect(seededShuffle(IDS, 42)).toEqual(seededShuffle(IDS, 42));
  });

  test("different seeds differ (usually)", () => {
    const a = seededShuffle(IDS, 1);
    const b = seededShuffle(IDS, 2);
    expect(a).not.toEqual(b);
  });

  test("is a permutation and does not mutate input", () => {
    const input = [...IDS];
    const out = seededShuffle(input, 7);
    expect(input).toEqual(IDS);
    expect([...out].sort((a, b) => a - b)).toEqual([...IDS].sort((a, b) => a - b));
  });
});

describe("createQueue", () => {
  test("unshuffled keeps source order", () => {
    const q = createQueue("likes", IDS);
    expect(q.order).toEqual(IDS);
    expect(currentTrackId(q)).toBeNull();
  });

  test("startTrackId leads a shuffled queue", () => {
    const q = createQueue("likes", IDS, { shuffle: true, startTrackId: 30 });
    expect(q.order[0]).toBe(30);
    expect(q.position).toBe(0);
    expect(currentTrackId(q)).toBe(30);
  });

  test("startTrackId positions within unshuffled order", () => {
    const q = createQueue("likes", IDS, { startTrackId: 40 });
    expect(q.position).toBe(3);
  });
});

describe("next/prev", () => {
  test("advances and records history", () => {
    let q = createQueue("likes", IDS, { startTrackId: 10 });
    const r = next(q);
    q = r.state;
    expect(r.ended).toBe(false);
    expect(currentTrackId(q)).toBe(20);
    expect(q.history).toEqual([10]);
  });

  test("repeat off ends at the tail", () => {
    let q = createQueue("likes", IDS, { startTrackId: 50 });
    const r = next(q);
    expect(r.ended).toBe(true);
    expect(currentTrackId(r.state)).toBe(50);
  });

  test("repeat all wraps to the head", () => {
    let q = setRepeat(createQueue("likes", IDS, { startTrackId: 50 }), "all");
    const r = next(q);
    expect(r.ended).toBe(false);
    expect(currentTrackId(r.state)).toBe(10);
  });

  test("repeat one stays put but still logs history", () => {
    let q = setRepeat(createQueue("likes", IDS, { startTrackId: 30 }), "one");
    const r = next(q);
    expect(r.ended).toBe(false);
    expect(currentTrackId(r.state)).toBe(30);
    expect(r.state.history).toEqual([30]);
  });

  test("prev pops history first", () => {
    let q = createQueue("likes", IDS, { startTrackId: 10 });
    q = next(q).state; // at 20, history [10]
    q = jumpTo(q, 50); // history [10, 20]
    q = prev(q);
    expect(currentTrackId(q)).toBe(20);
    q = prev(q);
    expect(currentTrackId(q)).toBe(10);
  });

  test("prev without history steps back in order and stops at head", () => {
    let q = createQueue("likes", IDS, { startTrackId: 20 });
    q = prev(q);
    expect(currentTrackId(q)).toBe(10);
    expect(prev(q)).toBe(q); // unchanged at the head
  });
});

describe("unplayable handling", () => {
  test("next skips marked tracks", () => {
    let q = createQueue("likes", IDS, { startTrackId: 10 });
    q = markUnplayable(q, 20);
    q = markUnplayable(q, 30);
    const r = next(q);
    expect(currentTrackId(r.state)).toBe(40);
  });

  test("ends when everything remaining is unplayable", () => {
    let q = createQueue("likes", [10, 20], { startTrackId: 10 });
    q = markUnplayable(q, 20);
    expect(next(q).ended).toBe(true);
  });

  test("upcoming excludes unplayable", () => {
    let q = createQueue("likes", IDS, { startTrackId: 10 });
    q = markUnplayable(q, 30);
    expect(upcoming(q, 3)).toEqual([20, 40, 50]);
  });
});

describe("toggleShuffle", () => {
  test("on keeps current first; off restores source order", () => {
    let q = createQueue("likes", IDS, { startTrackId: 30 });
    q = toggleShuffle(q);
    expect(q.shuffled).toBe(true);
    expect(currentTrackId(q)).toBe(30);
    expect(q.order[0]).toBe(30);
    q = toggleShuffle(q);
    expect(q.shuffled).toBe(false);
    expect(q.order).toEqual(IDS);
    expect(currentTrackId(q)).toBe(30);
  });
});

describe("reconcile", () => {
  test("drops vanished ids and appends new ones", () => {
    let q = createQueue("likes", IDS, { shuffle: true, startTrackId: 30 });
    q = reconcile(q, [20, 30, 40, 60]); // 10,50 gone; 60 new
    expect(currentTrackId(q)).toBe(30);
    expect(q.order).not.toContain(10);
    expect(q.order).not.toContain(50);
    expect(q.order[q.order.length - 1]).toBe(60);
    expect(q.sourceOrder).toEqual([20, 30, 40, 60]);
  });
});

describe("persistence", () => {
  // bun test runs without a DOM; stub the localStorage surface saveQueue uses.
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
  });

  test("round-trips state and snapshot", () => {
    const q = createQueue("playlist:9", IDS, { shuffle: true, startTrackId: 20 });
    const snapshot = {
      id: 20,
      title: "t",
      artist: "a",
      artistUrl: "",
      artworkUrl: null,
      permalinkUrl: "",
      durationMs: 1000,
    };
    saveQueue(q, snapshot);
    const loaded = loadQueue();
    expect(loaded?.state).toEqual(q);
    expect(loaded?.currentTrack).toEqual(snapshot);
    clearQueue();
    expect(loadQueue()).toBeNull();
  });

  test("rejects malformed payloads", () => {
    store.set("nimbus.queue.v1", '{"state":{"sourceId":5}}');
    expect(loadQueue()).toBeNull();
    store.set("nimbus.queue.v1", "not json");
    expect(loadQueue()).toBeNull();
  });

  test("backfills missing optional arrays", () => {
    const q = createQueue("likes", IDS) as Partial<QueueState>;
    delete q.history;
    delete q.unplayable;
    delete q.sourceOrder;
    store.set(
      "nimbus.queue.v1",
      JSON.stringify({ state: q, currentTrack: null, savedAt: 1 }),
    );
    const loaded = loadQueue();
    expect(loaded?.state.history).toEqual([]);
    expect(loaded?.state.unplayable).toEqual([]);
    expect(loaded?.state.sourceOrder).toEqual(loaded!.state.order);
  });
});
