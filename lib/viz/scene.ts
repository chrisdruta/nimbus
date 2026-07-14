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
  /**
   * Confident tempo estimate with predicted beat phase, or null (the
   * common case — ambient, DJ blends, sparse onsets).
   */
  tempo: import("./tempo").TempoEstimate | null;
  /** Seconds since last frame, clamped. */
  dt: number;
}

export interface SceneContext {
  g: CanvasRenderingContext2D;
  /** Device pixels (canvas.width/height, already DPR-scaled). */
  width: number;
  height: number;
  dpr: number;
  /**
   * Resolved visual settings for the active scene (lib/viz/settings.ts).
   * Scenes read these per frame — live slider feedback — and each scene
   * narrows to its own settings type. Absent in bare hosts (mini-viz).
   */
  settings?: unknown;
  /**
   * Whole-track lookahead: the provider waveform shape plus live playback
   * position. shape is null until fetched (or forever, when the provider
   * has none) — scenes must treat that as the normal case.
   */
  track?: {
    shape: import("./trackshape").TrackShape | null;
    positionSec: number;
    durationSec: number;
  };
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

export type SceneId = "bars" | "ridge" | "waterfall" | "scope" | "piano";

export const SCENE_META: ReadonlyArray<{
  id: SceneId;
  label: string;
  /** CSS px cap on the canvas column; omit for full-bleed. */
  maxWidth?: number;
}> = [
  { id: "bars", label: "spectrum", maxWidth: 1280 },
  { id: "ridge", label: "ridgeline", maxWidth: 1280 },
  { id: "waterfall", label: "waterfall" },
  { id: "scope", label: "scope", maxWidth: 1100 },
  { id: "piano", label: "piano", maxWidth: 1440 },
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
