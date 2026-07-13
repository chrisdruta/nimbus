"use client";

import { useEffect, useRef } from "react";
import { usePlayerRefs, usePlayerState } from "@/components/player/PlayerProvider";
import { FrameAnalyzer } from "@/lib/viz/analyzer";
import type { Scene, SceneContext, VizTheme } from "@/lib/viz/scene";
import type { ResolvedDsp, SceneVisualSettings } from "@/lib/viz/settings";
import type { TrackShape } from "@/lib/viz/trackshape";

const FULL_BAR_COUNT = 64;

/**
 * Owns the fullscreen canvas and rAF loop; drives whichever Scene is
 * active. The FrameAnalyzer persists across scene swaps so DSP state
 * (gravity, sensitivity) doesn't re-ramp when the user switches scenes.
 */
export function SceneHost({
  scene,
  theme,
  dsp,
  visual,
  trackShape,
  className = "",
}: {
  scene: Scene;
  theme: VizTheme;
  dsp?: ResolvedDsp;
  visual?: SceneVisualSettings;
  /** Whole-track lookahead shape for the current track (null while loading). */
  trackShape?: { shape: TrackShape | null; durationMs: number };
  className?: string;
}) {
  const { analyserRef, audioRef } = usePlayerRefs();
  const { playing } = usePlayerState();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<FrameAnalyzer | null>(null);
  const sceneRef = useRef(scene);
  const themeRef = useRef(theme);
  const playingRef = useRef(playing);
  const visualRef = useRef(visual);
  const dspRef = useRef(dsp);
  const trackShapeRef = useRef(trackShape);
  themeRef.current = theme;
  playingRef.current = playing;
  visualRef.current = visual;
  dspRef.current = dsp;
  trackShapeRef.current = trackShape;

  // Settings flow into the persistent analyzer; it rebuilds internally
  // only when a structural value actually changed. (First application
  // happens where the analyzer is created, below.)
  useEffect(() => {
    if (!dsp) return;
    const analyzer = analyzerRef.current;
    if (!analyzer) return;
    analyzer.setStructure(dsp);
    analyzer.setDsp(dsp.tuning);
  }, [dsp]);

  // Scene lifecycle: init/dispose on swap; the rAF loop reads sceneRef.
  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const sc: SceneContext = {
      g,
      width: canvas.width,
      height: canvas.height,
      dpr: window.devicePixelRatio || 1,
    };
    scene.init(sc);
    scene.resize(sc); // canvas is already sized; give layout-derived state
    sceneRef.current = scene;
    return () => scene.dispose();
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;

    if (!analyzerRef.current) {
      analyzerRef.current = new FrameAnalyzer({
        barCount: dspRef.current?.barCount ?? FULL_BAR_COUNT,
        wantWaveform: true,
      });
      if (dspRef.current) {
        analyzerRef.current.setStructure(dspRef.current);
        analyzerRef.current.setDsp(dspRef.current.tuning);
      }
    }
    const analyzer = analyzerRef.current;

    const sc: SceneContext = {
      g,
      width: canvas.width,
      height: canvas.height,
      dpr: window.devicePixelRatio || 1,
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      sc.width = canvas.width;
      sc.height = canvas.height;
      sc.dpr = dpr;
      sceneRef.current.resize(sc);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let raf = 0;
    let lastDraw = 0;
    let idleFrames = 0;
    const startSec = performance.now() / 1000;

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);

      // Frame-skip throttles: ~15 fps under reduced motion, ~4 fps when
      // paused and the bars have settled (energy ≈ 0).
      const idle = idleFrames > 90;
      const interval = reducedMotion ? 66 : idle ? 250 : 0;
      if (interval > 0 && nowMs - lastDraw < interval) return;
      lastDraw = nowMs;

      const frame = analyzer.sample(analyserRef.current, nowMs);
      if (!playingRef.current && frame.energy < 0.004) idleFrames++;
      else idleFrames = 0;

      if (reducedMotion) {
        frame.beat = false;
        frame.beatIntensity = 0;
        frame.tempo = null;
      }
      const t = { ...themeRef.current, reducedMotion };
      sc.settings = visualRef.current;
      const ts = trackShapeRef.current;
      sc.track = ts
        ? {
            shape: ts.shape,
            positionSec: audioRef.current?.currentTime ?? 0,
            durationSec: ts.durationMs / 1000,
          }
        : undefined;
      sceneRef.current.frame(sc, frame, t, nowMs / 1000 - startSec);
    };
    raf = requestAnimationFrame(draw);

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [analyserRef, audioRef]);

  return <canvas ref={canvasRef} className={className} />;
}
