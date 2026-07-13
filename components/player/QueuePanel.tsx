"use client";

import { artworkSized } from "@/lib/artwork";
import { IconCloud, IconX } from "@/components/ui/icons";
import { formatDuration } from "@/lib/format";
import { currentTrackId, type QueueTrack } from "@/lib/queue";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

function Row({
  track,
  onClick,
  highlight = false,
}: {
  track: QueueTrack;
  onClick?: () => void;
  highlight?: boolean;
}) {
  const art = artworkSized(track.artworkUrl, "large");
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left ${
        onClick ? "cursor-pointer hover:bg-white/5" : ""
      }`}
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt="" className="h-9 w-9 rounded object-cover" />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded bg-elem/40 text-muted">
          <IconCloud size={14} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${highlight ? "text-accent" : ""}`}>
          {track.title}
        </p>
        <p className="truncate text-xs text-muted">{track.artist}</p>
      </div>
      <span className="text-xs tabular-nums text-muted">
        {formatDuration(track.durationMs)}
      </span>
    </button>
  );
}

export function QueuePanel({ onClose }: { onClose: () => void }) {
  const { current, shuffled, shuffleMode, caps, slipstream, queue } =
    usePlayerState();
  const actions = usePlayerActions();
  const upNext = actions.upcomingTracks(40);
  const hostName = slipstream?.host.username ?? "member";
  const upNextLabel = slipstream
    ? `up next · from ${hostName}`
    : shuffled
      ? shuffleMode === "classic"
        ? "up next · shuffled"
        : `up next · shuffled (${shuffleMode})`
      : "up next";
  // The queue engine still holds the parked local queue while following.
  const parkedId = slipstream && queue ? currentTrackId(queue) : null;
  const parked = parkedId !== null ? actions.getMeta(parkedId) : undefined;

  return (
    <div className="fixed top-0 right-0 bottom-[88px] z-30 flex w-80 flex-col bg-side shadow-2xl">
      <div className="flex items-center justify-between p-4 pb-2">
        <h2 className="text-sm font-semibold tracking-widest text-muted uppercase">
          {slipstream ? "Slipstream" : "Queue"}
        </h2>
        <button
          aria-label="close queue"
          onClick={onClose}
          className="cursor-pointer text-muted hover:text-white"
        >
          <IconX size={16} />
        </button>
      </div>
      {slipstream && (
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="truncate text-xs text-accent">
            in {hostName}&apos;s slipstream
          </span>
          <button
            onClick={actions.leaveSlipstream}
            className="shrink-0 cursor-pointer text-xs text-muted transition hover:text-accent"
          >
            leave slipstream
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {current && (
          <>
            <p className="px-2 py-1 text-xs text-muted">now playing</p>
            <Row track={current} highlight />
          </>
        )}
        <p className="px-2 py-1 pt-3 text-xs text-muted">{upNextLabel}</p>
        {upNext.length === 0 && (
          <p className="px-2 py-2 text-sm text-muted">
            {slipstream ? `waiting for ${hostName}…` : "end of queue"}
          </p>
        )}
        {upNext.map((t) => (
          <Row
            key={t.id}
            track={t}
            onClick={
              caps.canJump ? () => actions.jumpToTrack(t.id) : undefined
            }
          />
        ))}
      </div>
      {slipstream && parked && (
        <div className="flex items-center justify-between gap-2 border-t border-black/40 px-4 py-3">
          <p className="min-w-0 truncate text-xs text-muted">
            your queue · paused on &ldquo;{parked.title}&rdquo;
          </p>
          <button
            onClick={actions.leaveSlipstream}
            className="shrink-0 cursor-pointer text-xs text-muted transition hover:text-accent"
          >
            return
          </button>
        </div>
      )}
    </div>
  );
}
