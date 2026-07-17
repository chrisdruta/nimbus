"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePagedList } from "@/lib/hooks/usePagedList";
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
import { useToast } from "@/components/ui/Toast";
import {
  IconArrowLeft,
  IconCloud,
  IconGrid,
  IconList,
  IconPlay,
  IconShuffle,
} from "@/components/ui/icons";

interface ArtistMeta {
  artist: ProviderArtist;
  followed: boolean;
}

/**
 * Artist page: profile header + windowed catalog. The track list pages like
 * the feed (usePagedList), so it only ever registerTracks — never
 * syncSource. The header links back to SoundCloud (creator attribution).
 */
export function ArtistView({ artistId }: { artistId: number }) {
  const router = useRouter();
  const toast = useToast();
  const sourceId = `artist:${artistId}`;

  const [meta, setMeta] = useState<ArtistMeta | null>(null);
  const [metaGone, setMetaGone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setMetaGone(false);
    fetch(`/api/artists/${artistId}`)
      .then((r) => (r.ok ? (r.json() as Promise<ArtistMeta>) : null))
      .then((d) => {
        if (cancelled) return;
        if (d) setMeta(d);
        else setMetaGone(true);
      })
      .catch(() => {
        if (!cancelled) setMetaGone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [artistId]);

  const list = usePagedList<ProviderTrack>(
    sourceId,
    (cursor) =>
      `/api/artists/${artistId}/tracks` +
      (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""),
    (data) => (data as { tracks: ProviderTrack[] }).tracks,
  );
  const tracks = list.items;

  // Loaded pages flow into the metadata cache and, when this artist is
  // what's playing, fold into the live queue. Never syncSource — windowed.
  const actions = usePlayerActions();
  const { queue, shared } = usePlayerState();
  useEffect(() => {
    if (tracks.length > 0) actions.registerTracks(sourceId, tracks);
  }, [tracks, sourceId, actions]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !list.hasMore || list.autoDepthReached) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) list.loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [list.hasMore, list.autoDepthReached, list.loadMore, list]);

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

  const goBack = () =>
    window.history.length > 1 ? router.back() : router.push("/search");

  const toggleFollow = () => {
    if (!meta) return;
    const next = !meta.followed;
    setMeta({ ...meta, followed: next });
    fetch(`/api/artists/${artistId}/follow`, {
      method: next ? "PUT" : "DELETE",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`follow ${res.status}`);
        toast(
          next
            ? `following ${meta.artist.username}`
            : `unfollowed ${meta.artist.username}`,
        );
      })
      .catch(() => {
        setMeta((m) => (m ? { ...m, followed: !next } : m));
        toast("couldn't update follow", "error");
      });
  };

  if (list.unauthorized) {
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

  const artist = meta?.artist ?? null;
  const avatar = artworkSized(artist?.avatarUrl ?? null, "t300x300");
  const place = [artist?.city, artist?.country].filter(Boolean).join(", ");
  const subtitle = artist
    ? [
        artist.followersCount !== null
          ? `${formatCount(artist.followersCount)} ${
              artist.followersCount === 1 ? "follower" : "followers"
            }`
          : null,
        artist.trackCount !== null
          ? `${formatCount(artist.trackCount)} ${
              artist.trackCount === 1 ? "track" : "tracks"
            }`
          : null,
        place || null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <div className="pb-8">
      <header className="bg-gradient-to-b from-black/30 to-transparent px-6 pt-6 pb-4 2xl:px-10">
        <button
          onClick={goBack}
          className="flex cursor-pointer items-center gap-1.5 text-xs text-muted transition hover:text-white"
        >
          <IconArrowLeft size={14} /> back
        </button>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt=""
              className="h-24 w-24 rounded-full object-cover shadow-xl"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-elem/40 text-muted shadow-xl">
              <IconCloud size={32} />
            </div>
          )}
          <div className="min-w-0 flex-1 basis-52">
            <h1 className="truncate text-2xl font-bold 2xl:text-3xl">
              {artist?.username ?? (metaGone ? "unknown artist" : "…")}
            </h1>
            <p className="mt-1 truncate text-xs text-muted 2xl:text-sm">
              {subtitle}
              {artist && (
                <>
                  {subtitle && " · "}
                  <a
                    href={artist.permalinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-white hover:underline"
                  >
                    on SoundCloud
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() =>
                actions.playFrom(sourceId, tracks, undefined, {
                  shuffle: true,
                })
              }
              disabled={playableCount === 0}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:scale-105 disabled:cursor-default disabled:opacity-40"
            >
              <IconShuffle size={16} /> Shuffle
            </button>
            <button
              onClick={() => actions.playFrom(sourceId, tracks)}
              disabled={playableCount === 0}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-elem px-4 py-1.5 text-sm text-muted transition hover:border-muted hover:text-white disabled:cursor-default disabled:opacity-40"
            >
              <IconPlay size={16} /> Play
            </button>
            <button
              onClick={toggleFollow}
              disabled={!meta}
              aria-pressed={meta?.followed ?? false}
              className={`cursor-pointer rounded-full px-4 py-1.5 text-sm transition disabled:cursor-default disabled:opacity-40 ${
                meta?.followed
                  ? "border border-accent text-accent hover:border-muted hover:text-muted"
                  : "border border-elem text-muted hover:border-muted hover:text-white"
              }`}
            >
              {meta?.followed ? "following" : "follow"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex items-center justify-end gap-1.5 px-6 2xl:px-10">
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

      {list.error && (
        <p className="px-6 py-3 text-sm text-accent">
          {list.error}{" "}
          <button onClick={list.retry} className="cursor-pointer underline">
            retry
          </button>
        </p>
      )}

      {layout === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 px-6 pt-3 2xl:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] 2xl:gap-6 2xl:px-10">
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
          {list.loading &&
            Array.from({ length: 12 }, (_, i) => <TileSkeleton key={`s${i}`} />)}
        </div>
      ) : (
        <div className="flex flex-col px-3 pt-3 xl:px-7">
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
          {list.loading &&
            Array.from({ length: 12 }, (_, i) => (
              <div
                key={`s${i}`}
                className="my-0.5 h-[56px] animate-pulse rounded-md bg-bar/40"
              />
            ))}
        </div>
      )}

      {!list.loading && !list.error && tracks.length === 0 && (
        <EmptyState
          message={metaGone ? "this artist isn't available" : "no tracks here"}
        />
      )}

      {list.hasMore && list.autoDepthReached && !list.loading && (
        <div className="flex justify-center pt-6">
          <button
            onClick={list.loadMore}
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
