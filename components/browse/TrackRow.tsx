"use client";

import { memo } from "react";
import { artworkSized } from "@/lib/artwork";
import { formatDuration } from "@/lib/format";
import { IconCloud, IconPlay, IconPlus, IconRadio } from "@/components/ui/icons";
import { Equalizer } from "./Equalizer";
import type { ProviderTrack } from "@/lib/provider";

/** List-layout counterpart of TrackTile — same props, same interaction
 * contract, so collection views can swap the two per display pref. */
export const TrackRow = memo(function TrackRow({
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
  const art = artworkSized(track.artworkUrl, "large");

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
      className={`group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition ${
        track.streamable ? "cursor-pointer hover:bg-white/5" : "opacity-40 grayscale"
      } ${isCurrent ? "bg-white/5" : ""}`}
    >
      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded">
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={art}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-elem/40 text-muted">
            <IconCloud size={16} />
          </span>
        )}
        {track.streamable && !isCurrent && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
            <IconPlay size={16} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm ${isCurrent ? "text-accent" : ""}`}
        >
          {track.title}
        </span>
        <span className="block truncate text-xs text-muted">
          {track.streamable ? track.artist : "unavailable"}
          {reposted && " · ↻ repost"}
        </span>
      </span>
      {track.streamable && onAddToSession && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddToSession();
          }}
          aria-label="queue for session"
          title="queue for session"
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted opacity-0 transition group-hover:opacity-100 hover:text-white"
        >
          <IconPlus size={14} />
        </button>
      )}
      {track.streamable && onStartRadio && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStartRadio();
          }}
          aria-label="start radio"
          title="start radio"
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted opacity-0 transition group-hover:opacity-100 hover:text-white"
        >
          <IconRadio size={14} />
        </button>
      )}
      {isCurrent && <Equalizer className="h-3 shrink-0" />}
      <span className="shrink-0 text-xs tabular-nums text-muted">
        {formatDuration(track.durationMs)}
      </span>
    </div>
  );
});
