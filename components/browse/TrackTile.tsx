"use client";

import { memo } from "react";
import { artworkSized } from "@/lib/artwork";
import { IconCloud, IconPlay, IconRadio } from "@/components/ui/icons";
import type { ProviderTrack } from "@/lib/provider";

function Equalizer() {
  return (
    <span className="absolute right-2 bottom-2 flex h-4 items-end gap-0.5 rounded-sm bg-black/75 p-1">
      {[0.6, 1, 0.75].map((scale, i) => (
        <span
          key={i}
          className="w-0.5 origin-bottom animate-pulse bg-accent"
          style={{ height: `${scale * 100}%`, animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

export const TrackTile = memo(function TrackTile({
  track,
  isCurrent,
  onPlay,
  onStartRadio,
  reposted,
}: {
  track: ProviderTrack;
  isCurrent: boolean;
  onPlay: () => void;
  /** Renders a hover "start radio" affordance when provided. */
  onStartRadio?: () => void;
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

      {/* signature stacked chips */}
      <span className="absolute top-2 left-2 flex max-w-[88%] flex-col items-start gap-1">
        <span className="truncate max-w-full bg-black/75 px-1.5 py-0.5 text-xs font-semibold backdrop-blur-sm">
          {track.title}
        </span>
        <span className="truncate max-w-full bg-black/75 px-1.5 py-0.5 text-xs text-muted backdrop-blur-sm">
          {track.streamable ? track.artist : "unavailable"}
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
      {isCurrent && <Equalizer />}
    </div>
  );
});
