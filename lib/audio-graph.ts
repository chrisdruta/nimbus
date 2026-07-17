import "client-only";

/** Limiter safety net for boosted quiet tracks; callers park it at 0 dB
 * when leveling is off so the disabled path stays untouched. */
export const LIMITER_THRESHOLD_DB = -1.5;

export interface AudioGraph {
  ctx: AudioContext;
  analyser: AnalyserNode;
  /** Leveler make-up gain (unity until a loudness estimate exists). */
  gain: GainNode;
  limiter: DynamicsCompressorNode;
}

/**
 * Build the app's audio graph over a media element:
 * source → analyser → leveler gain → limiter → destination.
 *
 * A media element accepts exactly one MediaElementSourceNode, ever — call
 * this once per element and reuse the nodes for its lifetime. The
 * analyser taps pre-gain so the viz keeps the source signal and leveler
 * measurements stay source-referenced (cacheable). Shared by the player
 * and the cast receiver page.
 */
export function buildAudioGraph(el: HTMLAudioElement): AudioGraph {
  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(el);
  const analyser = ctx.createAnalyser();
  // 8192 gives ~5.4 Hz/bin — enough to separate adjacent semitones down
  // to ~G2 for the piano scene (the scope only reads the window's first
  // 1536 samples, so its trace is unaffected). The longer FFT window
  // smears time, so the analyser's own smoothing drops to compensate;
  // down-smoothing lives in the cava-style gravity (lib/viz/dsp.ts).
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0.35;
  const gain = ctx.createGain();
  // Brick-wall-ish safety net so boosted quiet tracks can't clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.threshold.value = LIMITER_THRESHOLD_DB;
  source.connect(analyser);
  analyser.connect(gain);
  gain.connect(limiter);
  limiter.connect(ctx.destination);
  return { ctx, analyser, gain, limiter };
}
