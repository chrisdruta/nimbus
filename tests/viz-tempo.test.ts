import { describe, expect, test } from "bun:test";
import { beatPulse, foldBpm, TempoEstimator } from "../lib/viz/tempo";

/** Feed a train of onsets at the given times (seconds). */
function feed(est: TempoEstimator, times: number[], intensity = 1) {
  for (const t of times) est.push(t, intensity);
}

function train(bpm: number, startSec: number, count: number): number[] {
  const period = 60 / bpm;
  return Array.from({ length: count }, (_, i) => startSec + i * period);
}

describe("foldBpm", () => {
  test("folds octaves into the 70-180 window", () => {
    expect(foldBpm(120)).toBe(120);
    expect(foldBpm(60)).toBe(120);
    expect(foldBpm(240)).toBe(120);
    expect(foldBpm(35)).toBe(70);
    expect(foldBpm(200)).toBe(100);
  });

  test("rejects nonsense", () => {
    expect(foldBpm(0)).toBeNull();
    expect(foldBpm(-10)).toBeNull();
    expect(foldBpm(Infinity)).toBeNull();
  });
});

describe("TempoEstimator", () => {
  test("locks onto a clean 120 BPM train with high confidence", () => {
    const est = new TempoEstimator();
    const times = train(120, 0, 16);
    feed(est, times);
    const e = est.estimate(times[times.length - 1]);
    expect(e).not.toBeNull();
    expect(e!.bpm).toBeCloseTo(120, 0);
    expect(e!.confidence).toBeGreaterThan(0.5);
  });

  test("survives ±20 ms jitter", () => {
    const est = new TempoEstimator();
    const jitter = [8, -14, 20, -6, 12, -18, 4, -10, 16, -2, 19, -12, 7, -15, 11, -9];
    const times = train(120, 0, 16).map((t, i) => t + jitter[i] / 1000);
    feed(est, times);
    const e = est.estimate(times[times.length - 1]);
    expect(e).not.toBeNull();
    expect(e!.bpm).toBeGreaterThan(115);
    expect(e!.bpm).toBeLessThan(125);
  });

  test("half-time onsets fold back into the same octave", () => {
    const est = new TempoEstimator();
    // Onsets every second = 60 BPM, which folds to 120.
    const times = train(60, 0, 10);
    feed(est, times);
    const e = est.estimate(times[times.length - 1]);
    expect(e).not.toBeNull();
    expect(e!.bpm).toBeCloseTo(120, 0);
  });

  test("converges after a tempo change (120 → 140)", () => {
    const est = new TempoEstimator();
    const first = train(120, 0, 12);
    feed(est, first);
    const switchAt = first[first.length - 1] + 60 / 140;
    const second = train(140, switchAt, 24);
    feed(est, second);
    const e = est.estimate(second[second.length - 1]);
    expect(e).not.toBeNull();
    expect(e!.bpm).toBeGreaterThan(135);
    expect(e!.bpm).toBeLessThan(145);
  });

  test("irregular onsets yield no estimate", () => {
    const est = new TempoEstimator();
    // Aperiodic gaps — no bin should accumulate a dominant peak.
    feed(est, [0, 0.31, 0.94, 1.31, 2.17, 2.51, 3.42, 4.03, 4.99, 5.38]);
    expect(est.estimate(5.4)).toBeNull();
  });

  test("too few onsets yield no estimate", () => {
    const est = new TempoEstimator();
    feed(est, train(120, 0, 3));
    expect(est.estimate(1.5)).toBeNull();
  });

  test("estimate goes stale when onsets stop", () => {
    const est = new TempoEstimator();
    const times = train(120, 0, 16);
    feed(est, times);
    const last = times[times.length - 1];
    expect(est.estimate(last + 1)).not.toBeNull();
    expect(est.estimate(last + 20)).toBeNull();
  });

  test("beat phase is near a wrap point at onset times", () => {
    const est = new TempoEstimator();
    const times = train(120, 0, 20);
    feed(est, times);
    const e = est.estimate(times[times.length - 1]);
    expect(e).not.toBeNull();
    // Phase at an on-grid moment sits near 0 or 1, not mid-beat.
    const d = Math.min(e!.beatPhase, 1 - e!.beatPhase);
    expect(d).toBeLessThan(0.15);
  });
});

describe("beatPulse", () => {
  const tempo = { bpm: 120, confidence: 0.9, beatPhase: 0.1 };

  test("fires on phase wrap when the grid is confident", () => {
    const f = { beat: false, beatIntensity: 0, tempo };
    expect(beatPulse(f, 0.9).fire).toBe(true); // 0.9 → 0.1 wrapped
    expect(beatPulse(f, 0.05).fire).toBe(false); // still climbing
  });

  test("first frame on a grid never fires", () => {
    const f = { beat: true, beatIntensity: 1, tempo };
    expect(beatPulse(f, null).fire).toBe(false);
  });

  test("falls back to raw onsets without a confident grid", () => {
    const weak = { ...tempo, confidence: 0.2 };
    const f = { beat: true, beatIntensity: 0.8, tempo: weak };
    const p = beatPulse(f, 0.9);
    expect(p.fire).toBe(true);
    expect(p.intensity).toBeCloseTo(0.8, 5);
    expect(p.phase).toBeNull();
  });

  test("a concurrent raw onset keeps its measured punch", () => {
    const f = { beat: true, beatIntensity: 1.3, tempo };
    expect(beatPulse(f, 0.9).intensity).toBeCloseTo(1.3, 5);
  });
});
