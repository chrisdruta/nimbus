import { describe, expect, test } from "bun:test";
import {
  applyWindow2d,
  complexMultiply,
  Fft2d,
  hannWindow,
  logMagnitude,
  makeFftTables,
  shiftedIndex,
} from "../lib/viz/fft2d";

/** Seeded LCG so the Parseval field is deterministic. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe("makeFftTables", () => {
  test("rejects non-power-of-two sizes", () => {
    expect(() => makeFftTables(96)).toThrow();
    expect(() => makeFftTables(0)).toThrow();
    expect(() => makeFftTables(1)).toThrow();
  });

  test("bit reversal is an involution", () => {
    const { rev } = makeFftTables(16);
    for (let i = 0; i < 16; i++) expect(rev[rev[i]]).toBe(i);
  });
});

describe("Fft2d", () => {
  test("impulse at the origin transforms to a flat spectrum", () => {
    const n = 8;
    const re = new Float32Array(n * n);
    const im = new Float32Array(n * n);
    re[0] = 1;
    new Fft2d(n).forward(re, im);
    for (let i = 0; i < n * n; i++) {
      expect(re[i]).toBeCloseTo(1, 5);
      expect(im[i]).toBeCloseTo(0, 5);
    }
  });

  test("horizontal cosine stripes concentrate at (±k, 0)", () => {
    const n = 16;
    const k = 3;
    const re = new Float32Array(n * n);
    const im = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        re[y * n + x] = Math.cos((2 * Math.PI * k * x) / n);
      }
    }
    new Fft2d(n).forward(re, im);
    const expected = (n * n) / 2;
    for (let v = 0; v < n; v++) {
      for (let u = 0; u < n; u++) {
        const m = Math.hypot(re[v * n + u], im[v * n + u]);
        if (v === 0 && (u === k || u === n - k)) {
          expect(m).toBeCloseTo(expected, 2);
        } else {
          expect(m).toBeLessThan(1e-3 * expected);
        }
      }
    }
  });

  test("Parseval: spatial energy matches spectral energy / n²", () => {
    const n = 16;
    const rand = lcg(1234);
    const src = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) src[i] = rand() - 0.5;
    const re = Float32Array.from(src);
    const im = new Float32Array(n * n);
    new Fft2d(n).forward(re, im);
    let spatial = 0;
    let spectral = 0;
    for (let i = 0; i < n * n; i++) {
      spatial += src[i] * src[i];
      spectral += re[i] * re[i] + im[i] * im[i];
    }
    expect(spectral / (n * n)).toBeCloseTo(spatial, 3);
  });
});

describe("Fft2d.inverse", () => {
  test("round-trips a random field through forward + inverse", () => {
    const n = 16;
    const rand = lcg(42);
    const src = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) src[i] = rand() - 0.5;
    const re = Float32Array.from(src);
    const im = new Float32Array(n * n);
    const fft = new Fft2d(n);
    fft.forward(re, im);
    fft.inverse(re, im);
    for (let i = 0; i < n * n; i++) {
      expect(re[i]).toBeCloseTo(src[i], 4);
      expect(im[i]).toBeCloseTo(0, 4);
    }
  });
});

describe("complexMultiply", () => {
  test("multiplies elementwise into the first pair", () => {
    const are = Float32Array.from([1, 0]);
    const aim = Float32Array.from([2, 1]);
    const bre = Float32Array.from([3, 0]);
    const bim = Float32Array.from([-1, 1]);
    complexMultiply(are, aim, bre, bim);
    // (1+2i)(3-i) = 5+5i ; (0+i)(0+i) = -1
    expect(are[0]).toBeCloseTo(5, 5);
    expect(aim[0]).toBeCloseTo(5, 5);
    expect(are[1]).toBeCloseTo(-1, 5);
    expect(aim[1]).toBeCloseTo(0, 5);
  });
});

describe("logMagnitude", () => {
  test("applies log1p of the scaled magnitude", () => {
    const re = new Float32Array([3, 0, 0]);
    const im = new Float32Array([4, 0, 1]);
    const out = new Float32Array(3);
    logMagnitude(re, im, out, 2);
    expect(out[0]).toBeCloseTo(Math.log1p(10), 5);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeCloseTo(Math.log1p(2), 5);
  });
});

describe("hannWindow", () => {
  test("periodic: zero at the edge, unity at the center, symmetric", () => {
    const win = hannWindow(16);
    expect(win[0]).toBeCloseTo(0, 6);
    expect(win[8]).toBeCloseTo(1, 6);
    for (let i = 1; i < 16; i++) expect(win[i]).toBeCloseTo(win[16 - i], 6);
  });
});

describe("applyWindow2d", () => {
  test("matches the direct outer product", () => {
    const n = 4;
    const win = hannWindow(n);
    const field = new Float32Array(n * n).fill(1);
    applyWindow2d(field, win, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        expect(field[y * n + x]).toBeCloseTo(win[x] * win[y], 6);
      }
    }
  });
});

describe("shiftedIndex", () => {
  test("puts DC at the grid center", () => {
    const n = 8;
    expect(shiftedIndex(n / 2, n / 2, n)).toBe(0);
  });

  test("covers every spectrum index exactly once", () => {
    const n = 8;
    const seen = new Set<number>();
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) seen.add(shiftedIndex(x, y, n));
    }
    expect(seen.size).toBe(n * n);
  });
});
