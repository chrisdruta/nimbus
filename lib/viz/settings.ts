/**
 * Per-mode customization: named presets plus advanced overrides, stored
 * as one versioned pref payload. Field definitions drive both validation
 * (clamping) and the settings panel UI, so knobs stay in one place.
 * Keyed by StageMode — the pure-artwork "art" mode has knobs too.
 */

import type { SceneId } from "./scene";
import type { StageMode } from "@/lib/stage";
import type { SpectrumTuning } from "./dsp";
import { pianoBand } from "./piano";

export interface SpectrumSettings {
  barCount: number;
  gravity: number;
  monstercat: number;
  freqLow: number;
  freqHigh: number;
  noiseFloor: number;
  tiltDbPerOct: number;
  mirror: boolean;
  caps: boolean;
}

export interface ScopeSettings {
  /** Glow-pass strength, 0 disables the halo strokes. */
  glow: number;
  /** Phosphor persistence: fraction of the trace kept per frame. */
  trail: number;
  /** AutoGain RMS target — higher fills more of the canvas. */
  gainTarget: number;
  lineWeight: number;
}

export interface RidgeSettings {
  rows: number;
  /** Seconds of history across the stack. */
  historySec: number;
  lineWeight: number;
}

export interface PianoSettings {
  /** Keyboard size in semitones (49/61/72/88, instrument-anchored). */
  keys: number;
  /** Key-release fall speed (SpectrumProcessor gravity). */
  gravity: number;
  /** Light strength above the keyboard (roll brightness / beam alpha). */
  glow: number;
  noiseFloor: number;
  /** Spectral tilt — lifts high notes whose fundamentals run quieter. */
  tiltDbPerOct: number;
  /** Octave markers on the C keys. */
  labels: boolean;
  /** Sequencer roll: notes scroll upward over time; off = static beams. */
  roll: boolean;
  /** Roll note gate: only key lights above this level enter the history. */
  gate: number;
}

export interface FourierSettings {
  /** Source: false = rotating stripe field, true = spectrogram roll. */
  roll: boolean;
  /** 2D FFT grid resolution (n×n). */
  grid: number;
  /**
   * Base rotation in deg/sec, both sources. A confident tempo
   * overrides the rate (one rev per 16 beats); 0 disables spin entirely.
   */
  spin: number;
  /** Pre-log magnitude gain — higher pulls out faint harmonics. */
  gain: number;
  /** Stripe fill fraction — lower cuts sharper edges, richer dot trains. */
  duty: number;
  /** Roll window in seconds (spectrogram source). */
  historySec: number;
  /** 2D Hann window; off keeps the axis-aligned boundary cross. */
  window: boolean;
  /** Corner preview of the source pattern being transformed. */
  inset: boolean;
  /**
   * Multiply the source field by the album-art luminance before the
   * FFT — the artwork's spectrum convolves onto every harmonic dot.
   */
  art: boolean;
  /**
   * Convolve the painted spectrum with a small album-art kernel
   * (FFT convolution) — every dot blooms into an art-shaped glint.
   */
  bokeh: boolean;
}

export interface ArtSettings {
  /** The slow scale swell on the centered artwork. */
  breathe: boolean;
}

export interface SceneSettingsMap {
  art: ArtSettings;
  bars: SpectrumSettings;
  scope: ScopeSettings;
  ridge: RidgeSettings;
  piano: PianoSettings;
  fourier: FourierSettings;
}

export type SceneVisualSettings = SceneSettingsMap[StageMode];

export const SETTINGS_DEFAULTS: SceneSettingsMap = {
  art: { breathe: true },
  bars: {
    barCount: 64,
    gravity: 9,
    monstercat: 1.5,
    freqLow: 50,
    freqHigh: 12000,
    noiseFloor: 0.04,
    tiltDbPerOct: 1.5, // keep in step with DEFAULTS in dsp.ts
    mirror: true,
    caps: true,
  },
  scope: { glow: 0.6, trail: 0.65, gainTarget: 0.35, lineWeight: 1.75 },
  ridge: { rows: 36, historySec: 3.2, lineWeight: 1.8 },
  piano: {
    keys: 72,
    gravity: 14,
    glow: 0.7,
    noiseFloor: 0.05,
    tiltDbPerOct: 1.5,
    labels: true,
    roll: false,
    gate: 0.3,
  },
  fourier: {
    roll: false,
    grid: 128,
    spin: 18,
    gain: 1.5,
    duty: 0.7,
    historySec: 4,
    window: true,
    inset: true,
    art: false,
    bokeh: false,
  },
};

export type FieldDef =
  | { kind: "range"; key: string; label: string; hint: string; min: number; max: number; step: number }
  | { kind: "choice"; key: string; label: string; hint: string; options: number[] }
  | { kind: "toggle"; key: string; label: string; hint: string };

export const SETTINGS_FIELDS: Record<StageMode, FieldDef[]> = {
  art: [
    {
      kind: "toggle", key: "breathe", label: "breathe",
      hint: "slow scale swell on the centered artwork",
    },
  ],
  bars: [
    {
      kind: "choice", key: "barCount", label: "bars", options: [32, 48, 64, 96],
      hint: "how many bars split the spectrum",
    },
    {
      kind: "range", key: "gravity", label: "gravity", min: 2, max: 20, step: 0.5,
      hint: "how fast bars fall after a peak",
    },
    {
      kind: "range", key: "monstercat", label: "smoothing", min: 1, max: 2, step: 0.05,
      hint: "each bar lifts its neighbors — higher is rounder",
    },
    {
      kind: "range", key: "tiltDbPerOct", label: "tilt", min: -3, max: 6, step: 0.5,
      hint: "per-octave gain: positive lifts the highs",
    },
    {
      kind: "range", key: "freqLow", label: "low hz", min: 20, max: 200, step: 5,
      hint: "where the spectrum starts",
    },
    {
      kind: "range", key: "freqHigh", label: "high hz", min: 6000, max: 16000, step: 250,
      hint: "where the spectrum ends",
    },
    {
      kind: "range", key: "noiseFloor", label: "floor", min: 0, max: 0.15, step: 0.01,
      hint: "cut analyser noise below this level",
    },
    {
      kind: "toggle", key: "mirror", label: "mirror",
      hint: "mirror around the centerline instead of rising from the floor",
    },
    {
      kind: "toggle", key: "caps", label: "caps",
      hint: "white peak-hold markers that linger, then fall",
    },
  ],
  scope: [
    {
      kind: "range", key: "glow", label: "glow", min: 0, max: 1, step: 0.05,
      hint: "halo strength around the trace",
    },
    {
      kind: "range", key: "trail", label: "trail", min: 0, max: 0.9, step: 0.05,
      hint: "phosphor persistence: how much of the last frame survives",
    },
    {
      kind: "range", key: "gainTarget", label: "fill", min: 0.15, max: 0.6, step: 0.05,
      hint: "auto-gain target: how much height the wave fills",
    },
    {
      kind: "range", key: "lineWeight", label: "line", min: 1, max: 4, step: 0.25,
      hint: "trace thickness",
    },
  ],
  ridge: [
    {
      kind: "range", key: "rows", label: "ridges", min: 16, max: 56, step: 4,
      hint: "how many history rows stack up",
    },
    {
      kind: "range", key: "historySec", label: "history", min: 1.5, max: 8, step: 0.5,
      hint: "seconds of spectrum the stack spans",
    },
    {
      kind: "range", key: "lineWeight", label: "line", min: 1, max: 3, step: 0.2,
      hint: "ridge line thickness",
    },
  ],
  piano: [
    {
      kind: "choice", key: "keys", label: "keys", options: [49, 61, 72, 88],
      hint: "keyboard size in semitones",
    },
    {
      kind: "toggle", key: "roll", label: "roll",
      hint: "notes scroll upward over time; off keeps static beams",
    },
    {
      kind: "range", key: "gate", label: "gate", min: 0.05, max: 0.6, step: 0.05,
      hint: "how bright a note must be to enter the roll",
    },
    {
      kind: "range", key: "gravity", label: "release", min: 4, max: 28, step: 1,
      hint: "how fast keys dim after a note",
    },
    {
      kind: "range", key: "glow", label: "glow", min: 0, max: 1, step: 0.05,
      hint: "beam and roll brightness above the keybed",
    },
    {
      kind: "range", key: "tiltDbPerOct", label: "tilt", min: 0, max: 6, step: 0.5,
      hint: "per-octave gain: lifts quiet high notes",
    },
    {
      kind: "range", key: "noiseFloor", label: "floor", min: 0, max: 0.15, step: 0.01,
      hint: "cut analyser noise below this level",
    },
    {
      kind: "toggle", key: "labels", label: "octaves",
      hint: "octave markers on the c keys",
    },
  ],
  fourier: [
    {
      kind: "choice", key: "grid", label: "grid", options: [64, 128, 256],
      hint: "fft resolution: sharper detail, more cpu",
    },
    {
      kind: "toggle", key: "roll", label: "roll",
      hint: "transform the scrolling spectrogram instead of rotating stripes",
    },
    {
      kind: "range", key: "spin", label: "spin", min: 0, max: 60, step: 2,
      hint: "base rotation speed; a confident tempo takes over (one spin per 16 beats)",
    },
    {
      kind: "range", key: "gain", label: "contrast", min: 0.5, max: 3, step: 0.1,
      hint: "gain before the log: digs out faint harmonics",
    },
    {
      kind: "range", key: "duty", label: "duty", min: 0.4, max: 1, step: 0.05,
      hint: "stripe fill width: thinner cuts sharper edges, richer dots",
    },
    {
      kind: "range", key: "historySec", label: "history", min: 2, max: 8, step: 0.5,
      hint: "seconds the spectrogram window spans",
    },
    {
      kind: "toggle", key: "art", label: "artwork",
      hint: "shape the stripes by the album art's brightness",
    },
    {
      kind: "toggle", key: "bokeh", label: "bokeh",
      hint: "bright dots bloom into art-shaped glints",
    },
    {
      kind: "toggle", key: "window", label: "window",
      hint: "soften the field edges to hide the axis-aligned cross",
    },
    {
      kind: "toggle", key: "inset", label: "inset",
      hint: "corner preview of the pattern being transformed",
    },
  ],
};

export interface Preset {
  id: string;
  label: string;
  values: Record<string, number | boolean>;
}

export const PRESETS: Record<StageMode, Preset[]> = {
  art: [
    { id: "drift", label: "drift", values: {} },
    { id: "still", label: "still", values: { breathe: false } },
  ],
  bars: [
    { id: "classic", label: "classic", values: {} },
    {
      id: "smooth",
      label: "smooth",
      values: { gravity: 5, monstercat: 1.7, tiltDbPerOct: 2.5, caps: false },
    },
    {
      id: "punchy",
      label: "punchy",
      values: { gravity: 15, monstercat: 1.15, tiltDbPerOct: 4 },
    },
    {
      id: "wide",
      label: "wide",
      values: { barCount: 96, monstercat: 1.6, caps: false },
    },
  ],
  scope: [
    { id: "phosphor", label: "phosphor", values: {} },
    {
      id: "clean",
      label: "clean",
      values: { glow: 0.15, trail: 0.1, lineWeight: 1.5 },
    },
    {
      id: "laser",
      label: "laser",
      values: { glow: 1, trail: 0.35, lineWeight: 2.5 },
    },
  ],
  ridge: [
    { id: "classic", label: "classic", values: {} },
    { id: "dense", label: "dense", values: { rows: 52, historySec: 4.5, lineWeight: 1.2 } },
    { id: "sparse", label: "sparse", values: { rows: 20, historySec: 2.5, lineWeight: 2.2 } },
  ],
  piano: [
    { id: "grand", label: "grand", values: {} },
    { id: "roll", label: "roll", values: { roll: true } },
    { id: "crisp", label: "crisp", values: { gravity: 22, glow: 0.4 } },
    {
      id: "minimal",
      label: "minimal",
      values: { glow: 0.15, labels: false },
    },
  ],
  fourier: [
    { id: "orbit", label: "orbit", values: {} },
    { id: "lattice", label: "lattice", values: { roll: true, gain: 2 } },
    { id: "crystal", label: "crystal", values: { grid: 256, spin: 8, duty: 0.55 } },
  ],
};

/** One scene's persisted choice: a preset id plus advanced deltas. */
export interface SceneSelection {
  preset: string;
  overrides: Record<string, number | boolean>;
}

export interface SceneSettingsPayload {
  v: 1;
  scenes: Partial<Record<StageMode, SceneSelection>>;
}

export const EMPTY_SETTINGS: SceneSettingsPayload = { v: 1, scenes: {} };

const MODE_IDS: StageMode[] = ["art", "bars", "scope", "ridge", "piano", "fourier"];

export function isSceneSettingsPayload(
  v: unknown,
): v is SceneSettingsPayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p.v !== 1) return false;
  if (typeof p.scenes !== "object" || p.scenes === null) return false;
  for (const [key, sel] of Object.entries(p.scenes)) {
    if (!MODE_IDS.includes(key as StageMode)) return false;
    if (typeof sel !== "object" || sel === null) return false;
    const s = sel as Record<string, unknown>;
    if (typeof s.preset !== "string") return false;
    if (typeof s.overrides !== "object" || s.overrides === null) return false;
    for (const val of Object.values(s.overrides)) {
      if (typeof val !== "number" && typeof val !== "boolean") return false;
    }
  }
  return true;
}

function clampField(field: FieldDef, value: number | boolean): number | boolean {
  if (field.kind === "toggle") return typeof value === "boolean" ? value : true;
  if (typeof value !== "number" || !Number.isFinite(value)) return NaN;
  if (field.kind === "choice") {
    // Snap to the nearest allowed option.
    let best = field.options[0];
    for (const opt of field.options) {
      if (Math.abs(opt - value) < Math.abs(best - value)) best = opt;
    }
    return best;
  }
  return Math.min(field.max, Math.max(field.min, value));
}

/**
 * Effective settings for a scene: defaults ⊕ preset values ⊕ overrides,
 * every field clamped to its declared range. Unknown keys are dropped.
 */
export function resolveSceneSettings<K extends StageMode>(
  scene: K,
  payload: SceneSettingsPayload | null,
): SceneSettingsMap[K] {
  const out: Record<string, number | boolean> = {
    ...(SETTINGS_DEFAULTS[scene] as unknown as Record<string, number | boolean>),
  };
  const sel = payload?.scenes[scene];
  if (sel) {
    const preset = PRESETS[scene].find((p) => p.id === sel.preset);
    const layers = { ...(preset?.values ?? {}), ...sel.overrides };
    for (const field of SETTINGS_FIELDS[scene]) {
      const raw = layers[field.key];
      if (raw === undefined) continue;
      const clamped = clampField(field, raw);
      if (typeof clamped === "number" && Number.isNaN(clamped)) continue;
      out[field.key] = clamped;
    }
  }
  return out as unknown as SceneSettingsMap[K];
}

/** What the FrameAnalyzer needs: structural shape plus live tuning. */
export interface ResolvedDsp {
  barCount: number;
  freqLow: number;
  freqHigh: number;
  tuning: SpectrumTuning;
}

/**
 * DSP config for the active scene. The spectrum scene exposes its DSP
 * knobs directly; the piano scene derives a semitone-aligned band (one
 * bar per key, monstercat off so notes don't bleed into neighbors);
 * every other scene runs the defaults so bars-driven scenes (ridgeline)
 * stay on the house-tuned pipeline.
 */
export function resolveDsp(
  scene: SceneId,
  payload: SceneSettingsPayload | null,
): ResolvedDsp {
  if (scene === "piano") {
    const p = resolveSceneSettings("piano", payload);
    return {
      barCount: p.keys,
      ...pianoBand(p.keys),
      tuning: {
        gravity: p.gravity,
        monstercat: 1,
        noiseFloor: p.noiseFloor,
        tiltDbPerOct: p.tiltDbPerOct,
      },
    };
  }
  const d = SETTINGS_DEFAULTS.bars;
  const s = scene === "bars" ? resolveSceneSettings("bars", payload) : d;
  return {
    barCount: s.barCount,
    freqLow: s.freqLow,
    freqHigh: s.freqHigh,
    tuning: {
      gravity: s.gravity,
      monstercat: s.monstercat,
      noiseFloor: s.noiseFloor,
      tiltDbPerOct: s.tiltDbPerOct,
    },
  };
}

/** Immutable update helper for the panel: set a scene's preset. */
export function withPreset(
  payload: SceneSettingsPayload | null,
  scene: StageMode,
  preset: string,
): SceneSettingsPayload {
  const base = payload ?? EMPTY_SETTINGS;
  return {
    v: 1,
    // Choosing a preset clears the advanced deltas — it's a fresh baseline.
    scenes: { ...base.scenes, [scene]: { preset, overrides: {} } },
  };
}

/** Immutable update helper for the panel: set one advanced override. */
export function withOverride(
  payload: SceneSettingsPayload | null,
  scene: StageMode,
  key: string,
  value: number | boolean,
): SceneSettingsPayload {
  const base = payload ?? EMPTY_SETTINGS;
  const sel = base.scenes[scene] ?? { preset: PRESETS[scene][0].id, overrides: {} };
  return {
    v: 1,
    scenes: {
      ...base.scenes,
      [scene]: { ...sel, overrides: { ...sel.overrides, [key]: value } },
    },
  };
}

/** Immutable update helper for the panel: back to factory settings. */
export function withReset(
  payload: SceneSettingsPayload | null,
  scene: StageMode,
): SceneSettingsPayload {
  const base = payload ?? EMPTY_SETTINGS;
  const scenes = { ...base.scenes };
  delete scenes[scene];
  return { v: 1, scenes };
}
