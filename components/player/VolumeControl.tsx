"use client";

import { useRef } from "react";
import { Slider } from "@/components/ui/Slider";
import { IconMute, IconVolume } from "@/components/ui/icons";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

export function VolumeControl() {
  const { volume } = usePlayerState();
  const actions = usePlayerActions();
  const lastNonZero = useRef(1);
  if (volume > 0) lastNonZero.current = volume;

  return (
    <div className="flex w-32 items-center gap-2">
      <button
        aria-label={volume === 0 ? "unmute" : "mute"}
        onClick={() =>
          actions.setVolume(volume === 0 ? lastNonZero.current : 0)
        }
        className="cursor-pointer text-muted transition hover:text-white"
      >
        {volume === 0 ? <IconMute size={18} /> : <IconVolume size={18} />}
      </button>
      <Slider
        value={volume}
        max={1}
        step={0.05}
        ariaLabel="volume"
        className="flex-1"
        onScrub={actions.setVolume}
        onCommit={actions.setVolume}
      />
    </div>
  );
}
