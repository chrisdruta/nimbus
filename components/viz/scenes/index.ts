import type { Scene, SceneId } from "@/lib/viz/scene";
import { createSpectrumBarsScene } from "./spectrumBars";
import { createRidgelineScene } from "./ridgeline";
import { createOscilloscopeScene } from "./oscilloscope";
import { createPianoScene } from "./piano";
import { createFourierScene } from "./fourier";

export function createScene(id: SceneId): Scene {
  switch (id) {
    case "bars":
      return createSpectrumBarsScene();
    case "ridge":
      return createRidgelineScene();
    case "scope":
      return createOscilloscopeScene();
    case "piano":
      return createPianoScene();
    case "fourier":
      return createFourierScene();
  }
}
