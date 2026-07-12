"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderTrack } from "@/lib/provider";

export type TrackSource =
  | { kind: "likes" }
  | { kind: "playlist"; id: number };

export function sourceKey(source: TrackSource): string {
  return source.kind === "likes" ? "likes" : `playlist:${source.id}`;
}

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

/** Cursor-paginated track loading with id dedupe. `hasMore` stays true
 * until the provider reports an exhausted cursor. */
export function useTrackPages(source: TrackSource) {
  const key = sourceKey(source);
  const [tracks, setTracks] = useState<ProviderTrack[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cursorRef = useRef<string | null>(null);
  const seenRef = useRef<Set<number>>(new Set());
  const inFlightRef = useRef(false);
  const doneRef = useRef(false);

  // Reset when the source changes.
  useEffect(() => {
    cursorRef.current = null;
    seenRef.current = new Set();
    inFlightRef.current = false;
    doneRef.current = false;
    setTracks([]);
    setHasMore(true);
    setError(null);
    setUnauthorized(false);
  }, [key]);

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || doneRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint(source, cursorRef.current));
      if (res.status === 401) {
        setUnauthorized(true);
        doneRef.current = true;
        setHasMore(false);
        return;
      }
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const page = (await res.json()) as PageResponse;
      const fresh = page.tracks.filter((t) => !seenRef.current.has(t.id));
      for (const t of fresh) seenRef.current.add(t.id);
      setTracks((prev) => [...prev, ...fresh]);
      cursorRef.current = page.nextCursor;
      if (!page.nextCursor) {
        doneRef.current = true;
        setHasMore(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // First page loads eagerly.
  useEffect(() => {
    void loadMore();
  }, [loadMore]);

  return { tracks, loadMore, hasMore, loading, error, unauthorized };
}
