import { describe, expect, test } from "bun:test";
import { SpectrumHistory } from "../lib/viz/history";

const bars = (...values: number[]) => new Float32Array(values);

describe("SpectrumHistory", () => {
  test("commits rows on the time interval, not per frame", () => {
    const h = new SpectrumHistory({ cols: 2, rows: 4, intervalSec: 0.1 });
    expect(h.push(bars(1, 0), 0.04)).toBe(0);
    expect(h.push(bars(1, 0), 0.04)).toBe(0);
    expect(h.rowCount).toBe(0);
    expect(h.push(bars(1, 0), 0.04)).toBe(1); // 0.12s accumulated
    expect(h.rowCount).toBe(1);
  });

  test("a large dt commits multiple rows", () => {
    const h = new SpectrumHistory({ cols: 1, rows: 8, intervalSec: 0.1 });
    expect(h.push(bars(0.5), 0.35)).toBe(3);
    expect(h.rowCount).toBe(3);
  });

  test("max-pools within the interval so transients survive", () => {
    const h = new SpectrumHistory({ cols: 1, rows: 4, intervalSec: 0.1 });
    h.push(bars(0.2), 0.03);
    h.push(bars(0.9), 0.03); // the spike
    h.push(bars(0.1), 0.05); // commit happens here
    expect(h.row(0)[0]).toBeCloseTo(0.9, 5);
  });

  test("max-pools across columns when downsampling", () => {
    const h = new SpectrumHistory({ cols: 2, rows: 2, intervalSec: 0.1 });
    h.push(bars(0.1, 0.8, 0.2, 0.3), 0.1);
    const row = h.row(0);
    expect(row[0]).toBeCloseTo(0.8, 5); // max of first half
    expect(row[1]).toBeCloseTo(0.3, 5); // max of second half
  });

  test("row(0) is newest and the ring wraps at capacity", () => {
    const h = new SpectrumHistory({ cols: 1, rows: 3, intervalSec: 0.1 });
    for (let i = 1; i <= 5; i++) h.push(bars(i / 10), 0.1);
    expect(h.rowCount).toBe(3);
    expect(h.row(0)[0]).toBeCloseTo(0.5, 5);
    expect(h.row(1)[0]).toBeCloseTo(0.4, 5);
    expect(h.row(2)[0]).toBeCloseTo(0.3, 5);
  });

  test("pending pool resets after a commit", () => {
    const h = new SpectrumHistory({ cols: 1, rows: 4, intervalSec: 0.1 });
    h.push(bars(0.9), 0.1); // commit the spike
    h.push(bars(0.2), 0.1); // next row must not remember it
    expect(h.row(0)[0]).toBeCloseTo(0.2, 5);
  });
});
