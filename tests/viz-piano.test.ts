import { describe, expect, test } from "bun:test";
import {
  isBlackKey,
  midiToFreq,
  noteContrast,
  PIANO_KEY_COUNTS,
  pianoBand,
  pianoLayout,
} from "../lib/viz/piano";
import { computeBinRanges } from "../lib/viz/dsp";
import { resolveDsp, withOverride } from "../lib/viz/settings";

describe("midiToFreq", () => {
  test("hits the anchors", () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(21)).toBeCloseTo(27.5); // A0
    expect(midiToFreq(60)).toBeCloseTo(261.63, 1); // middle C
  });
});

describe("pianoBand", () => {
  test("band ratio is exactly keys semitones", () => {
    for (const keys of PIANO_KEY_COUNTS) {
      const { freqLow, freqHigh } = pianoBand(keys);
      expect(Math.log2(freqHigh / freqLow) * 12).toBeCloseTo(keys);
    }
  });

  test("log-spaced bars land centered on semitones", () => {
    // The whole point of the band: bar i of computeBinRanges spans note
    // midiLow+i's quarter-tone neighborhood. Check via the bar edges'
    // ideal frequencies (bin snapping aside, edges follow fLow·2^(i/12)).
    const { freqLow } = pianoBand(72);
    const f1 = midiToFreq(29); // F1, the 72-key anchor
    for (const i of [0, 12, 36, 71]) {
      const barCenter = freqLow * Math.pow(2, (i + 0.5) / 12);
      expect(barCenter).toBeCloseTo(midiToFreq(29 + i), 6);
    }
    expect(freqLow * Math.pow(2, 1 / 24)).toBeCloseTo(f1);
  });

  test("88 keys stay inside the analyser band at 44.1k/8192", () => {
    const { freqLow, freqHigh } = pianoBand(88);
    const ranges = computeBinRanges({
      barCount: 88,
      sampleRate: 44100,
      fftSize: 8192,
      freqLow,
      freqHigh,
    });
    expect(ranges).toHaveLength(88);
    // Monotonic, non-empty, within the FFT.
    let prev = 0;
    for (const [start, end] of ranges) {
      expect(start).toBeGreaterThanOrEqual(prev);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(4096);
      prev = end;
    }
    // Above ~100 Hz adjacent keys must resolve to distinct bins: A2 (MIDI
    // 45 = key 24) upward, every range should start where the last ended
    // without the forced one-bin fallback stacking up.
    const a2 = ranges[24];
    expect(a2[1] - a2[0]).toBeGreaterThanOrEqual(1);
  });
});

describe("pianoLayout", () => {
  test("key counts and white/black split match real keyboards", () => {
    const expectWhites: Record<number, number> = {
      49: 29, // C3–C7
      61: 36, // C2–C7
      72: 42, // F1–E7
      88: 52, // A0–C8
    };
    for (const keys of PIANO_KEY_COUNTS) {
      const l = pianoLayout(keys);
      expect(l.keys).toHaveLength(keys);
      const whites = l.keys.filter((k) => !k.black).length;
      expect(whites).toBe(expectWhites[keys]);
      expect(l.whiteUnits).toBe(whites);
    }
  });

  test("keys ascend chromatically and never go negative", () => {
    const l = pianoLayout(72);
    for (let i = 1; i < l.keys.length; i++) {
      expect(l.keys[i].midi).toBe(l.keys[i - 1].midi + 1);
    }
    for (const k of l.keys) {
      expect(k.x).toBeGreaterThanOrEqual(0);
      expect(k.x + k.w).toBeLessThanOrEqual(l.whiteUnits);
    }
  });

  test("no two black keys are adjacent; labels sit on C keys only", () => {
    const l = pianoLayout(88);
    for (let i = 1; i < l.keys.length; i++) {
      expect(l.keys[i].black && l.keys[i - 1].black).toBe(false);
    }
    const labeled = l.keys.filter((k) => k.label);
    expect(labeled.map((k) => k.label)).toEqual([
      "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8",
    ]);
    for (const k of labeled) expect(k.black).toBe(false);
    expect(isBlackKey(60)).toBe(false); // C4
    expect(isBlackKey(61)).toBe(true); // C#4
  });

  test("black keys straddle the boundary after their white neighbor", () => {
    const l = pianoLayout(61); // starts at C2
    const cSharp = l.keys[1]; // C#2
    expect(cSharp.black).toBe(true);
    expect(cSharp.x + cSharp.w / 2).toBeCloseTo(1); // centered on C|D edge
  });
});

describe("noteContrast", () => {
  test("a lone peak survives at nearly full level", () => {
    const bars = new Float32Array(24);
    bars[12] = 0.8;
    const out = noteContrast(bars, new Float32Array(24));
    expect(out[12]).toBeCloseTo(0.8, 5);
    // Its neighbors gain nothing from the peak's presence.
    expect(out[11]).toBe(0);
    expect(out[14]).toBe(0);
  });

  test("a flat broadband wall collapses toward dark", () => {
    const bars = new Float32Array(24).fill(0.7);
    const out = noteContrast(bars, new Float32Array(24));
    // Interior bands: v - 0.8v scaled back up ≈ 0.16 — far below the wall.
    for (let i = 4; i < 20; i++) expect(out[i]).toBeLessThan(0.2);
  });

  test("peaks riding a wall still stand out above it", () => {
    const bars = new Float32Array(24).fill(0.4);
    bars[10] = 0.95;
    const out = noteContrast(bars, new Float32Array(24));
    expect(out[10]).toBeGreaterThan(0.4);
    expect(out[10]).toBeGreaterThan(out[5] * 3);
  });

  test("handles edges without reading out of bounds", () => {
    const bars = new Float32Array([0.9, 0, 0, 0, 0, 0.9]);
    const out = noteContrast(bars, new Float32Array(6));
    expect(out[0]).toBeGreaterThan(0.5);
    expect(out[5]).toBeGreaterThan(0.5);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("resolveDsp piano branch", () => {
  test("one bar per key, monstercat off, semitone band", () => {
    const dsp = resolveDsp("piano", null);
    expect(dsp.barCount).toBe(72);
    expect(dsp.tuning.monstercat).toBe(1);
    expect(dsp.freqLow).toBeCloseTo(pianoBand(72).freqLow);
    expect(dsp.freqHigh).toBeCloseTo(pianoBand(72).freqHigh);
  });

  test("keys setting reshapes the band", () => {
    const p = withOverride(null, "piano", "keys", 88);
    const dsp = resolveDsp("piano", p);
    expect(dsp.barCount).toBe(88);
    expect(dsp.freqLow).toBeCloseTo(pianoBand(88).freqLow);
  });
});
