/** Oscilloscope helpers: trigger stabilization and auto gain. */

/**
 * Find a rising zero-crossing within the first `searchLen` samples so the
 * drawn window starts at a consistent phase (kills horizontal jitter).
 * The lookahead confirms a real rising edge rather than noise around zero.
 * Returns 0 when no trigger is found (silence, DC).
 */
export function findTrigger(w: Float32Array, searchLen: number): number {
  const limit = Math.min(searchLen, w.length - 9);
  for (let i = 0; i < limit; i++) {
    if (w[i] <= 0 && w[i + 1] > 0) {
      let ahead = 0;
      for (let j = 1; j <= 8; j++) ahead += w[i + j];
      if (ahead / 8 > 0.005) return i;
    }
  }
  return 0;
}

/**
 * Smoothly scale the trace so quiet tracks fill ~70% of the height
 * without visibly "breathing": gain drops fast on loud input, recovers
 * slowly on quiet input.
 */
export class AutoGain {
  private gain = 1;

  next(rms: number, dt: number): number {
    const target = Math.min(10, Math.max(1, 0.35 / Math.max(rms, 1e-4)));
    const tau = target < this.gain ? 0.12 : 0.4;
    const k = 1 - Math.exp(-dt / tau);
    this.gain += (target - this.gain) * k;
    return this.gain;
  }
}
