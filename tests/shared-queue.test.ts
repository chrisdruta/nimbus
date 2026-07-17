import { describe, expect, test } from "bun:test";
import { createQueue, type QueueTrack } from "../lib/queue";
import {
  SHARED_QUEUE_CAP,
  SHARED_SEED_COUNT,
  addEntry,
  applySharedOrder,
  parseControl,
  parseQueueOp,
  removeEntry,
  reorderEntries,
  seedEntries,
  type SharedQueueEntry,
} from "../lib/shared-queue";

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

function entry(id: number, addedBy: string | null = null): SharedQueueEntry {
  return { ...track(id), addedBy };
}

describe("addEntry", () => {
  test("appends with addedBy", () => {
    const res = addEntry([entry(10)], entry(20, "chris"), 5);
    if ("error" in res) throw new Error("expected success");
    expect(res.queue.map((e) => e.id)).toEqual([10, 20]);
    expect(res.queue[1].addedBy).toBe("chris");
  });

  test("rejects an id already queued", () => {
    expect(addEntry([entry(10)], entry(10), null)).toEqual({
      error: "duplicate",
    });
  });

  test("rejects the currently playing id", () => {
    expect(addEntry([entry(10)], entry(5), 5)).toEqual({ error: "duplicate" });
  });

  test("rejects at cap, allows at cap - 1", () => {
    const full = Array.from({ length: SHARED_QUEUE_CAP }, (_, i) =>
      entry(i + 1),
    );
    expect(addEntry(full, entry(9_999), null)).toEqual({ error: "full" });
    const almostFull = full.slice(0, SHARED_QUEUE_CAP - 1);
    const res = addEntry(almostFull, entry(9_999), null);
    if ("error" in res) throw new Error("expected success");
    expect(res.queue).toHaveLength(SHARED_QUEUE_CAP);
  });
});

describe("removeEntry", () => {
  test("removes by id, preserving order", () => {
    const res = removeEntry([entry(1), entry(2), entry(3)], 2);
    expect(res.changed).toBe(true);
    expect(res.queue.map((e) => e.id)).toEqual([1, 3]);
  });

  test("absent id is a no-op with changed: false", () => {
    const res = removeEntry([entry(1)], 99);
    expect(res.changed).toBe(false);
    expect(res.queue.map((e) => e.id)).toEqual([1]);
  });
});

describe("reorderEntries", () => {
  const queue = [entry(1), entry(2), entry(3)];

  test("accepts an exact permutation", () => {
    const next = reorderEntries(queue, [3, 1, 2]);
    expect(next?.map((e) => e.id)).toEqual([3, 1, 2]);
    expect(next?.[0].addedBy).toBe(queue[2].addedBy);
  });

  test("rejects wrong length, foreign, duplicated, and dropped ids", () => {
    expect(reorderEntries(queue, [3, 1])).toBeNull();
    expect(reorderEntries(queue, [3, 1, 99])).toBeNull();
    expect(reorderEntries(queue, [3, 1, 1])).toBeNull();
    expect(reorderEntries(queue, [3, 1, 2, 2])).toBeNull();
  });

  test("empty queue accepts only the empty order", () => {
    expect(reorderEntries([], [])).toEqual([]);
    expect(reorderEntries([], [1])).toBeNull();
  });
});

describe("applySharedOrder", () => {
  test("rewrites everything after the playing track", () => {
    const q = { ...createQueue("shared", [1, 2, 3, 4, 5]), position: 1 };
    const next = applySharedOrder(q, [9, 8, 3]);
    expect(next.order).toEqual([1, 2, 9, 8, 3]);
    expect(next.position).toBe(1);
    expect(next.order[next.position]).toBe(2);
    expect(next.sourceOrder).toEqual(next.order);
  });

  test("drops played-prefix ids that reappear in the shared list (replay)", () => {
    const q = { ...createQueue("shared", [1, 2, 3, 4]), position: 2 };
    const next = applySharedOrder(q, [1, 4]);
    expect(next.order).toEqual([2, 3, 1, 4]);
    expect(next.position).toBe(1);
    expect(next.order[next.position]).toBe(3);
  });

  test("filters the current track out of the shared list (prune race)", () => {
    const q = { ...createQueue("shared", [1, 2, 3]), position: 1 };
    const next = applySharedOrder(q, [2, 5]);
    expect(next.order).toEqual([1, 2, 5]);
    expect(next.position).toBe(1);
  });

  test("keeps history and unplayable untouched", () => {
    const q = {
      ...createQueue("shared", [1, 2, 3]),
      position: 0,
      history: [7],
      unplayable: [3],
    };
    const next = applySharedOrder(q, [3, 4]);
    expect(next.history).toEqual([7]);
    expect(next.unplayable).toEqual([3]);
  });

  test("nothing selected: order becomes the shared list", () => {
    const q = { ...createQueue("shared", [1, 2]), position: -1 };
    const next = applySharedOrder(q, [5, 6]);
    expect(next.order).toEqual([5, 6]);
    expect(next.position).toBe(-1);
  });

  test("order stays duplicate-free for messy input", () => {
    const q = { ...createQueue("shared", [1, 2, 3, 4]), position: 2 };
    const next = applySharedOrder(q, [4, 4, 1, 3, 1]);
    expect(new Set(next.order).size).toBe(next.order.length);
    expect(next.order[next.position]).toBe(3);
  });
});

test("seeding leaves addable headroom below the cap", () => {
  expect(SHARED_SEED_COUNT).toBeLessThan(SHARED_QUEUE_CAP);
});

describe("seedEntries", () => {
  const meta = new Map([10, 20, 30].map((id) => [id, track(id)]));

  test("resolves ids to entries with addedBy null", () => {
    const seeded = seedEntries([10, 20], (id) => meta.get(id));
    expect(seeded.map((e) => e.id)).toEqual([10, 20]);
    expect(seeded.every((e) => e.addedBy === null)).toBe(true);
  });

  test("skips ids without metadata and stops at the cap", () => {
    expect(seedEntries([10, 99, 30], (id) => meta.get(id)).map((e) => e.id))
      .toEqual([10, 30]);
    const many = Array.from({ length: SHARED_QUEUE_CAP + 50 }, (_, i) => i + 1);
    expect(seedEntries(many, (id) => track(id))).toHaveLength(
      SHARED_QUEUE_CAP,
    );
  });
});

describe("parseControl", () => {
  test("accepts play and prev", () => {
    expect(parseControl({ type: "play", trackId: 5 })).toEqual({
      type: "play",
      trackId: 5,
    });
    expect(parseControl({ type: "prev" })).toEqual({ type: "prev" });
  });

  test("rejects shape violations", () => {
    expect(parseControl(null)).toBeNull();
    expect(parseControl({ type: "play" })).toBeNull();
    expect(parseControl({ type: "play", trackId: 0 })).toBeNull();
    expect(parseControl({ type: "play", trackId: 1.5 })).toBeNull();
    expect(parseControl({ type: "jump", trackId: 5 })).toBeNull();
  });
});

describe("parseQueueOp", () => {
  test("add: validates and strips the track", () => {
    const op = parseQueueOp({ op: "add", track: { ...track(5), extra: 1 } });
    expect(op).toEqual({ op: "add", track: track(5) });
  });

  test("add: preview rides through the strip", () => {
    const op = parseQueueOp({
      op: "add",
      track: { ...track(5), preview: true },
    });
    expect(op).toEqual({ op: "add", track: { ...track(5), preview: true } });
  });

  test("add: rejects javascript: URLs (inherited window validation)", () => {
    const bad = { ...track(5), permalinkUrl: "javascript:alert(1)" };
    expect(parseQueueOp({ op: "add", track: bad })).toBeNull();
  });

  test("add: rejects external and spoofed SoundCloud links", () => {
    for (const permalinkUrl of [
      "https://attacker.example/track",
      "https://soundcloud.com@attacker.example/track",
    ]) {
      expect(
        parseQueueOp({
          op: "add",
          track: { ...track(5), permalinkUrl },
        }),
      ).toBeNull();
    }
  });

  test("remove: requires a positive safe-integer id", () => {
    expect(parseQueueOp({ op: "remove", trackId: 7 })).toEqual({
      op: "remove",
      trackId: 7,
    });
    expect(parseQueueOp({ op: "remove", trackId: -7 })).toBeNull();
  });

  test("reorder: requires ids, bounded length, and a revision", () => {
    expect(
      parseQueueOp({ op: "reorder", order: [2, 1], expectedRevision: 3 }),
    ).toEqual({ op: "reorder", order: [2, 1], expectedRevision: 3 });
    expect(parseQueueOp({ op: "reorder", order: [2, 1] })).toBeNull();
    expect(
      parseQueueOp({ op: "reorder", order: ["a"], expectedRevision: 1 }),
    ).toBeNull();
    const oversized = Array.from(
      { length: SHARED_QUEUE_CAP + 1 },
      (_, i) => i + 1,
    );
    expect(
      parseQueueOp({ op: "reorder", order: oversized, expectedRevision: 1 }),
    ).toBeNull();
  });

  test("rejects unknown ops and non-objects", () => {
    expect(parseQueueOp({ op: "clear" })).toBeNull();
    expect(parseQueueOp("add")).toBeNull();
  });
});
