"use client";

import { useState } from "react";
import { NowPlaying } from "./NowPlaying";
import { TransportControls } from "./TransportControls";
import { SeekBar } from "./SeekBar";
import { VolumeControl } from "./VolumeControl";
import { QueuePanel } from "./QueuePanel";
import { VisualizerCanvas } from "@/components/viz/VisualizerCanvas";
import { IconExpand, IconQueue, IconSpark } from "@/components/ui/icons";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

export function MediaBar() {
  const { vizMode } = usePlayerState();
  const actions = usePlayerActions();
  const [queueOpen, setQueueOpen] = useState(false);

  const iconBtn =
    "cursor-pointer text-muted transition hover:text-white";

  return (
    <>
      {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}

      <footer className="z-30 grid h-[88px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-black bg-bar px-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
        <NowPlaying />

        <div className="hidden flex-col items-center gap-1.5 md:flex">
          <TransportControls />
          <SeekBar />
        </div>

        <div className="flex items-center justify-end gap-4">
          {/* compact transport for small screens */}
          <div className="md:hidden">
            <TransportControls />
          </div>

          <div className="hidden items-center gap-4 md:flex">
            {vizMode === "mini" && (
              <VisualizerCanvas className="h-9 w-28" />
            )}
            <button
              aria-label="toggle queue"
              onClick={() => setQueueOpen((o) => !o)}
              className={`${iconBtn} ${queueOpen ? "text-accent hover:text-accent" : ""}`}
            >
              <IconQueue size={18} />
            </button>
            <VolumeControl />
            <button
              aria-label="toggle mini visualizer"
              onClick={() =>
                actions.setVizMode(vizMode === "mini" ? "off" : "mini")
              }
              className={`${iconBtn} ${vizMode === "mini" ? "text-accent hover:text-accent" : ""}`}
            >
              <IconSpark size={18} />
            </button>
            <button
              aria-label="fullscreen visualizer"
              onClick={() => actions.setVizMode("full")}
              className={iconBtn}
            >
              <IconExpand size={17} />
            </button>
          </div>
        </div>
      </footer>
    </>
  );
}
