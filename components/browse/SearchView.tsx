"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePagedList } from "@/lib/hooks/usePagedList";
import { normalizeSearchQuery, searchSourceId } from "@/lib/search";
import type { ProviderArtist, ProviderTrack } from "@/lib/provider";
import {
  usePlayerActions,
  usePlayerState,
} from "@/components/player/PlayerProvider";
import { TrackTile } from "./TrackTile";
import { TrackRow } from "./TrackRow";
import { TileSkeleton } from "./TileSkeleton";
import { EmptyState } from "./EmptyState";
import { useBrowseDisplayPrefs } from "./useBrowseDisplayPrefs";
import { currentTrackId } from "@/lib/queue";
import { artworkSized } from "@/lib/artwork";
import { formatCount } from "@/lib/format";
import {
  IconCloud,
  IconGrid,
  IconList,
  IconSearch,
} from "@/components/ui/icons";

type Tab = "tracks" | "artists";

/**
 * Debounced catalog search. Query and tab live in the URL (?q=…&tab=…) via
 * shallow history replaces, so leaving for an artist page and coming back
 * restores the results. Result lists are windowed (usePagedList): only ever
 * registerTracks, never syncSource — same rule as FeedView.
 */
export function SearchView() {
  const params = useSearchParams();
  const [input, setInput] = useState(() => params.get("q") ?? "");
  const [tab, setTab] = useState<Tab>(() =>
    params.get("tab") === "artists" ? "artists" : "tracks",
  );
  const [query, setQuery] = useState(() =>
    normalizeSearchQuery(params.get("q") ?? ""),
  );

  useEffect(() => {
    const t = setTimeout(() => setQuery(normalizeSearchQuery(input)), 300);
    return () => clearTimeout(t);
  }, [input]);

  // Shallow URL sync — no router.replace, which would refetch the RSC tree
  // on every keystroke's debounce.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    if (tab === "artists") qs.set("tab", "artists");
    const url = qs.size > 0 ? `/search?${qs.toString()}` : "/search";
    window.history.replaceState(null, "", url);
  }, [query, tab]);

  const sourceId = searchSourceId(query);
  const actions = usePlayerActions();
  const { queue, shared } = usePlayerState();

  const trackList = usePagedList<ProviderTrack>(
    query && tab === "tracks" ? `tracks:${query}` : null,
    (cursor) =>
      `/api/search/tracks?q=${encodeURIComponent(query)}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
    (data) => (data as { tracks: ProviderTrack[] }).tracks,
  );
  const artistList = usePagedList<ProviderArtist>(
    query && tab === "artists" ? `artists:${query}` : null,
    (cursor) =>
      `/api/search/artists?q=${encodeURIComponent(query)}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
    (data) => (data as { artists: ProviderArtist[] }).artists,
  );
  const active = tab === "tracks" ? trackList : artistList;
  const tracks = trackList.items;

  // Loaded results flow into the metadata cache and, when this search is
  // what's playing, fold into the live queue. Never syncSource — windowed.
  useEffect(() => {
    if (tracks.length > 0) actions.registerTracks(sourceId, tracks);
  }, [tracks, sourceId, actions]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !active.hasMore || active.autoDepthReached) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) active.loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active.hasMore, active.autoDepthReached, active.loadMore, active]);

  const { layout, setLayout } = useBrowseDisplayPrefs();
  const playingId =
    queue && queue.sourceId === sourceId ? currentTrackId(queue) : null;
  const playableCount = useMemo(
    () => tracks.filter((t) => t.streamable).length,
    [tracks],
  );

  const playTrack = (id: number) =>
    id === playingId
      ? actions.togglePlay()
      : queue?.sourceId === sourceId
        ? actions.jumpToTrack(id)
        : actions.playFrom(sourceId, tracks, id);
  const addToSession = shared
    ? (t: ProviderTrack) => () => actions.addToSharedQueue(t)
    : undefined;

  if (active.unauthorized) {
    return (
      <div className="flex flex-col items-center gap-4 py-32">
        <p className="text-muted">your session expired</p>
        <a
          href="/api/auth/login"
          className="rounded-full bg-accent px-6 py-2.5 text-white transition hover:scale-105"
        >
          Sign in with SoundCloud
        </a>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <div className="mx-auto w-full max-w-2xl px-6 pt-12">
        <div className="relative">
          <IconSearch
            size={16}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
          />
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="search soundcloud"
            aria-label="search"
            className="w-full rounded-full border border-elem bg-transparent py-3 pr-5 pl-11 text-sm outline-none transition focus:border-muted"
          />
        </div>

        {query && (
          <div className="mt-4 flex items-center gap-1.5">
            {(["tracks", "artists"] as const).map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
                className={`cursor-pointer rounded-full px-4 py-1.5 text-sm transition ${
                  tab === t
                    ? "bg-white/10 text-white"
                    : "text-muted hover:text-white"
                }`}
              >
                {t}
              </button>
            ))}
            {tab === "tracks" && (
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  aria-label="grid view"
                  title="grid view"
                  aria-pressed={layout === "grid"}
                  onClick={() => setLayout("grid")}
                  className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition ${
                    layout === "grid"
                      ? "bg-white/10 text-white"
                      : "text-muted hover:text-white"
                  }`}
                >
                  <IconGrid size={15} />
                </button>
                <button
                  aria-label="list view"
                  title="list view"
                  aria-pressed={layout === "list"}
                  onClick={() => setLayout("list")}
                  className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition ${
                    layout === "list"
                      ? "bg-white/10 text-white"
                      : "text-muted hover:text-white"
                  }`}
                >
                  <IconList size={15} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {active.error && (
        <p className="px-6 py-3 text-center text-sm text-accent">
          {active.error}{" "}
          <button onClick={active.retry} className="cursor-pointer underline">
            retry
          </button>
        </p>
      )}

      {!query && (
        <p className="pt-24 text-center text-sm text-muted">
          find tracks and artists on soundcloud
        </p>
      )}

      {query && tab === "tracks" && (
        <>
          {layout === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 px-6 pt-6 xl:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] xl:gap-6 xl:px-10">
              {tracks.map((t) => (
                <TrackTile
                  key={t.id}
                  track={t}
                  isCurrent={t.id === playingId}
                  onPlay={() => playTrack(t.id)}
                  onStartRadio={() => actions.startRadio(t)}
                  onAddToSession={addToSession?.(t)}
                />
              ))}
              {trackList.loading &&
                Array.from({ length: 12 }, (_, i) => (
                  <TileSkeleton key={`s${i}`} />
                ))}
            </div>
          ) : (
            <div className="flex flex-col px-3 pt-6 xl:px-7">
              {tracks.map((t) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  isCurrent={t.id === playingId}
                  onPlay={() => playTrack(t.id)}
                  onStartRadio={() => actions.startRadio(t)}
                  onAddToSession={addToSession?.(t)}
                />
              ))}
              {trackList.loading &&
                Array.from({ length: 12 }, (_, i) => (
                  <div
                    key={`s${i}`}
                    className="my-0.5 h-[56px] animate-pulse rounded-md bg-bar/40"
                  />
                ))}
            </div>
          )}
          {!trackList.loading && !trackList.error && tracks.length === 0 && (
            <EmptyState message={`no tracks for “${query}”`} />
          )}
          {playableCount === 0 && tracks.length > 0 && (
            <p className="px-6 pt-3 text-center text-xs text-muted">
              nothing here is playable
            </p>
          )}
        </>
      )}

      {query && tab === "artists" && (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 px-6 pt-6 xl:px-10">
            {artistList.items.map((a) => (
              <Link
                key={a.id}
                href={`/artists/${a.id}`}
                className="group flex flex-col items-center gap-2.5 rounded-xl p-4 text-center transition hover:bg-white/5"
              >
                {a.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={artworkSized(a.avatarUrl, "t300x300") ?? undefined}
                    alt=""
                    loading="lazy"
                    className="h-24 w-24 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-24 w-24 items-center justify-center rounded-full bg-elem text-muted">
                    <IconCloud size={28} />
                  </span>
                )}
                <span className="w-full truncate text-sm">{a.username}</span>
                {a.followersCount !== null && (
                  <span className="-mt-1.5 text-xs text-muted">
                    {formatCount(a.followersCount)}{" "}
                    {a.followersCount === 1 ? "follower" : "followers"}
                  </span>
                )}
              </Link>
            ))}
            {artistList.loading &&
              Array.from({ length: 12 }, (_, i) => (
                <div
                  key={`s${i}`}
                  className="flex flex-col items-center gap-2.5 p-4"
                >
                  <span className="h-24 w-24 animate-pulse rounded-full bg-bar/40" />
                  <span className="h-3 w-20 animate-pulse rounded bg-bar/40" />
                </div>
              ))}
          </div>
          {!artistList.loading &&
            !artistList.error &&
            artistList.items.length === 0 && (
              <EmptyState message={`no artists for “${query}”`} />
            )}
        </>
      )}

      {query && active.hasMore && active.autoDepthReached && !active.loading && (
        <div className="flex justify-center pt-6">
          <button
            onClick={active.loadMore}
            className="cursor-pointer rounded-full border border-elem px-5 py-2 text-sm text-muted transition hover:border-muted hover:text-white"
          >
            load more
          </button>
        </div>
      )}

      <div ref={sentinelRef} className="h-px" />
    </div>
  );
}
