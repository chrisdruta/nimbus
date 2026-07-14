"use client";

import { useRef } from "react";
import { Slider } from "@/components/ui/Slider";
import { IconLevel, IconMute, IconVolume } from "@/components/ui/icons";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

/** Inline volume cluster: mute toggle, always-visible slider, and the
 * auto-level switch — no hover flyout to chase with the pointer. */
export function VolumeControl() {
  const { volume, leveling } = usePlayerState();
  const actions = usePlayerActions();
  const lastNonZero = useRef(1);
  if (volume > 0) lastNonZero.current = volume;

  return (
    <div className="flex items-center gap-2">
      <button
        aria-label={volume === 0 ? "unmute" : "mute"}
        title={volume === 0 ? "unmute" : "mute"}
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
        onScrub={actions.setVolume}
        onCommit={actions.setVolume}
        className="w-24"
      />
      <button
        role="switch"
        aria-checked={leveling}
        aria-label="volume leveling"
        title={leveling ? "auto-level on" : "auto-level off"}
        onClick={() => actions.setLeveling(!leveling)}
        className={`cursor-pointer transition ${
          leveling ? "text-accent" : "text-muted hover:text-white"
        }`}
      >
        <IconLevel size={15} />
      </button>
    </div>
  );
}
