import { describe, expect, test } from "bun:test";
import { formatCount, formatDuration } from "../lib/format";

describe("formatCount", () => {
  test("small numbers stay exact", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(950)).toBe("950");
  });

  test("thousands compact to k", () => {
    expect(formatCount(1000)).toBe("1k");
    expect(formatCount(1500)).toBe("1.5k");
    expect(formatCount(12345)).toBe("12k");
    expect(formatCount(999_499)).toBe("999k");
  });

  test("millions compact to m", () => {
    expect(formatCount(1_000_000)).toBe("1m");
    expect(formatCount(1_150_000)).toBe("1.1m");
    expect(formatCount(23_400_000)).toBe("23m");
  });

  test("negatives and fractions clamp to whole counts", () => {
    expect(formatCount(-5)).toBe("0");
    expect(formatCount(10.9)).toBe("10");
  });
});

describe("formatDuration", () => {
  test("existing behavior holds", () => {
    expect(formatDuration(194_000)).toBe("3:14");
    expect(formatDuration(3_849_000)).toBe("1:04:09");
  });
});
