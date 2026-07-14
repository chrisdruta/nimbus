import { describe, expect, test } from "bun:test";
import {
  LEVELER,
  accumulate,
  blockMeanSquare,
  createLevelerState,
  dbToLinear,
  gainDbFor,
  isLoudnessCachePayload,
  loadLoudnessMap,
  loudnessDb,
  rememberLoudness,
  serializeLoudnessMap,
} from "@/lib/loudness";

/** Full-cycle sine block at a given amplitude: mean square = a²/2. */
function sine(amplitude: number, n = 2048): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 8 * i) / n);
  }
  return out;
}

function feed(blocks: Float32Array[]): ReturnType<typeof createLevelerState> {
  let state = createLevelerState();
  for (const b of blocks) state = accumulate(state, blockMeanSquare(b));
  return state;
}

describe("blockMeanSquare", () => {
  test("sine mean square is a²/2", () => {
    expect(blockMeanSquare(sine(1))).toBeCloseTo(0.5, 3);
    expect(blockMeanSquare(sine(0.1))).toBeCloseTo(0.005, 5);
  });

  test("empty and silent blocks are zero", () => {
    expect(blockMeanSquare(new Float32Array(0))).toBe(0);
    expect(blockMeanSquare(new Float32Array(2048))).toBe(0);
  });
});

describe("accumulate / loudnessDb", () => {
  test("silence is gated out and returns the same state object", () => {
    const state = createLevelerState();
    expect(accumulate(state, 0)).toBe(state);
    // -60 dB block sits below the -55 dB gate.
    expect(accumulate(state, dbToLinear(-60) ** 2)).toBe(state);
  });

  test("estimate is null until minBlocks gated blocks arrive", () => {
    let state = createLevelerState();
    for (let i = 0; i < LEVELER.minBlocks - 1; i++) {
      state = accumulate(state, blockMeanSquare(sine(0.5)));
      expect(loudnessDb(state)).toBeNull();
    }
    state = accumulate(state, blockMeanSquare(sine(0.5)));
    expect(loudnessDb(state)).not.toBeNull();
  });

  test("steady sine converges to its RMS in dBFS", () => {
    // Full-scale sine: RMS = 1/√2 → -3.01 dBFS.
    const state = feed(Array.from({ length: 20 }, () => sine(1)));
    expect(loudnessDb(state)!).toBeCloseTo(-3.01, 1);
  });

  test("intro silence does not drag the estimate down", () => {
    const quietIntro = Array.from({ length: 50 }, () => sine(0.0001));
    const body = Array.from({ length: 20 }, () => sine(1));
    const withIntro = feed([...quietIntro, ...body]);
    const without = feed(body);
    expect(loudnessDb(withIntro)!).toBeCloseTo(loudnessDb(without)!, 5);
  });
});

describe("gainDbFor", () => {
  test("moves loudness to the target", () => {
    expect(gainDbFor(LEVELER.targetDb)).toBeCloseTo(0, 5);
    expect(gainDbFor(-8)).toBeCloseTo(LEVELER.targetDb + 8, 5);
    expect(gainDbFor(-18)).toBeCloseTo(LEVELER.targetDb + 18, 5);
  });

  test("clamps at both ends", () => {
    // Crushed master at -4 dB RMS would need -10 dB — inside the clamp.
    expect(gainDbFor(-4)).toBeCloseTo(-10, 5);
    // Absurdly hot input clamps at minGainDb.
    expect(gainDbFor(0)).toBe(LEVELER.minGainDb);
    // Very quiet input clamps at maxGainDb.
    expect(gainDbFor(-40)).toBe(LEVELER.maxGainDb);
  });
});

describe("dbToLinear", () => {
  test("known conversions", () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 3);
    expect(dbToLinear(6)).toBeCloseTo(1.995, 3);
  });
});

describe("loudness cache", () => {
  test("payload validator accepts round-trips and rejects junk", () => {
    const map = new Map([
      [1, -12.5],
      [2, -8],
    ]);
    const payload = serializeLoudnessMap(map);
    expect(isLoudnessCachePayload(payload)).toBe(true);
    expect(loadLoudnessMap(payload)).toEqual(map);

    expect(isLoudnessCachePayload(null)).toBe(false);
    expect(isLoudnessCachePayload({ v: 2, entries: [] })).toBe(false);
    expect(isLoudnessCachePayload({ v: 1, entries: [[1]] })).toBe(false);
    expect(isLoudnessCachePayload({ v: 1, entries: [["1", -3]] })).toBe(false);
    expect(isLoudnessCachePayload({ v: 1, entries: [[1, NaN]] })).toBe(false);
    expect(isLoudnessCachePayload({ v: 1, entries: {} })).toBe(false);
  });

  test("rememberLoudness upserts without mutating the input", () => {
    const before = new Map([[1, -10]]);
    const after = rememberLoudness(before, 2, -8);
    expect(before.size).toBe(1);
    expect(after.get(1)).toBe(-10);
    expect(after.get(2)).toBe(-8);
  });

  test("eviction drops the least recently written entry", () => {
    let map = new Map<number, number>();
    for (let i = 1; i <= 4; i++) map = rememberLoudness(map, i, -i, 4);
    // Rewriting 1 refreshes its recency; adding 5 must evict 2, not 1.
    map = rememberLoudness(map, 1, -1.5, 4);
    map = rememberLoudness(map, 5, -5, 4);
    expect(map.size).toBe(4);
    expect(map.has(2)).toBe(false);
    expect(map.get(1)).toBe(-1.5);
    expect(map.has(5)).toBe(true);
  });
});
