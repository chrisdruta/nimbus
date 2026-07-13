"use client";

import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/Slider";
import { IconMute, IconVolume } from "@/components/ui/icons";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

/** Icon-only volume: click toggles mute, hover (or focus) reveals the
 * slider in a flyout above the bar — one bar slot instead of five. */
export function VolumeControl() {
  const { volume } = usePlayerState();
  const actions = usePlayerActions();
  const lastNonZero = useRef(1);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (volume > 0) lastNonZero.current = volume;

  const hold = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const release = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 300);
  };

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <div
      ref={rootRef}
      className="relative flex items-center"
      onPointerEnter={hold}
      onPointerLeave={release}
    >
      {open && (
        <div className="glass absolute bottom-full left-1/2 z-40 mb-3 w-36 -translate-x-1/2 rounded-full px-3 py-2 shadow-2xl">
          <Slider
            value={volume}
            max={1}
            step={0.05}
            ariaLabel="volume"
            onScrub={actions.setVolume}
            onCommit={actions.setVolume}
          />
        </div>
      )}
      <button
        aria-label={volume === 0 ? "unmute" : "mute"}
        onClick={() =>
          actions.setVolume(volume === 0 ? lastNonZero.current : 0)
        }
        onFocus={hold}
        onBlur={release}
        className="cursor-pointer text-muted transition hover:text-white"
      >
        {volume === 0 ? <IconMute size={18} /> : <IconVolume size={18} />}
      </button>
    </div>
  );
}
