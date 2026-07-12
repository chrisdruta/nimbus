"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTrackPages, sourceKey, type TrackSource } from "@/lib/hooks/useTrackPages";
import { usePlayerActions, usePlayerState } from "@/components/player/PlayerProvider";
import { HeaderBand } from "./HeaderBand";
import { TrackTile } from "./TrackTile";
import { TileSkeleton } from "./TileSkeleton";
import { EmptyState } from "./EmptyState";
import { IconPlay, IconShuffle } from "@/components/ui/icons";
import { currentTrackId } from "@/lib/queue";

export function BrowseView({
  source,
  title,
  subtitle,
}: {
  source: TrackSource;
  title: string;
  subtitle?: string;
}) {
  const key = sourceKey(source);
  const { tracks, loadMore, hasMore, loading, error, unauthorized } =
    useTrackPages(source);
  const actions = usePlayerActions();
  const { queue } = usePlayerState();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Newly loaded pages flow into the metadata cache and, when this source
  // is what's playing, into the live queue.
  useEffect(() => {
    if (tracks.length > 0) actions.registerTracks(key, tracks);
  }, [tracks, key, actions]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const playingId =
    queue && queue.sourceId === key ? currentTrackId(queue) : null;
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
      <HeaderBand
        title={title}
        artworkUrl={tracks[0]?.artworkUrl ?? null}
        subtitle={
          subtitle ??
          `${tracks.length}${hasMore ? "+" : ""} tracks · ${playableCount} playable`
        }
        actions={
          <>
            <button
              onClick={() => actions.playFrom(key, tracks, undefined, { shuffle: true })}
              disabled={playableCount === 0}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:scale-105 disabled:cursor-default disabled:opacity-40"
            >
              <IconShuffle size={16} /> Shuffle
            </button>
            <button
              onClick={() => actions.playFrom(key, tracks)}
              disabled={playableCount === 0}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-elem px-5 py-2 text-sm text-muted transition hover:border-muted hover:text-white disabled:cursor-default disabled:opacity-40"
            >
              <IconPlay size={16} /> Play
            </button>
          </>
        }
      />

      {error && (
        <p className="px-6 py-3 text-sm text-accent">
          {error}{" "}
          <button onClick={() => void loadMore()} className="cursor-pointer underline">
            retry
          </button>
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 px-6 pt-6">
        {tracks.map((t) => (
          <TrackTile
            key={t.id}
            track={t}
            isCurrent={t.id === playingId}
            onPlay={() =>
              t.id === playingId
                ? actions.togglePlay()
                : queue?.sourceId === key
                  ? actions.jumpToTrack(t.id)
                  : actions.playFrom(key, tracks, t.id)
            }
          />
        ))}
        {loading &&
          Array.from({ length: 12 }, (_, i) => <TileSkeleton key={`s${i}`} />)}
      </div>

      {!loading && !error && tracks.length === 0 && !hasMore && (
        <EmptyState message="nothing here yet" />
      )}

      <div ref={sentinelRef} className="h-px" />
    </div>
  );
}
