/**
 * Pure feed-page helpers — the stateful fetching lives in
 * lib/hooks/useFeed.ts. The feed is a time-series (uploads + reposts from
 * followed users), so the same track can arrive more than once: as its
 * upload and again as a repost, or reposted by two people across pages.
 */

import type { ProviderFeedItem } from "./provider";

/** Feed sourceId — the queue only ever holds loaded feed tracks. */
export const FEED_SOURCE_ID = "feed";

/** Pages auto-loaded by scrolling before an explicit "load more" gate. */
export const FEED_MAX_AUTO_PAGES = 6;

/** Append a page, deduping by track id: a track keeps its first (newest)
 * appearance; later duplicates — repost echoes — are dropped. */
export function appendFeedPage(
  items: readonly ProviderFeedItem[],
  page: readonly ProviderFeedItem[],
): ProviderFeedItem[] {
  const seen = new Set(items.map((i) => i.track.id));
  const out = [...items];
  for (const item of page) {
    if (seen.has(item.track.id)) continue;
    seen.add(item.track.id);
    out.push(item);
  }
  return out;
}
