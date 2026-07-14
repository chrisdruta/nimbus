import type { Scene, SceneId } from "@/lib/viz/scene";
import { createSpectrumBarsScene } from "./spectrumBars";
import { createRidgelineScene } from "./ridgeline";
import { createWaterfallScene } from "./waterfall";
import { createOscilloscopeScene } from "./oscilloscope";
import { createPianoScene } from "./piano";

export function createScene(id: SceneId): Scene {
  switch (id) {
    case "bars":
      return createSpectrumBarsScene();
    case "ridge":
      return createRidgelineScene();
    case "waterfall":
      return createWaterfallScene();
    case "scope":
      return createOscilloscopeScene();
    case "piano":
      return createPianoScene();
  }
}
