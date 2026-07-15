/**
 * Field construction for the fourier scene: the spectrum rendered as a
 * spatial image (rotating stripes or a scrolling spectrogram), plus the
 * brightness stabilizer and palette LUT for painting the 2D spectrum.
 * Pure and allocation-free on the per-frame paths.
 */

import type { SpectrumHistory } from "./history";

export interface StripeOpts {
  /** Lit fraction of each bar cell — lower cuts sharper, richer edges. */
  duty: number;
  /** Fold lows to the center (symmetric source, ridgeline-style). */
  mirror: boolean;
}

/**
 * Rotating stripe field: the bar spectrum extruded along one axis and
 * rotated by `angle` about the grid center — evaluated analytically per
 * pixel, no canvas sampling. Each pixel is rotated back by -angle; its
 * cross-stripe coordinate u ∈ [-1, 1] picks a bar cell, and the inner
 * `duty` fraction of the cell carries the bar value (hard edges by
 * design: richer harmonic dot trains). Returns the field mean so the
 * caller can subtract it — removing the DC spike exactly.
 */
export function rasterizeStripes(
  bars: Float32Array,
  angle: number,
  out: Float32Array,
  n: number,
  opts: StripeOpts,
): number {
  const nb = bars.length;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const scale = 2 / n; // pixel index → centered coordinate in [-1, 1]
  const center = (n - 1) / 2;
  const halfDuty = opts.duty * 0.5;
  let sum = 0;
  for (let y = 0; y < n; y++) {
    const cy = (y - center) * scale;
    const o = y * n;
    for (let x = 0; x < n; x++) {
      const cx = (x - center) * scale;
      const u = cx * cos + cy * sin;
      const p = opts.mirror ? Math.abs(u) : (u + 1) * 0.5;
      let v = 0;
      if (p >= 0 && p < 1) {
        const cell = Math.floor(p * nb);
        const frac = p * nb - cell;
        if (Math.abs(frac - 0.5) <= halfDuty) v = bars[cell];
      }
      out[o + x] = v;
      sum += v;
    }
  }
  return sum / (n * n);
}

/**
 * Roll field: the spectrogram history as a time × frequency image, the
 * newest row on the bottom edge. Build the history with cols = n and
 * rows = n so rows copy straight through; rows not yet committed stay
 * zero. Returns the field mean, same contract as rasterizeStripes.
 */
export function rasterizeRoll(
  history: SpectrumHistory,
  out: Float32Array,
  n: number,
): number {
  const rows = history.rowCount;
  let sum = 0;
  for (let y = 0; y < n; y++) {
    const age = n - 1 - y;
    const o = y * n;
    if (age >= rows) {
      out.fill(0, o, o + n);
      continue;
    }
    const row = history.row(age);
    if (row.length === n) {
      out.set(row, o);
      for (let x = 0; x < n; x++) sum += row[x];
    } else {
      // Cols/grid mismatch (shouldn't happen in the scene): nearest sample.
      for (let x = 0; x < n; x++) {
        const v = row[Math.min(row.length - 1, Math.floor((x * row.length) / n))];
        out[o + x] = v;
        sum += v;
      }
    }
  }
  return sum / (n * n);
}

/**
 * RGBA pixels (n×n, from a resampled artwork draw) → luminance grid
 * normalized so the brightest cell is 1: multiplying the source field
 * by this convolves the artwork's own 2D spectrum onto every harmonic
 * dot (multiplication in space = convolution in frequency). Only the
 * art's shape matters, not its overall level — hence the peak
 * normalization; an all-black image degrades to a no-op window.
 */
export function luminanceGrid(
  rgba: Uint8ClampedArray,
  out: Float32Array,
): void {
  let max = 0;
  for (let o = 0, i = 0; o < out.length; o++, i += 4) {
    const l = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    out[o] = l;
    if (l > max) max = l;
  }
  if (max < 1e-6) {
    out.fill(1);
    return;
  }
  for (let o = 0; o < out.length; o++) out[o] /= max;
}

/**
 * Rotate a field about the grid center by `angle` (nearest-neighbor
 * back-sampling; pixels that fall outside the source stay 0), so a
 * rotating spectrogram sweeps its modulation spectrum the way the
 * stripe field does. Returns the rotated field's mean, same contract
 * as the rasterizers. angle 0 is a straight copy.
 */
export function rotateField(
  src: Float32Array,
  out: Float32Array,
  n: number,
  angle: number,
): number {
  let sum = 0;
  if (Math.abs(angle % (Math.PI * 2)) < 1e-6) {
    out.set(src);
    for (let i = 0; i < out.length; i++) sum += out[i];
    return sum / out.length;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const center = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    const cy = y - center;
    const o = y * n;
    for (let x = 0; x < n; x++) {
      const cx = x - center;
      // Rotate the pixel back by -angle, nearest-sample the source.
      const sx = Math.round(cx * cos + cy * sin + center);
      const sy = Math.round(-cx * sin + cy * cos + center);
      let v = 0;
      if (sx >= 0 && sx < n && sy >= 0 && sy < n) v = src[sy * n + sx];
      out[o + x] = v;
      sum += v;
    }
  }
  return sum / (n * n);
}

/**
 * Scale a convolution kernel so it sums to 1 (energy-preserving —
 * convolving with it neither brightens nor dims the field overall).
 * An all-zero kernel degrades to a uniform box.
 */
export function normalizeSum(kernel: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < kernel.length; i++) sum += kernel[i];
  if (sum <= 1e-9) {
    kernel.fill(1 / kernel.length);
    return;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
}

/**
 * Embed a k×k kernel into an n×n complex grid centered on the origin
 * with wraparound, the layout FFT convolution expects: conv(F, K) =
 * IFFT(FFT(F) ∘ FFT(this)) lands unshifted.
 */
export function embedKernelCentered(
  kernel: Float32Array,
  k: number,
  re: Float32Array,
  im: Float32Array,
  n: number,
): void {
  re.fill(0);
  im.fill(0);
  const half = k >> 1;
  for (let ky = 0; ky < k; ky++) {
    const y = (ky - half + n) & (n - 1);
    for (let kx = 0; kx < k; kx++) {
      const x = (kx - half + n) & (n - 1);
      re[y * n + x] = kernel[ky * k + kx];
    }
  }
}

/**
 * field[i] *= win[i], in place; returns the new field mean (the
 * rasterizer's mean is stale once the field is reshaped).
 */
export function applyFieldWindow(
  field: Float32Array,
  win: Float32Array,
): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    field[i] *= win[i];
    sum += field[i];
  }
  return sum / field.length;
}

/** Beats per full revolution when the spin locks to a confident tempo. */
const BEATS_PER_REV = 16;

/**
 * Base rotation rate in rad/sec: locked to the tempo grid when the
 * estimate is confident — one revolution per 16 beats, so the dot-field
 * completes a sweep every four bars — else the slider rate. A slider at
 * 0 keeps the field still regardless of tempo (explicit "no spin").
 * Same confidence gate as beatPulse, so the rate lock and the beat
 * kicks engage together.
 */
export function spinTarget(
  tempo: { bpm: number; confidence: number } | null,
  spinDegPerSec: number,
): number {
  if (spinDegPerSec <= 0) return 0;
  if (tempo && tempo.confidence >= 0.5) {
    return (Math.PI * 2 * tempo.bpm) / (60 * BEATS_PER_REV);
  }
  return (spinDegPerSec * Math.PI) / 180;
}

/**
 * Brightness stabilizer for the log-magnitude field: tracks a smoothed
 * running peak (fast attack, slow release — AutoGain's shape) and returns
 * the scale that maps it to 1. The floor clamps gain during silence so an
 * all-zero field stays black instead of amplifying numerical dust.
 */
export class FieldNormalizer {
  private peak = 0;

  next(mag: Float32Array, dt: number): number {
    let p = 0;
    for (let i = 0; i < mag.length; i++) if (mag[i] > p) p = mag[i];
    const tau = p > this.peak ? 0.08 : 1.4;
    const k = 1 - Math.exp(-dt / tau);
    this.peak += (p - this.peak) * k;
    return 1 / Math.max(this.peak, 0.35);
  }
}

/**
 * 256-entry RGBA ramp for the spectrum image: dim accent → full accent →
 * white, with alpha rising from 0 so quiet bins stay transparent over the
 * stage's blurred-art backdrop. Rebuild only when the accent changes.
 */
export function buildColorLut(
  accentRgb: [number, number, number],
): Uint8ClampedArray {
  const [ar, ag, ab] = accentRgb;
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const lift = 0.25 + 0.75 * Math.min(1, t / 0.7); // dim → full accent
    const hot = Math.max(0, (t - 0.7) / 0.3); // accent → white
    const o = i * 4;
    lut[o] = ar * lift * (1 - hot) + 255 * hot;
    lut[o + 1] = ag * lift * (1 - hot) + 255 * hot;
    lut[o + 2] = ab * lift * (1 - hot) + 255 * hot;
    lut[o + 3] = 255 * Math.min(1, t * 1.5);
  }
  return lut;
}
