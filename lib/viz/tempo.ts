/**
 * Realtime tempo estimation from the onset stream: inter-onset intervals
 * folded into one BPM octave feed a decaying histogram; the peak (with
 * parabolic interpolation) is the tempo, and a phase-locked beat grid lets
 * scenes pulse on *predicted* beats instead of raw onsets. Confidence
 * gates everything — sparse or irregular material reads as "no tempo",
 * which consumers must treat as the common case.
 */

const MIN_BPM = 70;
const MAX_BPM = 180;
const BINS = MAX_BPM - MIN_BPM + 1; // 1 BPM resolution
const WINDOW_SEC = 8; // onsets considered for pairing
const PAIR_SEC = 2; // max IOI that still counts as tempo evidence
const HIST_TAU_SEC = 4; // evidence half-life ~2.8 s
const PHASE_PULL = 0.3; // how hard an on-grid onset drags the grid
const PHASE_TOLERANCE = 0.15; // of a period, for "on-grid"
const MIN_ONSETS = 6;
const MIN_CONFIDENCE = 0.3;

export interface TempoEstimate {
  bpm: number;
  /** 0..1 — peak sharpness scaled by evidence quantity. */
  confidence: number;
  /** Fraction through the current predicted beat, 0..1. */
  beatPhase: number;
}

/** Fold a raw IOI-derived BPM into the [MIN_BPM, MAX_BPM] octave. */
export function foldBpm(bpm: number): number | null {
  if (!(bpm > 0) || !Number.isFinite(bpm)) return null;
  let b = bpm;
  while (b < MIN_BPM) b *= 2;
  while (b > MAX_BPM) b /= 2;
  return b >= MIN_BPM ? b : null;
}

export class TempoEstimator {
  private readonly onsets: Array<{ t: number; w: number }> = [];
  private readonly hist = new Float64Array(BINS);
  private lastT: number | null = null;
  private bpm = 0;
  private confidence = 0;
  private anchor: number | null = null; // a time some beat fell on

  /** Feed one detected onset (seconds, intensity 0..~1.5). */
  push(tSec: number, intensity: number): void {
    // Evidence decays with time so tempo changes win within a few seconds.
    if (this.lastT !== null && tSec > this.lastT) {
      const decay = Math.exp(-(tSec - this.lastT) / HIST_TAU_SEC);
      for (let i = 0; i < BINS; i++) this.hist[i] *= decay;
    }
    this.lastT = tSec;

    while (this.onsets.length && tSec - this.onsets[0].t > WINDOW_SEC) {
      this.onsets.shift();
    }

    const w = 0.5 + Math.min(1.5, Math.max(0, intensity));
    for (const prev of this.onsets) {
      const ioi = tSec - prev.t;
      if (ioi <= 0.05 || ioi > PAIR_SEC) continue;
      const folded = foldBpm(60 / ioi);
      if (folded === null) continue;
      const bin = Math.round(folded) - MIN_BPM;
      if (bin >= 0 && bin < BINS) this.hist[bin] += w * prev.w;
    }
    this.onsets.push({ t: tSec, w });

    this.recompute();

    // Phase lock: an onset near a predicted beat drags the grid toward it.
    if (this.bpm > 0) {
      const period = 60 / this.bpm;
      if (this.anchor === null) {
        this.anchor = tSec;
      } else {
        const e = (((tSec - this.anchor) % period) + period) % period;
        const d = e < period / 2 ? e : e - period;
        if (Math.abs(d) < PHASE_TOLERANCE * period) {
          this.anchor += PHASE_PULL * d;
        }
      }
    }
  }

  private recompute(): void {
    let total = 0;
    let peakIdx = 0;
    for (let i = 0; i < BINS; i++) {
      total += this.hist[i];
      if (this.hist[i] > this.hist[peakIdx]) peakIdx = i;
    }
    if (total <= 0 || this.hist[peakIdx] <= 0) {
      this.bpm = 0;
      this.confidence = 0;
      return;
    }

    // Parabolic interpolation across the peak's neighbors.
    const y0 = peakIdx > 0 ? this.hist[peakIdx - 1] : 0;
    const y1 = this.hist[peakIdx];
    const y2 = peakIdx < BINS - 1 ? this.hist[peakIdx + 1] : 0;
    const denom = y0 - 2 * y1 + y2;
    const delta = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
    this.bpm = MIN_BPM + peakIdx + delta;

    let peakMass = 0;
    for (let i = Math.max(0, peakIdx - 2); i <= Math.min(BINS - 1, peakIdx + 2); i++) {
      peakMass += this.hist[i];
    }
    const sharpness = peakMass / total;
    const evidence = Math.min(1, this.onsets.length / MIN_ONSETS);
    this.confidence = sharpness * evidence;
  }

  /** Current estimate, or null when there's no confident tempo. */
  estimate(nowSec: number): TempoEstimate | null {
    if (this.bpm <= 0 || this.confidence < MIN_CONFIDENCE || this.anchor === null) {
      return null;
    }
    // A couple of onsets can align by accident — demand real evidence.
    if (this.onsets.length < 4) return null;
    // Stale grid: no onset evidence for a while — stop pretending.
    if (this.lastT === null || nowSec - this.lastT > WINDOW_SEC) return null;
    const period = 60 / this.bpm;
    const phase =
      ((((nowSec - this.anchor) / period) % 1) + 1) % 1;
    return { bpm: this.bpm, confidence: this.confidence, beatPhase: phase };
  }
}

/**
 * Scene-side beat trigger: on a confident grid, fire when the predicted
 * phase wraps (steady pulse even through missed onsets); otherwise fall
 * back to raw onsets. Callers thread `prevPhase` between frames.
 */
export function beatPulse(
  f: { beat: boolean; beatIntensity: number; tempo: TempoEstimate | null },
  prevPhase: number | null,
): { fire: boolean; intensity: number; phase: number | null } {
  const t = f.tempo;
  if (t && t.confidence >= 0.5) {
    const fire = prevPhase !== null && t.beatPhase < prevPhase;
    return {
      fire,
      // A raw onset landing this frame keeps its measured punch; a purely
      // predicted beat pulses at a steady moderate strength.
      intensity: fire ? (f.beat ? Math.max(0.7, f.beatIntensity) : 0.7) : 0,
      phase: t.beatPhase,
    };
  }
  return { fire: f.beat, intensity: f.beatIntensity, phase: null };
}
