/**
 * Spectrum smoothing pipeline adapted from cava
 * (github.com/karlstav/cava), MIT © Karl Stavestrand — the "monstercat"
 * neighbor filter, gravity falloff, and sensitivity autoscaling are ports
 * of cava's core look. Input here is AnalyserNode byte-frequency data
 * (already dB-mapped), not raw FFT magnitudes, so constants are re-tuned.
 */

export interface SpectrumConfig {
  barCount: number;
  /** AudioContext.sampleRate. */
  sampleRate: number;
  /** AnalyserNode.fftSize (bin count = fftSize / 2). */
  fftSize: number;
  /** Band edges; audible content on SoundCloud MP3s lives well inside. */
  freqLow?: number;
  freqHigh?: number;
  /** Neighbor-lift decay base; <=1 disables. */
  monstercat?: number;
  /** Fall acceleration in value/s². */
  gravity?: number;
  /** Post-normalization cut for analyser noise. */
  noiseFloor?: number;
}

const DEFAULTS = {
  freqLow: 50,
  freqHigh: 12000,
  monstercat: 1.5,
  gravity: 9,
  noiseFloor: 0.04,
};

/**
 * Log-spaced bin ranges: bar i spans frequencies
 * fLow·(fHigh/fLow)^(i/n) .. ^((i+1)/n). Every range is at least one bin
 * wide and starts at or after the previous range's end.
 */
export function computeBinRanges(
  cfg: SpectrumConfig,
): Array<[start: number, end: number]> {
  const { barCount, sampleRate, fftSize } = cfg;
  const fLow = cfg.freqLow ?? DEFAULTS.freqLow;
  const fHigh = cfg.freqHigh ?? DEFAULTS.freqHigh;
  const binCount = fftSize / 2;
  const hzPerBin = sampleRate / fftSize;

  const ranges: Array<[number, number]> = [];
  let prevEnd = Math.max(1, Math.floor(fLow / hzPerBin));
  for (let i = 0; i < barCount; i++) {
    const edge = fLow * Math.pow(fHigh / fLow, (i + 1) / barCount);
    let end = Math.min(binCount, Math.ceil(edge / hzPerBin));
    if (end <= prevEnd) end = Math.min(binCount, prevEnd + 1);
    ranges.push([prevEnd, end]);
    prevEnd = end;
  }
  return ranges;
}

/**
 * cava's "monstercat" filter: each bar lifts its neighbors to at least
 * value / strength^distance. In place; never lowers a bar.
 */
export function monstercatFilter(bars: Float32Array, strength: number): void {
  if (strength <= 1) return;
  const n = bars.length;
  for (let i = 0; i < n; i++) {
    const v = bars[i];
    if (v <= 0) continue;
    for (let j = i - 1, d = 1; j >= 0; j--, d++) {
      const lifted = v / Math.pow(strength, d);
      if (lifted <= bars[j]) break; // further neighbors can only be higher
      bars[j] = lifted;
    }
    for (let j = i + 1, d = 1; j < n; j++, d++) {
      const lifted = v / Math.pow(strength, d);
      if (lifted <= bars[j]) break;
      bars[j] = lifted;
    }
  }
}

/**
 * Stateful per-frame processor: aggregate → sensitivity autoscale →
 * noise floor → monstercat → gravity. Returns an internal buffer valid
 * until the next process() call.
 */
export class SpectrumProcessor {
  private readonly ranges: Array<[number, number]>;
  private readonly monstercat: number;
  private readonly gravity: number;
  private readonly noiseFloor: number;

  private readonly live: Float32Array;
  private readonly display: Float32Array;
  private readonly fallSec: Float32Array;
  private readonly peakAtFall: Float32Array;
  private sens = 1;

  constructor(cfg: SpectrumConfig) {
    this.ranges = computeBinRanges(cfg);
    this.monstercat = cfg.monstercat ?? DEFAULTS.monstercat;
    this.gravity = cfg.gravity ?? DEFAULTS.gravity;
    this.noiseFloor = cfg.noiseFloor ?? DEFAULTS.noiseFloor;
    this.live = new Float32Array(cfg.barCount);
    this.display = new Float32Array(cfg.barCount);
    this.fallSec = new Float32Array(cfg.barCount);
    this.peakAtFall = new Float32Array(cfg.barCount);
  }

  process(freqData: Uint8Array, dtSec: number): Float32Array {
    const n = this.live.length;

    // 1. Aggregate each bar's bin range.
    for (let i = 0; i < n; i++) {
      const [start, end] = this.ranges[i];
      let sum = 0;
      for (let b = start; b < end; b++) sum += freqData[b] ?? 0;
      this.live[i] = sum / (end - start) / 255;
    }

    // 2. Sensitivity autoscale (cava): clip pulls back fast, recovery is
    //    slow, so quiet tracks fill the range without loud ones strobing.
    let clipped = false;
    for (let i = 0; i < n; i++) {
      const v = this.live[i] * this.sens;
      if (v > 1) clipped = true;
      this.live[i] = Math.min(1, v);
    }
    this.sens = clipped
      ? Math.max(0.5, this.sens * 0.98)
      : Math.min(8, this.sens * (1 + 0.4 * dtSec));

    // 3. Noise floor.
    const floor = this.noiseFloor;
    for (let i = 0; i < n; i++) {
      this.live[i] = Math.max(0, (this.live[i] - floor) / (1 - floor));
    }

    // 4. Monstercat neighbor lift.
    monstercatFilter(this.live, this.monstercat);

    // 5. Gravity: instant rise, accelerating fall, never below live.
    for (let i = 0; i < n; i++) {
      const v = this.live[i];
      if (v >= this.display[i]) {
        this.display[i] = v;
        this.fallSec[i] = 0;
        this.peakAtFall[i] = v;
      } else {
        this.fallSec[i] += dtSec;
        const fallen =
          this.peakAtFall[i] - this.gravity * this.fallSec[i] * this.fallSec[i];
        this.display[i] = Math.max(v, fallen);
      }
    }
    return this.display;
  }
}
