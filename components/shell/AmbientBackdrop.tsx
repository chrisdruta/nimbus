"use client";

import { usePlayerState } from "@/components/player/PlayerProvider";
import { CrossfadeArt } from "@/components/art/CrossfadeArt";

/**
 * The current track's artwork as a blurred, dimmed, slowly drifting
 * background behind the whole shell. The blur is applied to a static
 * image layer (GPU composites it once); only opacity and transform ever
 * animate. A neutral gradient shows when nothing is playing or the
 * track has no artwork.
 */
export function AmbientBackdrop() {
  const { current } = usePlayerState();

  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(120% 90% at 50% 20%, #1c1c1c, #0e0e0e)",
        }}
      />
      <CrossfadeArt
        url={current?.artworkUrl ?? null}
        durationMs={1200}
        className="scale-125 object-cover blur-3xl brightness-50 saturate-125 motion-safe:animate-[ambient-drift_90s_ease-in-out_infinite_alternate]"
      />
      {/* Readability scrim; the bar zone at the bottom stays darkest. */}
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/40" />
    </div>
  );
}
