"use client";

import { useEffect } from "react";
import { artworkSized } from "@/lib/artwork";
import type { QueueTrack } from "@/lib/queue";

interface MediaSessionOptions {
  current: QueueTrack | null;
  playing: boolean;
  audioEl: () => HTMLAudioElement | null;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
}

/** Lock-screen / media-key integration. No-op where unsupported. */
export function useMediaSession(opts: MediaSessionOptions) {
  const { current, playing } = opts;

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;

    if (current) {
      const art = artworkSized(current.artworkUrl, "t500x500");
      ms.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: "nimbus · SoundCloud",
        artwork: art ? [{ src: art, sizes: "500x500" }] : [],
      });
    }
    ms.playbackState = playing ? "playing" : "paused";

    ms.setActionHandler("play", opts.onPlay);
    ms.setActionHandler("pause", opts.onPause);
    ms.setActionHandler("nexttrack", opts.onNext);
    ms.setActionHandler("previoustrack", opts.onPrev);
    ms.setActionHandler("seekto", (e) => {
      const el = opts.audioEl();
      if (el && e.seekTime !== undefined) el.currentTime = e.seekTime;
    });
    return () => {
      for (const a of ["play", "pause", "nexttrack", "previoustrack", "seekto"] as const) {
        ms.setActionHandler(a, null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, playing]);

  // Position state keeps OS scrubbers honest.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const el = opts.audioEl();
    if (!el) return;
    const update = () => {
      if (!Number.isFinite(el.duration)) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: el.duration,
          playbackRate: el.playbackRate,
          position: Math.min(el.currentTime, el.duration),
        });
      } catch {
        // stale values race track changes; harmless
      }
    };
    el.addEventListener("durationchange", update);
    el.addEventListener("seeked", update);
    return () => {
      el.removeEventListener("durationchange", update);
      el.removeEventListener("seeked", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
}
