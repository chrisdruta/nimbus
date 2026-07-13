"use client";

import { NowPlaying } from "./NowPlaying";
import { TransportControls } from "./TransportControls";
import { SeekBar } from "./SeekBar";
import { VolumeControl } from "./VolumeControl";
import { VisualizerCanvas } from "@/components/viz/VisualizerCanvas";
import { IconExpand } from "@/components/ui/icons";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

export function MediaBar() {
  const { current } = usePlayerState();
  const actions = usePlayerActions();

  return (
    <footer className="glass z-30 grid h-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-6 border-t border-white/5 px-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
      <NowPlaying />

      {/* Cap the seek width so it doesn't stretch edge-to-edge of its
          column on wide screens; keep the whole block cell-centered. The
          seek row only exists once a track is loaded — an idle 0:00–0:00
          scrubber is just noise. */}
      <div className="hidden w-full max-w-2xl flex-col items-center gap-2 justify-self-center md:flex xl:max-w-3xl">
        <TransportControls />
        {current && <SeekBar />}
      </div>

      {/* Centered in its column (not pinned to the edge); volume leads so
          the two stage entries (mini viz, expand) sit together. */}
      <div className="flex items-center justify-end md:justify-center">
        {/* compact transport for small screens */}
        <div className="md:hidden">
          <TransportControls />
        </div>

        <div className="hidden items-center gap-5 md:flex">
          <VolumeControl />
          {current && (
            <button
              aria-label="open stage"
              title="open stage"
              onClick={() => actions.openStage()}
              className="cursor-pointer"
            >
              <VisualizerCanvas className="h-10 w-32" />
            </button>
          )}
          <button
            aria-label="open stage"
            title="open stage"
            onClick={() => actions.openStage()}
            className="cursor-pointer text-muted transition hover:text-white"
          >
            <IconExpand size={19} />
          </button>
        </div>
      </div>
    </footer>
  );
}
