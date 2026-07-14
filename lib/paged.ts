/**
 * Pure helpers for windowed "now" lists (search results, artist catalogs) —
 * the feed's paging conventions generalized. Stateful fetching lives in
 * lib/hooks/usePagedList.ts.
 */

/** Pages auto-loaded by scrolling before an explicit "load more" gate. */
export const PAGED_MAX_AUTO_PAGES = 6;

/** Append a page, deduping by id: an item keeps its first appearance;
 * later duplicates (cursor drift between pages) are dropped. */
export function appendUniqueById<T extends { id: number }>(
  items: readonly T[],
  page: readonly T[],
): T[] {
  const seen = new Set(items.map((i) => i.id));
  const out = [...items];
  for (const item of page) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
