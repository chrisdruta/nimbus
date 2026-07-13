"use client";

import { useState } from "react";
import {
  IconChevronUp,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRepeat,
  IconShuffle,
} from "@/components/ui/icons";
import { ShuffleMenu } from "./ShuffleMenu";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

export function TransportControls() {
  const { playing, shuffled, shuffleMode, repeat, current, caps } =
    usePlayerState();
  const actions = usePlayerActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const disabled = current === null;
  // Present when the source (not the moment) forbids a control.
  const hostHint = (allowed: boolean) =>
    allowed ? undefined : "host controls playback";

  const side = "cursor-pointer text-muted transition hover:text-white disabled:cursor-default disabled:opacity-40";

  return (
    <div className="flex items-center gap-6">
      <div className="relative flex items-center gap-0.5">
        <button
          aria-label={`toggle shuffle (${shuffled ? `on · ${shuffleMode}` : "off"})`}
          onClick={actions.toggleShuffleMode}
          disabled={disabled || !caps.canShuffle}
          title={hostHint(caps.canShuffle) ?? (shuffled ? `shuffle on · ${shuffleMode}` : "shuffle off")}
          className={`relative ${side} ${shuffled ? "text-accent hover:text-accent" : ""}`}
        >
          <IconShuffle size={18} />
          {/* on-state dot, mirroring the familiar player convention */}
          {shuffled && (
            <span className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
          )}
        </button>
        <button
          aria-label="choose shuffle mode"
          onClick={() => setMenuOpen((o) => !o)}
          disabled={disabled || !caps.canShuffle}
          title={hostHint(caps.canShuffle) ?? "shuffle mode"}
          className={`-mr-2 rounded p-0.5 ${side} hover:bg-white/5`}
        >
          <IconChevronUp size={14} />
        </button>
        {menuOpen && <ShuffleMenu onClose={() => setMenuOpen(false)} />}
      </div>
      <button
        aria-label="previous"
        onClick={actions.prevTrack}
        disabled={disabled || !caps.canSkip}
        title={hostHint(caps.canSkip)}
        className={side}
      >
        <IconPrev size={22} />
      </button>
      <button
        aria-label={playing ? "pause" : "play"}
        onClick={actions.togglePlay}
        disabled={disabled}
        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-white text-black transition hover:scale-105 disabled:cursor-default disabled:opacity-40"
      >
        {playing ? <IconPause size={19} /> : <IconPlay size={19} />}
      </button>
      <button
        aria-label="next"
        onClick={actions.nextTrack}
        disabled={disabled || !caps.canSkip}
        title={hostHint(caps.canSkip)}
        className={side}
      >
        <IconNext size={22} />
      </button>
      <button
        aria-label={`repeat: ${repeat}`}
        onClick={actions.cycleRepeat}
        disabled={disabled || !caps.canRepeat}
        title={hostHint(caps.canRepeat)}
        className={`relative ${side} ${repeat !== "off" ? "text-accent hover:text-accent" : ""}`}
      >
        <IconRepeat size={18} />
        {repeat === "one" && (
          <span className="absolute -top-1 -right-1.5 text-[9px] font-bold text-accent">
            1
          </span>
        )}
      </button>
    </div>
  );
}
