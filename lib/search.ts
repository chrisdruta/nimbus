/**
 * Shared search-query rules so the input field, the queue sourceId, and the
 * API routes all agree on what a query is. Pure — unit-tested.
 */

export const SEARCH_QUERY_MAX = 200;

/** Collapse whitespace runs, trim, cap length; "" means "no query". */
export function normalizeSearchQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_QUERY_MAX).trim();
}

/** Queue sourceId for a search-results queue ("search:<encoded query>"). */
export function searchSourceId(query: string): string {
  return `search:${encodeURIComponent(normalizeSearchQuery(query))}`;
}
