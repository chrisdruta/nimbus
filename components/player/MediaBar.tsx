"use client";

import { NowPlaying, TrackActions } from "./NowPlaying";
import { TransportControls } from "./TransportControls";
import { SeekBar } from "./SeekBar";
import { VolumeControl } from "./VolumeControl";
import { VisualizerCanvas } from "@/components/viz/VisualizerCanvas";
import { IconQueue } from "@/components/ui/icons";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

export function MediaBar({
  queueOpen,
  onToggleQueue,
  queueLive,
}: {
  queueOpen: boolean;
  onToggleQueue: () => void;
  /** Someone's slipstream is live — surfaces as a dot on the queue button. */
  queueLive: boolean;
}) {
  const { current, stageOpen } = usePlayerState();
  const actions = usePlayerActions();

  // Side columns are symmetric (1fr each) so the center column — and the
  // play button on its center line — sits on the true middle of the bar.
  return (
    <footer className="glass z-30 grid h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-white/5 px-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] 2xl:h-24 2xl:gap-6">
      <NowPlaying />

      {/* Cap the seek width so it doesn't stretch edge-to-edge of its
          column on wide screens; keep the whole block cell-centered. The
          seek row only exists once a track is loaded — an idle 0:00–0:00
          scrubber is just noise. Equal flex spacers flank the transport,
          keeping it centered: like/follow/radio anchor the left one, the
          mini viz (stage toggle) anchors the right one, both sitting
          above the scrubber's ends. */}
      <div className="hidden w-full max-w-2xl flex-col items-center gap-2 justify-self-center md:flex 2xl:max-w-3xl">
        <div className="flex w-full items-center">
          <div className="flex min-w-0 flex-1 items-center justify-start">
            <TrackActions />
          </div>
          <TransportControls />
          <div className="flex min-w-0 flex-1 items-center justify-end">
            {current && (
              <button
                aria-label={stageOpen ? "close stage" : "open stage"}
                title={stageOpen ? "close stage" : "open stage"}
                onClick={() =>
                  stageOpen ? actions.closeStage() : actions.openStage()
                }
                className="hidden w-full max-w-28 cursor-pointer lg:block"
              >
                <VisualizerCanvas className="h-8 w-full" />
              </button>
            )}
          </div>
        </div>
        {current && <SeekBar />}
      </div>

      <div className="flex items-center justify-end">
        {/* compact transport for small screens */}
        <div className="md:hidden">
          <TransportControls />
        </div>

        <div className="hidden items-center gap-4 md:flex">
          <VolumeControl />
          <button
            aria-label={queueOpen ? "close queue" : "open queue"}
            title="queue"
            onClick={onToggleQueue}
            className={`relative cursor-pointer transition ${
              queueOpen ? "text-white" : "text-muted hover:text-white"
            }`}
          >
            <IconQueue size={18} />
            {queueLive && (
              <span className="absolute -top-1 -right-1 h-1.5 w-1.5 rounded-full bg-accent" />
            )}
          </button>
        </div>
      </div>
    </footer>
  );
}
