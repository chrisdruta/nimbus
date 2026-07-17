import type { AudioFrame, Scene, SceneContext, VizTheme } from "@/lib/viz/scene";
import { SETTINGS_DEFAULTS, type SpectrumSettings } from "@/lib/viz/settings";
import { beatPulse } from "@/lib/viz/tempo";

const SPAN = 0.42; // each half-bar spans up to 42% of the height (mirrored)
const FLOOR_SPAN = 0.78; // single-sided span when mirroring is off

/**
 * Evolved spectrum: bars with peak-hold caps and an artwork-tinted
 * gradient — mirrored around the centerline or rising from the floor,
 * per settings. The default scene.
 */
export function createSpectrumBarsScene(): Scene {
  let caps = new Float32Array(0);
  let capHold = new Float32Array(0);
  let capFall = new Float32Array(0);
  let gradient: CanvasGradient | null = null;
  let gradientKey = "";
  let beatGlow = 0;
  let prevPhase: number | null = null;

  return {
    id: "bars",
    init() {
      caps = new Float32Array(0);
      beatGlow = 0;
      gradient = null;
      gradientKey = "";
    },
    resize() {
      gradient = null; // height-dependent; rebuild lazily in frame()
    },
    frame(sc: SceneContext, f: AudioFrame, theme: VizTheme) {
      const { g, width, height, dpr } = sc;
      const s = (sc.settings as SpectrumSettings | undefined) ?? SETTINGS_DEFAULTS.bars;
      const n = f.bars.length;
      const [r, gr, b] = theme.accentRgb;

      if (caps.length !== n) {
        caps = new Float32Array(n);
        capHold = new Float32Array(n);
        capFall = new Float32Array(n);
      }

      const cy = height / 2;
      const baseline = height * 0.9;

      // Transparent canvas — the stage's blurred-art backdrop shows through.
      g.clearRect(0, 0, width, height);

      // Beat bloom: a soft glow rising from the bottom, decaying fast.
      // Pulses on the predicted tempo grid when it's confident. A
      // full-canvas radial fill per frame — the single most expensive op
      // here, so low-power hosts skip it.
      const pulse = beatPulse(f, prevPhase);
      prevPhase = pulse.phase;
      if (pulse.fire) beatGlow = Math.min(1, beatGlow + 0.08 * pulse.intensity * 10);
      beatGlow *= Math.exp(-f.dt / 0.15);
      if (beatGlow > 0.005 && !sc.lowPower) {
        const glow = g.createRadialGradient(
          width / 2, height, 0,
          width / 2, height, height * 0.9,
        );
        glow.addColorStop(0, `rgba(${r}, ${gr}, ${b}, ${0.35 * beatGlow})`);
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        g.fillStyle = glow;
        g.fillRect(0, 0, width, height);
      }

      // Vertical gradient: accent at the extremes, translucent center
      // (mirrored) or accent at the tip fading toward the floor.
      const key = `${height}:${theme.accent}:${s.mirror}`;
      if (!gradient || gradientKey !== key) {
        gradient = s.mirror
          ? g.createLinearGradient(0, cy - height * SPAN, 0, cy + height * SPAN)
          : g.createLinearGradient(0, baseline - height * FLOOR_SPAN, 0, baseline);
        gradient.addColorStop(0, `rgba(${r}, ${gr}, ${b}, 1)`);
        gradient.addColorStop(0.5, `rgba(${r}, ${gr}, ${b}, 0.35)`);
        gradient.addColorStop(1, `rgba(${r}, ${gr}, ${b}, ${s.mirror ? 1 : 0.55})`);
        gradientKey = key;
      }

      const gap = 2 * dpr;
      const barW = (width - gap * (n - 1)) / n;
      const capW = Math.max(2 * dpr, barW);

      for (let i = 0; i < n; i++) {
        const v = f.bars[i];
        const x = i * (barW + gap);

        if (v <= 0.004) {
          // Silence: a thin spine keeps the layout readable.
          g.globalAlpha = 1;
          g.fillStyle = "#404040";
          const spineY = s.mirror ? cy : baseline;
          g.fillRect(x, spineY - dpr, barW, 2 * dpr);
        } else {
          g.globalAlpha = 0.55 + 0.45 * v;
          g.fillStyle = gradient;
          if (s.mirror) {
            const half = Math.max(1 * dpr, v * height * SPAN);
            g.fillRect(x, cy - half, barW, half * 2);
          } else {
            const h = Math.max(1 * dpr, v * height * FLOOR_SPAN);
            g.fillRect(x, baseline - h, barW, h);
          }
        }

        if (!s.caps) continue;

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
          g.globalAlpha = 0.85;
          g.fillStyle = "#ffffff";
          if (s.mirror) {
            const capY = caps[i] * height * SPAN;
            g.fillRect(x, cy - capY - 2 * dpr, capW, 2 * dpr);
            g.fillRect(x, cy + capY, capW, 2 * dpr);
          } else {
            const capY = baseline - caps[i] * height * FLOOR_SPAN;
            g.fillRect(x, capY - 2 * dpr, capW, 2 * dpr);
          }
        }
      }
      g.globalAlpha = 1;
    },
    dispose() {
      gradient = null;
    },
  };
}
