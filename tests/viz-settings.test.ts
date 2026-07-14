import { describe, expect, test } from "bun:test";
import {
  isSceneSettingsPayload,
  PRESETS,
  resolveDsp,
  resolveSceneSettings,
  SETTINGS_DEFAULTS,
  SETTINGS_FIELDS,
  withOverride,
  withPreset,
  withReset,
  type SceneSettingsPayload,
} from "../lib/viz/settings";
import { STAGE_META } from "../lib/stage";

describe("isSceneSettingsPayload", () => {
  test("accepts a well-formed payload", () => {
    const p: SceneSettingsPayload = {
      v: 1,
      scenes: { bars: { preset: "punchy", overrides: { gravity: 12 } } },
    };
    expect(isSceneSettingsPayload(p)).toBe(true);
    expect(isSceneSettingsPayload({ v: 1, scenes: {} })).toBe(true);
  });

  test("rejects wrong version, junk shapes, unknown scenes", () => {
    expect(isSceneSettingsPayload(null)).toBe(false);
    expect(isSceneSettingsPayload({ v: 2, scenes: {} })).toBe(false);
    expect(isSceneSettingsPayload({ v: 1 })).toBe(false);
    expect(
      isSceneSettingsPayload({
        v: 1,
        scenes: { radial: { preset: "x", overrides: {} } },
      }),
    ).toBe(false);
    expect(
      isSceneSettingsPayload({
        v: 1,
        scenes: { bars: { preset: "x", overrides: { gravity: "fast" } } },
      }),
    ).toBe(false);
  });
});

describe("resolveSceneSettings", () => {
  test("null payload yields defaults", () => {
    expect(resolveSceneSettings("bars", null)).toEqual(SETTINGS_DEFAULTS.bars);
    expect(resolveSceneSettings("scope", null)).toEqual(SETTINGS_DEFAULTS.scope);
  });

  test("preset values layer over defaults, overrides over presets", () => {
    let p = withPreset(null, "bars", "punchy"); // gravity 15
    expect(resolveSceneSettings("bars", p).gravity).toBe(15);
    p = withOverride(p, "bars", "gravity", 6);
    const r = resolveSceneSettings("bars", p);
    expect(r.gravity).toBe(6);
    expect(r.monstercat).toBe(1.15); // punchy's value still applies
  });

  test("out-of-range overrides clamp, unknown keys drop", () => {
    let p = withOverride(null, "bars", "gravity", 999);
    p = withOverride(p, "bars", "nonsense", 42);
    const r = resolveSceneSettings("bars", p) as unknown as Record<string, unknown>;
    expect(r.gravity).toBe(20); // field max
    expect(r.nonsense).toBeUndefined();
  });

  test("choice fields snap to the nearest allowed option", () => {
    const p = withOverride(null, "bars", "barCount", 70);
    expect(resolveSceneSettings("bars", p).barCount).toBe(64);
  });

  test("withReset returns the scene to defaults", () => {
    let p = withPreset(null, "scope", "laser");
    p = withReset(p, "scope");
    expect(resolveSceneSettings("scope", p)).toEqual(SETTINGS_DEFAULTS.scope);
  });
});

describe("resolveDsp", () => {
  test("bars scene carries its settings into the DSP config", () => {
    const p = withOverride(withPreset(null, "bars", "wide"), "bars", "tiltDbPerOct", 5);
    const dsp = resolveDsp("bars", p);
    expect(dsp.barCount).toBe(96);
    expect(dsp.tuning.tiltDbPerOct).toBe(5);
  });

  test("other scenes always run default DSP", () => {
    const p = withOverride(null, "bars", "barCount", 96);
    const dsp = resolveDsp("ridge", p);
    expect(dsp.barCount).toBe(SETTINGS_DEFAULTS.bars.barCount);
    expect(dsp.tuning.gravity).toBe(SETTINGS_DEFAULTS.bars.gravity);
  });
});

describe("registry coherence", () => {
  test("every stage mode has fields and at least two presets", () => {
    for (const { id } of STAGE_META) {
      expect(SETTINGS_FIELDS[id].length).toBeGreaterThan(0);
      expect(PRESETS[id].length).toBeGreaterThanOrEqual(2);
    }
  });

  test("preset values reference declared fields within range", () => {
    for (const { id } of STAGE_META) {
      const fields = new Map(SETTINGS_FIELDS[id].map((f) => [f.key, f]));
      for (const preset of PRESETS[id]) {
        for (const [key, value] of Object.entries(preset.values)) {
          const field = fields.get(key);
          expect(field).toBeDefined();
          if (field?.kind === "range") {
            expect(typeof value).toBe("number");
            expect(value as number).toBeGreaterThanOrEqual(field.min);
            expect(value as number).toBeLessThanOrEqual(field.max);
          }
          if (field?.kind === "choice") {
            expect(field.options).toContain(value as number);
          }
          if (field?.kind === "toggle") {
            expect(typeof value).toBe("boolean");
          }
        }
      }
    }
  });
});
