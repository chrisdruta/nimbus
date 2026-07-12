"use client";

import {
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRepeat,
  IconShuffle,
} from "@/components/ui/icons";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

export function TransportControls() {
  const { playing, shuffled, repeat, current } = usePlayerState();
  const actions = usePlayerActions();
  const disabled = current === null;

  const side = "cursor-pointer text-muted transition hover:text-white disabled:cursor-default disabled:opacity-40";

  return (
    <div className="flex items-center gap-5">
      <button
        aria-label="toggle shuffle"
        onClick={actions.toggleShuffleMode}
        disabled={disabled}
        className={`${side} ${shuffled ? "text-accent hover:text-accent" : ""}`}
      >
        <IconShuffle size={17} />
      </button>
      <button aria-label="previous" onClick={actions.prevTrack} disabled={disabled} className={side}>
        <IconPrev size={20} />
      </button>
      <button
        aria-label={playing ? "pause" : "play"}
        onClick={actions.togglePlay}
        disabled={disabled}
        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white text-black transition hover:scale-105 disabled:cursor-default disabled:opacity-40"
      >
        {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
      </button>
      <button aria-label="next" onClick={actions.nextTrack} disabled={disabled} className={side}>
        <IconNext size={20} />
      </button>
      <button
        aria-label={`repeat: ${repeat}`}
        onClick={actions.cycleRepeat}
        disabled={disabled}
        className={`relative ${side} ${repeat !== "off" ? "text-accent hover:text-accent" : ""}`}
      >
        <IconRepeat size={17} />
        {repeat === "one" && (
          <span className="absolute -top-1 -right-1.5 text-[9px] font-bold text-accent">
            1
          </span>
        )}
      </button>
    </div>
  );
}
