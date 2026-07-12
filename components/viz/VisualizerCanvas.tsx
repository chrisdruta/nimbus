"use client";

import { useEffect, useRef } from "react";
import { usePlayerRefs } from "@/components/player/PlayerProvider";
import { FrameAnalyzer } from "@/lib/viz/analyzer";

function themeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

const BAR_COUNT = 24;

/**
 * The mini media-bar visualizer: 24 bars fed by the shared cava-style DSP
 * (gravity fall, monstercat smoothing, sensitivity autoscale).
 */
export function VisualizerCanvas({ className = "" }: { className?: string }) {
  const { analyserRef } = usePlayerRefs();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;

    const accent = themeColor("--color-accent", "#ff4200");
    const dim = themeColor("--color-elem", "#404040");
    const analyzer = new FrameAnalyzer({ barCount: BAR_COUNT });
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      const { width, height } = canvas;
      g.clearRect(0, 0, width, height);
      const frame = analyzer.sample(analyserRef.current, nowMs);

      const gap = 1;
      const barWidth = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        const v = frame.bars[i];
        const h = Math.max(2, v * height);
        g.fillStyle = v > 0.02 ? accent : dim;
        g.fillRect(i * (barWidth + gap), height - h, barWidth, h);
      }
    };
    raf = requestAnimationFrame(draw);

    // Nothing to draw for while the tab is hidden; stop burning frames.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [analyserRef]);

  return <canvas ref={canvasRef} className={className} />;
}
