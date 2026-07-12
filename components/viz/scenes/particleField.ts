import type { AudioFrame, Scene, SceneContext, VizTheme } from "@/lib/viz/scene";
import { spawnParticles, stepParticles, type Particle } from "@/lib/viz/particles";

/**
 * Ambient drift field: particles wander with the track's energy, flare
 * and scatter on beats. Trails come from translucent background fills.
 */
export function createParticleFieldScene(): Scene {
  let particles: Particle[] = [];
  let sprite: HTMLCanvasElement | null = null;
  let spriteAccent = "";
  let firstFrame = true;

  function ensureSprite(theme: VizTheme): HTMLCanvasElement | null {
    if (sprite && spriteAccent === theme.accent) return sprite;
    const [r, g, b] = theme.accentRgb;
    const size = 64;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const grad = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    grad.addColorStop(0, `rgba(255, 255, 255, 0.9)`);
    grad.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, 0.8)`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    sprite = c;
    spriteAccent = theme.accent;
    return sprite;
  }

  return {
    id: "particles",
    init() {
      particles = [];
      firstFrame = true;
    },
    resize(sc: SceneContext) {
      const { width, height, dpr } = sc;
      const n = Math.max(
        120,
        Math.min(320, Math.round((width * height) / (9000 * dpr * dpr))),
      );
      particles = spawnParticles(n, width, height);
      firstFrame = true;
    },
    frame(sc: SceneContext, f: AudioFrame, theme: VizTheme) {
      const { g, width, height, dpr } = sc;

      // Trails: translucent fill; full clear under reduced motion.
      g.globalAlpha = firstFrame || theme.reducedMotion ? 1 : 0.28;
      g.fillStyle = theme.background;
      g.fillRect(0, 0, width, height);
      g.globalAlpha = 1;
      firstFrame = false;

      const impulse =
        f.beat && !theme.reducedMotion
          ? {
              // Random point biased toward the center.
              x: width * (0.5 + (Math.random() - 0.5) * 0.5),
              y: height * (0.5 + (Math.random() - 0.5) * 0.5),
              strength: f.beatIntensity,
            }
          : undefined;
      stepParticles(particles, f.dt, {
        w: width,
        h: height,
        energy: theme.reducedMotion ? 0.16 : f.energy,
        impulse,
      });

      const img = ensureSprite(theme);
      if (!img) return;
      g.globalCompositeOperation = "lighter";
      const baseScale = 1 + 0.25 * f.bass;
      for (const p of particles) {
        const shimmer = 1 + 0.15 * Math.sin(p.phase);
        const d = p.size * (1 + 1.6 * p.glow) * baseScale * shimmer * dpr * 4;
        g.globalAlpha = Math.min(1, 0.25 + 0.5 * f.energy + 0.4 * p.glow);
        g.drawImage(img, p.x - d / 2, p.y - d / 2, d, d);
      }
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    },
    dispose() {
      particles = [];
      sprite = null;
    },
  };
}
