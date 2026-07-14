"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appendUniqueById, PAGED_MAX_AUTO_PAGES } from "@/lib/paged";

/**
 * Windowed page loading for "now" lists — the useFeed pattern generalized
 * for search results and artist catalogs: no walk-to-completion, no
 * IndexedDB cache (staleness is the enemy), depth grows on scroll intent
 * gated by an explicit "load more" past PAGED_MAX_AUTO_PAGES.
 */
export function usePagedList<T extends { id: number }>(
  /** Restarts from page one whenever this changes; null disables (renders
   * empty without fetching — e.g. no search query yet). */
  key: string | null,
  /** Builds the endpoint URL for a page; latest closure always used. */
  buildUrl: (cursor: string | null) => string,
  /** Plucks the item array off the route's JSON response. */
  pickItems: (data: unknown) => T[],
) {
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const genRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const doneRef = useRef(true);

  // The callbacks are closures over caller state; keep the latest without
  // destabilizing loadMore.
  const buildUrlRef = useRef(buildUrl);
  buildUrlRef.current = buildUrl;
  const pickItemsRef = useRef(pickItems);
  pickItemsRef.current = pickItems;

  const loadMore = useCallback(() => {
    if (inFlightRef.current || doneRef.current) return;
    inFlightRef.current = true;
    const gen = genRef.current;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(buildUrlRef.current(cursorRef.current));
        if (gen !== genRef.current) return;
        if (res.status === 401) {
          setUnauthorized(true);
          return;
        }
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        const data = (await res.json()) as { nextCursor: string | null };
        if (gen !== genRef.current) return;
        cursorRef.current = data.nextCursor;
        doneRef.current = data.nextCursor === null;
        setHasMore(data.nextCursor !== null);
        setItems((prev) => appendUniqueById(prev, pickItemsRef.current(data)));
        setPages((n) => n + 1);
      } catch (err) {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        // A remount already reset the flag for its own generation.
        if (gen === genRef.current) {
          inFlightRef.current = false;
          setLoading(false);
        }
      }
    })();
  }, []);

  useEffect(() => {
    genRef.current++;
    cursorRef.current = null;
    inFlightRef.current = false;
    doneRef.current = key === null;
    setItems([]);
    setHasMore(false);
    setPages(0);
    setLoading(false);
    setError(null);
    setUnauthorized(false);
    if (key !== null) loadMore();
  }, [key, loadMore]);

  return {
    items,
    loadMore,
    hasMore,
    autoDepthReached: pages >= PAGED_MAX_AUTO_PAGES,
    loading,
    error,
    unauthorized,
    retry: loadMore,
  };
}
