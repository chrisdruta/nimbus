/**
 * Pure color math for artwork palette extraction (the DOM/canvas half
 * lives in lib/artwork.ts). Buckets pixels into an HSL histogram and
 * picks the most present vibrant color.
 */

export interface HistogramBucket {
  count: number;
  r: number;
  g: number;
  b: number;
}

export const HUE_BUCKETS = 12;
export const SAT_BUCKETS = 3;
export const LIGHT_BUCKETS = 3;

export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [h: number, s: number, l: number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb(
  h: number,
  s: number,
  l: number,
): [r: number, g: number, b: number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ];
}

export function bucketIndex(h: number, s: number, l: number): number {
  const hi = Math.min(HUE_BUCKETS - 1, Math.floor(h * HUE_BUCKETS));
  const si = Math.min(SAT_BUCKETS - 1, Math.floor(s * SAT_BUCKETS));
  const li = Math.min(LIGHT_BUCKETS - 1, Math.floor(l * LIGHT_BUCKETS));
  return (hi * SAT_BUCKETS + si) * LIGHT_BUCKETS + li;
}

/** Accumulate RGBA pixel data into an HSL-bucketed histogram. */
export function buildHistogram(data: Uint8ClampedArray): HistogramBucket[] {
  const buckets: HistogramBucket[] = Array.from(
    { length: HUE_BUCKETS * SAT_BUCKETS * LIGHT_BUCKETS },
    () => ({ count: 0, r: 0, g: 0, b: 0 }),
  );
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    const bucket = buckets[bucketIndex(h, s, l)];
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
  }
  return buckets;
}

/**
 * Most populous sufficiently-vibrant bucket's mean color, with lightness
 * floored so it reads against a near-black background. When nothing passes
 * the strict vibrancy gate — common for dark artwork — a relaxed pass
 * accepts dark-but-hued buckets and lets the lightness floor lift them,
 * so a moody navy cover still tints navy instead of defaulting. Null only
 * when the artwork carries no usable hue at all (grayscale, washed out).
 */
export function pickVibrant(
  buckets: HistogramBucket[],
): [r: number, g: number, b: number] | null {
  const mostPopulous = (
    passes: (s: number, l: number) => boolean,
  ): HistogramBucket | null => {
    let best: HistogramBucket | null = null;
    for (const bucket of buckets) {
      if (bucket.count === 0) continue;
      const [, s, l] = rgbToHsl(
        bucket.r / bucket.count,
        bucket.g / bucket.count,
        bucket.b / bucket.count,
      );
      if (!passes(s, l)) continue;
      if (!best || bucket.count > best.count) best = bucket;
    }
    return best;
  };

  const best =
    mostPopulous((s, l) => s > 0.3 && l > 0.2 && l < 0.75) ??
    mostPopulous((s, l) => s > 0.2 && l > 0.04 && l < 0.9);
  if (!best) return null;
  const [h, s, l] = rgbToHsl(
    best.r / best.count,
    best.g / best.count,
    best.b / best.count,
  );
  return hslToRgb(h, s, Math.max(l, 0.55));
}
