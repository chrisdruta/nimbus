"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useLibrary,
  sourceKey,
  type TrackSource,
} from "@/lib/hooks/useLibrary";
import type { ProviderTrack } from "@/lib/provider";
import {
  usePlayerActions,
  usePlayerState,
} from "@/components/player/PlayerProvider";
import { HeaderBand } from "./HeaderBand";
import { TrackTile } from "./TrackTile";
import { TrackRow } from "./TrackRow";
import { TileSkeleton } from "./TileSkeleton";
import { EmptyState } from "./EmptyState";
import { useBrowseDisplayPrefs } from "./useBrowseDisplayPrefs";
import {
  IconEye,
  IconEyeOff,
  IconGrid,
  IconList,
  IconPlay,
  IconShuffle,
} from "@/components/ui/icons";
import { artworkSized } from "@/lib/artwork";
import { currentTrackId } from "@/lib/queue";
import { useAuthenticatedUserId } from "@/components/auth/AuthenticatedUser";

const WINDOW_STEP = 50;

export function BrowseView({
  source,
  title,
  subtitle,
}: {
  source: TrackSource;
  title: string;
  subtitle?: string;
}) {
  const userId = useAuthenticatedUserId();
  const key = sourceKey(source);
  const { tracks, complete, loading, error, unauthorized, retry } = useLibrary(
    source,
    userId,
  );
  const actions = usePlayerActions();
  const { queue, shared } = usePlayerState();
  const sentinelRef = useRef<HTMLDivElement>(null);
  // The hook holds the whole collection; the DOM gets a growing window.
  const [visibleCount, setVisibleCount] = useState(WINDOW_STEP);
  // Slim pinned header appears once the full HeaderBand scrolls away.
  const headerEndRef = useRef<HTMLDivElement>(null);
  const [slim, setSlim] = useState(false);

  useEffect(() => {
    setVisibleCount(WINDOW_STEP);
  }, [key]);

  useEffect(() => {
    const el = headerEndRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      setSlim(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pages flow into the metadata cache and, when this source is what's
  // playing, mix into the live queue. A completed walk also reconciles
  // removals — syncSource only ever sees the full list.
  useEffect(() => {
    if (tracks.length === 0) return;
    if (complete) actions.syncSource(key, tracks);
    else actions.registerTracks(key, tracks);
  }, [tracks, complete, key, actions]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((n) => n + WINDOW_STEP);
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { layout, setLayout, hideUnplayable, setHideUnplayable } =
    useBrowseDisplayPrefs();

  const playingId =
    queue && queue.sourceId === key ? currentTrackId(queue) : null;
  const playableCount = useMemo(
    () => tracks.filter((t) => t.streamable).length,
    [tracks],
  );
  // Display-only filter: every player call (playFrom/syncSource/register)
  // keeps the unfiltered list — hiding never changes what plays.
  const displayTracks = useMemo(
    () => (hideUnplayable ? tracks.filter((t) => t.streamable) : tracks),
    [tracks, hideUnplayable],
  );
  const visible = displayTracks.slice(0, visibleCount);

  const playTrack = (id: number) =>
    id === playingId
      ? actions.togglePlay()
      : queue?.sourceId === key
        ? actions.jumpToTrack(id)
        : actions.playFrom(key, tracks, id);

  // In a shared session (hosting or joined), tiles/rows grow a hover
  // "queue for session" affordance.
  const addToSession = shared
    ? (t: ProviderTrack) => () => actions.addToSharedQueue(t)
    : undefined;

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
      {/* Slim pinned header: zero-height sticky shell so it takes no flow
          space; fades in once the big header has scrolled away. pr-16
          clears the shell's anchored open-queue button. */}
      <div className="sticky top-0 z-20 h-0">
        <div
          className={`glass flex items-center gap-3 border-b border-white/5 py-2 pr-16 pl-6 transition-opacity duration-200 xl:pl-10 ${
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
          <h2 className="min-w-0 truncate font-semibold">{title}</h2>
          <span className="shrink-0 text-xs text-muted">
            {tracks.length} tracks
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              aria-label="shuffle all"
              title="shuffle all"
              onClick={() =>
                actions.playFrom(key, tracks, undefined, { shuffle: true })
              }
              disabled={playableCount === 0}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-accent text-white transition hover:scale-105 disabled:cursor-default disabled:opacity-40"
            >
              <IconShuffle size={14} />
            </button>
            <button
              aria-label="play all"
              title="play all"
              onClick={() => actions.playFrom(key, tracks)}
              disabled={playableCount === 0}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-elem text-muted transition hover:border-muted hover:text-white disabled:cursor-default disabled:opacity-40"
            >
              <IconPlay size={14} />
            </button>
          </div>
        </div>
      </div>

      <HeaderBand
        title={title}
        artworkUrl={tracks[0]?.artworkUrl ?? null}
        subtitle={
          subtitle ??
          (complete
            ? `${tracks.length} tracks · ${playableCount} playable`
            : `${tracks.length}+ tracks · syncing…`)
        }
        actions={
          <>
            <button
              onClick={() =>
                actions.playFrom(key, tracks, undefined, { shuffle: true })
              }
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
      <div ref={headerEndRef} className="h-px" />

      <div className="flex items-center gap-1.5 px-6 pt-6 xl:px-10">
        {hideUnplayable && displayTracks.length < tracks.length && (
          <span className="text-xs text-muted">
            showing {displayTracks.length} of {tracks.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            aria-label={
              hideUnplayable ? "show unplayable" : "hide unplayable"
            }
            title={hideUnplayable ? "show unplayable" : "hide unplayable"}
            aria-pressed={hideUnplayable}
            onClick={() => setHideUnplayable(!hideUnplayable)}
            className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition ${
              hideUnplayable
                ? "bg-white/10 text-white"
                : "text-muted hover:text-white"
            }`}
          >
            {hideUnplayable ? <IconEyeOff size={15} /> : <IconEye size={15} />}
          </button>
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
      </div>

      {error && (
        <p className="px-6 py-3 text-sm text-accent">
          {error}{" "}
          <button onClick={retry} className="cursor-pointer underline">
            retry
          </button>
        </p>
      )}

      {layout === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 px-6 pt-3 xl:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] xl:gap-6 xl:px-10">
          {visible.map((t) => (
            <TrackTile
              key={t.id}
              track={t}
              isCurrent={t.id === playingId}
              onPlay={() => playTrack(t.id)}
              onStartRadio={() => actions.startRadio(t)}
              onAddToSession={addToSession?.(t)}
            />
          ))}
          {loading &&
            Array.from({ length: 12 }, (_, i) => (
              <TileSkeleton key={`s${i}`} />
            ))}
        </div>
      ) : (
        <div className="flex flex-col px-3 pt-3 xl:px-7">
          {visible.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              isCurrent={t.id === playingId}
              onPlay={() => playTrack(t.id)}
              onStartRadio={() => actions.startRadio(t)}
              onAddToSession={addToSession?.(t)}
            />
          ))}
          {loading &&
            Array.from({ length: 12 }, (_, i) => (
              <div
                key={`s${i}`}
                className="my-0.5 h-[56px] animate-pulse rounded-md bg-bar/40"
              />
            ))}
        </div>
      )}

      {!loading && !error && tracks.length === 0 && complete && (
        <EmptyState message="nothing here yet" />
      )}
      {!loading &&
        !error &&
        tracks.length > 0 &&
        displayTracks.length === 0 && (
          <EmptyState message="everything here is unavailable" />
        )}

      <div ref={sentinelRef} className="h-px" />
    </div>
  );
}
