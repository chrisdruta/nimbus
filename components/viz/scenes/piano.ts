import type { AudioFrame, Scene, SceneContext, VizTheme } from "@/lib/viz/scene";
import { noteContrast, pianoLayout, type PianoLayout } from "@/lib/viz/piano";
import { SETTINGS_DEFAULTS, type PianoSettings } from "@/lib/viz/settings";
import { beatPulse } from "@/lib/viz/tempo";

/**
 * A keyboard lit by the spectrum: resolveDsp gives this scene one bar per
 * semitone, so bars[i] is the level of layout key i. Keys glow accent as
 * their band sounds, with light beams rising off the keybed. An FFT lights
 * harmonics as well as fundamentals — chords bloom as clusters — which is
 * the aesthetic, not a transcription.
 */
/**
 * Sparse-lighting transfer on top of noteContrast: gain the contrast back
 * up (a dense mix suppresses even its peaks), gate off the residual wash,
 * and curve what remains — strong notes pop, the broadband bed keeps a
 * faint shimmer instead of going black.
 */
function keyLight(v: number): number {
  const GATE = 0.12;
  const x = Math.min(1, v * 1.8);
  if (x <= GATE) return 0;
  return Math.min(1, Math.pow((x - GATE) / (1 - GATE), 1.3) * 1.15);
}

export function createPianoScene(): Scene {
  let layout: PianoLayout | null = null;
  let lit = new Float32Array(0);
  let layoutKeys = 0;
  let beam: CanvasGradient | null = null;
  let beamKey = "";
  let beatGlow = 0;
  let prevPhase: number | null = null;

  return {
    id: "piano",
    init() {
      beatGlow = 0;
      prevPhase = null;
      beam = null;
      beamKey = "";
    },
    resize() {
      beam = null; // anchored in canvas coords; rebuild lazily in frame()
    },
    frame(sc: SceneContext, f: AudioFrame, theme: VizTheme) {
      const { g, width, height, dpr } = sc;
      const s = (sc.settings as PianoSettings | undefined) ?? SETTINGS_DEFAULTS.piano;
      const [r, gr, b] = theme.accentRgb;

      if (!layout || layoutKeys !== s.keys) {
        layout = pianoLayout(s.keys);
        layoutKeys = s.keys;
      }
      const n = Math.min(f.bars.length, layout.keys.length);
      if (lit.length !== n) lit = new Float32Array(n);
      noteContrast(f.bars, lit);

      // Keybed geometry: white keys span the width; height keeps a
      // key-like aspect but never dominates the canvas.
      const whiteW = width / layout.whiteUnits;
      const whiteH = Math.min(whiteW * 5.4, height * 0.3);
      const blackH = whiteH * 0.62;
      const kbBottom = height - Math.min(height * 0.08, 48 * dpr);
      const kbTop = kbBottom - whiteH;
      const gap = Math.max(1, Math.round(dpr));
      const radius = Math.max(2 * dpr, whiteW * 0.08);

      g.clearRect(0, 0, width, height);

      // Light beams above the keybed: a unit-height gradient (bright at
      // the base, transparent at 1) scaled per beam, so every beam fades
      // to nothing exactly at its own tip instead of cutting off flat.
      const beamMax = kbTop - height * 0.06;
      if (s.glow > 0.01 && beamMax > 8 * dpr) {
        if (!beam || beamKey !== theme.accent) {
          beam = g.createLinearGradient(0, 0, 0, -1);
          beam.addColorStop(0, `rgba(${r}, ${gr}, ${b}, 0.6)`);
          beam.addColorStop(0.35, `rgba(${r}, ${gr}, ${b}, 0.22)`);
          beam.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
          beamKey = theme.accent;
        }
        for (let i = 0; i < n; i++) {
          const lv = keyLight(lit[i]);
          if (lv <= 0.01) continue;
          const k = layout.keys[i];
          const inset = k.black ? whiteW * 0.1 : whiteW * 0.22;
          g.save();
          g.translate(k.x * whiteW + inset, kbTop);
          g.scale(1, lv * beamMax);
          g.globalAlpha = (0.25 + 0.75 * lv) * s.glow;
          g.fillStyle = beam;
          g.fillRect(0, -1, k.w * whiteW - inset * 2, 1);
          g.restore();
        }
        g.globalAlpha = 1;
      }

      // Felt strip along the keybed top; blooms on the beat.
      const pulse = beatPulse(f, prevPhase);
      prevPhase = pulse.phase;
      if (pulse.fire) beatGlow = Math.min(1, beatGlow + 0.6 * pulse.intensity);
      beatGlow *= Math.exp(-f.dt / 0.18);
      g.fillStyle = `rgba(${r}, ${gr}, ${b}, ${0.4 + 0.5 * beatGlow})`;
      g.fillRect(0, kbTop - 3 * dpr, width, 3 * dpr);

      // White keys first (blacks overlay). Unlit keys read as a dark
      // keyboard in a dark room; lit keys fill with accent, running
      // white-hot near full level.
      for (let i = 0; i < n; i++) {
        const k = layout.keys[i];
        if (k.black) continue;
        const x = k.x * whiteW + gap / 2;
        const w = whiteW - gap;
        g.beginPath();
        g.roundRect(x, kbTop, w, whiteH, [0, 0, radius, radius]);
        g.fillStyle = "rgba(255, 255, 255, 0.1)";
        g.fill();
        const lv = keyLight(lit[i]);
        if (lv > 0.01) {
          const hot = Math.max(0, (lv - 0.6) / 0.4);
          const lr = Math.round(r + (255 - r) * hot);
          const lg = Math.round(gr + (255 - gr) * hot);
          const lb = Math.round(b + (255 - b) * hot);
          g.fillStyle = `rgba(${lr}, ${lg}, ${lb}, ${0.9 * lv})`;
          g.fill();
        }
        if (s.labels && k.label) {
          g.fillStyle = "rgba(255, 255, 255, 0.38)";
          g.font = `${Math.round(9 * dpr)}px ui-monospace, monospace`;
          g.textAlign = "center";
          g.textBaseline = "bottom";
          g.fillText(k.label, x + w / 2, kbBottom - 5 * dpr);
        }
      }

      // Black keys: near-black with a top highlight so they read on the
      // dark backdrop; they light brighter than whites (dark base).
      for (let i = 0; i < n; i++) {
        const k = layout.keys[i];
        if (!k.black) continue;
        const x = k.x * whiteW + gap / 2;
        const w = k.w * whiteW - gap;
        g.beginPath();
        g.roundRect(x, kbTop, w, blackH, [0, 0, radius * 0.75, radius * 0.75]);
        g.fillStyle = "rgba(6, 6, 8, 0.88)";
        g.fill();
        const lv = keyLight(lit[i]);
        if (lv > 0.01) {
          const hot = Math.max(0, (lv - 0.6) / 0.4);
          const lr = Math.round(r + (255 - r) * hot);
          const lg = Math.round(gr + (255 - gr) * hot);
          const lb = Math.round(b + (255 - b) * hot);
          g.fillStyle = `rgba(${lr}, ${lg}, ${lb}, ${Math.min(1, lv * 1.15)})`;
          g.fill();
        } else {
          g.fillStyle = "rgba(255, 255, 255, 0.12)";
          g.fillRect(x, kbTop, w, dpr);
        }
      }
    },
    dispose() {
      layout = null;
      beam = null;
    },
  };
}
