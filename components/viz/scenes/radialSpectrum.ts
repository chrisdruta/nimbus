import type { AudioFrame, Scene, SceneContext, VizTheme } from "@/lib/viz/scene";

const SLOTS = 96; // 48 unique bars mirrored across the vertical axis
const UNIQUE = SLOTS / 2;

/**
 * Ring of spectrum bars orbiting the track artwork; the artwork breathes
 * with the bass on a damped spring and gets kicked on beats.
 */
export function createRadialSpectrumScene(): Scene {
  let scale = 1;
  let scaleVel = 0;
  let vignette: CanvasGradient | null = null;

  return {
    id: "radial",
    init() {
      scale = 1;
      scaleVel = 0;
    },
    resize(sc: SceneContext) {
      const { g, width, height } = sc;
      vignette = g.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.2,
        width / 2, height / 2, Math.max(width, height) * 0.75,
      );
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    },
    frame(sc: SceneContext, f: AudioFrame, theme: VizTheme, tSec: number) {
      const { g, width, height, dpr } = sc;
      const cx = width / 2;
      const cy = height / 2;
      const [r, gr, b] = theme.accentRgb;

      // Transparent canvas; the vignette still darkens the backdrop's rim.
      g.clearRect(0, 0, width, height);
      if (vignette) {
        g.fillStyle = vignette;
        g.fillRect(0, 0, width, height);
      }

      // Damped spring toward 1 + 0.05·bass, kicked on beats.
      const target = 1 + 0.05 * f.bass;
      if (f.beat) scaleVel += 1.2 * f.beatIntensity;
      const accel = -90 * (scale - target) - 12 * scaleVel;
      scaleVel += accel * f.dt;
      scale += scaleVel * f.dt;

      const R0 = Math.min(width, height) * 0.16;
      const R = R0 * scale;
      const rotation = theme.reducedMotion ? 0 : tSec * 0.06;

      // Bars first so the artwork sits on top of their inner ends.
      const Rin = R + 10 * dpr;
      const Lmax = Math.min(width, height) / 2 - Rin - 24 * dpr;
      const barWidth = ((2 * Math.PI * Rin) / SLOTS) * 0.55;
      g.lineCap = "round";
      g.lineWidth = barWidth;
      for (let j = 0; j < SLOTS; j++) {
        const i = j < UNIQUE ? j : SLOTS - 1 - j;
        const v = f.bars[i] ?? 0;
        const angle = -Math.PI / 2 + (j * 2 * Math.PI) / SLOTS + rotation;
        const len = Math.max(2 * dpr, v * Lmax);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        g.strokeStyle = `rgba(${r}, ${gr}, ${b}, ${0.35 + 0.65 * v})`;
        g.beginPath();
        g.moveTo(cx + cos * Rin, cy + sin * Rin);
        g.lineTo(cx + cos * (Rin + len), cy + sin * (Rin + len));
        g.stroke();
      }

      // Artwork disc (circle-clipped) or accent-tinted fallback disc.
      if (theme.artwork) {
        g.save();
        g.beginPath();
        g.arc(cx, cy, R, 0, 2 * Math.PI);
        g.clip();
        g.drawImage(theme.artwork, cx - R, cy - R, R * 2, R * 2);
        g.restore();
      } else {
        g.fillStyle = `rgba(${r}, ${gr}, ${b}, 0.15)`;
        g.beginPath();
        g.arc(cx, cy, R, 0, 2 * Math.PI);
        g.fill();
      }
      g.strokeStyle = `rgba(${r}, ${gr}, ${b}, 0.9)`;
      g.lineWidth = 1.5 * dpr;
      g.beginPath();
      g.arc(cx, cy, R, 0, 2 * Math.PI);
      g.stroke();
    },
    dispose() {
      vignette = null;
    },
  };
}
