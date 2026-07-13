"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderTrack } from "@/lib/provider";
import {
  appendPage,
  cacheKey,
  EVICT_AFTER_MS,
  shouldSkipWalk,
  sourceKey,
  validateCachedLibrary,
  type CachedLibrary,
  type TrackSource,
} from "@/lib/library-cache";
import { idbDelete, idbGet, idbKeys, idbSet } from "@/lib/idb";

export type { TrackSource };
export { sourceKey };

function endpoint(source: TrackSource, cursor: string | null): string {
  const base =
    source.kind === "likes"
      ? "/api/likes"
      : `/api/playlists/${source.id}/tracks`;
  return cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
}

interface PageResponse {
  tracks: ProviderTrack[];
  nextCursor: string | null;
  error?: string;
}

/** Once per session, drop cache records nobody has refreshed in a month. */
let evicted = false;
function evictStale(): void {
  if (evicted) return;
  evicted = true;
  void (async () => {
    const now = Date.now();
    for (const key of await idbKeys()) {
      const rec = await idbGet(key);
      if (!validateCachedLibrary(rec) || now - rec.fetchedAt > EVICT_AFTER_MS) {
        await idbDelete(key);
      }
    }
  })();
}

/**
 * Full-collection track loading: hydrates instantly from the IndexedDB
 * cache, then walks every page of the source. A complete, fresh cache
 * whose head matches the live first page short-circuits the walk. The
 * displayed list only shrinks on a *completed* walk, never mid-walk.
 */
export function useLibrary(source: TrackSource, userId: number) {
  const key = sourceKey(source);
  const [tracks, setTracks] = useState<ProviderTrack[]>([]);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const genRef = useRef(0);
  const accRef = useRef<ProviderTrack[]>([]);
  const cursorRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<PageResponse | "unauthorized"> => {
      const res = await fetch(endpoint(source, cursor));
      if (res.status === 401) return "unauthorized";
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      return (await res.json()) as PageResponse;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  const persist = useCallback(
    (list: ProviderTrack[]) => {
      const rec: CachedLibrary = {
        v: 1,
        userId,
        sourceKey: key,
        tracks: list,
        complete: true,
        fetchedAt: Date.now(),
      };
      void idbSet(cacheKey(userId, key), rec);
    },
    [key, userId],
  );

  /** Walk pages from cursorRef until exhausted; resumable after errors. */
  const walk = useCallback(
    async (gen: number) => {
      setError(null);
      try {
        while (true) {
          const page = await fetchPage(cursorRef.current);
          if (gen !== genRef.current) return;
          if (page === "unauthorized") {
            setUnauthorized(true);
            setLoading(false);
            return;
          }
          accRef.current = appendPage(accRef.current, page.tracks);
          cursorRef.current = page.nextCursor;
          // While a hydrated cache is on screen, keep it there — a partial
          // walk must never replace a complete list.
          if (!hydratedRef.current) setTracks(accRef.current);
          if (page.nextCursor === null) break;
        }
        setTracks(accRef.current);
        setComplete(true);
        setLoading(false);
        persist(accRef.current);
      } catch (err) {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    },
    [fetchPage, persist],
  );

  useEffect(() => {
    const gen = ++genRef.current;
    accRef.current = [];
    cursorRef.current = null;
    hydratedRef.current = false;
    setTracks([]);
    setComplete(false);
    setError(null);
    setUnauthorized(false);
    setLoading(true);
    evictStale();

    void (async () => {
      // 1. Instant hydration from the per-user cache record.
      let cached: CachedLibrary | null = null;
      const rec = await idbGet(cacheKey(userId, key));
      if (gen !== genRef.current) return;
      if (
        validateCachedLibrary(rec) &&
        rec.userId === userId &&
        rec.sourceKey === key &&
        rec.complete
      ) {
        cached = rec;
        hydratedRef.current = true;
        setTracks(rec.tracks);
        setComplete(true);
        setLoading(false);
      }

      // 2. Live first page decides: cache is authoritative, or full walk.
      try {
        const page = await fetchPage(null);
        if (gen !== genRef.current) return;
        if (page === "unauthorized") {
          setUnauthorized(true);
          setLoading(false);
          return;
        }
        const hasMore = page.nextCursor !== null;
        if (
          cached &&
          shouldSkipWalk(cached, page.tracks, hasMore, Date.now())
        ) {
          return; // cached list stands
        }
        accRef.current = appendPage([], page.tracks);
        cursorRef.current = page.nextCursor;
        if (!hydratedRef.current) setTracks(accRef.current);
        if (!hasMore) {
          setTracks(accRef.current);
          setComplete(true);
          setLoading(false);
          persist(accRef.current);
          return;
        }
        await walk(gen);
      } catch (err) {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId]);

  /** Resume a failed walk from the saved cursor. */
  const retry = useCallback(() => {
    if (unauthorized) return;
    setLoading(!hydratedRef.current);
    void walk(genRef.current);
  }, [walk, unauthorized]);

  return { tracks, complete, loading, error, unauthorized, retry };
}
