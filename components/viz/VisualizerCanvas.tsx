"use client";

import { useEffect, useRef } from "react";
import { usePlayerRefs } from "@/components/player/PlayerProvider";

function themeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/**
 * Frequency bars from the shared AnalyserNode. "mini" lives in the media
 * bar; "full" fills whatever box its parent gives it (DPR-aware).
 */
export function VisualizerCanvas({
  variant,
  className = "",
}: {
  variant: "mini" | "full";
  className?: string;
}) {
  const { analyserRef } = usePlayerRefs();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;

    const accent = themeColor("--color-accent", "#ff4200");
    const dim = themeColor("--color-elem", "#404040");
    let raf = 0;
    let data: Uint8Array<ArrayBuffer> | null = null;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const analyser = analyserRef.current;
      const { width, height } = canvas;
      g.clearRect(0, 0, width, height);
      if (!analyser) return;
      if (!data || data.length !== analyser.frequencyBinCount) {
        data = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(data);

      // Drop the top eighth of bins — mostly dead air above ~16 kHz.
      const bins = Math.floor(data.length * 0.875);
      const barCount = variant === "mini" ? 24 : 96;
      const perBar = Math.max(1, Math.floor(bins / barCount));
      const gap = variant === "mini" ? 1 : 2;
      const barWidth = (width - gap * (barCount - 1)) / barCount;

      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < perBar; j++) sum += data[i * perBar + j];
        const v = sum / perBar / 255;
        const h = Math.max(variant === "mini" ? 2 : 3, v * height);
        g.fillStyle = v > 0.02 ? accent : dim;
        g.globalAlpha = variant === "full" ? 0.55 + v * 0.45 : 1;
        g.fillRect(i * (barWidth + gap), height - h, barWidth, h);
      }
      g.globalAlpha = 1;
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [analyserRef, variant]);

  return <canvas ref={canvasRef} className={className} />;
}
