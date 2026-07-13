import { hslToRgb, rgbToHsl } from "./palette";

/**
 * 256-entry RGB lookup table for the waterfall spectrogram: near-black →
 * dim accent → accent → hue-rotated bright → near-white. Lightness rises
 * monotonically so intensity always reads as "more".
 */
export function buildColormap(
  accentRgb: [number, number, number],
  hueSpreadDeg = 40,
): Uint8ClampedArray {
  const [h, s] = rgbToHsl(accentRgb[0], accentRgb[1], accentRgb[2]);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // Hue drifts toward the rotated end as intensity grows (aurora feel).
    const hue = (h + (hueSpreadDeg / 360) * t * t + 1) % 1;
    // Saturation ramps in quickly, then eases off near white.
    const sat =
      Math.max(0.25, s) *
      Math.min(1, t * 4) *
      (t > 0.85 ? 1 - ((t - 0.85) / 0.15) * 0.6 : 1);
    const light = 0.02 + 0.93 * Math.pow(t, 1.15);
    const [r, g, b] = hslToRgb(hue, sat, light);
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
}
