import { describe, expect, test } from "bun:test";
import {
  computeBinRanges,
  monstercatFilter,
  SpectrumProcessor,
  type SpectrumConfig,
} from "../lib/viz/dsp";

const CFG: SpectrumConfig = {
  barCount: 24,
  sampleRate: 44100,
  fftSize: 2048,
};

describe("computeBinRanges", () => {
  test("produces one range per bar, each at least one bin wide", () => {
    const ranges = computeBinRanges(CFG);
    expect(ranges).toHaveLength(24);
    for (const [start, end] of ranges) expect(end).toBeGreaterThan(start);
  });

  test("ranges are contiguous and monotone", () => {
    const ranges = computeBinRanges(CFG);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i][0]).toBe(ranges[i - 1][1]);
    }
  });

  test("stays within the analyser's bin count", () => {
    const ranges = computeBinRanges({ ...CFG, barCount: 96 });
    const last = ranges[ranges.length - 1];
    expect(last[1]).toBeLessThanOrEqual(CFG.fftSize / 2);
  });

  test("covers the requested band approximately", () => {
    const hzPerBin = CFG.sampleRate / CFG.fftSize; // ~21.5 Hz
    const ranges = computeBinRanges(CFG);
    expect(ranges[0][0] * hzPerBin).toBeLessThanOrEqual(60);
    expect(ranges[ranges.length - 1][1] * hzPerBin).toBeGreaterThanOrEqual(11000);
  });
});

describe("monstercatFilter", () => {
  test("lifts neighbors of a lone spike by successive powers", () => {
    const bars = new Float32Array([0, 0, 1, 0, 0]);
    monstercatFilter(bars, 1.5);
    expect(bars[2]).toBe(1);
    expect(bars[1]).toBeCloseTo(1 / 1.5, 5);
    expect(bars[3]).toBeCloseTo(1 / 1.5, 5);
    expect(bars[0]).toBeCloseTo(1 / 2.25, 5);
    expect(bars[4]).toBeCloseTo(1 / 2.25, 5);
  });

  test("never lowers existing values", () => {
    const bars = new Float32Array([0.9, 0.1, 1, 0.1, 0.9]);
    const before = [...bars];
    monstercatFilter(bars, 1.5);
    for (let i = 0; i < bars.length; i++) {
      expect(bars[i]).toBeGreaterThanOrEqual(before[i]);
    }
  });

  test("strength <= 1 is a no-op", () => {
    const bars = new Float32Array([0, 1, 0]);
    monstercatFilter(bars, 1);
    expect([...bars]).toEqual([0, 1, 0]);
  });
});

function frame(processor: SpectrumProcessor, level: number, dt = 1 / 60) {
  const data = new Uint8Array(1024).fill(level);
  return processor.process(data, dt);
}

describe("SpectrumProcessor", () => {
  test("silence stays at zero", () => {
    const p = new SpectrumProcessor(CFG);
    const out = frame(p, 0);
    for (const v of out) expect(v).toBe(0);
  });

  test("rise is instant, fall is gravity-accelerated", () => {
    const p = new SpectrumProcessor({ ...CFG, monstercat: 1, noiseFloor: 0 });
    const loud = frame(p, 255);
    const peak = loud[0];
    expect(peak).toBeGreaterThan(0.9);

    // One quiet frame: barely fallen (gravity * dt² is tiny).
    const after1 = frame(p, 0)[0];
    expect(after1).toBeLessThan(peak);
    expect(after1).toBeGreaterThan(peak - 0.01);

    // Accelerating: the drop over frames 2..11 exceeds 10x the first drop.
    let after10 = after1;
    for (let i = 0; i < 10; i++) after10 = frame(p, 0)[0];
    expect(peak - after10).toBeGreaterThan((peak - after1) * 10);

    // Instant rise from mid-fall.
    const risen = frame(p, 255)[0];
    expect(risen).toBeGreaterThanOrEqual(peak * 0.99);
  });

  test("sensitivity autoscale fills the range on quiet input", () => {
    const p = new SpectrumProcessor({ ...CFG, monstercat: 1, noiseFloor: 0 });
    let max = 0;
    for (let i = 0; i < 600; i++) {
      const out = frame(p, 40); // quiet but present
      max = Math.max(...out);
    }
    expect(max).toBeGreaterThan(0.8);
  });

  test("no bar ever exceeds 1 even after quiet-boosted sens meets loud input", () => {
    const p = new SpectrumProcessor({ ...CFG, monstercat: 1, noiseFloor: 0 });
    for (let i = 0; i < 600; i++) frame(p, 40);
    const out = frame(p, 255);
    for (const v of out) expect(v).toBeLessThanOrEqual(1);
  });

  test("noise floor zeroes sub-floor input", () => {
    const p = new SpectrumProcessor({ ...CFG, monstercat: 1, noiseFloor: 0.1 });
    // level 10/255 ≈ 0.039 < 0.1 floor (sens starts at 1)
    const out = frame(p, 10);
    for (const v of out) expect(v).toBe(0);
  });
});
