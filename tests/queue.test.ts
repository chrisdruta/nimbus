import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearQueue,
  createQueue,
  currentTrackId,
  enqueue,
  integrate,
  jumpTo,
  loadQueue,
  markUnplayable,
  next,
  prev,
  reconcile,
  saveQueue,
  seededShuffle,
  setRepeat,
  setShuffleMode,
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
    expect([...out].sort((a, b) => a - b)).toEqual(
      [...IDS].sort((a, b) => a - b),
    );
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

describe("integrate", () => {
  test("unshuffled appends in arrival order", () => {
    let q = createQueue("likes", IDS, { startTrackId: 30 });
    q = integrate(q, [60, 70]);
    expect(q.order).toEqual([...IDS, 60, 70]);
    expect(q.sourceOrder).toEqual([...IDS, 60, 70]);
    expect(currentTrackId(q)).toBe(30);
  });

  test("shuffled inserts only after the current position", () => {
    let q = createQueue("likes", IDS, { shuffle: true, startTrackId: 30 });
    q = next(q).state;
    q = next(q).state; // position 2
    const playedPrefix = q.order.slice(0, q.position + 1);
    const fresh = [60, 70, 80, 90];
    const merged = integrate(q, fresh, {});
    expect(merged.order.slice(0, merged.position + 1)).toEqual(playedPrefix);
    for (const id of fresh) {
      expect(merged.order.indexOf(id)).toBeGreaterThan(merged.position);
    }
    expect(currentTrackId(merged)).toBe(currentTrackId(q));
  });

  test("result is a permutation of old order plus new ids", () => {
    let q = createQueue("likes", IDS, { shuffle: true, startTrackId: 10 });
    const merged = integrate(q, [60, 70, 80]);
    expect([...merged.order].sort((a, b) => a - b)).toEqual(
      [...IDS, 60, 70, 80].sort((a, b) => a - b),
    );
    expect(merged.sourceOrder).toEqual([...q.sourceOrder, 60, 70, 80]);
  });

  test("is deterministic for a fixed seed and order length", () => {
    const q = createQueue("likes", IDS, {
      shuffle: true,
      startTrackId: 10,
      seed: 1234,
    });
    expect(integrate(q, [60, 70, 80]).order).toEqual(
      integrate(q, [60, 70, 80]).order,
    );
  });

  test("mixes into the remainder rather than always appending at the tail", () => {
    // With a large enough batch, at least one insertion must land strictly
    // inside the existing remainder for any seed.
    const many = Array.from({ length: 200 }, (_, i) => (i + 1) * 10);
    let q = createQueue("likes", many.slice(0, 50), {
      shuffle: true,
      startTrackId: 10,
    });
    const fresh = many.slice(50);
    const merged = integrate(q, fresh);
    const tail = merged.order.slice(-fresh.length);
    expect(tail).not.toEqual(fresh);
  });

  test("dedupes known ids and no-ops on empty input", () => {
    const q = createQueue("likes", IDS, { shuffle: true, startTrackId: 10 });
    expect(integrate(q, [])).toBe(q);
    expect(integrate(q, [10, 20])).toBe(q);
    const merged = integrate(q, [20, 60]);
    expect(merged.order.filter((id) => id === 20)).toHaveLength(1);
    expect(merged.order).toContain(60);
  });

  test("shuffled queue with nothing selected can insert anywhere", () => {
    const q = createQueue("likes", IDS, { shuffle: true }); // position -1
    const merged = integrate(q, [60, 70]);
    expect(merged.position).toBe(-1);
    expect([...merged.order].sort((a, b) => a - b)).toEqual(
      [...IDS, 60, 70].sort((a, b) => a - b),
    );
  });
});

describe("enqueue", () => {
  test("foreign id lands at the tail and joins sourceOrder", () => {
    const q = createQueue("likes", IDS, { startTrackId: 30 });
    const r = enqueue(q, 99, "last");
    expect(r.order).toEqual([...IDS, 99]);
    expect(r.sourceOrder).toEqual([...IDS, 99]);
    expect(currentTrackId(r)).toBe(30);
  });

  test("foreign id lands right after the current track", () => {
    const q = createQueue("likes", IDS, { startTrackId: 30 });
    const r = enqueue(q, 99, "next");
    expect(r.order).toEqual([10, 20, 30, 99, 40, 50]);
    expect(currentTrackId(r)).toBe(30);
  });

  test("id from the unplayed remainder moves without duplicating", () => {
    const q = createQueue("likes", IDS, { startTrackId: 20 });
    const r = enqueue(q, 50, "next");
    expect(r.order).toEqual([10, 20, 50, 30, 40]);
    expect(r.order.filter((id) => id === 50)).toHaveLength(1);
    expect(currentTrackId(r)).toBe(20);
  });

  test("played id is consumed and position repaired", () => {
    let q = createQueue("likes", IDS, { startTrackId: 10 });
    q = next(q).state;
    q = next(q).state; // on 30, played [10, 20]
    const r = enqueue(q, 10, "next");
    expect(r.order).toEqual([20, 30, 10, 40, 50]);
    expect(currentTrackId(r)).toBe(30);
    expect(r.order.filter((id) => id === 10)).toHaveLength(1);
  });

  test("enqueuing the current track is a no-op", () => {
    const q = createQueue("likes", IDS, { startTrackId: 30 });
    expect(enqueue(q, 30, "next")).toBe(q);
    expect(enqueue(q, 30, "last")).toBe(q);
  });

  test("nothing selected: next inserts at the head", () => {
    const q = createQueue("likes", IDS); // position -1
    const r = enqueue(q, 99, "next");
    expect(r.order[0]).toBe(99);
    expect(r.position).toBe(-1);
  });

  test("re-queuing an unplayable id clears the mark", () => {
    let q = createQueue("likes", IDS, { startTrackId: 10 });
    q = markUnplayable(q, 40);
    const r = enqueue(q, 40, "next");
    expect(r.unplayable).not.toContain(40);
    expect(upcoming(r, 1)).toEqual([40]);
  });

  test("last on the current tail keeps order values", () => {
    const q = createQueue("likes", IDS, { startTrackId: 10 });
    const r = enqueue(q, 50, "last");
    expect(r.order).toEqual(IDS);
  });

  test("shuffle bookkeeping is untouched", () => {
    const q = createQueue("likes", IDS, { shuffle: true, startTrackId: 30 });
    const r = enqueue(q, 99, "next");
    expect(r.shuffled).toBe(true);
    expect(r.seed).toBe(q.seed);
    expect(r.shuffleMode).toBe(q.shuffleMode);
    expect(r.history).toEqual(q.history);
  });

  test("foreign id survives un-shuffling", () => {
    const q = createQueue("likes", IDS, { shuffle: true, startTrackId: 30 });
    const r = toggleShuffle(enqueue(q, 99, "next"));
    expect(r.order).toContain(99);
    expect(currentTrackId(r)).toBe(30);
  });
});

describe("persistence", () => {
  const USER_ID = 7;
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
    const q = createQueue("playlist:9", IDS, {
      shuffle: true,
      startTrackId: 20,
    });
    const snapshot = {
      id: 20,
      title: "t",
      artist: "a",
      artistUrl: "",
      artworkUrl: null,
      permalinkUrl: "",
      durationMs: 1000,
    };
    saveQueue(USER_ID, q, snapshot);
    const loaded = loadQueue(USER_ID);
    expect(loaded?.state).toEqual(q);
    expect(loaded?.currentTrack).toEqual(snapshot);
    clearQueue(USER_ID);
    expect(loadQueue(USER_ID)).toBeNull();
  });

  test("namespaces queues by authenticated user", () => {
    const q = createQueue("likes", IDS);
    saveQueue(USER_ID, q, null);
    expect(loadQueue(USER_ID)?.state).toEqual(q);
    expect(loadQueue(USER_ID + 1)).toBeNull();
  });

  test("rejects malformed payloads", () => {
    store.set(`nimbus.queue.v1:${USER_ID}`, '{"state":{"sourceId":5}}');
    expect(loadQueue(USER_ID)).toBeNull();
    store.set(`nimbus.queue.v1:${USER_ID}`, "not json");
    expect(loadQueue(USER_ID)).toBeNull();
  });

  test("backfills missing optional arrays", () => {
    const q = createQueue("likes", IDS) as Partial<QueueState>;
    delete q.history;
    delete q.unplayable;
    delete q.sourceOrder;
    delete q.shuffleMode;
    store.set(
      `nimbus.queue.v1:${USER_ID}`,
      JSON.stringify({ state: q, currentTrack: null, savedAt: 1 }),
    );
    const loaded = loadQueue(USER_ID);
    expect(loaded?.state.history).toEqual([]);
    expect(loaded?.state.unplayable).toEqual([]);
    expect(loaded?.state.sourceOrder).toEqual(loaded!.state.order);
    expect(loaded?.state.shuffleMode).toBe("classic");
  });

  test("legacy snapshots without artistId stay valid; junk artistId drops the track", () => {
    const q = createQueue("radio:track:10", [10, 11], { startTrackId: 10 });
    const legacy = {
      id: 10,
      title: "t",
      artist: "a",
      artistUrl: "",
      artworkUrl: null,
      permalinkUrl: "",
      durationMs: 1000,
    };
    const junk = { ...legacy, id: 11, artistId: "nope" };
    store.set(
      `nimbus.queue.v1:${USER_ID}`,
      JSON.stringify({
        state: q,
        currentTrack: legacy,
        tracks: [legacy, junk],
        savedAt: 1,
      }),
    );
    const loaded = loadQueue(USER_ID);
    expect(loaded?.currentTrack).toEqual(legacy);
    expect(loaded?.tracks).toEqual([legacy]);
  });

  test("legacy snapshots without preview stay valid; junk preview drops the track", () => {
    const q = createQueue("radio:track:10", [10, 11], { startTrackId: 10 });
    const legacy = {
      id: 10,
      title: "t",
      artist: "a",
      artistUrl: "",
      artworkUrl: null,
      permalinkUrl: "",
      durationMs: 1000,
    };
    const marked = { ...legacy, id: 11, preview: true };
    const junk = { ...legacy, id: 11, preview: "yes" };
    store.set(
      `nimbus.queue.v1:${USER_ID}`,
      JSON.stringify({
        state: q,
        currentTrack: legacy,
        tracks: [legacy, marked],
        savedAt: 1,
      }),
    );
    expect(loadQueue(USER_ID)?.tracks).toEqual([legacy, marked]);
    store.set(
      `nimbus.queue.v1:${USER_ID}`,
      JSON.stringify({
        state: q,
        currentTrack: legacy,
        tracks: [legacy, junk],
        savedAt: 1,
      }),
    );
    expect(loadQueue(USER_ID)?.tracks).toEqual([legacy]);
  });

  test("round-trips the optional metadata snapshot", () => {
    const q = createQueue("radio:track:10", IDS, { startTrackId: 10 });
    const track = (id: number) => ({
      id,
      title: `t${id}`,
      artist: "a",
      artistUrl: "",
      artworkUrl: null,
      permalinkUrl: "",
      durationMs: 1000,
    });
    saveQueue(USER_ID, q, track(10), IDS.map(track));
    expect(loadQueue(USER_ID)?.tracks).toEqual(IDS.map(track));
    // Without the snapshot the field stays absent.
    saveQueue(USER_ID, q, track(10));
    expect(loadQueue(USER_ID)?.tracks).toBeUndefined();
  });

  test("drops malformed snapshot entries without killing the queue", () => {
    const q = createQueue("radio:track:10", IDS);
    const good = {
      id: 10,
      title: "t",
      artist: "a",
      artistUrl: "",
      artworkUrl: null,
      permalinkUrl: "",
      durationMs: 1000,
    };
    store.set(
      `nimbus.queue.v1:${USER_ID}`,
      JSON.stringify({
        state: q,
        currentTrack: null,
        tracks: [good, { id: "nope" }, null, { ...good, durationMs: "x" }],
        savedAt: 1,
      }),
    );
    const loaded = loadQueue(USER_ID);
    expect(loaded?.state).toEqual(q);
    expect(loaded?.tracks).toEqual([good]);
  });

  test("round-trips shuffleMode", () => {
    let q = createQueue("likes", IDS, { shuffle: true, startTrackId: 10 });
    q = setShuffleMode(q, "artist-spaced");
    saveQueue(USER_ID, q, null);
    expect(loadQueue(USER_ID)?.state.shuffleMode).toBe("artist-spaced");
  });
});

describe("shuffleMode state", () => {
  test("createQueue defaults to classic", () => {
    expect(createQueue("likes", IDS).shuffleMode).toBe("classic");
    expect(createQueue("likes", IDS, { shuffle: true }).shuffleMode).toBe(
      "classic",
    );
  });

  test("setShuffleMode turns shuffle on and keeps the current track first", () => {
    let q = createQueue("likes", IDS); // unshuffled
    q = jumpTo(q, 30);
    q = setShuffleMode(q, "rediscovery");
    expect(q.shuffled).toBe(true);
    expect(q.shuffleMode).toBe("rediscovery");
    expect(currentTrackId(q)).toBe(30);
    expect(q.position).toBe(0);
    expect([...q.order].sort((a, b) => a - b)).toEqual([...IDS]);
  });

  test("setShuffleMode with nothing selected keeps position -1", () => {
    const q = setShuffleMode(createQueue("likes", IDS), "artist-spaced");
    expect(q.position).toBe(-1);
    expect(q.shuffled).toBe(true);
  });

  test("re-selecting the active mode reshuffles (new seed)", () => {
    let q = createQueue("likes", IDS, { shuffle: true, startTrackId: 10 });
    q = setShuffleMode(q, "classic");
    const seedA = q.seed;
    q = setShuffleMode(q, "classic");
    expect(q.seed).not.toBe(seedA);
  });

  test("toggleShuffle off and back on keeps the mode", () => {
    let q = createQueue("likes", IDS, { shuffle: true, startTrackId: 10 });
    q = setShuffleMode(q, "artist-spaced");
    q = toggleShuffle(q); // off — source order restored
    expect(q.shuffled).toBe(false);
    expect(q.shuffleMode).toBe("artist-spaced");
    expect(q.order).toEqual([...IDS]);
    q = toggleShuffle(q); // on — artist-spaced again
    expect(q.shuffled).toBe(true);
    expect(q.shuffleMode).toBe("artist-spaced");
  });

  test("toggleShuffle applies artist spacing through ctx", () => {
    // Two artists, alternating requirement is satisfiable.
    const artistOf = (id: number) => (id <= 30 ? "x" : "y");
    let q = createQueue("likes", [10, 20, 30, 40, 50, 60]);
    q = { ...q, shuffleMode: "artist-spaced" };
    q = toggleShuffle(q, true, { artistOf });
    for (let i = 1; i < q.order.length; i++) {
      expect(artistOf(q.order[i])).not.toBe(artistOf(q.order[i - 1]));
    }
  });
});
