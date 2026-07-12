"use client";

import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/Slider";
import { formatDuration } from "@/lib/format";
import { usePlayerRefs, usePlayerState } from "./PlayerProvider";

/** Subscribes to the audio element directly — playback progress never
 * re-renders anything above this component. */
export function SeekBar() {
  const { audioRef } = usePlayerRefs();
  const { current, playing } = usePlayerState();
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const scrubRef = useRef<number | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    let raf = 0;
    const tick = () => {
      if (scrubRef.current === null) setTime(el.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const onDuration = () =>
      setDuration(
        Number.isFinite(el.duration) && el.duration > 0
          ? el.duration
          : (current?.durationMs ?? 0) / 1000,
      );
    onDuration();
    el.addEventListener("durationchange", onDuration);
    if (playing) raf = requestAnimationFrame(tick);
    else setTime(el.currentTime);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("durationchange", onDuration);
    };
  }, [audioRef, playing, current]);

  const shown = scrubRef.current ?? time;

  return (
    <div className="flex w-full items-center gap-2">
      <span className="w-10 text-right text-xs tabular-nums text-muted">
        {formatDuration(shown * 1000)}
      </span>
      <Slider
        value={shown}
        max={duration || 1}
        step={5}
        ariaLabel="seek"
        className="flex-1"
        onScrub={(v) => {
          scrubRef.current = v;
          forceRender((n) => n + 1);
        }}
        onCommit={(v) => {
          scrubRef.current = null;
          const el = audioRef.current;
          if (el) el.currentTime = v;
          setTime(v);
        }}
      />
      <span className="w-10 text-xs tabular-nums text-muted">
        {formatDuration(duration * 1000)}
      </span>
    </div>
  );
}
