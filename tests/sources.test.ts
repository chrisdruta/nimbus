import { describe, expect, test } from "bun:test";
import { CAPS, capsOf, sourceKindOf } from "../lib/sources";

describe("sourceKindOf", () => {
  test("maps known sourceId shapes", () => {
    expect(sourceKindOf("likes")).toBe("likes");
    expect(sourceKindOf("playlist:2")).toBe("playlist");
    expect(sourceKindOf("playlist:184623")).toBe("playlist");
    expect(sourceKindOf("radio:track:9")).toBe("radio");
    expect(sourceKindOf("feed")).toBe("feed");
  });

  test("unknown ids fall back to the default local source", () => {
    expect(sourceKindOf("")).toBe("likes");
    expect(sourceKindOf("garbage")).toBe("likes");
  });

  test("shared-session queue maps to the shared kind", () => {
    expect(sourceKindOf("shared")).toBe("shared");
  });
});

describe("capsOf", () => {
  test("local sources allow everything", () => {
    for (const kind of ["likes", "playlist"] as const) {
      expect(capsOf(kind)).toEqual({
        canSkip: true,
        canJump: true,
        canShuffle: true,
        canRepeat: true,
        canSeek: true,
        persists: true,
        restoresFromLibrary: true,
      });
    }
  });

  test("self-contained sources persist their own metadata", () => {
    for (const kind of ["radio", "feed", "slipstream"] as const) {
      expect(capsOf(kind).restoresFromLibrary).toBe(false);
    }
  });

  test("slipstream is fully read-only and never persists", () => {
    expect(Object.values(capsOf("slipstream")).every((v) => v === false)).toBe(
      true,
    );
  });

  test("shared host keeps transport but loses shuffle/repeat; snapshots persist", () => {
    expect(capsOf("shared")).toEqual({
      canSkip: true,
      canJump: true,
      canShuffle: false,
      canRepeat: false,
      canSeek: true,
      persists: true,
      restoresFromLibrary: false,
    });
  });

  test("shared follower gets intent-routed transport but never seeks or persists", () => {
    expect(capsOf("slipstream-shared")).toEqual({
      canSkip: true,
      canJump: true,
      canShuffle: false,
      canRepeat: false,
      canSeek: false,
      persists: false,
      restoresFromLibrary: false,
    });
  });

  test("every kind has a caps row", () => {
    expect(Object.keys(CAPS).sort()).toEqual(
      [
        "likes",
        "playlist",
        "radio",
        "slipstream",
        "slipstream-shared",
        "feed",
        "shared",
      ].sort(),
    );
  });
});
