import { describe, expect, test } from "bun:test";
import {
  buildHistogram,
  bucketIndex,
  hslToRgb,
  pickVibrant,
  rgbToHsl,
} from "../lib/viz/palette";

/** RGBA pixel data from a list of [r,g,b] colors. */
function pixels(colors: Array<[number, number, number]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  return data;
}

describe("rgbToHsl / hslToRgb", () => {
  test("primaries round-trip", () => {
    const primaries: Array<[number, number, number]> = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 66, 0],
    ];
    for (const rgb of primaries) {
      const [h, s, l] = rgbToHsl(...rgb);
      const back = hslToRgb(h, s, l);
      expect(back[0]).toBeCloseTo(rgb[0], -1);
      expect(back[1]).toBeCloseTo(rgb[1], -1);
      expect(back[2]).toBeCloseTo(rgb[2], -1);
    }
  });

  test("grays have zero saturation", () => {
    expect(rgbToHsl(128, 128, 128)[1]).toBe(0);
    expect(rgbToHsl(0, 0, 0)[1]).toBe(0);
    expect(rgbToHsl(255, 255, 255)[1]).toBe(0);
  });

  test("bucketIndex stays in range at extremes", () => {
    expect(bucketIndex(0, 0, 0)).toBe(0);
    expect(bucketIndex(1, 1, 1)).toBe(12 * 3 * 3 - 1);
  });
});

describe("pickVibrant", () => {
  test("picks the dominant vibrant color", () => {
    // 60% saturated blue, 40% saturated red.
    const data = pixels([
      ...Array.from({ length: 60 }, () => [40, 80, 220] as [number, number, number]),
      ...Array.from({ length: 40 }, () => [220, 40, 40] as [number, number, number]),
    ]);
    const rgb = pickVibrant(buildHistogram(data));
    expect(rgb).not.toBeNull();
    const [r, , b] = rgb!;
    expect(b).toBeGreaterThan(r); // blue won
  });

  test("ignores grayscale pixels entirely", () => {
    const data = pixels(
      Array.from({ length: 100 }, () => [128, 128, 128] as [number, number, number]),
    );
    expect(pickVibrant(buildHistogram(data))).toBeNull();
  });

  test("dark-but-hued artwork yields its hue via the relaxed pass", () => {
    // Deep red, below the strict lightness gate (l ≈ 0.07).
    const data = pixels(
      Array.from({ length: 100 }, () => [30, 5, 5] as [number, number, number]),
    );
    const rgb = pickVibrant(buildHistogram(data));
    expect(rgb).not.toBeNull();
    const [h, , l] = rgbToHsl(...rgb!);
    expect(h).toBeLessThan(0.05); // still red
    expect(l).toBeGreaterThanOrEqual(0.54); // lifted to readable
  });

  test("ignores near-white vibrance", () => {
    const data = pixels(
      Array.from(
        { length: 100 },
        () => [255, 245, 240] as [number, number, number],
      ),
    );
    expect(pickVibrant(buildHistogram(data))).toBeNull();
  });

  test("prefers a strict-vibrant bucket over a bigger dark one", () => {
    const data = pixels([
      // 70% deep dark blue (only passes the relaxed gate)...
      ...Array.from({ length: 70 }, () => [10, 12, 40] as [number, number, number]),
      // ...but 30% properly vibrant green wins via the strict pass.
      ...Array.from({ length: 30 }, () => [60, 200, 80] as [number, number, number]),
    ]);
    const rgb = pickVibrant(buildHistogram(data));
    expect(rgb).not.toBeNull();
    const [r, g, b] = rgb!;
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  test("floors lightness so the color reads on near-black", () => {
    // Vibrant but darkish red (l ≈ 0.33).
    const data = pixels(
      Array.from({ length: 100 }, () => [150, 20, 20] as [number, number, number]),
    );
    const rgb = pickVibrant(buildHistogram(data));
    expect(rgb).not.toBeNull();
    const [, , l] = rgbToHsl(...rgb!);
    expect(l).toBeGreaterThanOrEqual(0.54);
  });
});
