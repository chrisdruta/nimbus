import type { AudioFrame, Scene, SceneContext, VizTheme } from "@/lib/viz/scene";

const BAR_COUNT = 64;
const SPAN = 0.42; // each half-bar spans up to 42% of the height

/**
 * Evolved spectrum: mirrored bars around the horizontal centerline with
 * peak-hold caps and an artwork-tinted gradient. The default scene.
 */
export function createSpectrumBarsScene(): Scene {
  const caps = new Float32Array(BAR_COUNT);
  const capHold = new Float32Array(BAR_COUNT);
  const capFall = new Float32Array(BAR_COUNT);
  let gradient: CanvasGradient | null = null;
  let gradientKey = "";
  let beatGlow = 0;

  return {
    id: "bars",
    init() {
      caps.fill(0);
      capHold.fill(0);
      capFall.fill(0);
      beatGlow = 0;
      gradient = null;
      gradientKey = "";
    },
    resize() {
      gradient = null; // height-dependent; rebuild lazily in frame()
    },
    frame(sc: SceneContext, f: AudioFrame, theme: VizTheme) {
      const { g, width, height, dpr } = sc;
      const cy = height / 2;
      const [r, gr, b] = theme.accentRgb;

      // Transparent canvas — the stage's blurred-art backdrop shows through.
      g.clearRect(0, 0, width, height);

      // Beat bloom: a soft glow rising from the bottom, decaying fast.
      if (f.beat) beatGlow = Math.min(1, beatGlow + 0.08 * f.beatIntensity * 10);
      beatGlow *= Math.exp(-f.dt / 0.15);
      if (beatGlow > 0.005) {
        const glow = g.createRadialGradient(
          width / 2, height, 0,
          width / 2, height, height * 0.9,
        );
        glow.addColorStop(0, `rgba(${r}, ${gr}, ${b}, ${0.35 * beatGlow})`);
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        g.fillStyle = glow;
        g.fillRect(0, 0, width, height);
      }

      // Vertical gradient: accent at the extremes, translucent center.
      const key = `${height}:${theme.accent}`;
      if (!gradient || gradientKey !== key) {
        gradient = g.createLinearGradient(0, cy - height * SPAN, 0, cy + height * SPAN);
        gradient.addColorStop(0, `rgba(${r}, ${gr}, ${b}, 1)`);
        gradient.addColorStop(0.5, `rgba(${r}, ${gr}, ${b}, 0.35)`);
        gradient.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 1)`);
        gradientKey = key;
      }

      const gap = 2 * dpr;
      const barW = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      const capW = Math.max(2 * dpr, barW);

      for (let i = 0; i < BAR_COUNT; i++) {
        const v = f.bars[i];
        const x = i * (barW + gap);
        const half = Math.max(1 * dpr, v * height * SPAN);

        if (v <= 0.004) {
          // Silence: a thin spine keeps the layout readable.
          g.globalAlpha = 1;
          g.fillStyle = "#404040";
          g.fillRect(x, cy - dpr, barW, 2 * dpr);
        } else {
          g.globalAlpha = 0.55 + 0.45 * v;
          g.fillStyle = gradient;
          g.fillRect(x, cy - half, barW, half * 2);
        }

        // Peak-hold caps: track the outer edge, hold, then fall.
        if (v >= caps[i]) {
          caps[i] = v;
          capHold[i] = 0.5;
          capFall[i] = 0;
        } else if (capHold[i] > 0) {
          capHold[i] -= f.dt;
        } else {
          capFall[i] += f.dt;
          caps[i] = Math.max(v, caps[i] - 1.8 * capFall[i] * f.dt);
        }
        if (caps[i] > 0.02) {
          const capY = caps[i] * height * SPAN;
          g.globalAlpha = 0.85;
          g.fillStyle = "#ffffff";
          g.fillRect(x, cy - capY - 2 * dpr, capW, 2 * dpr);
          g.fillRect(x, cy + capY, capW, 2 * dpr);
        }
      }
      g.globalAlpha = 1;
    },
    dispose() {
      gradient = null;
    },
  };
}
