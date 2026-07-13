/**
 * Fixed-capacity ring buffer of downsampled spectrum slices. Rows commit
 * on a fixed time interval (not per frame) so scroll speed is frame-rate
 * independent; between commits incoming bars are max-pooled into the
 * pending row so fast transients survive slow row rates.
 */
export class SpectrumHistory {
  readonly cols: number;
  readonly capacity: number;

  private readonly intervalSec: number;
  private readonly buffer: Float32Array;
  private readonly pending: Float32Array;
  private accSec = 0;
  private head = 0; // index the NEXT row will be written to
  private count = 0;

  constructor(cfg: { cols: number; rows: number; intervalSec: number }) {
    this.cols = cfg.cols;
    this.capacity = cfg.rows;
    this.intervalSec = cfg.intervalSec;
    this.buffer = new Float32Array(cfg.rows * cfg.cols);
    this.pending = new Float32Array(cfg.cols);
  }

  /** Rows committed so far, up to capacity. */
  get rowCount(): number {
    return this.count;
  }

  /**
   * Feed one frame of bars; returns how many rows were committed (0 most
   * frames, more if dt spanned several intervals — later commits repeat
   * the same pending pool).
   */
  push(bars: Float32Array, dtSec: number): number {
    // Max-pool bars into the pending row (proportional ranges, peak kept).
    const n = bars.length;
    for (let c = 0; c < this.cols; c++) {
      const start = Math.floor((c * n) / this.cols);
      const end = Math.max(start + 1, Math.floor(((c + 1) * n) / this.cols));
      let max = 0;
      for (let i = start; i < end; i++) if (bars[i] > max) max = bars[i];
      if (max > this.pending[c]) this.pending[c] = max;
    }

    this.accSec += dtSec;
    let committed = 0;
    while (this.accSec >= this.intervalSec) {
      this.accSec -= this.intervalSec;
      this.buffer.set(this.pending, this.head * this.cols);
      this.head = (this.head + 1) % this.capacity;
      this.count = Math.min(this.count + 1, this.capacity);
      committed++;
    }
    if (committed > 0) this.pending.fill(0);
    return committed;
  }

  /**
   * Committed row i, where 0 is the newest. Returns a subarray view into
   * the ring — valid until the next push().
   */
  row(i: number): Float32Array {
    const idx =
      (this.head - 1 - i + this.capacity * 2) % this.capacity;
    return this.buffer.subarray(idx * this.cols, (idx + 1) * this.cols);
  }
}
