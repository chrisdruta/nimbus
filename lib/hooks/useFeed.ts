"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderFeedItem, ProviderTrack } from "@/lib/provider";
import { appendFeedPage, FEED_MAX_AUTO_PAGES } from "@/lib/feed";

interface FeedResponse {
  items: ProviderFeedItem[];
  nextCursor: string | null;
}

/**
 * Paged feed loading. Deliberately unlike useLibrary: the feed is a
 * time-series that extends effectively forever backwards, so there is no
 * walk-to-completion, no IndexedDB cache (staleness is the enemy — the feed
 * is "now"), and depth grows only on scroll intent, gated by an explicit
 * "load more" past FEED_MAX_AUTO_PAGES.
 */
export function useFeed() {
  const [items, setItems] = useState<ProviderFeedItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const genRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const doneRef = useRef(false);

  const loadMore = useCallback(() => {
    if (inFlightRef.current || doneRef.current) return;
    inFlightRef.current = true;
    const gen = genRef.current;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const cursor = cursorRef.current;
        const res = await fetch(
          cursor ? `/api/feed?cursor=${encodeURIComponent(cursor)}` : "/api/feed",
        );
        if (gen !== genRef.current) return;
        if (res.status === 401) {
          setUnauthorized(true);
          return;
        }
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        const page = (await res.json()) as FeedResponse;
        if (gen !== genRef.current) return;
        cursorRef.current = page.nextCursor;
        doneRef.current = page.nextCursor === null;
        setHasMore(page.nextCursor !== null);
        setItems((prev) => appendFeedPage(prev, page.items));
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
    doneRef.current = false;
    setItems([]);
    setHasMore(true);
    setPages(0);
    setError(null);
    setUnauthorized(false);
    loadMore();
  }, [loadMore]);

  const tracks = useMemo<ProviderTrack[]>(
    () => items.map((i) => i.track),
    [items],
  );

  return {
    items,
    tracks,
    loadMore,
    hasMore,
    autoDepthReached: pages >= FEED_MAX_AUTO_PAGES,
    loading,
    error,
    unauthorized,
    retry: loadMore,
  };
}
