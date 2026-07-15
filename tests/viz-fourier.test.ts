import { describe, expect, test } from "bun:test";
import { Fft2d } from "../lib/viz/fft2d";
import {
  applyFieldWindow,
  buildColorLut,
  embedKernelCentered,
  FieldNormalizer,
  luminanceGrid,
  normalizeSum,
  rasterizeRoll,
  rasterizeStripes,
  rotateField,
  spinTarget,
} from "../lib/viz/fourier";
import { SpectrumHistory } from "../lib/viz/history";

const N = 16;

function bars(...values: number[]): Float32Array {
  return Float32Array.from(values);
}

function fieldMean(f: Float32Array): number {
  let sum = 0;
  for (const v of f) sum += v;
  return sum / f.length;
}

describe("rasterizeStripes", () => {
  const OPTS = { duty: 0.7, mirror: true };

  test("is deterministic", () => {
    const b = bars(0.2, 0.9, 0.4, 0.7);
    const a = new Float32Array(N * N);
    const c = new Float32Array(N * N);
    rasterizeStripes(b, 0.35, a, N, OPTS);
    rasterizeStripes(b, 0.35, c, N, OPTS);
    expect(a).toEqual(c);
  });

  test("returns the exact field mean", () => {
    const out = new Float32Array(N * N);
    const mean = rasterizeStripes(bars(0.5, 1, 0.25), 1.1, out, N, OPTS);
    expect(mean).toBeCloseTo(fieldMean(out), 6);
  });

  test("angle 0 extrudes vertically: every column is constant", () => {
    const out = new Float32Array(N * N);
    rasterizeStripes(bars(0.3, 0.8, 0.1, 0.6), 0, out, N, OPTS);
    for (let x = 0; x < N; x++) {
      for (let y = 1; y < N; y++) {
        expect(out[y * N + x]).toBe(out[x]);
      }
    }
  });

  test("higher duty lights more pixels", () => {
    const b = bars(1, 1, 1, 1);
    const narrow = new Float32Array(N * N);
    const wide = new Float32Array(N * N);
    rasterizeStripes(b, 0.2, narrow, N, { duty: 0.5, mirror: true });
    rasterizeStripes(b, 0.2, wide, N, { duty: 1, mirror: true });
    const lit = (f: Float32Array) => f.reduce((c, v) => c + (v > 0 ? 1 : 0), 0);
    expect(lit(wide)).toBeGreaterThan(lit(narrow));
  });

  test("rotation theorem: a 90° field rotation transposes the spectrum", () => {
    const b = bars(0.3, 0.9, 0.2, 0.7, 0.5);
    const f0 = new Float32Array(N * N);
    const f90 = new Float32Array(N * N);
    const m0 = rasterizeStripes(b, 0, f0, N, OPTS);
    const m90 = rasterizeStripes(b, Math.PI / 2, f90, N, OPTS);

    const fft = new Fft2d(N);
    const mag = (f: Float32Array, mean: number) => {
      const re = new Float32Array(N * N);
      const im = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) re[i] = f[i] - mean;
      fft.forward(re, im);
      const out = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) out[i] = Math.hypot(re[i], im[i]);
      return out;
    };
    const s0 = mag(f0, m0);
    const s90 = mag(f90, m90);
    for (let v = 0; v < N; v++) {
      for (let u = 0; u < N; u++) {
        expect(s90[v * N + u]).toBeCloseTo(s0[u * N + v], 2);
      }
    }
  });
});

describe("rasterizeRoll", () => {
  test("empty history rasterizes to zeros with zero mean", () => {
    const history = new SpectrumHistory({ cols: N, rows: N, intervalSec: 0.1 });
    const out = new Float32Array(N * N).fill(9);
    const mean = rasterizeRoll(history, out, N);
    expect(mean).toBe(0);
    for (const v of out) expect(v).toBe(0);
  });

  test("newest row lands on the bottom edge", () => {
    const history = new SpectrumHistory({ cols: N, rows: N, intervalSec: 0.1 });
    const older = new Float32Array(N).fill(0.25);
    const newest = new Float32Array(N).fill(0.75);
    history.push(older, 0.1); // commit row
    history.push(newest, 0.1); // commit row
    const out = new Float32Array(N * N);
    const mean = rasterizeRoll(history, out, N);
    for (let x = 0; x < N; x++) {
      expect(out[(N - 1) * N + x]).toBeCloseTo(0.75, 6);
      expect(out[(N - 2) * N + x]).toBeCloseTo(0.25, 6);
      expect(out[x]).toBe(0); // top rows still empty
    }
    expect(mean).toBeCloseTo(fieldMean(out), 6);
  });
});

describe("FieldNormalizer", () => {
  test("silence yields a finite clamped scale, never NaN", () => {
    const norm = new FieldNormalizer();
    const scale = norm.next(new Float32Array(64), 1 / 60);
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeCloseTo(1 / 0.35, 5);
  });

  test("attacks fast on a peak jump, releases slowly after", () => {
    const norm = new FieldNormalizer();
    const loud = new Float32Array(64).fill(8);
    const quiet = new Float32Array(64).fill(0.5);
    let scale = 1;
    for (let i = 0; i < 30; i++) scale = norm.next(loud, 1 / 60);
    expect(1 / scale).toBeGreaterThan(7); // near the loud peak within .5s
    const settled = scale;
    scale = norm.next(quiet, 1 / 60);
    // One quiet frame barely moves it — slow release.
    expect(1 / scale).toBeGreaterThan(0.9 * (1 / settled));
  });
});

describe("luminanceGrid", () => {
  test("normalizes so the brightest cell is 1", () => {
    const rgba = new Uint8ClampedArray(4 * 4);
    rgba.set([255, 255, 255, 255], 0); // white
    rgba.set([255, 0, 0, 255], 4); // pure red
    rgba.set([0, 0, 0, 255], 8); // black
    rgba.set([128, 128, 128, 255], 12); // gray
    const out = new Float32Array(4);
    luminanceGrid(rgba, out);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(0.2126, 4);
    expect(out[2]).toBe(0);
    expect(out[3]).toBeCloseTo(128 / 255, 4);
  });

  test("all-black art degrades to a no-op window", () => {
    const rgba = new Uint8ClampedArray(4 * 3); // zeros
    const out = new Float32Array(3);
    luminanceGrid(rgba, out);
    for (const v of out) expect(v).toBe(1);
  });
});

describe("applyFieldWindow", () => {
  test("multiplies in place and returns the new mean", () => {
    const field = Float32Array.from([1, 1, 2, 0]);
    const win = Float32Array.from([0.5, 1, 0.25, 1]);
    const mean = applyFieldWindow(field, win);
    expect(Array.from(field)).toEqual([0.5, 1, 0.5, 0]);
    expect(mean).toBeCloseTo(0.5, 6);
  });
});

describe("rotateField", () => {
  test("angle 0 copies the source and returns its mean", () => {
    const src = new Float32Array(N * N);
    src[3 * N + 7] = 0.5;
    const out = new Float32Array(N * N).fill(9);
    const mean = rotateField(src, out, N, 0);
    expect(out).toEqual(src);
    expect(mean).toBeCloseTo(0.5 / (N * N), 8);
  });

  test("a quarter turn maps pixels exactly: out[y][x] = src[n-1-x][y]", () => {
    const src = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) src[i] = i;
    const out = new Float32Array(N * N);
    rotateField(src, out, N, Math.PI / 2);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        expect(out[y * N + x]).toBe(src[(N - 1 - x) * N + y]);
      }
    }
  });

  test("rows become columns: a rotated roll's time axis turns", () => {
    // Bottom-edge row (newest) rotated 90° should land on an edge column.
    const src = new Float32Array(N * N);
    for (let x = 0; x < N; x++) src[(N - 1) * N + x] = 1;
    const out = new Float32Array(N * N);
    rotateField(src, out, N, Math.PI / 2);
    for (let y = 0; y < N; y++) {
      expect(out[y * N]).toBe(1); // left edge column
      expect(out[y * N + 1]).toBe(0);
    }
  });

  test("off-grid samples after rotation are zero, mean matches", () => {
    const src = new Float32Array(N * N).fill(1);
    const out = new Float32Array(N * N);
    const mean = rotateField(src, out, N, Math.PI / 4);
    // The rotated square's corners fall outside the source: some zeros.
    let sum = 0;
    let zeros = 0;
    for (const v of out) {
      sum += v;
      if (v === 0) zeros++;
    }
    expect(zeros).toBeGreaterThan(0);
    expect(mean).toBeCloseTo(sum / (N * N), 6);
  });
});

describe("normalizeSum", () => {
  test("scales the kernel to unit sum", () => {
    const k = Float32Array.from([1, 3, 4]);
    normalizeSum(k);
    expect(k[0]).toBeCloseTo(0.125, 5);
    expect(k[1]).toBeCloseTo(0.375, 5);
    expect(k[2]).toBeCloseTo(0.5, 5);
  });

  test("all-zero kernel degrades to a uniform box", () => {
    const k = new Float32Array(4);
    normalizeSum(k);
    for (const v of k) expect(v).toBeCloseTo(0.25, 6);
  });
});

describe("embedKernelCentered", () => {
  test("centers the kernel on the origin with wraparound", () => {
    const n = 8;
    const re = new Float32Array(n * n);
    const im = new Float32Array(n * n);
    const kernel = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]); // 3×3
    embedKernelCentered(kernel, 3, re, im, n);
    // Kernel center (value 5) lands at (0,0); corners wrap.
    expect(re[0]).toBe(5);
    expect(re[1]).toBe(6); // right of center
    expect(re[n - 1]).toBe(4); // left of center, wrapped
    expect(re[n]).toBe(8); // below center
    expect(re[(n - 1) * n]).toBe(2); // above center, wrapped
    expect(re[(n - 1) * n + (n - 1)]).toBe(1); // top-left corner, wrapped
    for (const v of im) expect(v).toBe(0);
  });

  test("FFT convolution with an origin impulse reproduces the kernel", () => {
    // conv(δ, K) = K — run the exact pipeline the scene uses.
    const n = 8;
    const fft = new Fft2d(n);
    const kernel = Float32Array.from([0.5, 0.25, 0.125, 0.125]); // 2×2
    const kre = new Float32Array(n * n);
    const kim = new Float32Array(n * n);
    embedKernelCentered(kernel, 2, kre, kim, n);
    const expected = Float32Array.from(kre);
    fft.forward(kre, kim);

    const re = new Float32Array(n * n);
    const im = new Float32Array(n * n);
    re[0] = 1; // impulse at the origin
    fft.forward(re, im);
    for (let i = 0; i < n * n; i++) {
      const r = re[i] * kre[i] - im[i] * kim[i];
      im[i] = re[i] * kim[i] + im[i] * kre[i];
      re[i] = r;
    }
    fft.inverse(re, im);
    for (let i = 0; i < n * n; i++) expect(re[i]).toBeCloseTo(expected[i], 4);
  });
});

describe("spinTarget", () => {
  test("no tempo: converts the slider from deg/sec to rad/sec", () => {
    expect(spinTarget(null, 18)).toBeCloseTo((18 * Math.PI) / 180, 6);
  });

  test("unconfident tempo falls back to the slider", () => {
    const rate = spinTarget({ bpm: 128, confidence: 0.3 }, 18);
    expect(rate).toBeCloseTo((18 * Math.PI) / 180, 6);
  });

  test("confident tempo locks to one revolution per 16 beats", () => {
    const rate = spinTarget({ bpm: 120, confidence: 0.8 }, 18);
    // 120 bpm → 2 beats/sec → 16 beats in 8s → 2π/8 rad/sec.
    expect(rate).toBeCloseTo((Math.PI * 2) / 8, 6);
  });

  test("slider at 0 stays still even on a confident grid", () => {
    expect(spinTarget({ bpm: 174, confidence: 0.9 }, 0)).toBe(0);
  });
});

describe("buildColorLut", () => {
  test("alpha starts at zero and never decreases", () => {
    const lut = buildColorLut([255, 66, 0]);
    expect(lut[3]).toBe(0);
    for (let i = 1; i < 256; i++) {
      expect(lut[i * 4 + 3]).toBeGreaterThanOrEqual(lut[(i - 1) * 4 + 3]);
    }
  });

  test("tops out at opaque white", () => {
    const lut = buildColorLut([255, 66, 0]);
    const o = 255 * 4;
    expect(lut[o]).toBe(255);
    expect(lut[o + 1]).toBe(255);
    expect(lut[o + 2]).toBe(255);
    expect(lut[o + 3]).toBe(255);
  });

  test("mid-ramp sits on the accent hue", () => {
    const lut = buildColorLut([255, 66, 0]);
    const o = Math.round(0.7 * 255) * 4;
    expect(Math.abs(lut[o] - 255)).toBeLessThanOrEqual(3);
    expect(Math.abs(lut[o + 1] - 66)).toBeLessThanOrEqual(3);
    expect(lut[o + 2]).toBeLessThanOrEqual(3);
  });
});
