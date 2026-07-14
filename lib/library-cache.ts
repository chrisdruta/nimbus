/**
 * Pure library-cache logic: record shape, validation, page merging, and the
 * freshness policy that decides when a cached walk can stand in for a fresh
 * one. IndexedDB access lives in lib/idb.ts; this module never touches it.
 */

import type { ProviderTrack } from "@/lib/provider";

export type TrackSource =
  | { kind: "likes" }
  | { kind: "playlist"; id: number };

export function sourceKey(source: TrackSource): string {
  return source.kind === "likes" ? "likes" : `playlist:${source.id}`;
}

export interface CachedLibrary {
  v: 1;
  userId: number;
  sourceKey: string;
  /** Provider order, id-deduped, complete only when `complete` is true. */
  tracks: ProviderTrack[];
  complete: boolean;
  /** ms epoch of the last completed walk. */
  fetchedAt: number;
}

/** A completed walk older than this always re-walks. */
export const WALK_TTL_MS = 24 * 60 * 60 * 1000;
/** Records untouched for this long are pruned on startup. */
export const EVICT_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function cacheKey(userId: number, key: string): string {
  return `${userId}:${key}`;
}

function isTrack(t: unknown): t is ProviderTrack {
  if (typeof t !== "object" || t === null) return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.id === "number" &&
    typeof o.title === "string" &&
    typeof o.artist === "string" &&
    // Optional: records cached before the field existed stay valid.
    (o.artistId === undefined || typeof o.artistId === "number") &&
    typeof o.artistUrl === "string" &&
    (o.artworkUrl === null || typeof o.artworkUrl === "string") &&
    typeof o.permalinkUrl === "string" &&
    typeof o.durationMs === "number" &&
    typeof o.streamable === "boolean"
  );
}

export function validateCachedLibrary(v: unknown): v is CachedLibrary {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.userId === "number" &&
    typeof o.sourceKey === "string" &&
    typeof o.complete === "boolean" &&
    typeof o.fetchedAt === "number" &&
    Array.isArray(o.tracks) &&
    o.tracks.every(isTrack)
  );
}

/** Merge a page into an accumulated list, dropping ids already present. */
export function appendPage(
  tracks: readonly ProviderTrack[],
  page: readonly ProviderTrack[],
): ProviderTrack[] {
  const seen = new Set(tracks.map((t) => t.id));
  return [...tracks, ...page.filter((t) => !seen.has(t.id))];
}

/**
 * Leading-id comparison: likes are prepend-only on SoundCloud, so a first
 * page identical to the cache's head means nothing new arrived up front.
 * `hasMore` is whether the first page came back with a next cursor — when
 * it didn't, the page IS the whole collection and the check is exact.
 */
export function firstPageChanged(
  cached: readonly ProviderTrack[],
  firstPage: readonly ProviderTrack[],
  hasMore: boolean,
): boolean {
  if (!hasMore && cached.length !== firstPage.length) return true;
  const n = Math.min(cached.length, firstPage.length);
  for (let i = 0; i < n; i++) {
    if (cached[i].id !== firstPage[i].id) return true;
  }
  // Cache shorter than one page while the server has more: rows appeared.
  return cached.length < firstPage.length;
}

/**
 * A cached walk stands in for a fresh one only when it finished, is within
 * TTL, and the fresh first page matches its head. Removals deeper than one
 * page are the blind spot; the TTL bounds how long they can hide.
 */
export function shouldSkipWalk(
  rec: CachedLibrary | null,
  firstPage: readonly ProviderTrack[],
  hasMore: boolean,
  now: number,
): boolean {
  if (!rec || !rec.complete) return false;
  if (now - rec.fetchedAt > WALK_TTL_MS) return false;
  return !firstPageChanged(rec.tracks, firstPage, hasMore);
}
