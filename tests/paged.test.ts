import { describe, expect, test } from "bun:test";
import { appendUniqueById } from "../lib/paged";

const items = (...ids: number[]) => ids.map((id) => ({ id }));

describe("appendUniqueById", () => {
  test("appends a page in order", () => {
    expect(appendUniqueById(items(1, 2), items(3, 4))).toEqual(
      items(1, 2, 3, 4),
    );
  });

  test("drops duplicates, keeping the first appearance", () => {
    const first = [{ id: 1, tag: "old" }];
    const page = [
      { id: 1, tag: "new" },
      { id: 2, tag: "new" },
    ];
    expect(appendUniqueById(first, page)).toEqual([
      { id: 1, tag: "old" },
      { id: 2, tag: "new" },
    ]);
  });

  test("dedupes within a single page too", () => {
    expect(appendUniqueById([], items(5, 5, 6))).toEqual(items(5, 6));
  });

  test("does not mutate its inputs", () => {
    const prev = items(1);
    appendUniqueById(prev, items(2));
    expect(prev).toEqual(items(1));
  });
});
