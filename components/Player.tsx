"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Visualizer from "./Visualizer";

interface Track {
  id: number;
  title: string;
  artist: string;
  artistUrl: string;
  artworkUrl: string | null;
  permalinkUrl: string;
  durationMs: number;
  streamable: boolean;
}

/**
 * Spike player. One persistent analyzed <audio crossorigin="anonymous">:
 * a media element can ever be bound to only one MediaElementSourceNode, and
 * a graph-attached element with cross-origin (non-CORS) media is silenced —
 * so if the CDN blocks CORS loads we fall back to a second, never-analyzed
 * element to still validate plain playback.
 */
export default function Player() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [protocol, setProtocol] = useState<string | null>(null);
  const [loadBlocked, setLoadBlocked] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const mainRef = useRef<HTMLAudioElement>(null);
  const fallbackRef = useRef<HTMLAudioElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const loadBlockedRef = useRef(false);
  const currentRef = useRef<number | null>(null);
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;

  useEffect(() => {
    fetch("/api/likes")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? res.status);
        const { tracks } = (await res.json()) as { tracks: Track[] };
        setTracks(tracks);
      })
      .catch((err) => setLoadError(`could not load likes: ${err.message}`));
  }, []);

  // First play gesture: build the analysis graph on the main element.
  const ensureGraph = useCallback(() => {
    const el = mainRef.current;
    if (!el || ctxRef.current) {
      void ctxRef.current?.resume();
      return;
    }
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(el);
    const node = ctx.createAnalyser();
    node.fftSize = 256;
    source.connect(node);
    node.connect(ctx.destination);
    ctxRef.current = ctx;
    setAnalyser(node);
    void ctx.resume();
  }, []);

  const activeEl = useCallback(
    () => (loadBlockedRef.current ? fallbackRef.current : mainRef.current),
    [],
  );

  const playIndex = useCallback(
    async (index: number) => {
      const track = tracksRef.current[index];
      if (!track) return;
      setPlayError(null);
      const res = await fetch(`/api/tracks/${track.id}/play`);
      if (!res.ok) {
        setPlayError(`stream resolution failed for "${track.title}"`);
        return;
      }
      const stream = (await res.json()) as { url: string; protocol: string };
      setProtocol(stream.protocol);
      setCurrent(index);
      currentRef.current = index;
      if (!loadBlockedRef.current) ensureGraph();
      const el = activeEl();
      if (!el) return;
      el.src = stream.url;
      try {
        await el.play();
        setPlaying(true);
      } catch (err) {
        setPlayError(`playback failed: ${err}`);
      }
    },
    [activeEl, ensureGraph],
  );

  // CORS diagnostic, failure mode 1: with crossorigin="anonymous", a CDN
  // response without CORS headers fails the media load outright.
  const onMainError = useCallback(() => {
    const el = mainRef.current;
    console.error("main <audio> error", el?.error?.code, el?.error?.message);
    if (!loadBlockedRef.current && currentRef.current !== null) {
      loadBlockedRef.current = true;
      setLoadBlocked(true);
      void playIndex(currentRef.current); // revalidate via fallback element
    } else {
      setPlayError("track failed to load even without CORS mode");
      setPlaying(false);
    }
  }, [playIndex]);

  const onEnded = useCallback(() => {
    const next = ((currentRef.current ?? -1) + 1) % tracksRef.current.length;
    void playIndex(next); // spike goal 6: transition through the same element
  }, [playIndex]);

  const togglePlay = useCallback(() => {
    const el = activeEl();
    if (!el || currentRef.current === null) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }, [activeEl]);

  const track = current !== null ? tracks[current] : null;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "1rem" }}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={mainRef} crossOrigin="anonymous" onError={onMainError} onEnded={onEnded} />
      <audio ref={fallbackRef} onEnded={onEnded} />

      <Visualizer
        analyser={analyser}
        audioEl={mainRef.current}
        loadBlocked={loadBlocked}
        protocol={protocol}
      />

      {track && (
        <div
          style={{
            background: "var(--bg-bar)",
            borderRadius: 8,
            padding: "0.75rem 1rem",
            margin: "1rem 0",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <button
            onClick={togglePlay}
            style={{
              background: "var(--accent)",
              color: "#fff",
              border: 0,
              borderRadius: "50%",
              width: 44,
              height: 44,
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <div style={{ minWidth: 0 }}>
            {/* SoundCloud attribution: track and creator link back to source */}
            <a href={track.permalinkUrl} target="_blank" rel="noreferrer">
              {track.title}
            </a>
            <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              <a href={track.artistUrl} target="_blank" rel="noreferrer">
                {track.artist}
              </a>{" "}
              · on{" "}
              <a href={track.permalinkUrl} target="_blank" rel="noreferrer">
                SoundCloud
              </a>
            </div>
          </div>
        </div>
      )}

      {(loadError ?? playError) && (
        <p style={{ color: "var(--accent)" }}>{loadError ?? playError}</p>
      )}

      <ol style={{ listStyle: "none", display: "grid", gap: 4 }}>
        {tracks.map((t, i) => (
          <li key={t.id}>
            <button
              onClick={() => void playIndex(i)}
              disabled={!t.streamable}
              style={{
                width: "100%",
                textAlign: "left",
                background: i === current ? "var(--bg-elem)" : "transparent",
                color: t.streamable ? "var(--text-primary)" : "var(--text-secondary)",
                border: 0,
                borderRadius: 4,
                padding: "0.5rem 0.75rem",
                cursor: t.streamable ? "pointer" : "default",
              }}
            >
              {t.title}
              <span style={{ color: "var(--text-secondary)" }}>
                {" — "}
                {t.artist}
                {!t.streamable && " (not streamable)"}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {tracks.length === 0 && !loadError && (
        <p style={{ color: "var(--text-secondary)" }}>loading likes…</p>
      )}
    </div>
  );
}
