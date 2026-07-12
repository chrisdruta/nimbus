"use client";

import { useEffect } from "react";
import { VisualizerCanvas } from "./VisualizerCanvas";
import { usePlayerActions, usePlayerState } from "@/components/player/PlayerProvider";

export function FullscreenViz() {
  const { vizMode, current } = usePlayerState();
  const actions = usePlayerActions();
  const open = vizMode === "full";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") actions.setVizMode("mini");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, actions]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 cursor-pointer bg-side"
      onClick={() => actions.setVizMode("mini")}
    >
      <VisualizerCanvas variant="full" className="h-full w-full" />
      {current && (
        <div className="pointer-events-none absolute bottom-8 left-8">
          <p className="text-2xl font-bold">{current.title}</p>
          <p className="mt-1 text-muted">
            {current.artist} · on SoundCloud
          </p>
        </div>
      )}
      <p className="absolute top-6 right-6 text-xs text-muted">esc to close</p>
    </div>
  );
}
