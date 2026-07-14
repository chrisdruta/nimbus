import { describe, expect, test } from "bun:test";
import {
  appendPage,
  cacheKey,
  firstPageChanged,
  shouldSkipWalk,
  sourceKey,
  validateCachedLibrary,
  WALK_TTL_MS,
  type CachedLibrary,
} from "../lib/library-cache";
import type { ProviderTrack } from "../lib/provider";

function track(id: number): ProviderTrack {
  return {
    id,
    title: `t${id}`,
    artist: "a",
    artistUrl: "https://soundcloud.com/a",
    artworkUrl: null,
    permalinkUrl: `https://soundcloud.com/a/t${id}`,
    durationMs: 1000,
    streamable: true,
  };
}

const tracks = (...ids: number[]) => ids.map(track);

function record(overrides: Partial<CachedLibrary> = {}): CachedLibrary {
  return {
    v: 1,
    userId: 7,
    sourceKey: "likes",
    tracks: tracks(1, 2, 3),
    complete: true,
    fetchedAt: 1_000_000,
    ...overrides,
  };
}

describe("keys", () => {
  test("sourceKey and cacheKey compose per user and source", () => {
    expect(sourceKey({ kind: "likes" })).toBe("likes");
    expect(sourceKey({ kind: "playlist", id: 9 })).toBe("playlist:9");
    expect(cacheKey(7, "likes")).toBe("7:likes");
  });
});

describe("validateCachedLibrary", () => {
  test("accepts a well-formed record", () => {
    expect(validateCachedLibrary(record())).toBe(true);
  });

  test("artistId is optional (legacy caches) but must be a number", () => {
    const withId = { ...track(1), artistId: 42 };
    expect(validateCachedLibrary(record({ tracks: [withId] }))).toBe(true);
    // The default track() helper has no artistId — legacy shape.
    expect(validateCachedLibrary(record())).toBe(true);
    const junk = { ...track(1), artistId: "42" as unknown as number };
    expect(validateCachedLibrary(record({ tracks: [junk] }))).toBe(false);
  });

  test("rejects wrong version, missing fields, and junk", () => {
    expect(validateCachedLibrary(null)).toBe(false);
    expect(validateCachedLibrary("nope")).toBe(false);
    expect(validateCachedLibrary({ ...record(), v: 2 })).toBe(false);
    expect(validateCachedLibrary({ ...record(), userId: "7" })).toBe(false);
    expect(validateCachedLibrary({ ...record(), fetchedAt: undefined })).toBe(
      false,
    );
  });

  test("rejects malformed track rows", () => {
    const bad = record();
    (bad.tracks[1] as unknown as { id: string }).id = "20";
    expect(validateCachedLibrary(bad)).toBe(false);
  });
});

describe("appendPage", () => {
  test("appends fresh rows and drops ids already present", () => {
    const merged = appendPage(tracks(1, 2), tracks(2, 3, 4));
    expect(merged.map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  test("keeps order and does not mutate inputs", () => {
    const base = tracks(1, 2);
    const page = tracks(3);
    const merged = appendPage(base, page);
    expect(base).toHaveLength(2);
    expect(merged.map((t) => t.id)).toEqual([1, 2, 3]);
  });
});

describe("firstPageChanged", () => {
  test("identical head with more pages pending → unchanged", () => {
    expect(firstPageChanged(tracks(1, 2, 3, 4), tracks(1, 2), true)).toBe(
      false,
    );
  });

  test("prepended like → changed", () => {
    expect(firstPageChanged(tracks(1, 2, 3), tracks(9, 1, 2), true)).toBe(
      true,
    );
  });

  test("rows appended beyond a short cache → changed", () => {
    expect(firstPageChanged(tracks(1, 2), tracks(1, 2, 3), true)).toBe(true);
  });

  test("whole-collection page with tail removal → changed", () => {
    // No next cursor: the page IS the library, so a length mismatch counts
    // even when the shared head is identical.
    expect(firstPageChanged(tracks(1, 2, 3), tracks(1, 2), false)).toBe(true);
  });

  test("whole-collection page identical → unchanged", () => {
    expect(firstPageChanged(tracks(1, 2, 3), tracks(1, 2, 3), false)).toBe(
      false,
    );
  });
});

describe("shouldSkipWalk", () => {
  const now = 2_000_000;

  test("skips when complete, fresh, and head matches", () => {
    expect(shouldSkipWalk(record(), tracks(1, 2, 3), false, now)).toBe(true);
  });

  test("never skips without a record or with an incomplete one", () => {
    expect(shouldSkipWalk(null, tracks(1), false, now)).toBe(false);
    expect(
      shouldSkipWalk(record({ complete: false }), tracks(1, 2, 3), false, now),
    ).toBe(false);
  });

  test("never skips past the TTL", () => {
    const rec = record({ fetchedAt: now - WALK_TTL_MS - 1 });
    expect(shouldSkipWalk(rec, tracks(1, 2, 3), false, now)).toBe(false);
  });

  test("never skips when the first page changed", () => {
    expect(shouldSkipWalk(record(), tracks(9, 1, 2), true, now)).toBe(false);
  });
});
