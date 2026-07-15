/**
 * Minimal radix-2 FFT toolkit for 2D image spectra (the fourier scene).
 * Everything works on preallocated buffers — the per-frame path allocates
 * nothing. Forward transform only, unnormalized (Σ over N samples).
 */

export interface FftTables {
  cosTab: Float32Array;
  sinTab: Float32Array;
  /** Bit-reversal permutation, length n. */
  rev: Uint32Array;
}

export function makeFftTables(n: number): FftTables {
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`fft size must be a power of two, got ${n}`);
  }
  const cosTab = new Float32Array(n / 2);
  const sinTab = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cosTab[k] = Math.cos((2 * Math.PI * k) / n);
    sinTab[k] = Math.sin((2 * Math.PI * k) / n);
  }
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  return { cosTab, sinTab, rev };
}

/**
 * In-place forward DIT FFT over a strided view of a split complex buffer.
 * The stride lets the 2D transform run column passes directly on the
 * row-major grid — no transpose buffer.
 */
export function fft1d(
  re: Float32Array,
  im: Float32Array,
  offset: number,
  stride: number,
  n: number,
  t: FftTables,
): void {
  const { cosTab, sinTab, rev } = t;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = offset + i * stride;
      const b = offset + j * stride;
      let tmp = re[a];
      re[a] = re[b];
      re[b] = tmp;
      tmp = im[a];
      im[a] = im[b];
      im[b] = tmp;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, tw = 0; k < half; k++, tw += step) {
        // Forward twiddle e^(-2πi·tw/n).
        const wr = cosTab[tw];
        const wi = -sinTab[tw];
        const a = offset + (start + k) * stride;
        const b = offset + (start + k + half) * stride;
        const br = re[b] * wr - im[b] * wi;
        const bi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - br;
        im[b] = im[a] - bi;
        re[a] += br;
        im[a] += bi;
      }
    }
  }
}

/** Separable n×n 2D FFT with tables built once at construction. */
export class Fft2d {
  readonly n: number;
  private readonly tables: FftTables;

  constructor(n: number) {
    this.n = n;
    this.tables = makeFftTables(n);
  }

  /** In-place forward transform of a row-major n×n complex grid. */
  forward(re: Float32Array, im: Float32Array): void {
    const n = this.n;
    for (let y = 0; y < n; y++) fft1d(re, im, y * n, 1, n, this.tables);
    for (let x = 0; x < n; x++) fft1d(re, im, x, n, n, this.tables);
  }

  /**
   * In-place inverse transform, 1/n² scale included — the conjugate
   * trick reuses the forward butterflies.
   */
  inverse(re: Float32Array, im: Float32Array): void {
    const total = this.n * this.n;
    for (let i = 0; i < total; i++) im[i] = -im[i];
    this.forward(re, im);
    const s = 1 / total;
    for (let i = 0; i < total; i++) {
      re[i] *= s;
      im[i] *= -s;
    }
  }
}

/** a := a·b elementwise (complex), in place. */
export function complexMultiply(
  are: Float32Array,
  aim: Float32Array,
  bre: Float32Array,
  bim: Float32Array,
): void {
  for (let i = 0; i < are.length; i++) {
    const r = are[i] * bre[i] - aim[i] * bim[i];
    aim[i] = are[i] * bim[i] + aim[i] * bre[i];
    are[i] = r;
  }
}

/** out[i] = log1p(gain · |re[i] + i·im[i]|). No allocation. */
export function logMagnitude(
  re: Float32Array,
  im: Float32Array,
  out: Float32Array,
  gain: number,
): void {
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.log1p(gain * Math.sqrt(re[i] * re[i] + im[i] * im[i]));
  }
}

/** Periodic Hann window, length n: 0 at sample 0, 1 at n/2. */
export function hannWindow(n: number): Float32Array {
  const win = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  }
  return win;
}

/** field[y·n + x] *= win[x] · win[y], in place (separable 2D window). */
export function applyWindow2d(
  field: Float32Array,
  win: Float32Array,
  n: number,
): void {
  for (let y = 0; y < n; y++) {
    const wy = win[y];
    const o = y * n;
    for (let x = 0; x < n; x++) field[o + x] *= wy * win[x];
  }
}

/**
 * fftshift as pure indexing: the row-major spectrum index that display
 * pixel (x, y) should read so DC lands at the grid center. Saves a
 * quadrant-swap pass — the colorize loop reads through this instead.
 */
export function shiftedIndex(x: number, y: number, n: number): number {
  return ((y + n / 2) & (n - 1)) * n + ((x + n / 2) & (n - 1));
}
