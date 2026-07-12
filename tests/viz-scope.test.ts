import { describe, expect, test } from "bun:test";
import { AutoGain, findTrigger } from "../lib/viz/scope";

function sine(n: number, period: number, phase = 0, amp = 0.5): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * (i + phase)) / period);
  }
  return out;
}

describe("findTrigger", () => {
  test("finds the rising zero-cross of a sine", () => {
    // Phase 32 on a 64-period sine: first rising zero-cross at index 32.
    const w = sine(2048, 64, 32);
    const trig = findTrigger(w, 512);
    expect(w[trig]).toBeLessThanOrEqual(0);
    expect(w[trig + 1]).toBeGreaterThan(0);
    expect(trig).toBe(32);
  });

  test("silence returns 0", () => {
    expect(findTrigger(new Float32Array(2048), 512)).toBe(0);
  });

  test("DC offset (never crossing zero) returns 0", () => {
    const w = new Float32Array(2048).fill(0.3);
    expect(findTrigger(w, 512)).toBe(0);
  });

  test("noise wobble around zero without a real edge is rejected", () => {
    const w = new Float32Array(2048);
    // Tiny alternating values: crossings exist but lookahead mean ~0.
    for (let i = 0; i < w.length; i++) w[i] = i % 2 === 0 ? -0.001 : 0.001;
    expect(findTrigger(w, 512)).toBe(0);
  });

  test("trigger leaves room for the drawn window", () => {
    const w = sine(2048, 64, 32);
    const trig = findTrigger(w, 512);
    expect(trig + 1024).toBeLessThanOrEqual(w.length);
  });
});

describe("AutoGain", () => {
  test("converges toward 0.35/rms for quiet input", () => {
    const ag = new AutoGain();
    let g = 1;
    for (let i = 0; i < 600; i++) g = ag.next(0.05, 1 / 60);
    expect(g).toBeCloseTo(0.35 / 0.05, 0); // ≈7
  });

  test("clamps at 10 for near-silence and 1 for loud", () => {
    const quiet = new AutoGain();
    let g = 1;
    for (let i = 0; i < 900; i++) g = quiet.next(0.0001, 1 / 60);
    expect(g).toBeLessThanOrEqual(10);
    expect(g).toBeGreaterThan(9);

    const loud = new AutoGain();
    for (let i = 0; i < 300; i++) g = loud.next(0.9, 1 / 60);
    expect(g).toBeCloseTo(1, 1);
  });

  test("responds faster down than up", () => {
    const ag = new AutoGain();
    for (let i = 0; i < 600; i++) ag.next(0.05, 1 / 60); // gain ≈ 7
    const droppedTo = ag.next(0.7, 1 / 60); // loud hit
    const ag2 = new AutoGain();
    for (let i = 0; i < 600; i++) ag2.next(0.7, 1 / 60); // gain ≈ 1
    const roseTo = ag2.next(0.05, 1 / 60);
    // One frame of loud input moves gain down more than one frame of
    // quiet input moves it up (relative to the respective gaps).
    expect((7 - droppedTo) / 6).toBeGreaterThan((roseTo - 1) / 6);
  });
});
