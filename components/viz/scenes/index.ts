import type { Scene, SceneId } from "@/lib/viz/scene";
import { createSpectrumBarsScene } from "./spectrumBars";
import { createRadialSpectrumScene } from "./radialSpectrum";
import { createParticleFieldScene } from "./particleField";
import { createOscilloscopeScene } from "./oscilloscope";

export function createScene(id: SceneId): Scene {
  switch (id) {
    case "bars":
      return createSpectrumBarsScene();
    case "radial":
      return createRadialSpectrumScene();
    case "particles":
      return createParticleFieldScene();
    case "scope":
      return createOscilloscopeScene();
  }
}
