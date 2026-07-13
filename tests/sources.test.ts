import { describe, expect, test } from "bun:test";
import { CAPS, capsOf, sourceKindOf } from "../lib/sources";

describe("sourceKindOf", () => {
  test("maps known sourceId shapes", () => {
    expect(sourceKindOf("likes")).toBe("likes");
    expect(sourceKindOf("playlist:2")).toBe("playlist");
    expect(sourceKindOf("playlist:184623")).toBe("playlist");
    expect(sourceKindOf("radio:track:9")).toBe("radio");
  });

  test("unknown ids fall back to the default local source", () => {
    expect(sourceKindOf("")).toBe("likes");
    expect(sourceKindOf("garbage")).toBe("likes");
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
      });
    }
  });

  test("slipstream is fully read-only and never persists", () => {
    expect(Object.values(capsOf("slipstream")).every((v) => v === false)).toBe(
      true,
    );
  });

  test("every kind has a caps row", () => {
    expect(Object.keys(CAPS).sort()).toEqual(
      ["likes", "playlist", "radio", "slipstream"].sort(),
    );
  });
});
