"use client";

import { useEffect, useRef, useState } from "react";

type Verdict = "pending" | "ok" | "tainted";

/**
 * Canvas bar graph from AnalyserNode data, plus the spike's key diagnostic:
 * can Web Audio actually see SoundCloud CDN audio, or does CORS block it?
 * Failure mode 1 (load blocked) is detected by the Player; failure mode 2
 * (element loads but the graph is silenced/tainted) is detected here when
 * playback advances while the analyser stays all-zero.
 */
export default function Visualizer({
  analyser,
  audioEl,
  loadBlocked,
  protocol,
}: {
  analyser: AnalyserNode | null;
  audioEl: HTMLAudioElement | null;
  loadBlocked: boolean;
  protocol: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [verdict, setVerdict] = useState<Verdict>("pending");
  const verdictRef = useRef<Verdict>("pending");

  useEffect(() => {
    if (!analyser) return;
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;

    const loop = () => {
      analyser.getByteFrequencyData(data);
      g.fillStyle = "#282828";
      g.fillRect(0, 0, canvas.width, canvas.height);
      const barWidth = canvas.width / data.length;
      let max = 0;
      g.fillStyle = "#ff4200";
      data.forEach((v, i) => {
        if (v > max) max = v;
        const h = (v / 255) * canvas.height;
        g.fillRect(i * barWidth, canvas.height - h, barWidth - 1, h);
      });

      if (verdictRef.current === "pending" && audioEl && !audioEl.paused) {
        if (max > 0) {
          verdictRef.current = "ok";
          setVerdict("ok");
          console.log("CORS OK: analyser sees frequency data");
        } else if (audioEl.currentTime > 2) {
          verdictRef.current = "tainted";
          setVerdict("tainted");
          console.error("CORS FAIL (tainted): playback advances, analyser silent");
        }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [analyser, audioEl]);

  const badge = loadBlocked
    ? { text: "CORS FAIL — load blocked with crossorigin; playing unanalyzed fallback", color: "#c0392b" }
    : verdict === "tainted"
      ? { text: "CORS FAIL — media loads but analyser is silent (tainted)", color: "#c0392b" }
      : verdict === "ok"
        ? { text: "CORS OK — Web Audio analysis works", color: "#1e8449" }
        : { text: "CORS verdict pending — play a track", color: "var(--bg-elem)" };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={608}
        height={120}
        style={{ width: "100%", borderRadius: 8, background: "var(--bg-bar)" }}
      />
      <p
        style={{
          display: "inline-block",
          background: badge.color,
          borderRadius: 4,
          padding: "0.25rem 0.6rem",
          marginTop: 8,
          fontSize: 13,
        }}
      >
        {badge.text}
        {protocol && ` · stream: ${protocol}`}
        {protocol === "hls" &&
          " (bare <audio> may not play HLS in Chromium — record this)"}
      </p>
    </div>
  );
}
