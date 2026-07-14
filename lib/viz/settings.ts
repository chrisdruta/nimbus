/**
 * Per-scene customization: named presets plus advanced overrides, stored
 * as one versioned pref payload. Field definitions drive both validation
 * (clamping) and the settings panel UI, so knobs stay in one place.
 */

import type { SceneId } from "./scene";
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

export interface WaterfallSettings {
  /** Seconds of history across the canvas width. */
  scrollSec: number;
  /** Pre-colormap level multiplier. */
  intensity: number;
  /** Hue rotation across the ramp, degrees. */
  hueSpread: number;
}

export interface PianoSettings {
  /** Keyboard size in semitones (49/61/72/88, instrument-anchored). */
  keys: number;
  /** Key-release fall speed (SpectrumProcessor gravity). */
  gravity: number;
  /** Beam strength above the keyboard, 0 disables. */
  glow: number;
  noiseFloor: number;
  /** Spectral tilt — lifts high notes whose fundamentals run quieter. */
  tiltDbPerOct: number;
  /** Octave markers on the C keys. */
  labels: boolean;
}

export interface SceneSettingsMap {
  bars: SpectrumSettings;
  scope: ScopeSettings;
  ridge: RidgeSettings;
  waterfall: WaterfallSettings;
  piano: PianoSettings;
}

export type SceneVisualSettings = SceneSettingsMap[SceneId];

export const SETTINGS_DEFAULTS: SceneSettingsMap = {
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
  waterfall: { scrollSec: 14, intensity: 1, hueSpread: 40 },
  piano: {
    keys: 72,
    gravity: 14,
    glow: 0.7,
    noiseFloor: 0.05,
    tiltDbPerOct: 1.5,
    labels: true,
  },
};

export type FieldDef =
  | { kind: "range"; key: string; label: string; min: number; max: number; step: number }
  | { kind: "choice"; key: string; label: string; options: number[] }
  | { kind: "toggle"; key: string; label: string };

export const SETTINGS_FIELDS: Record<SceneId, FieldDef[]> = {
  bars: [
    { kind: "choice", key: "barCount", label: "bars", options: [32, 48, 64, 96] },
    { kind: "range", key: "gravity", label: "gravity", min: 2, max: 20, step: 0.5 },
    { kind: "range", key: "monstercat", label: "smoothing", min: 1, max: 2, step: 0.05 },
    { kind: "range", key: "tiltDbPerOct", label: "tilt", min: -3, max: 6, step: 0.5 },
    { kind: "range", key: "freqLow", label: "low hz", min: 20, max: 200, step: 5 },
    { kind: "range", key: "freqHigh", label: "high hz", min: 6000, max: 16000, step: 250 },
    { kind: "range", key: "noiseFloor", label: "floor", min: 0, max: 0.15, step: 0.01 },
    { kind: "toggle", key: "mirror", label: "mirror" },
    { kind: "toggle", key: "caps", label: "caps" },
  ],
  scope: [
    { kind: "range", key: "glow", label: "glow", min: 0, max: 1, step: 0.05 },
    { kind: "range", key: "trail", label: "trail", min: 0, max: 0.9, step: 0.05 },
    { kind: "range", key: "gainTarget", label: "fill", min: 0.15, max: 0.6, step: 0.05 },
    { kind: "range", key: "lineWeight", label: "line", min: 1, max: 4, step: 0.25 },
  ],
  ridge: [
    { kind: "range", key: "rows", label: "ridges", min: 16, max: 56, step: 4 },
    { kind: "range", key: "historySec", label: "history", min: 1.5, max: 8, step: 0.5 },
    { kind: "range", key: "lineWeight", label: "line", min: 1, max: 3, step: 0.2 },
  ],
  waterfall: [
    { kind: "range", key: "scrollSec", label: "scroll", min: 6, max: 30, step: 1 },
    { kind: "range", key: "intensity", label: "intensity", min: 0.5, max: 1.5, step: 0.05 },
    { kind: "range", key: "hueSpread", label: "hue drift", min: -120, max: 120, step: 10 },
  ],
  piano: [
    { kind: "choice", key: "keys", label: "keys", options: [49, 61, 72, 88] },
    { kind: "range", key: "gravity", label: "release", min: 4, max: 28, step: 1 },
    { kind: "range", key: "glow", label: "glow", min: 0, max: 1, step: 0.05 },
    { kind: "range", key: "tiltDbPerOct", label: "tilt", min: 0, max: 6, step: 0.5 },
    { kind: "range", key: "noiseFloor", label: "floor", min: 0, max: 0.15, step: 0.01 },
    { kind: "toggle", key: "labels", label: "octaves" },
  ],
};

export interface Preset {
  id: string;
  label: string;
  values: Record<string, number | boolean>;
}

export const PRESETS: Record<SceneId, Preset[]> = {
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
  waterfall: [
    { id: "aurora", label: "aurora", values: {} },
    { id: "mono", label: "mono", values: { hueSpread: 0 } },
    { id: "prism", label: "prism", values: { hueSpread: 110, intensity: 1.15 } },
    { id: "slow", label: "slow", values: { scrollSec: 26 } },
  ],
  piano: [
    { id: "grand", label: "grand", values: {} },
    { id: "crisp", label: "crisp", values: { gravity: 22, glow: 0.35 } },
    { id: "cascade", label: "cascade", values: { gravity: 8, glow: 1 } },
    {
      id: "minimal",
      label: "minimal",
      values: { glow: 0.15, labels: false },
    },
  ],
};

/** One scene's persisted choice: a preset id plus advanced deltas. */
export interface SceneSelection {
  preset: string;
  overrides: Record<string, number | boolean>;
}

export interface SceneSettingsPayload {
  v: 1;
  scenes: Partial<Record<SceneId, SceneSelection>>;
}

export const EMPTY_SETTINGS: SceneSettingsPayload = { v: 1, scenes: {} };

const SCENE_IDS: SceneId[] = ["bars", "scope", "ridge", "waterfall", "piano"];

export function isSceneSettingsPayload(
  v: unknown,
): v is SceneSettingsPayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p.v !== 1) return false;
  if (typeof p.scenes !== "object" || p.scenes === null) return false;
  for (const [key, sel] of Object.entries(p.scenes)) {
    if (!SCENE_IDS.includes(key as SceneId)) return false;
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
export function resolveSceneSettings<K extends SceneId>(
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
 * every other scene runs the defaults so bars-driven scenes (ridgeline,
 * waterfall) stay on the house-tuned pipeline.
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
  scene: SceneId,
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
  scene: SceneId,
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
  scene: SceneId,
): SceneSettingsPayload {
  const base = payload ?? EMPTY_SETTINGS;
  const scenes = { ...base.scenes };
  delete scenes[scene];
  return { v: 1, scenes };
}
