/**
 * Whole-track "shape" derived from the provider's amplitude waveform:
 * a normalized envelope, quiet/loud sections, and drop candidates that
 * scenes can query by playback position for lookahead. Pure math — the
 * fetching lives in the waveform API route and StageView.
 */

export interface TrackSection {
  startFrac: number;
  endFrac: number;
  kind: "quiet" | "loud";
}

export interface TrackDrop {
  /** Position of the rise, as a fraction of the track. */
  atFrac: number;
  /** How hard the rise hits, 0..1. */
  strength: number;
}

export interface TrackShape {
  /** Envelope resampled to a fixed grid, normalized 0..1. */
  envelope: number[];
  sections: TrackSection[];
  drops: TrackDrop[];
}

const POINTS = 512;
const LOUD_ENTER = 0.55; // hysteresis: enter loud above this...
const LOUD_EXIT = 0.45; // ...leave it below this
const MIN_RUN_FRAC = 0.02; // ignore blips shorter than 2% of the track
const DROP_QUIET_FRAC = 0.015; // quiet run needed before a drop (~4s of a 4.5min track)
const DROP_RISE_LEVEL = 0.72; // the rise must reach this...
const DROP_RISE_SPAN = 0.006; // ...within this fraction (~1.5s)

/** p-th percentile (0..1) of the values, linear interpolation. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function normalizeWaveform(
  samples: number[],
  points = POINTS,
): TrackShape | null {
  if (samples.length < 8) return null;

  // Resample to the fixed grid by mean pooling (envelope, not peaks).
  const envelope = new Array<number>(points);
  for (let i = 0; i < points; i++) {
    const start = Math.floor((i * samples.length) / points);
    const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / points));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    envelope[i] = sum / (end - start);
  }

  // Normalize by the 98th percentile — robust to a lone spike.
  const scale = percentile(envelope, 0.98);
  if (!(scale > 0)) return null;
  for (let i = 0; i < points; i++) {
    envelope[i] = Math.min(1, Math.max(0, envelope[i] / scale));
  }

  // Light smoothing before sectioning so single-point flicker can't
  // defeat the hysteresis.
  const smooth = envelope.map((v, i) => {
    const a = envelope[Math.max(0, i - 2)];
    const b = envelope[Math.max(0, i - 1)];
    const c = envelope[Math.min(points - 1, i + 1)];
    const d = envelope[Math.min(points - 1, i + 2)];
    return (a + b + v + c + d) / 5;
  });

  // Quiet/loud runs with hysteresis, then merge runs shorter than the
  // minimum into their predecessor.
  const minRun = Math.max(1, Math.round(MIN_RUN_FRAC * points));
  const sections: TrackSection[] = [];
  let kind: TrackSection["kind"] = smooth[0] >= LOUD_ENTER ? "loud" : "quiet";
  let runStart = 0;
  for (let i = 1; i <= points; i++) {
    const next =
      i === points
        ? null
        : kind === "loud"
          ? smooth[i] < LOUD_EXIT
            ? ("quiet" as const)
            : ("loud" as const)
          : smooth[i] >= LOUD_ENTER
            ? ("loud" as const)
            : ("quiet" as const);
    if (next !== kind) {
      const prev = sections[sections.length - 1];
      if (i - runStart < minRun && prev) {
        prev.endFrac = i / points; // too short: absorb into the last section
      } else {
        sections.push({ startFrac: runStart / points, endFrac: i / points, kind });
      }
      if (next === null) break;
      kind = next;
      runStart = i;
    }
  }
  // Coalesce neighbors that ended up the same kind after absorption.
  for (let i = sections.length - 1; i > 0; i--) {
    if (sections[i].kind === sections[i - 1].kind) {
      sections[i - 1].endFrac = sections[i].endFrac;
      sections.splice(i, 1);
    }
  }

  // Drops: a sustained quiet stretch followed by a sharp rise.
  const drops: TrackDrop[] = [];
  const quietRun = Math.max(2, Math.round(DROP_QUIET_FRAC * points));
  const riseSpan = Math.max(1, Math.round(DROP_RISE_SPAN * points));
  let quietLen = 0;
  for (let i = 0; i < points; i++) {
    if (smooth[i] < LOUD_EXIT) {
      quietLen++;
      continue;
    }
    if (quietLen >= quietRun) {
      let peak = 0;
      for (let j = i; j < Math.min(points, i + riseSpan); j++) {
        peak = Math.max(peak, smooth[j]);
      }
      if (peak >= DROP_RISE_LEVEL) {
        drops.push({
          atFrac: i / points,
          strength: Math.min(1, (peak - LOUD_EXIT) / (1 - LOUD_EXIT)),
        });
      }
    }
    quietLen = 0;
  }

  return { envelope, sections, drops };
}

/** Envelope level at a playback position (fraction 0..1). */
export function envelopeAt(shape: TrackShape, frac: number): number {
  const n = shape.envelope.length;
  const idx = Math.min(n - 1, Math.max(0, Math.floor(frac * n)));
  return shape.envelope[idx];
}

/**
 * 0..1 ramp that rises through the `horizonSec` seconds before the next
 * drop — scenes use it to lean in before the hit. 0 when no drop is near
 * or the shape is absent.
 */
export function dropAnticipation(
  shape: TrackShape | null,
  positionSec: number,
  durationSec: number,
  horizonSec = 2,
): number {
  if (!shape || !(durationSec > 0)) return 0;
  const drop = nextDrop(shape, positionSec / durationSec);
  if (!drop) return 0;
  const inSec = drop.inFrac * durationSec;
  if (inSec > horizonSec) return 0;
  return (1 - inSec / horizonSec) * drop.strength;
}

/** The next drop at or after the position, or null. */
export function nextDrop(
  shape: TrackShape,
  frac: number,
): { inFrac: number; strength: number } | null {
  for (const d of shape.drops) {
    if (d.atFrac >= frac) return { inFrac: d.atFrac - frac, strength: d.strength };
  }
  return null;
}
