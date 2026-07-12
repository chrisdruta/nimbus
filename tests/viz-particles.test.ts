import { describe, expect, test } from "bun:test";
import { spawnParticles, stepParticles } from "../lib/viz/particles";

/** Same mulberry32 as the queue engine — deterministic test rand. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 800;
const H = 600;
const DT = 1 / 60;

describe("particles", () => {
  test("spawn is deterministic with a seeded rand", () => {
    const a = spawnParticles(50, W, H, mulberry32(7));
    const b = spawnParticles(50, W, H, mulberry32(7));
    expect(a).toEqual(b);
  });

  test("spawns within bounds", () => {
    for (const p of spawnParticles(100, W, H, mulberry32(1))) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(H);
      expect(p.glow).toBe(0);
    }
  });

  test("step is deterministic with a seeded rand", () => {
    const a = spawnParticles(30, W, H, mulberry32(3));
    const b = spawnParticles(30, W, H, mulberry32(3));
    const ra = mulberry32(9);
    const rb = mulberry32(9);
    for (let i = 0; i < 100; i++) {
      stepParticles(a, DT, { w: W, h: H, energy: 0.5, rand: ra });
      stepParticles(b, DT, { w: W, h: H, energy: 0.5, rand: rb });
    }
    expect(a).toEqual(b);
  });

  test("impulse pushes particles away from its origin", () => {
    const ps = spawnParticles(40, W, H, mulberry32(4));
    // Isolate the impulse: at rest, no wander (rand 0.5 adds nothing).
    for (const p of ps) {
      p.vx = 0;
      p.vy = 0;
    }
    stepParticles(ps, DT, {
      w: W,
      h: H,
      energy: 0,
      impulse: { x: 400, y: 300, strength: 1 },
      rand: () => 0.5,
    });
    for (const p of ps) {
      // Velocity points away from the impulse origin.
      const dot = p.vx * (p.x - 400) + p.vy * (p.y - 300);
      expect(dot).toBeGreaterThan(0);
    }
  });

  test("impulse sets glow and glow decays", () => {
    const ps = spawnParticles(10, W, H, mulberry32(5));
    stepParticles(ps, DT, {
      w: W,
      h: H,
      energy: 0,
      impulse: { x: 400, y: 300, strength: 1 },
      rand: () => 0.5,
    });
    const litGlow = ps[0].glow;
    expect(litGlow).toBeGreaterThan(0.5);
    for (let i = 0; i < 120; i++) {
      stepParticles(ps, DT, { w: W, h: H, energy: 0, rand: () => 0.5 });
    }
    expect(ps[0].glow).toBeLessThan(litGlow * 0.01);
  });

  test("particles stay finite and near-bounds after 10k steps", () => {
    const ps = spawnParticles(20, W, H, mulberry32(6));
    const rand = mulberry32(11);
    for (let i = 0; i < 10_000; i++) {
      stepParticles(ps, DT, {
        w: W,
        h: H,
        energy: 1,
        impulse:
          i % 30 === 0 ? { x: rand() * W, y: rand() * H, strength: 1.5 } : undefined,
        rand,
      });
    }
    for (const p of ps) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.vx)).toBe(true);
      expect(Number.isFinite(p.vy)).toBe(true);
      const m = p.size * 4 + 1;
      expect(p.x).toBeGreaterThanOrEqual(-m);
      expect(p.x).toBeLessThanOrEqual(W + m);
      expect(p.y).toBeGreaterThanOrEqual(-m);
      expect(p.y).toBeLessThanOrEqual(H + m);
    }
  });
});
