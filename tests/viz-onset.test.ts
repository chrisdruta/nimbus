import { describe, expect, test } from "bun:test";
import { OnsetDetector } from "../lib/viz/onset";

const DT = 1 / 60;

/** Run a signal function through a detector; returns beat timestamps. */
function run(
  detector: OnsetDetector,
  signal: (t: number) => number,
  seconds: number,
): number[] {
  const beats: number[] = [];
  for (let t = 0; t < seconds; t += DT) {
    if (detector.push(signal(t), t).beat) beats.push(t);
  }
  return beats;
}

describe("OnsetDetector", () => {
  test("silence never fires", () => {
    expect(run(new OnsetDetector(), () => 0, 5)).toHaveLength(0);
  });

  test("pulse train over a noise floor fires on the pulses", () => {
    // 0.1 baseline with 0.6 spikes every second, 100 ms wide.
    const signal = (t: number) => (t % 1 < 0.1 ? 0.6 : 0.1);
    const beats = run(new OnsetDetector(), signal, 6);
    expect(beats.length).toBeGreaterThanOrEqual(4);
    // Every beat lands inside a pulse window.
    for (const t of beats) expect(t % 1).toBeLessThan(0.12);
  });

  test("refractory period prevents double fires within one pulse", () => {
    const signal = (t: number) => (t % 1 < 0.1 ? 0.6 : 0.1);
    const beats = run(new OnsetDetector({ refractorySec: 0.18 }), signal, 6);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i] - beats[i - 1]).toBeGreaterThan(0.18);
    }
  });

  test("sustained loud signal fires at most once", () => {
    const beats = run(new OnsetDetector(), () => 0.8, 5);
    expect(beats.length).toBeLessThanOrEqual(1);
  });

  test("quiet pulses below the absolute floor never fire", () => {
    const signal = (t: number) => (t % 1 < 0.1 ? 0.015 : 0.001);
    expect(run(new OnsetDetector(), signal, 5)).toHaveLength(0);
  });

  test("intensity scales with how far the spike exceeds threshold", () => {
    const d = new OnsetDetector();
    // Build up a quiet window first.
    for (let t = 0; t < 1; t += DT) d.push(0.1, t);
    const big = d.push(0.9, 1.0);
    expect(big.beat).toBe(true);
    expect(big.intensity).toBeGreaterThan(0.5);
    expect(big.intensity).toBeLessThanOrEqual(1.5);
  });
});
