import type { AudioFrame, Scene, SceneContext, VizTheme } from "@/lib/viz/scene";
import { AutoGain, findTrigger } from "@/lib/viz/scope";

const WINDOW = 1024;
const TRIGGER_SEARCH = 512;

/** Time-domain waveform with phosphor trails and a triple-pass glow stroke. */
export function createOscilloscopeScene(): Scene {
  const autoGain = new AutoGain();
  let beatWiden = 0;
  let firstFrame = true;

  return {
    id: "scope",
    init() {
      beatWiden = 0;
      firstFrame = true;
    },
    resize() {
      firstFrame = true; // stale trails don't survive a resize
    },
    frame(sc: SceneContext, f: AudioFrame, theme: VizTheme) {
      const { g, width, height, dpr } = sc;
      const cy = height / 2;
      const [r, gr, b] = theme.accentRgb;

      // Phosphor persistence on a transparent canvas: erase a fraction of
      // the previous frame so trails fade toward the backdrop, not black.
      if (firstFrame || theme.reducedMotion) {
        g.clearRect(0, 0, width, height);
      } else {
        g.globalCompositeOperation = "destination-out";
        g.fillStyle = "rgba(0, 0, 0, 0.35)";
        g.fillRect(0, 0, width, height);
        g.globalCompositeOperation = "source-over";
      }
      firstFrame = false;

      // Faint centerline beneath the trace.
      g.fillStyle = "#404040";
      g.fillRect(0, cy - dpr / 2, width, dpr);

      const w = f.waveform;
      if (w.length < WINDOW + TRIGGER_SEARCH) return;
      const trig = findTrigger(w, TRIGGER_SEARCH);

      let sumSq = 0;
      for (let i = 0; i < WINDOW; i++) {
        const s = w[trig + i];
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / WINDOW);
      const gain = autoGain.next(rms, f.dt);

      if (f.beat) beatWiden = Math.min(1, beatWiden + 0.5 * f.beatIntensity);
      beatWiden *= Math.exp(-f.dt / 0.12);

      const path = new Path2D();
      const maxY = height * 0.46;
      for (let i = 0; i < WINDOW; i++) {
        const x = (i / (WINDOW - 1)) * width;
        const yRaw = w[trig + i] * gain * height * 0.35;
        const y = cy + Math.max(-maxY, Math.min(maxY, yRaw));
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }

      // Layered glow — far cheaper than shadowBlur.
      g.lineJoin = "round";
      g.lineCap = "round";
      g.strokeStyle = `rgba(${r}, ${gr}, ${b}, 0.12)`;
      g.lineWidth = 9 * dpr;
      g.stroke(path);
      g.strokeStyle = `rgba(${r}, ${gr}, ${b}, 0.35)`;
      g.lineWidth = 4 * dpr;
      g.stroke(path);
      // Core: accent lightened toward white.
      const cr = Math.round(r + (255 - r) * 0.35);
      const cg = Math.round(gr + (255 - gr) * 0.35);
      const cb = Math.round(b + (255 - b) * 0.35);
      g.strokeStyle = `rgb(${cr}, ${cg}, ${cb})`;
      g.lineWidth = 1.75 * dpr * (1 + 0.5 * beatWiden);
      g.stroke(path);
    },
    dispose() {},
  };
}
