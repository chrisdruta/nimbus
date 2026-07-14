/**
 * Piano keyboard math for the piano scene: key ranges, the semitone-aligned
 * analysis band, and normalized key geometry. Pure and deterministic — the
 * scene only paints what this describes.
 */

/** Equal-tempered frequency for a MIDI note number (A4 = 69 = 440 Hz). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Supported key counts, each anchored like real instruments: 49 (C3–C7),
 * 61 (C2–C7), 72 (F1–E7), 88 (A0–C8).
 */
export const PIANO_KEY_COUNTS = [49, 61, 72, 88] as const;

const MIDI_LOW: Record<number, number> = { 49: 48, 61: 36, 72: 29, 88: 21 };

/** C D E F G A B — pitch classes rendered as white keys. */
const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);

export function isBlackKey(midi: number): boolean {
  return !WHITE_PCS.has(((midi % 12) + 12) % 12);
}

/**
 * Analysis band that makes log-spaced bars coincide with semitones: bar i
 * of `keys` bars over [freqLow, freqHigh] spans exactly the quarter-tone
 * neighborhood of note midiLow + i (band ratio is 2^(keys/12)).
 */
export function pianoBand(keys: number): { freqLow: number; freqHigh: number } {
  const midiLow = MIDI_LOW[keys] ?? MIDI_LOW[72];
  const pad = Math.pow(2, 1 / 24);
  return {
    freqLow: midiToFreq(midiLow) / pad,
    freqHigh: midiToFreq(midiLow + keys - 1) * pad,
  };
}

/**
 * Spectral contrast for note-like lighting: each band minus `strength` ×
 * its neighborhood mean (±radius, self included), floored at zero and
 * rescaled so a lone peak keeps its level. Tonal peaks stand nearly
 * untouched; broadband walls (a full mix's noise floor) collapse toward
 * dark instead of lighting the whole keyboard. Writes into `out`.
 */
export function noteContrast(
  bars: Float32Array,
  out: Float32Array,
  radius = 4,
  strength = 0.8,
): Float32Array {
  const n = Math.min(bars.length, out.length);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += bars[j];
    const mean = sum / (hi - lo + 1);
    // A lone spike's own energy inflates its neighborhood mean by
    // 1/(window) — the denominator restores it to full scale.
    const selfShare = strength / (hi - lo + 1);
    out[i] = Math.max(0, bars[i] - strength * mean) / (1 - selfShare);
  }
  return out;
}

export interface PianoKey {
  midi: number;
  black: boolean;
  /** Left edge / width in white-key-width units (whites sit on integers). */
  x: number;
  w: number;
  /** "c4"-style marker, present on C keys only. */
  label?: string;
}

export interface PianoLayout {
  keys: PianoKey[];
  /** Total width in white-key-width units (= number of white keys). */
  whiteUnits: number;
}

const BLACK_W = 0.62;

/**
 * Geometry for a keyboard of `keys` semitones in normalized units: white
 * keys are 1 unit wide at integer positions; black keys straddle the
 * boundary after their preceding white. Scale by (canvasWidth / whiteUnits)
 * to paint.
 */
export function pianoLayout(keys: number): PianoLayout {
  const midiLow = MIDI_LOW[keys] ?? MIDI_LOW[72];
  const out: PianoKey[] = [];
  let white = 0;
  for (let i = 0; i < keys; i++) {
    const midi = midiLow + i;
    if (isBlackKey(midi)) {
      out.push({ midi, black: true, x: white - BLACK_W / 2, w: BLACK_W });
    } else {
      const key: PianoKey = { midi, black: false, x: white, w: 1 };
      if (((midi % 12) + 12) % 12 === 0) {
        key.label = `c${Math.floor(midi / 12) - 1}`;
      }
      out.push(key);
      white++;
    }
  }
  return { keys: out, whiteUnits: white };
}
