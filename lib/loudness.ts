/**
 * Volume-leveling engine: estimate a track's loudness from short
 * time-domain blocks and derive a make-up gain toward a common target.
 *
 * Pure and deterministic — the player samples its AnalyserNode on a timer,
 * feeds blocks in here, and applies the returned gain to a GainNode.
 * Loudness is measured as gated RMS (dBFS), a pragmatic stand-in for LUFS:
 * near-silent blocks are excluded so intros and gaps don't skew the
 * estimate, and the result is source-referenced (measured pre-gain) so
 * cached values stay valid if the target ever changes.
 */

export const LEVELER = {
  /** Where every track should land (gated-RMS dBFS). */
  targetDb: -14,
  /** Blocks quieter than this are silence, not signal. */
  gateDb: -55,
  /** Never attenuate/boost past these — boosting quiet-but-dynamic
   * material too hard just trades one problem for pumping. */
  minGainDb: -12,
  maxGainDb: 6,
  /** Gated blocks required before the estimate is trusted at all. */
  minBlocks: 3,
  /** Gated blocks required before the estimate is worth caching. */
  cacheBlocks: 40,
} as const;

export interface LevelerState {
  /** Sum of gated block mean-squares (energy domain, so the running
   * average is a true integrated RMS, not an average of dB values). */
  sumSquares: number;
  /** Gated blocks accumulated. */
  blocks: number;
}

export function createLevelerState(): LevelerState {
  return { sumSquares: 0, blocks: 0 };
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Mean square of one time-domain block (energy; RMS² ). */
export function blockMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return sum / samples.length;
}

/** Fold one block into the estimate; silent blocks return `state`
 * unchanged so callers can cheaply detect the gate. */
export function accumulate(
  state: LevelerState,
  meanSquare: number,
  gateDb: number = LEVELER.gateDb,
): LevelerState {
  if (meanSquare <= 0) return state;
  if (10 * Math.log10(meanSquare) < gateDb) return state;
  return { sumSquares: state.sumSquares + meanSquare, blocks: state.blocks + 1 };
}

/** Integrated gated-RMS loudness in dBFS, or null until the estimate has
 * seen enough signal to mean anything. */
export function loudnessDb(
  state: LevelerState,
  minBlocks: number = LEVELER.minBlocks,
): number | null {
  if (state.blocks < minBlocks) return null;
  return 10 * Math.log10(state.sumSquares / state.blocks);
}

/** Make-up gain (dB) that moves `loudness` to the target, clamped. */
export function gainDbFor(
  loudness: number,
  cfg: { targetDb: number; minGainDb: number; maxGainDb: number } = LEVELER,
): number {
  const raw = cfg.targetDb - loudness;
  return Math.min(cfg.maxGainDb, Math.max(cfg.minGainDb, raw));
}

// ------------------------------------------------- per-track loudness cache

/** Persisted shape: recency-ordered [trackId, loudnessDb] pairs (oldest
 * first). A pairs array, not a Record — numeric-string keys lose insertion
 * order in JS objects, which would break the LRU trim. */
export interface LoudnessCachePayload {
  v: 1;
  entries: Array<[number, number]>;
}

export const LOUDNESS_CACHE_CAP = 500;

export function isLoudnessCachePayload(
  v: unknown,
): v is LoudnessCachePayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as { v?: unknown; entries?: unknown };
  return (
    p.v === 1 &&
    Array.isArray(p.entries) &&
    p.entries.every(
      (e) =>
        Array.isArray(e) &&
        e.length === 2 &&
        typeof e[0] === "number" &&
        Number.isFinite(e[0]) &&
        typeof e[1] === "number" &&
        Number.isFinite(e[1]),
    )
  );
}

export function loadLoudnessMap(
  payload: LoudnessCachePayload | null,
): Map<number, number> {
  return new Map(payload?.entries ?? []);
}

export function serializeLoudnessMap(
  map: Map<number, number>,
): LoudnessCachePayload {
  return { v: 1, entries: [...map.entries()] };
}

/** Upsert a track's loudness, refreshing its recency; evicts the least
 * recently written entries past the cap. Returns a new Map. */
export function rememberLoudness(
  map: Map<number, number>,
  trackId: number,
  loudness: number,
  cap: number = LOUDNESS_CACHE_CAP,
): Map<number, number> {
  const next = new Map(map);
  next.delete(trackId); // re-insert at the tail → most recent
  next.set(trackId, loudness);
  while (next.size > cap) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}
