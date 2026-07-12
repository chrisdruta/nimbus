/**
 * Contracts for the visualization system. Scenes are plug-ins: SceneHost
 * owns the canvas + rAF loop and drives whichever Scene is active.
 */

/** One frame of analyzed audio, produced by FrameAnalyzer each rAF tick. */
export interface AudioFrame {
  /** Smoothed spectrum bars, 0..1 (post cava-style DSP). */
  bars: Float32Array;
  /** Raw time-domain samples, -1..1 (analyser.fftSize long). */
  waveform: Float32Array;
  /** Smoothed low-band (~40–130 Hz) level, 0..1. */
  bass: number;
  /** Smoothed full-band level, 0..1. */
  energy: number;
  /** Onset fired this frame. */
  beat: boolean;
  /** How far above threshold the onset was, 0..~1.5. */
  beatIntensity: number;
  /** Seconds since last frame, clamped. */
  dt: number;
}

export interface SceneContext {
  g: CanvasRenderingContext2D;
  /** Device pixels (canvas.width/height, already DPR-scaled). */
  width: number;
  height: number;
  dpr: number;
}

export interface VizTheme {
  /** Artwork vibrant color, or the app accent fallback. */
  accent: string;
  /** Same color pre-split for cheap rgba() composition. */
  accentRgb: [number, number, number];
  /** Near-black, subtly artwork-tinted. */
  background: string;
  /** Decoded t500x500 artwork; null when unavailable/tainted. */
  artwork: HTMLImageElement | null;
  reducedMotion: boolean;
}

export type SceneId = "bars" | "radial" | "particles" | "scope";

export const SCENE_META: ReadonlyArray<{ id: SceneId; label: string }> = [
  { id: "bars", label: "spectrum" },
  { id: "radial", label: "orbit" },
  { id: "particles", label: "drift" },
  { id: "scope", label: "scope" },
];

export function isSceneId(v: unknown): v is SceneId {
  return SCENE_META.some((s) => s.id === v);
}

/**
 * A scene owns its private state via factory closure. `frame` is called
 * every animation tick with a fresh untransformed context; scenes do their
 * own clearing (some keep trails instead of clearing).
 */
export interface Scene {
  id: SceneId;
  init(sc: SceneContext): void;
  resize(sc: SceneContext): void;
  frame(sc: SceneContext, f: AudioFrame, theme: VizTheme, tSec: number): void;
  dispose(): void;
}
