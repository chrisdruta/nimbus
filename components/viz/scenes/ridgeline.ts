import type { AudioFrame, Scene, SceneContext, VizTheme } from "@/lib/viz/scene";
import { SpectrumHistory } from "@/lib/viz/history";
import { SETTINGS_DEFAULTS, type RidgeSettings } from "@/lib/viz/settings";
import { beatPulse } from "@/lib/viz/tempo";
import { dropAnticipation } from "@/lib/viz/trackshape";

const COLS = 48;

/**
 * Stacked scrolling spectrum silhouettes — the Unknown Pleasures look.
 * The live spectrum draws as the front ridge (stroke only); committed
 * history recedes upward with perspective compression, each history ridge
 * a filled silhouette so nearer rows occlude farther ones. Spectrum is
 * mirror-folded (lows in the center) for the classic symmetric shape.
 */
export function createRidgelineScene(): Scene {
  let history: SpectrumHistory | null = null;
  let historyKey = "";
  let beatLift = 0;
  let prevPhase: number | null = null;

  // One folded ridge: optional silhouette fill, then stroke. amp is in
  // device px.
  function ridge(
    g: CanvasRenderingContext2D,
    values: Float32Array,
    left: number,
    right: number,
    baseY: number,
    amp: number,
    fill: boolean,
  ): void {
    const w = right - left;
    const n = COLS * 2; // folded: highs → lows → highs
    g.beginPath();
    g.moveTo(left, baseY);
    let prevX = left;
    let prevY = baseY;
    for (let j = 0; j <= n; j++) {
      const d = Math.abs(j - n / 2) / (n / 2); // 0 center → 1 edges
      const v = values[Math.min(COLS - 1, Math.round(d * (COLS - 1)))];
      // Taper toward the edges so ridges land on the baseline.
      const x = left + (j / n) * w;
      const y = baseY - v * amp * (1 - d * d * 0.65);
      // Quadratic through midpoints keeps the line calm, not jagged.
      const mx = (prevX + x) / 2;
      const my = (prevY + y) / 2;
      g.quadraticCurveTo(prevX, prevY, mx, my);
      prevX = x;
      prevY = y;
    }
    g.lineTo(right, baseY);
    if (fill) g.fill();
    g.stroke();
  }

  return {
    id: "ridge",
    init() {
      history = null;
      historyKey = "";
      beatLift = 0;
    },
    resize() {},
    frame(sc: SceneContext, f: AudioFrame, theme: VizTheme) {
      const { g, width, height, dpr } = sc;
      const s = (sc.settings as RidgeSettings | undefined) ?? SETTINGS_DEFAULTS.ridge;
      const rows = Math.round(s.rows);
      const [r, gr, b] = theme.accentRgb;

      // History buffer follows the rows/duration settings (rebuild wipes
      // the stack — acceptable on an explicit settings change).
      const key = `${rows}:${s.historySec}`;
      if (!history || historyKey !== key) {
        history = new SpectrumHistory({
          cols: COLS,
          rows,
          intervalSec: s.historySec / rows,
        });
        historyKey = key;
      }
      history.push(f.bars, f.dt);
      const pulse = beatPulse(f, prevPhase);
      prevPhase = pulse.phase;
      if (pulse.fire) beatLift = Math.min(1, beatLift + 0.5 * pulse.intensity);
      beatLift *= Math.exp(-f.dt / 0.12);

      g.clearRect(0, 0, width, height);

      // Layout: front ridge near the bottom, history receding upward with
      // rows packed tighter toward the back.
      const frontY = height * 0.82;
      const backY = height * 0.2;
      const inset = width * 0.16;
      const amp = height * 0.2;

      // Back-to-front so silhouettes occlude what's behind them.
      const drawable = Math.min(history.rowCount, rows);
      for (let i = drawable - 1; i >= 0; i--) {
        // depth: 0 = front-most history row, 1 = oldest.
        const depth = (i + 1) / rows;
        const eased = 1 - Math.pow(1 - depth, 1.6); // compress at the back
        const y = frontY - (frontY - backY) * eased;
        const fade = 1 - depth * 0.82;
        // Depth-graded fill: nearly clear just behind the live line,
        // fully opaque past mid-depth, so the stack fades in instead of
        // snapping from open line to solid silhouette.
        const fillAlpha = 0.94 * Math.min(1, depth * 1.7);
        g.fillStyle = `rgba(6, 6, 8, ${fillAlpha.toFixed(3)})`;
        g.strokeStyle = `rgba(${Math.round(200 + (r - 200) * 0.25)}, ${Math.round(
          200 + (gr - 200) * 0.25,
        )}, ${Math.round(200 + (b - 200) * 0.25)}, ${0.55 * fade})`;
        g.lineWidth = Math.max(0.5, s.lineWeight * 0.78 * dpr * (1 - depth * 0.6));
        ridge(g, history.row(i), inset, width - inset, y, amp * (1 - depth * 0.35), true);
      }

      // Live front ridge from the current bars — smooth per-frame motion,
      // with the beat lift applied here only.
      const live = new Float32Array(COLS);
      for (let c = 0; c < COLS; c++) {
        const start = Math.floor((c * f.bars.length) / COLS);
        const end = Math.max(
          start + 1,
          Math.floor(((c + 1) * f.bars.length) / COLS),
        );
        let max = 0;
        for (let k = start; k < end; k++) if (f.bars[k] > max) max = f.bars[k];
        live[c] = max;
      }
      // The front ridge leans in ahead of a known drop.
      const antic = sc.track
        ? dropAnticipation(sc.track.shape, sc.track.positionSec, sc.track.durationSec)
        : 0;
      // Stroke only — an unfilled front line over the filled history stack.
      g.strokeStyle = "rgba(235, 235, 238, 0.95)";
      g.lineWidth = s.lineWeight * dpr;
      ridge(
        g,
        live,
        inset,
        width - inset,
        frontY,
        amp * (1 + 0.18 * beatLift + 0.12 * antic),
        false,
      );
    },
    dispose() {},
  };
}
