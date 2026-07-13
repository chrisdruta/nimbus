"use client";

import { useEffect, useRef } from "react";
import type { ShuffleMode } from "@/lib/queue";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

const MODES: Array<{ mode: ShuffleMode; label: string; hint: string }> = [
  { mode: "classic", label: "classic", hint: "pure random" },
  { mode: "artist-spaced", label: "artist-spaced", hint: "keeps artists apart" },
  { mode: "rediscovery", label: "rediscovery", hint: "surfaces rarely played" },
];

/** One radio group for the whole shuffle model: off, or one of the
 * modes. Picking a mode turns shuffle on; "off" restores source order. */
export function ShuffleMenu({ onClose }: { onClose: () => void }) {
  const { shuffled, shuffleMode } = usePlayerState();
  const actions = usePlayerActions();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const row =
    "flex w-full cursor-pointer items-baseline gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-white/5";

  return (
    <div
      ref={panelRef}
      className="glass absolute bottom-full left-1/2 z-40 mb-2 w-56 -translate-x-1/2 rounded-lg p-2 shadow-2xl"
    >
      <p className="px-2 pt-1 pb-2 text-xs tracking-widest text-muted uppercase">
        Shuffle
      </p>
      <button
        onClick={() => {
          if (shuffled) actions.toggleShuffleMode();
          onClose();
        }}
        className={row}
      >
        <span className={!shuffled ? "text-accent" : "text-white"}>
          {!shuffled ? "●" : "○"} off
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted">
          play in order
        </span>
      </button>
      {MODES.map(({ mode, label, hint }) => (
        <button
          key={mode}
          onClick={() => {
            actions.setShuffleMode(mode);
            onClose();
          }}
          className={row}
        >
          <span
            className={
              shuffled && mode === shuffleMode ? "text-accent" : "text-white"
            }
          >
            {shuffled && mode === shuffleMode ? "●" : "○"} {label}
          </span>
          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted">
            {hint}
          </span>
        </button>
      ))}
    </div>
  );
}
