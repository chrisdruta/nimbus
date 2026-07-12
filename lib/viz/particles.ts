/**
 * Pure particle physics for the drift scene. Deterministic when given a
 * seeded rand; rendering (sprites, trails, compositing) lives in the
 * scene module.
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Base radius in CSS px (scene scales by dpr). */
  size: number;
  /** Free-running phase for size shimmer. */
  phase: number;
  /** Beat flare, 0..1, decays exponentially. */
  glow: number;
}

export interface StepOptions {
  w: number;
  h: number;
  /** 0..1 — scales drift speed. */
  energy: number;
  /** Beat flare: push particles away from (x, y). */
  impulse?: { x: number; y: number; strength: number };
  rand?: () => number;
}

export function spawnParticles(
  n: number,
  w: number,
  h: number,
  rand: () => number = Math.random,
): Particle[] {
  return Array.from({ length: n }, () => ({
    x: rand() * w,
    y: rand() * h,
    vx: (rand() - 0.5) * 12,
    vy: (rand() - 0.5) * 12,
    size: 1.5 + rand() * 2.5,
    phase: rand() * Math.PI * 2,
    glow: 0,
  }));
}

export function stepParticles(
  ps: Particle[],
  dt: number,
  opts: StepOptions,
): void {
  const { w, h, energy, impulse } = opts;
  const rand = opts.rand ?? Math.random;
  const speed = 0.35 + 2.2 * energy;
  const damping = 1 - 0.6 * dt;
  const glowDecay = Math.exp(-dt / 0.25);

  for (const p of ps) {
    // Gentle wander + damping keeps velocities bounded.
    p.vx = (p.vx + (rand() - 0.5) * 8 * dt) * damping;
    p.vy = (p.vy + (rand() - 0.5) * 8 * dt) * damping;

    if (impulse) {
      const dx = p.x - impulse.x;
      const dy = p.y - impulse.y;
      const dist = Math.max(30, Math.hypot(dx, dy));
      const push = (impulse.strength * 130) / dist;
      p.vx += (dx / dist) * push;
      p.vy += (dy / dist) * push;
      p.glow = Math.min(1, p.glow + impulse.strength * 0.9);
    }

    p.x += p.vx * speed * dt * 10;
    p.y += p.vy * speed * dt * 10;
    p.phase += dt * (1 + 2 * energy);
    p.glow *= glowDecay;

    // Toroidal wrap with a margin so sprites never pop at the edge.
    const m = p.size * 4;
    if (p.x < -m) p.x += w + 2 * m;
    else if (p.x > w + m) p.x -= w + 2 * m;
    if (p.y < -m) p.y += h + 2 * m;
    else if (p.y > h + m) p.y -= h + 2 * m;
  }
}
