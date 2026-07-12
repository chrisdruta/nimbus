/**
 * Sound-energy onset (beat) detection over the bass band. Compares the
 * instantaneous level against a trailing window's mean, with a variance
 * term that raises the threshold on sustained bass (drones, pads) so only
 * punchy transients fire.
 */

interface Sample {
  t: number;
  e: number;
}

export interface OnsetOptions {
  /** Trailing window length. */
  windowSec?: number;
  /** Minimum spacing between beats. */
  refractorySec?: number;
  /** Base multiple of the window mean required to fire. */
  sensitivity?: number;
}

export class OnsetDetector {
  private readonly windowSec: number;
  private readonly refractorySec: number;
  private readonly sensitivity: number;
  private readonly samples: Sample[] = [];
  private lastBeat = -Infinity;

  constructor(opts?: OnsetOptions) {
    this.windowSec = opts?.windowSec ?? 1.0;
    this.refractorySec = opts?.refractorySec ?? 0.18;
    this.sensitivity = opts?.sensitivity ?? 1.35;
  }

  /** bassEnergy: mean of raw freq bins covering ~40–130 Hz, 0..1. */
  push(bassEnergy: number, nowSec: number): { beat: boolean; intensity: number } {
    const window = this.samples;
    while (window.length > 0 && nowSec - window[0].t > this.windowSec) {
      window.shift();
    }

    let beat = false;
    let intensity = 0;
    if (window.length >= 8) {
      let sum = 0;
      for (const s of window) sum += s.e;
      const mean = sum / window.length;
      let varSum = 0;
      for (const s of window) varSum += (s.e - mean) * (s.e - mean);
      const sigma = Math.sqrt(varSum / window.length);

      // Variance-adaptive threshold, capped so noisy material still fires.
      const threshold = Math.min(
        mean * (this.sensitivity + 0.5 * (mean > 0 ? sigma / mean : 0)),
        mean * 2.2,
      );

      if (
        bassEnergy > threshold &&
        bassEnergy > 0.02 &&
        nowSec - this.lastBeat > this.refractorySec
      ) {
        beat = true;
        intensity = Math.min(1.5, Math.max(0, (bassEnergy - threshold) / threshold));
        this.lastBeat = nowSec;
      }
    }

    window.push({ t: nowSec, e: bassEnergy });
    return { beat, intensity };
  }
}
