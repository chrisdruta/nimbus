import { describe, expect, test } from "bun:test";
import { buildColormap } from "../lib/viz/colormap";
import { rgbToHsl } from "../lib/viz/palette";

const ACCENT: [number, number, number] = [255, 66, 0];

describe("buildColormap", () => {
  test("256 RGB entries, deterministic", () => {
    const a = buildColormap(ACCENT);
    const b = buildColormap(ACCENT);
    expect(a.length).toBe(256 * 3);
    expect([...a]).toEqual([...b]);
  });

  test("starts near black, ends near white", () => {
    const lut = buildColormap(ACCENT);
    expect(Math.max(lut[0], lut[1], lut[2])).toBeLessThan(30);
    const last = 255 * 3;
    expect(Math.min(lut[last], lut[last + 1], lut[last + 2])).toBeGreaterThan(
      180,
    );
  });

  test("lightness is monotonically non-decreasing", () => {
    const lut = buildColormap(ACCENT);
    let prev = -1;
    for (let i = 0; i < 256; i++) {
      const [, , l] = rgbToHsl(lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]);
      expect(l).toBeGreaterThanOrEqual(prev - 0.02); // rounding tolerance
      prev = l;
    }
  });

  test("midrange carries the accent hue", () => {
    const lut = buildColormap(ACCENT);
    const [accentH] = rgbToHsl(...ACCENT);
    const i = 128;
    const [h, s] = rgbToHsl(lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]);
    expect(s).toBeGreaterThan(0.2);
    // Within the hue-spread window of the accent (wrap-aware).
    const dist = Math.min(Math.abs(h - accentH), 1 - Math.abs(h - accentH));
    expect(dist).toBeLessThan(0.2);
  });

  test("grayscale accent still produces a usable ramp", () => {
    const lut = buildColormap([128, 128, 128]);
    expect(Math.max(lut[0], lut[1], lut[2])).toBeLessThan(30);
    const last = 255 * 3;
    expect(Math.min(lut[last], lut[last + 1], lut[last + 2])).toBeGreaterThan(
      140,
    );
  });
});
