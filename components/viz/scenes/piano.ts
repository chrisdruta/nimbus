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
  // Sequencer roll: note history lives in an offscreen canvas that
  // scrolls upward (waterfall's self-drawImage idiom, turned vertical).
  let roll: HTMLCanvasElement | null = null;
  let rollG: CanvasRenderingContext2D | null = null;
  let rollShift = 0;

  return {
    id: "piano",
    init() {
      beatGlow = 0;
      prevPhase = null;
      beam = null;
      beamKey = "";
      roll = null;
      rollG = null;
      rollShift = 0;
    },
    resize() {
      beam = null; // anchored in canvas coords; rebuild lazily in frame()
      roll = null; // sized to the roll region; rebuilt (history dropped)
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

      // Album art anchors the space above the keybed — oversized but
      // dimmed well into the background, so the roll/beams painting over
      // it read as the foreground.
      if (theme.artwork) {
        const size = Math.min(kbTop * 0.78, width * 0.42);
        const ax = (width - size) / 2;
        const ay = (kbTop - size) / 2 - kbTop * 0.02;
        const artR = 16 * dpr;
        g.save();
        g.beginPath();
        g.roundRect(ax, ay, size, size, artR);
        g.clip();
        g.globalAlpha = 0.45;
        g.drawImage(theme.artwork, ax, ay, size, size);
        g.restore();
        g.globalAlpha = 1;
        g.strokeStyle = "rgba(255, 255, 255, 0.05)";
        g.lineWidth = dpr;
        g.beginPath();
        g.roundRect(ax, ay, size, size, artR);
        g.stroke();
      }

      // Onset pulse feeds both the roll's beat lines and the felt strip.
      const pulse = beatPulse(f, prevPhase);
      prevPhase = pulse.phase;

      const rollOn = s.roll && !theme.reducedMotion;
      const rollH = Math.floor(kbTop - 4 * dpr);

      if (rollOn && rollH > 40) {
        // Sequencer roll: each frame the history scrolls up by dy device
        // pixels and the current key lights stamp the vacated bottom
        // strip — sustained notes extrude into bars, MIDI-roll style.
        if (!roll || roll.width !== width || roll.height !== rollH) {
          roll = document.createElement("canvas");
          roll.width = width;
          roll.height = rollH;
          rollG = roll.getContext("2d");
          rollShift = 0;
        }
        const rg = rollG;
        if (rg) {
          // Scroll speed follows the tempo grid when it's confident —
          // the visible window is ~8 beats — else a steady 7 seconds.
          const bps =
            f.tempo && f.tempo.confidence > 0.3 ? f.tempo.bpm / 60 : null;
          const historySec = bps ? Math.min(12, Math.max(4, 8 / bps)) : 7;
          rollShift += (rollH / historySec) * f.dt;
          const dy = Math.floor(rollShift);
          if (dy > 0) {
            rollShift -= dy;
            rg.globalCompositeOperation = "copy";
            rg.drawImage(roll, 0, -dy);
            rg.globalCompositeOperation = "destination-out";
            // Per-step fade sized so notes dissolve to ~7% by the top.
            rg.fillStyle = `rgba(0, 0, 0, ${Math.min(0.3, (2.6 * dy) / rollH)})`;
            rg.fillRect(0, 0, width, rollH);
            rg.globalCompositeOperation = "source-over";
            if (pulse.fire) {
              rg.fillStyle = "rgba(255, 255, 255, 0.05)";
              rg.fillRect(0, rollH - dy, width, Math.max(1, Math.round(dpr)));
            }
            // Stamp only clear notes — the low-level shimmer stays on the
            // live keys but would silt the history into a wall. The gate
            // knob trades sparseness for density (ambient vs full mixes).
            for (let i = 0; i < n; i++) {
              const lv = keyLight(lit[i]);
              if (lv <= s.gate) continue;
              const nv = Math.pow((lv - s.gate) / (1 - s.gate), 1.2);
              const k = layout.keys[i];
              const inset = whiteW * 0.08;
              const hot = Math.max(0, (nv - 0.55) / 0.45);
              const lr = Math.round(r + (255 - r) * hot);
              const lg = Math.round(gr + (255 - gr) * hot);
              const lb = Math.round(b + (255 - b) * hot);
              rg.fillStyle = `rgba(${lr}, ${lg}, ${lb}, ${(0.25 + 0.75 * nv) * (0.3 + 0.7 * s.glow)})`;
              // Crisp integer columns — fractional x smears the roll.
              const x0 = Math.round(k.x * whiteW + inset);
              const x1 = Math.round((k.x + k.w) * whiteW - inset);
              rg.fillRect(x0, rollH - dy, x1 - x0, dy);
            }
          }
          g.drawImage(roll, 0, 0);
        }
      }

      // Light beams above the keybed: a unit-height gradient (bright at
      // the base, transparent at 1) scaled per beam, so every beam fades
      // to nothing exactly at its own tip instead of cutting off flat.
      const beamMax = kbTop - height * 0.06;
      if (!rollOn && s.glow > 0.01 && beamMax > 8 * dpr) {
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
      roll = null;
      rollG = null;
    },
  };
}
