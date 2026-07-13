import { describe, expect, test } from "bun:test";
import { appendFeedPage } from "../lib/feed";
import type { ProviderFeedItem } from "../lib/provider";

function item(id: number, reposted = false): ProviderFeedItem {
  return {
    track: {
      id,
      title: `t${id}`,
      artist: "a",
      artistUrl: "",
      artworkUrl: null,
      permalinkUrl: "",
      durationMs: 1000,
      streamable: true,
    },
    reposted,
  };
}

describe("appendFeedPage", () => {
  test("appends preserving page order", () => {
    const out = appendFeedPage([item(1)], [item(2), item(3)]);
    expect(out.map((i) => i.track.id)).toEqual([1, 2, 3]);
  });

  test("drops repost echoes of already-seen tracks", () => {
    const out = appendFeedPage([item(1), item(2, true)], [item(2), item(3)]);
    expect(out.map((i) => i.track.id)).toEqual([1, 2, 3]);
    // The first appearance wins, keeping its repost flag.
    expect(out[1].reposted).toBe(true);
  });

  test("dedupes within a single page", () => {
    const out = appendFeedPage([], [item(5), item(5, true), item(6)]);
    expect(out.map((i) => i.track.id)).toEqual([5, 6]);
    expect(out[0].reposted).toBe(false);
  });

  test("never mutates its inputs", () => {
    const base = [item(1)];
    const page = [item(2)];
    appendFeedPage(base, page);
    expect(base.length).toBe(1);
    expect(page.length).toBe(1);
  });
});
