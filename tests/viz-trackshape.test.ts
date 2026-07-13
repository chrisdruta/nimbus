import { describe, expect, test } from "bun:test";
import {
  dropAnticipation,
  envelopeAt,
  nextDrop,
  normalizeWaveform,
} from "../lib/viz/trackshape";

/** Synthetic sample arrays on the provider's arbitrary integer scale. */
function flat(level: number, len = 1800): number[] {
  return new Array(len).fill(level);
}

/** Quiet intro, hard drop at the given fraction, loud to the end. */
function quietThenDrop(dropFrac: number, len = 1800): number[] {
  const out = new Array<number>(len);
  const at = Math.floor(len * dropFrac);
  for (let i = 0; i < len; i++) out[i] = i < at ? 20 : 130;
  return out;
}

describe("normalizeWaveform", () => {
  test("rejects unusably short input", () => {
    expect(normalizeWaveform([1, 2, 3])).toBeNull();
    expect(normalizeWaveform(flat(0))).toBeNull(); // all-zero: no scale
  });

  test("flat input normalizes near 1 with a single loud section", () => {
    const shape = normalizeWaveform(flat(100))!;
    expect(shape.envelope.length).toBe(512);
    for (const v of shape.envelope) expect(v).toBeCloseTo(1, 5);
    expect(shape.sections).toHaveLength(1);
    expect(shape.sections[0].kind).toBe("loud");
    expect(shape.drops).toHaveLength(0);
  });

  test("a lone spike does not crush the envelope (percentile scale)", () => {
    const samples = flat(100);
    samples[900] = 10_000;
    const shape = normalizeWaveform(samples)!;
    // Median-ish level stays ~1 rather than ~0.01.
    expect(shape.envelope[100]).toBeGreaterThan(0.9);
  });

  test("quiet intro then drop yields quiet+loud sections and one drop", () => {
    const shape = normalizeWaveform(quietThenDrop(0.3))!;
    expect(shape.sections.length).toBe(2);
    expect(shape.sections[0].kind).toBe("quiet");
    expect(shape.sections[1].kind).toBe("loud");
    expect(shape.drops.length).toBe(1);
    expect(shape.drops[0].atFrac).toBeCloseTo(0.3, 1);
    expect(shape.drops[0].strength).toBeGreaterThan(0.7);
  });

  test("multiple drops are all found in order", () => {
    const len = 1800;
    const samples = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      const frac = i / len;
      // loud 0-0.2, quiet 0.2-0.4, loud 0.4-0.6, quiet 0.6-0.8, loud tail
      const quiet = (frac >= 0.2 && frac < 0.4) || (frac >= 0.6 && frac < 0.8);
      samples[i] = quiet ? 15 : 125;
    }
    const shape = normalizeWaveform(samples)!;
    expect(shape.drops.length).toBe(2);
    expect(shape.drops[0].atFrac).toBeCloseTo(0.4, 1);
    expect(shape.drops[1].atFrac).toBeCloseTo(0.8, 1);
  });

  test("sectioning hysteresis ignores single-point flicker", () => {
    const samples = flat(100);
    samples[400] = 0; // one quiet blip in a loud track
    const shape = normalizeWaveform(samples)!;
    expect(shape.sections).toHaveLength(1);
    expect(shape.sections[0].kind).toBe("loud");
  });
});

describe("queries", () => {
  const shape = normalizeWaveform(quietThenDrop(0.5))!;

  test("envelopeAt reads the normalized level by fraction", () => {
    expect(envelopeAt(shape, 0.1)).toBeLessThan(0.3);
    expect(envelopeAt(shape, 0.9)).toBeGreaterThan(0.8);
    expect(envelopeAt(shape, -1)).toBe(shape.envelope[0]); // clamped
    expect(envelopeAt(shape, 2)).toBe(shape.envelope[511]);
  });

  test("nextDrop reports distance to the upcoming drop", () => {
    const d = nextDrop(shape, 0.2)!;
    expect(d.inFrac).toBeCloseTo(0.3, 1);
    expect(nextDrop(shape, 0.6)).toBeNull(); // already past it
  });

  test("dropAnticipation ramps in only near the drop", () => {
    const durationSec = 200; // drop at 100 s
    expect(dropAnticipation(shape, 50, durationSec)).toBe(0);
    const near = dropAnticipation(shape, 99.5, durationSec, 2);
    expect(near).toBeGreaterThan(0.5);
    expect(dropAnticipation(null, 99.5, durationSec)).toBe(0);
    expect(dropAnticipation(shape, 99.5, 0)).toBe(0);
  });
});
