/**
 * Spectrum smoothing pipeline adapted from cava
 * (github.com/karlstav/cava), MIT © Karl Stavestrand — the "monstercat"
 * neighbor filter, gravity falloff, and sensitivity autoscaling are ports
 * of cava's core look. Input here is AnalyserNode byte-frequency data
 * (already dB-mapped), not raw FFT magnitudes, so constants are re-tuned.
 */

/**
 * Scalar knobs that can change live without rebuilding the processor
 * (bin ranges and buffers stay put).
 */
export interface SpectrumTuning {
  /** Neighbor-lift decay base; <=1 disables. */
  monstercat?: number;
  /** Fall acceleration in value/s². */
  gravity?: number;
  /** Post-normalization cut for analyser noise. */
  noiseFloor?: number;
  /** Spectral tilt in dB/octave referenced to 1 kHz; >0 lifts highs. */
  tiltDbPerOct?: number;
  /** Where the soft-knee compressor starts bending (0..1). */
  kneeStart?: number;
}

export interface SpectrumConfig extends SpectrumTuning {
  barCount: number;
  /** AudioContext.sampleRate. */
  sampleRate: number;
  /** AnalyserNode.fftSize (bin count = fftSize / 2). */
  fftSize: number;
  /** Band edges; audible content on SoundCloud MP3s lives well inside. */
  freqLow?: number;
  freqHigh?: number;
}

const DEFAULTS = {
  freqLow: 50,
  freqHigh: 12000,
  monstercat: 1.5,
  gravity: 9,
  noiseFloor: 0.04,
  tiltDbPerOct: 3,
  kneeStart: 0.8,
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
 * Soft-knee limiter: identity below the knee, tanh compression above —
 * asymptotic to 1, never a hard flat top.
 */
export function softKnee(v: number, knee: number): number {
  if (v <= knee) return v;
  const span = 1 - knee;
  // min() guards float rounding: knee + span·tanh can land a hair over 1.
  return Math.min(1, knee + span * Math.tanh((v - knee) / span));
}

/**
 * Stateful per-frame processor: aggregate → tilt → sensitivity autoscale
 * with soft-knee → noise floor → monstercat → gravity. Returns an internal
 * buffer valid until the next process() call.
 */
export class SpectrumProcessor {
  private readonly ranges: Array<[number, number]>;
  private readonly hzPerBin: number;
  private monstercat: number;
  private gravity: number;
  private noiseFloor: number;
  private tiltDbPerOct: number;
  private kneeStart: number;

  private readonly tiltGain: Float32Array;
  private readonly live: Float32Array;
  private readonly display: Float32Array;
  private readonly fallSec: Float32Array;
  private readonly peakAtFall: Float32Array;
  private sens = 1;

  constructor(cfg: SpectrumConfig) {
    this.ranges = computeBinRanges(cfg);
    this.hzPerBin = cfg.sampleRate / cfg.fftSize;
    this.monstercat = cfg.monstercat ?? DEFAULTS.monstercat;
    this.gravity = cfg.gravity ?? DEFAULTS.gravity;
    this.noiseFloor = cfg.noiseFloor ?? DEFAULTS.noiseFloor;
    this.tiltDbPerOct = cfg.tiltDbPerOct ?? DEFAULTS.tiltDbPerOct;
    this.kneeStart = cfg.kneeStart ?? DEFAULTS.kneeStart;
    this.tiltGain = new Float32Array(cfg.barCount);
    this.live = new Float32Array(cfg.barCount);
    this.display = new Float32Array(cfg.barCount);
    this.fallSec = new Float32Array(cfg.barCount);
    this.peakAtFall = new Float32Array(cfg.barCount);
    this.retilt();
  }

  /** Autoscale gain — read/written to survive structural rebuilds. */
  getSensitivity(): number {
    return this.sens;
  }

  setSensitivity(v: number): void {
    this.sens = v;
  }

  /** Update live-tunable scalars without losing gravity/sens state. */
  setTuning(t: SpectrumTuning): void {
    if (t.monstercat !== undefined) this.monstercat = t.monstercat;
    if (t.gravity !== undefined) this.gravity = t.gravity;
    if (t.noiseFloor !== undefined) this.noiseFloor = t.noiseFloor;
    if (t.kneeStart !== undefined) this.kneeStart = t.kneeStart;
    if (t.tiltDbPerOct !== undefined && t.tiltDbPerOct !== this.tiltDbPerOct) {
      this.tiltDbPerOct = t.tiltDbPerOct;
      this.retilt();
    }
  }

  /** Per-bar gain from the range's geometric-center frequency vs 1 kHz. */
  private retilt(): void {
    for (let i = 0; i < this.ranges.length; i++) {
      const [start, end] = this.ranges[i];
      const fCenter = Math.sqrt(start * end) * this.hzPerBin;
      const octaves = Math.log2(fCenter / 1000);
      this.tiltGain[i] = Math.pow(10, (this.tiltDbPerOct * octaves) / 20);
    }
  }

  process(freqData: Uint8Array, dtSec: number): Float32Array {
    const n = this.live.length;

    // 1. Aggregate each bar's bin range, then tilt (bass sits below 1 kHz,
    //    so a positive tilt attenuates it relative to mids/highs).
    for (let i = 0; i < n; i++) {
      const [start, end] = this.ranges[i];
      let sum = 0;
      for (let b = start; b < end; b++) sum += freqData[b] ?? 0;
      this.live[i] = (sum / (end - start) / 255) * this.tiltGain[i];
    }

    // 2. Sensitivity autoscale (cava) with a soft knee instead of a hard
    //    clip: pull-back only engages when several bars run hot, so one
    //    bass bar can't pump the whole spectrum's gain.
    let hot = 0;
    const knee = this.kneeStart;
    for (let i = 0; i < n; i++) {
      const v = this.live[i] * this.sens;
      if (v > knee) hot++;
      this.live[i] = softKnee(v, knee);
    }
    this.sens =
      hot >= 2
        ? Math.max(0.5, this.sens * 0.98)
        : Math.min(6, this.sens * (1 + 0.15 * dtSec));

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
