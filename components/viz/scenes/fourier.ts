import type { AudioFrame, Scene, SceneContext, VizTheme } from "@/lib/viz/scene";
import {
  applyWindow2d,
  complexMultiply,
  Fft2d,
  hannWindow,
  logMagnitude,
  shiftedIndex,
} from "@/lib/viz/fft2d";
import {
  applyFieldWindow,
  buildColorLut,
  embedKernelCentered,
  FieldNormalizer,
  luminanceGrid,
  normalizeSum,
  rasterizeRoll,
  rasterizeStripes,
  rotateField,
  spinTarget,
} from "@/lib/viz/fourier";
import { SpectrumHistory } from "@/lib/viz/history";
import { SETTINGS_DEFAULTS, type FourierSettings } from "@/lib/viz/settings";
import { beatPulse } from "@/lib/viz/tempo";

/** Reduced motion: hold a diagonal so the dot-line is never axis-aligned. */
const FIXED_ANGLE = Math.PI / 6;
/** Beat kick at full strength, rad/sec on top of the base spin. */
const KICK_GAIN = 2.4;
const INSET_FRACTION = 0.22;

/**
 * Spatial-frequency meta-visualization: the spectrum is rasterized as a
 * rotating stripe field (or a scrolling spectrogram), run through a 2D
 * image FFT, and the log-magnitude spectrum is what's painted — a
 * sweeping line of harmonic dots (rotation theorem) or a modulation-
 * spectrum lattice. A corner inset shows the source pattern.
 */
export function createFourierScene(): Scene {
  let n = 0;
  let fft: Fft2d | null = null;
  let field = new Float32Array(0);
  let rollField = new Float32Array(0); // unrotated roll scratch
  let re = new Float32Array(0);
  let im = new Float32Array(0);
  let mag = new Float32Array(0);
  let win: Float32Array = new Float32Array(0);
  let img: ImageData | null = null;
  let insetImg: ImageData | null = null;
  let offCtx: CanvasRenderingContext2D | null = null;
  let insetCtx: CanvasRenderingContext2D | null = null;
  let lut: Uint8ClampedArray | null = null;
  let lutKey = "";
  let history: SpectrumHistory | null = null;
  let historyKey = "";
  let angle = 0;
  let kick = 0;
  let spinRate = 0; // smoothed base rotation, rad/sec
  let prevPhase: number | null = null;
  let frameCount = 0;
  let artLum: Float32Array | null = null;
  let artFor: HTMLImageElement | null = null;
  // Bokeh: scratch pair for the convolution FFT plus the precomputed
  // kernel spectrum (FFT of the small art kernel, embedded n×n).
  let convRe = new Float32Array(0);
  let convIm = new Float32Array(0);
  let kernRe = new Float32Array(0);
  let kernIm = new Float32Array(0);
  let kernFor: HTMLImageElement | null = null;
  let normalizer = new FieldNormalizer();

  function ensureGrid(size: number): void {
    if (n === size && fft) return;
    n = size;
    fft = new Fft2d(n);
    field = new Float32Array(n * n);
    rollField = new Float32Array(n * n);
    re = new Float32Array(n * n);
    im = new Float32Array(n * n);
    mag = new Float32Array(n * n);
    win = hannWindow(n);
    img = new ImageData(n, n);
    insetImg = new ImageData(n, n);
    const off = document.createElement("canvas");
    off.width = n;
    off.height = n;
    offCtx = off.getContext("2d");
    const insetOff = document.createElement("canvas");
    insetOff.width = n;
    insetOff.height = n;
    insetCtx = insetOff.getContext("2d");
    history = null; // grid-sized; rebuilt lazily when the roll needs it
    historyKey = "";
    artLum = null; // grid-sized too; re-extracted on demand
    artFor = null;
    convRe = new Float32Array(n * n);
    convIm = new Float32Array(n * n);
    kernRe = new Float32Array(n * n);
    kernIm = new Float32Array(n * n);
    kernFor = null;
    normalizer = new FieldNormalizer();
  }

  // Artwork luminance at grid resolution, cached per artwork identity.
  // One drawImage + getImageData per track change, never per frame.
  function ensureArtLum(art: HTMLImageElement | null): void {
    if (!art) {
      artLum = null;
      artFor = null;
      return;
    }
    if (artFor === art && artLum) return;
    artFor = art;
    const c = document.createElement("canvas");
    c.width = n;
    c.height = n;
    const cg = c.getContext("2d");
    if (!cg) {
      artLum = null;
      return;
    }
    cg.drawImage(art, 0, 0, n, n);
    try {
      const rgba = cg.getImageData(0, 0, n, n).data;
      if (!artLum || artLum.length !== n * n) artLum = new Float32Array(n * n);
      luminanceGrid(rgba, artLum);
    } catch {
      artLum = null; // tainted artwork shouldn't reach the theme, but be safe
    }
  }

  // Bokeh kernel spectrum, cached per artwork identity: the art
  // downsampled small (bigger would smear dots into mush), sum-
  // normalized, embedded origin-centered, transformed once.
  function ensureKernel(art: HTMLImageElement | null): boolean {
    if (!art || !fft) return false;
    if (kernFor === art) return true;
    const k = Math.max(8, n >> 3);
    const c = document.createElement("canvas");
    c.width = k;
    c.height = k;
    const cg = c.getContext("2d");
    if (!cg) return false;
    cg.drawImage(art, 0, 0, k, k);
    try {
      const kernel = new Float32Array(k * k);
      luminanceGrid(cg.getImageData(0, 0, k, k).data, kernel);
      normalizeSum(kernel);
      embedKernelCentered(kernel, k, kernRe, kernIm, n);
      fft.forward(kernRe, kernIm);
      kernFor = art;
      return true;
    } catch {
      return false;
    }
  }

  return {
    id: "fourier",
    init() {
      n = 0;
      fft = null;
      angle = 0;
      kick = 0;
      spinRate = 0;
      prevPhase = null;
      frameCount = 0;
      lut = null;
      lutKey = "";
    },
    resize() {
      // Offscreens are grid-sized, not stage-sized — nothing to rebuild.
    },
    frame(sc: SceneContext, f: AudioFrame, theme: VizTheme) {
      const { g, width, height, dpr } = sc;
      const s = (sc.settings as FourierSettings | undefined) ?? SETTINGS_DEFAULTS.fourier;
      ensureGrid(Math.round(s.grid));
      if (!fft || !offCtx || !insetCtx || !img || !insetImg) return;

      if (!lut || lutKey !== theme.accent) {
        lut = buildColorLut(theme.accentRgb);
        lutKey = theme.accent;
      }

      // Rotation: base spin plus beat kicks, both sources — the stripes
      // rotate analytically, the roll rotates as an image; either way
      // the rotation theorem sweeps the spectrum with it.
      const pulse = beatPulse(f, prevPhase);
      prevPhase = pulse.phase;
      if (theme.reducedMotion) {
        angle = FIXED_ANGLE;
        kick = 0;
      } else {
        if (pulse.fire) kick = Math.min(1, kick + 0.6 * pulse.intensity);
        kick *= Math.exp(-f.dt / 0.25);
        // Base rate locks to a confident tempo (one rev per 16 beats),
        // easing between grid and slider so handoffs never jerk.
        spinRate +=
          (spinTarget(f.tempo, s.spin) - spinRate) *
          (1 - Math.exp(-f.dt / 1.5));
        angle += (spinRate + kick * KICK_GAIN) * f.dt;
        if (angle > Math.PI * 2) angle -= Math.PI * 2;
      }

      if (s.roll) {
        const key = `${n}:${s.historySec}`;
        if (!history || historyKey !== key) {
          history = new SpectrumHistory({
            cols: n,
            rows: n,
            intervalSec: s.historySec / n,
          });
          historyKey = key;
        }
        history.push(f.bars, f.dt);
      }

      // The FFT pipeline halves its rate on the big grid; skipped frames
      // repaint the cached offscreen (rotation state still advances, so
      // motion resumes without a jump).
      frameCount++;
      const stride = n >= 256 ? 2 : 1;
      if (frameCount % stride === 0) {
        let mean: number;
        if (s.roll && history) {
          rasterizeRoll(history, rollField, n);
          mean = rotateField(rollField, field, n, angle);
        } else {
          mean = rasterizeStripes(f.bars, angle, field, n, {
            duty: s.duty,
            mirror: true,
          });
        }
        // Art window: multiply the field by the artwork's luminance —
        // in frequency space that convolves the art's spectrum onto
        // every harmonic dot (and it shows in the inset).
        if (s.art) {
          ensureArtLum(theme.artwork);
          if (artLum) mean = applyFieldWindow(field, artLum);
        }
        for (let i = 0; i < n * n; i++) {
          re[i] = field[i] - mean; // mean-subtract: kills the DC spike
          im[i] = 0;
        }
        if (s.window) applyWindow2d(re, win, n);
        fft.forward(re, im);
        logMagnitude(re, im, mag, s.gain);

        // Bokeh: bloom-style FFT convolution — only the field's
        // highlights are extracted and convolved with the art kernel,
        // then layered back over the crisp base, so bright dots bloom
        // into art-shaped glints instead of the whole field smearing
        // to fog (convolving everything was tried; it's mush).
        if (s.bokeh && ensureKernel(theme.artwork)) {
          let peak = 0;
          for (let i = 0; i < n * n; i++) if (mag[i] > peak) peak = mag[i];
          const thresh = peak * 0.6;
          for (let i = 0; i < n * n; i++) {
            convRe[i] = Math.max(0, mag[i] - thresh);
          }
          convIm.fill(0);
          fft.forward(convRe, convIm);
          complexMultiply(convRe, convIm, kernRe, kernIm);
          fft.inverse(convRe, convIm);
          // The unit-sum kernel conserves highlight energy over its
          // whole footprint; boost so the glints read at dot scale.
          for (let i = 0; i < n * n; i++) {
            const b = convRe[i];
            if (b > 0) mag[i] += 3 * b;
          }
        }
        const scale = normalizer.next(mag, f.dt * stride);

        const data = img.data;
        for (let y = 0, o = 0; y < n; y++) {
          for (let x = 0; x < n; x++, o += 4) {
            let idx = (mag[shiftedIndex(x, y, n)] * scale * 255) | 0;
            if (idx > 255) idx = 255;
            const l = idx * 4;
            data[o] = lut[l];
            data[o + 1] = lut[l + 1];
            data[o + 2] = lut[l + 2];
            data[o + 3] = lut[l + 3];
          }
        }
        offCtx.putImageData(img, 0, 0);

        if (s.inset) {
          const idata = insetImg.data;
          for (let i = 0, o = 0; i < n * n; i++, o += 4) {
            let idx = (field[i] * 210) | 0; // dimmed vs the main ramp
            if (idx > 255) idx = 255;
            const l = idx * 4;
            idata[o] = lut[l];
            idata[o + 1] = lut[l + 1];
            idata[o + 2] = lut[l + 2];
            idata[o + 3] = lut[l + 3];
          }
          insetCtx.putImageData(insetImg, 0, 0);
        }
      }

      g.clearRect(0, 0, width, height);
      g.imageSmoothingEnabled = true;
      // Cover scale, centered — dots stay round at any aspect ratio.
      const side = Math.max(width, height);
      g.drawImage(
        offCtx.canvas,
        (width - side) / 2,
        (height - side) / 2,
        side,
        side,
      );

      if (s.inset) {
        const size = Math.round(Math.min(width, height) * INSET_FRACTION);
        const margin = Math.round(Math.min(width, height) * 0.05);
        const x = margin;
        const y = height - margin - size;
        g.fillStyle = "rgba(0, 0, 0, 0.35)";
        g.fillRect(x, y, size, size);
        g.drawImage(insetCtx.canvas, x, y, size, size);
        g.strokeStyle = "rgba(255, 255, 255, 0.08)";
        g.lineWidth = dpr;
        g.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      }
    },
    dispose() {
      fft = null;
      offCtx = null;
      insetCtx = null;
      img = null;
      insetImg = null;
      history = null;
      lut = null;
      artLum = null;
      artFor = null;
    },
  };
}
