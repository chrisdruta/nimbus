"use client";

import { memo } from "react";
import { artworkSized } from "@/lib/artwork";
import { IconCloud, IconPlay } from "@/components/ui/icons";
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
}: {
  track: ProviderTrack;
  isCurrent: boolean;
  onPlay: () => void;
}) {
  const art = artworkSized(track.artworkUrl, "t300x300");

  return (
    <button
      onClick={onPlay}
      disabled={!track.streamable}
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
      </span>

      {track.streamable && !isCurrent && (
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-xl">
            <IconPlay size={22} />
          </span>
        </span>
      )}
      {isCurrent && <Equalizer />}
    </button>
  );
});
