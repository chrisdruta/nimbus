import { describe, expect, test } from "bun:test";
import {
  normalizeSearchQuery,
  SEARCH_QUERY_MAX,
  searchSourceId,
} from "../lib/search";

describe("normalizeSearchQuery", () => {
  test("trims and collapses whitespace runs", () => {
    expect(normalizeSearchQuery("  boards   of\tcanada ")).toBe(
      "boards of canada",
    );
  });

  test("empty and whitespace-only input mean no query", () => {
    expect(normalizeSearchQuery("")).toBe("");
    expect(normalizeSearchQuery("   \n\t ")).toBe("");
  });

  test("caps length and never leaves a trailing space", () => {
    const long = `${"a".repeat(SEARCH_QUERY_MAX - 1)} b`;
    const out = normalizeSearchQuery(long);
    expect(out.length).toBeLessThanOrEqual(SEARCH_QUERY_MAX);
    expect(out.endsWith(" ")).toBe(false);
  });
});

describe("searchSourceId", () => {
  test("normalizes and URL-encodes the query", () => {
    expect(searchSourceId(" four  tet ")).toBe("search:four%20tet");
  });

  test("equivalent inputs share a sourceId", () => {
    expect(searchSourceId("four tet")).toBe(searchSourceId("  four   tet "));
  });
});
