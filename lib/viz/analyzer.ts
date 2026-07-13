import { SpectrumProcessor, type SpectrumTuning } from "./dsp";
import { OnsetDetector } from "./onset";
import { TempoEstimator } from "./tempo";
import type { AudioFrame } from "./scene";

/**
 * Thin AnalyserNode adapter: one read per rAF tick, reused buffers, and
 * the shared DSP applied. Each consumer owns its own instance so gravity
 * and sensitivity state stay independent (mini bars vs fullscreen).
 */
export class FrameAnalyzer {
  private barCount: number;
  private readonly wantWaveform: boolean;
  private tuning: SpectrumTuning = {};
  private freqLow: number | undefined;
  private freqHigh: number | undefined;

  private processor: SpectrumProcessor | null = null;
  private processorKey = "";
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private waveform: Float32Array<ArrayBuffer> = new Float32Array(0);
  private readonly onset = new OnsetDetector();
  private readonly tempo = new TempoEstimator();
  private bassSmooth = 0;
  private energySmooth = 0;
  private lastMs: number | null = null;
  private readonly frame: AudioFrame;

  constructor(cfg: {
    barCount: number;
    wantWaveform?: boolean;
    tuning?: SpectrumTuning;
  }) {
    this.barCount = cfg.barCount;
    this.wantWaveform = cfg.wantWaveform ?? false;
    this.tuning = cfg.tuning ?? {};
    this.frame = {
      bars: new Float32Array(cfg.barCount),
      waveform: this.waveform,
      bass: 0,
      energy: 0,
      beat: false,
      beatIntensity: 0,
      tempo: null,
      dt: 1 / 60,
    };
  }

  /**
   * Update DSP tuning live; kept so a processor rebuilt on an
   * fftSize/sampleRate change re-applies it.
   */
  setDsp(tuning: SpectrumTuning): void {
    this.tuning = { ...this.tuning, ...tuning };
    this.processor?.setTuning(this.tuning);
  }

  /**
   * Structural changes (bar count, band edges) rebuild the processor on
   * the next sample; autoscale gain carries over so the display doesn't
   * visibly re-ramp. Gravity state resets — fine for an explicit user
   * settings change.
   */
  setStructure(s: {
    barCount?: number;
    freqLow?: number;
    freqHigh?: number;
  }): void {
    if (s.barCount !== undefined) this.barCount = s.barCount;
    if (s.freqLow !== undefined) this.freqLow = s.freqLow;
    if (s.freqHigh !== undefined) this.freqHigh = s.freqHigh;
  }

  /** Sample the analyser; the returned object is reused between calls. */
  sample(analyser: AnalyserNode | null, nowMs: number): AudioFrame {
    const dt = Math.min(
      this.lastMs === null ? 1 / 60 : (nowMs - this.lastMs) / 1000,
      0.05,
    );
    this.lastMs = nowMs;
    this.frame.dt = dt;

    if (!analyser) {
      this.frame.bars.fill(0);
      this.frame.bass = 0;
      this.frame.energy = 0;
      this.frame.beat = false;
      this.frame.beatIntensity = 0;
      this.frame.tempo = null;
      return this.frame;
    }

    const binCount = analyser.frequencyBinCount;
    if (!this.freqData || this.freqData.length !== binCount) {
      this.freqData = new Uint8Array(binCount);
    }
    const key = `${analyser.fftSize}:${analyser.context.sampleRate}:${this.barCount}:${this.freqLow}:${this.freqHigh}`;
    if (!this.processor || this.processorKey !== key) {
      const prevSens = this.processor?.getSensitivity();
      this.processor = new SpectrumProcessor({
        barCount: this.barCount,
        sampleRate: analyser.context.sampleRate,
        fftSize: analyser.fftSize,
        freqLow: this.freqLow,
        freqHigh: this.freqHigh,
        ...this.tuning,
      });
      if (prevSens !== undefined) this.processor.setSensitivity(prevSens);
      this.processorKey = key;
    }

    analyser.getByteFrequencyData(this.freqData);
    this.frame.bars = this.processor.process(this.freqData, dt);

    // Raw band levels (pre-DSP) for energy/bass/beat.
    const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
    const bassLo = Math.max(1, Math.floor(40 / hzPerBin));
    const bassHi = Math.max(bassLo + 1, Math.ceil(130 / hzPerBin));
    let bassSum = 0;
    for (let i = bassLo; i < bassHi; i++) bassSum += this.freqData[i];
    const bassNow = bassSum / (bassHi - bassLo) / 255;
    let allSum = 0;
    for (let i = 0; i < binCount; i++) allSum += this.freqData[i];
    const energyNow = allSum / binCount / 255;

    // Exponential smoothing, τ ≈ 80 ms.
    const k = 1 - Math.exp(-dt / 0.08);
    this.bassSmooth += (bassNow - this.bassSmooth) * k;
    this.energySmooth += (energyNow - this.energySmooth) * k;
    this.frame.bass = this.bassSmooth;
    this.frame.energy = this.energySmooth;

    // Onset detection runs on the raw (unsmoothed) bass level; onsets
    // feed the tempo grid, which every frame reports predicted phase.
    const nowSec = nowMs / 1000;
    const { beat, intensity } = this.onset.push(bassNow, nowSec);
    this.frame.beat = beat;
    this.frame.beatIntensity = intensity;
    if (beat) this.tempo.push(nowSec, intensity);
    this.frame.tempo = this.tempo.estimate(nowSec);

    if (this.wantWaveform) {
      if (this.waveform.length !== analyser.fftSize) {
        this.waveform = new Float32Array(analyser.fftSize);
      }
      analyser.getFloatTimeDomainData(this.waveform);
      this.frame.waveform = this.waveform;
    }
    return this.frame;
  }
}
