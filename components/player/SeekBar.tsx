"use client";

import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/Slider";
import { formatDuration } from "@/lib/format";
import { usePlayerActions, usePlayerRefs, usePlayerState } from "./PlayerProvider";

/** Subscribes to the active playhead directly (positionMsNow reads the
 * audio element, or extrapolated cast status while casting) — playback
 * progress never re-renders anything above this component. */
export function SeekBar() {
  const { audioRef, positionMsNow } = usePlayerRefs();
  const { current, playing, caps } = usePlayerState();
  const actions = usePlayerActions();
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const scrubRef = useRef<number | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    let raf = 0;
    const tick = () => {
      if (scrubRef.current === null) setTime(positionMsNow() / 1000);
      raf = requestAnimationFrame(tick);
    };
    // While casting the local element has no metadata — the track's own
    // duration is the fallback either way.
    const onDuration = () =>
      setDuration(
        Number.isFinite(el.duration) && el.duration > 0
          ? el.duration
          : (current?.durationMs ?? 0) / 1000,
      );
    onDuration();
    el.addEventListener("durationchange", onDuration);
    if (playing) raf = requestAnimationFrame(tick);
    else setTime(positionMsNow() / 1000);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("durationchange", onDuration);
    };
  }, [audioRef, positionMsNow, playing, current]);

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
        disabled={!caps.canSeek}
        onScrub={(v) => {
          scrubRef.current = v;
          forceRender((n) => n + 1);
        }}
        onCommit={(v) => {
          scrubRef.current = null;
          actions.seekTo(v * 1000);
          setTime(v);
        }}
      />
      <span className="w-10 text-xs tabular-nums text-muted">
        {formatDuration(duration * 1000)}
      </span>
    </div>
  );
}
