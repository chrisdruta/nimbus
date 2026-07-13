"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFeed } from "@/lib/hooks/useFeed";
import { FEED_SOURCE_ID } from "@/lib/feed";
import {
  usePlayerActions,
  usePlayerState,
} from "@/components/player/PlayerProvider";
import { HeaderBand } from "./HeaderBand";
import { TrackTile } from "./TrackTile";
import { TileSkeleton } from "./TileSkeleton";
import { EmptyState } from "./EmptyState";
import { IconPlay, IconShuffle } from "@/components/ui/icons";
import { artworkSized } from "@/lib/artwork";
import { currentTrackId } from "@/lib/queue";

/**
 * The feed browse page. Structurally BrowseView's sibling, but backed by
 * the paged useFeed hook instead of useLibrary: the list is never complete,
 * so this component must ONLY ever registerTracks — syncSource would treat
 * the loaded window as the whole collection and drop queued ids that
 * scrolled out of it.
 */
export function FeedView() {
  const { items, tracks, loadMore, hasMore, autoDepthReached, loading, error, unauthorized, retry } =
    useFeed();
  const actions = usePlayerActions();
  const { queue } = usePlayerState();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const headerEndRef = useRef<HTMLDivElement>(null);
  const [slim, setSlim] = useState(false);

  useEffect(() => {
    const el = headerEndRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      setSlim(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Loaded pages flow into the metadata cache and, when the feed is what's
  // playing, fold into the live queue. Never syncSource — see above.
  useEffect(() => {
    if (tracks.length > 0) actions.registerTracks(FEED_SOURCE_ID, tracks);
  }, [tracks, actions]);

  // Scroll auto-loads more pages until the depth gate; past it the explicit
  // button below takes over.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || autoDepthReached) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, autoDepthReached, loadMore]);

  const playingId =
    queue && queue.sourceId === FEED_SOURCE_ID ? currentTrackId(queue) : null;
  const playableCount = useMemo(
    () => tracks.filter((t) => t.streamable).length,
    [tracks],
  );

  if (unauthorized) {
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
      <div className="sticky top-0 z-20 h-0">
        <div
          className={`glass flex items-center gap-3 border-b border-white/5 py-2 pr-16 pl-6 transition-opacity duration-200 ${
            slim ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          {tracks[0]?.artworkUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artworkSized(tracks[0].artworkUrl, "large") ?? undefined}
              alt=""
              className="h-9 w-9 rounded object-cover"
            />
          )}
          <h2 className="min-w-0 truncate font-semibold">feed</h2>
          <span className="shrink-0 text-xs text-muted">
            {tracks.length} tracks
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              aria-label="shuffle all"
              title="shuffle all"
              onClick={() =>
                actions.playFrom(FEED_SOURCE_ID, tracks, undefined, {
                  shuffle: true,
                })
              }
              disabled={playableCount === 0}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-accent text-white transition hover:scale-105 disabled:cursor-default disabled:opacity-40"
            >
              <IconShuffle size={14} />
            </button>
            <button
              aria-label="play all"
              title="play all"
              onClick={() => actions.playFrom(FEED_SOURCE_ID, tracks)}
              disabled={playableCount === 0}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-elem text-muted transition hover:border-muted hover:text-white disabled:cursor-default disabled:opacity-40"
            >
              <IconPlay size={14} />
            </button>
          </div>
        </div>
      </div>

      <HeaderBand
        title="feed"
        artworkUrl={tracks[0]?.artworkUrl ?? null}
        subtitle={`${tracks.length} tracks · from the people you follow`}
        actions={
          <>
            <button
              onClick={() =>
                actions.playFrom(FEED_SOURCE_ID, tracks, undefined, {
                  shuffle: true,
                })
              }
              disabled={playableCount === 0}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:scale-105 disabled:cursor-default disabled:opacity-40"
            >
              <IconShuffle size={16} /> Shuffle
            </button>
            <button
              onClick={() => actions.playFrom(FEED_SOURCE_ID, tracks)}
              disabled={playableCount === 0}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-elem px-5 py-2 text-sm text-muted transition hover:border-muted hover:text-white disabled:cursor-default disabled:opacity-40"
            >
              <IconPlay size={16} /> Play
            </button>
          </>
        }
      />
      <div ref={headerEndRef} className="h-px" />

      {error && (
        <p className="px-6 py-3 text-sm text-accent">
          {error}{" "}
          <button onClick={retry} className="cursor-pointer underline">
            retry
          </button>
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 px-6 pt-6">
        {items.map(({ track, reposted }) => (
          <TrackTile
            key={track.id}
            track={track}
            isCurrent={track.id === playingId}
            reposted={reposted}
            onPlay={() =>
              track.id === playingId
                ? actions.togglePlay()
                : queue?.sourceId === FEED_SOURCE_ID
                  ? actions.jumpToTrack(track.id)
                  : actions.playFrom(FEED_SOURCE_ID, tracks, track.id)
            }
            onStartRadio={() => actions.startRadio(track)}
          />
        ))}
        {loading &&
          Array.from({ length: 12 }, (_, i) => <TileSkeleton key={`s${i}`} />)}
      </div>

      {!loading && !error && tracks.length === 0 && (
        <EmptyState message="nothing here yet — follow some artists on SoundCloud" />
      )}

      {hasMore && autoDepthReached && !loading && (
        <div className="flex justify-center pt-6">
          <button
            onClick={loadMore}
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
