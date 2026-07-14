"use client";

import { memo } from "react";
import Link from "next/link";
import { artworkSized } from "@/lib/artwork";
import { IconCloud, IconPlay, IconPlus, IconRadio } from "@/components/ui/icons";
import { Equalizer } from "./Equalizer";
import type { ProviderTrack } from "@/lib/provider";

export const TrackTile = memo(function TrackTile({
  track,
  isCurrent,
  onPlay,
  onStartRadio,
  onAddToSession,
  reposted,
}: {
  track: ProviderTrack;
  isCurrent: boolean;
  onPlay: () => void;
  /** Renders a hover "start radio" affordance when provided. */
  onStartRadio?: () => void;
  /** Renders a hover "queue for session" affordance when provided
   * (i.e. while a shared slipstream session is active). */
  onAddToSession?: () => void;
  /** Feed items: this track reached the feed as a repost. */
  reposted?: boolean;
}) {
  const art = artworkSized(track.artworkUrl, "t300x300");

  return (
    // A div with button semantics — the radio affordance is a real <button>
    // inside, and buttons can't nest.
    <div
      role="button"
      tabIndex={track.streamable ? 0 : -1}
      aria-disabled={!track.streamable}
      onClick={track.streamable ? onPlay : undefined}
      onKeyDown={(e) => {
        if (!track.streamable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay();
        }
      }}
      title={
        track.streamable
          ? `${track.title} — ${track.artist}`
          : `${track.title} — unavailable`
      }
      className={`group relative aspect-square overflow-hidden rounded-md bg-bar/40 text-left ${
        track.streamable ? "cursor-pointer" : "opacity-40 grayscale"
      } ${isCurrent ? "ring-2 ring-accent" : ""}`}
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={art}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.04] group-hover:brightness-75"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-elem">
          <IconCloud size={56} />
        </div>
      )}

      {/* signature stacked chips; z-10 keeps the artist link clickable
          above the hover play overlay */}
      <span className="absolute top-2 left-2 z-10 flex max-w-[88%] flex-col items-start gap-1">
        <span className="line-clamp-2 max-w-full bg-black/75 px-1.5 py-0.5 text-xs font-semibold backdrop-blur-sm">
          {track.title}
        </span>
        <span className="truncate max-w-full bg-black/75 px-1.5 py-0.5 text-xs text-muted backdrop-blur-sm">
          {!track.streamable ? (
            "unavailable"
          ) : track.artistId ? (
            <Link
              href={`/artists/${track.artistId}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:text-white hover:underline"
            >
              {track.artist}
            </Link>
          ) : (
            track.artist
          )}
        </span>
        {reposted && (
          <span className="bg-black/75 px-1.5 py-0.5 text-[10px] text-muted backdrop-blur-sm">
            ↻ repost
          </span>
        )}
      </span>

      {track.streamable && !isCurrent && (
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-xl">
            <IconPlay size={22} />
          </span>
        </span>
      )}
      {track.streamable && onStartRadio && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStartRadio();
          }}
          aria-label="start radio"
          title="start radio"
          className="absolute bottom-2 left-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/75 text-muted opacity-0 transition group-hover:opacity-100 hover:text-white"
        >
          <IconRadio size={14} />
        </button>
      )}
      {track.streamable && onAddToSession && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddToSession();
          }}
          aria-label="queue for session"
          title="queue for session"
          className="absolute bottom-2 left-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/75 text-muted opacity-0 transition group-hover:opacity-100 hover:text-white"
        >
          <IconPlus size={14} />
        </button>
      )}
      {isCurrent && (
        <span className="absolute right-2 bottom-2 rounded-sm bg-black/75 p-1">
          <Equalizer className="h-2" />
        </span>
      )}
    </div>
  );
});
