import type { AudioFrame, Scene, SceneContext, VizTheme } from "@/lib/viz/scene";
import { buildColormap } from "@/lib/viz/colormap";
import { SETTINGS_DEFAULTS, type WaterfallSettings } from "@/lib/viz/settings";
import { dropAnticipation } from "@/lib/viz/trackshape";

const TIME_COLS = 480; // offscreen width in history columns
const FREQ_ROWS = 64; // matches the fullscreen bar count

/**
 * Scrolling spectrogram: time flows right-to-left, low frequencies at the
 * bottom, intensity through an artwork-accent colormap. History lives in
 * a small offscreen canvas; each frame blits it scaled to the viewport so
 * the aurora smear comes from bilinear upscaling, not per-pixel work.
 */
export function createWaterfallScene(): Scene {
  let off: HTMLCanvasElement | null = null;
  let offG: CanvasRenderingContext2D | null = null;
  let column: ImageData | null = null;
  let lut: Uint8ClampedArray | null = null;
  let lutKey = "";
  let accSec = 0;

  return {
    id: "waterfall",
    init() {
      off = document.createElement("canvas");
      off.width = TIME_COLS;
      off.height = FREQ_ROWS;
      offG = off.getContext("2d");
      column = offG ? offG.createImageData(1, FREQ_ROWS) : null;
      lut = null;
      lutKey = "";
      accSec = 0;
    },
    resize() {},
    frame(sc: SceneContext, f: AudioFrame, theme: VizTheme) {
      const { g, width, height } = sc;
      const s =
        (sc.settings as WaterfallSettings | undefined) ?? SETTINGS_DEFAULTS.waterfall;
      if (!off || !offG || !column) return;

      const key = `${theme.accent}:${s.hueSpread}`;
      if (!lut || lutKey !== key) {
        lut = buildColormap(theme.accentRgb, s.hueSpread);
        lutKey = key;
      }

      const colSec = s.scrollSec / TIME_COLS;
      accSec += f.dt;
      while (accSec >= colSec) {
        accSec -= colSec;
        // Scroll one column left (self-drawImage copies), paint the new
        // column at the right edge; beats brighten their column slightly.
        offG.drawImage(off, -1, 0);
        // Lean in through the couple of seconds before a known drop.
        const antic = sc.track
          ? dropAnticipation(sc.track.shape, sc.track.positionSec, sc.track.durationSec)
          : 0;
        const boost = s.intensity * (1 + 0.25 * f.beatIntensity + 0.3 * antic);
        const px = column.data;
        for (let i = 0; i < FREQ_ROWS; i++) {
          const v = Math.min(1, (f.bars[i] ?? 0) * boost);
          const li = Math.round(v * 255) * 3;
          const y = FREQ_ROWS - 1 - i; // lows at the bottom
          px[y * 4] = lut[li];
          px[y * 4 + 1] = lut[li + 1];
          px[y * 4 + 2] = lut[li + 2];
          px[y * 4 + 3] = 255;
        }
        offG.putImageData(column, TIME_COLS - 1, 0);
      }

      g.clearRect(0, 0, width, height);
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 0.88;
      g.drawImage(off, 0, 0, TIME_COLS, FREQ_ROWS, 0, 0, width, height);
      g.globalAlpha = 1;
    },
    dispose() {
      off = null;
      offG = null;
      column = null;
      lut = null;
    },
  };
}
