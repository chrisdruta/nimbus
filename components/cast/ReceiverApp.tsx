"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  CAST_NAMESPACE,
  STATUS_BEAT_MS,
  parseSenderMessage,
  type ReceiverMessage,
  type SenderMessage,
} from "@/lib/cast";
import { buildAudioGraph, type AudioGraph } from "@/lib/audio-graph";
import { loadStreamInto } from "@/lib/stream-load";
import { LEVELER, dbToLinear } from "@/lib/loudness";
import type { QueueTrack } from "@/lib/queue";
import { CrossfadeArt } from "@/components/art/CrossfadeArt";
import { useVizTheme } from "@/components/viz/useVizTheme";
import { IconCloud } from "@/components/ui/icons";

const RECEIVER_SDK_URL =
  "https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js";

type Mode =
  | "boot"
  /** ?debug=1 — CAF stubbed; the panel injects messages by hand. */
  | "debug"
  | "cast"
  | "cast-failed";

/**
 * The TV-side app: a plain audio element + the shared audio graph and
 * stream loader, with CAF used only for session lifetime and the custom
 * message channel (the fully-custom-pipeline decision — see
 * docs/plans/cast-to-tv.md). The sender owns the queue; this page plays
 * exactly one URL at a time and reports status back. M-a renders the
 * art-mode stage; scenes arrive with the TV profile in M-b.
 */
export function ReceiverApp() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const trackIdRef = useRef<number | null>(null);
  const bufferingRef = useRef(false);
  const sendRef = useRef<(msg: ReceiverMessage) => void>(() => {});

  const [mode, setMode] = useState<Mode>("boot");
  const [track, setTrack] = useState<QueueTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [debugStarted, setDebugStarted] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const theme = useVizTheme(track?.artworkUrl ?? null);

  const sendToSender = useCallback((msg: ReceiverMessage) => {
    sendRef.current(msg);
  }, []);

  /** One status beat from current element truth (no-op until loaded). */
  const beat = useCallback(() => {
    const el = audioRef.current;
    const id = trackIdRef.current;
    if (!el || id === null) return;
    sendToSender({
      type: "status",
      trackId: id,
      positionMs: Math.max(0, Math.floor(el.currentTime * 1000)),
      playing: !el.paused && !el.ended,
      buffering: bufferingRef.current,
    });
  }, [sendToSender]);

  useEffect(() => {
    const iv = setInterval(beat, STATUS_BEAT_MS);
    return () => clearInterval(iv);
  }, [beat]);

  const handleMessage = useCallback(
    async (msg: SenderMessage) => {
      const el = audioRef.current;
      if (!el) return;
      switch (msg.type) {
        case "load": {
          // Chromecast has no autoplay gate, so the graph can be born on
          // the first load; the debug harness builds it on its start
          // gesture instead.
          if (!graphRef.current) graphRef.current = buildAudioGraph(el);
          const g = graphRef.current;
          void g.ctx.resume();
          // The sender's cached loudness rides the load message — this
          // side has no measurement history of its own.
          const gainDb = Math.min(
            LEVELER.maxGainDb,
            Math.max(LEVELER.minGainDb, msg.gainDb),
          );
          g.gain.gain.setTargetAtTime(
            dbToLinear(gainDb),
            g.ctx.currentTime,
            0.05,
          );
          trackIdRef.current = msg.trackId;
          bufferingRef.current = false;
          setTrack(msg.track);
          hlsRef.current?.destroy();
          hlsRef.current = null;
          let loaded = false;
          try {
            await loadStreamInto(el, msg, (hls) => {
              hlsRef.current = hls;
              // Post-load fatal errors (signed URL expiring mid-track)
              // never reach the element's error event under hls.js.
              hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal && loaded && trackIdRef.current === msg.trackId) {
                  sendToSender({
                    type: "error",
                    trackId: msg.trackId,
                    code: "stall",
                  });
                }
              });
            });
            loaded = true;
            if (trackIdRef.current !== msg.trackId) return; // superseded
            if (msg.positionMs > 1_000) el.currentTime = msg.positionMs / 1000;
            await el.play();
          } catch {
            if (trackIdRef.current === msg.trackId) {
              sendToSender({ type: "error", trackId: msg.trackId, code: "load" });
            }
          }
          return;
        }
        case "play":
          void el.play().catch(() => {});
          return;
        case "pause":
          el.pause();
          return;
        case "seek":
          if (el.src || hlsRef.current) el.currentTime = msg.ms / 1000;
          return;
        case "stop":
          hlsRef.current?.destroy();
          hlsRef.current = null;
          el.pause();
          el.removeAttribute("src");
          el.load();
          trackIdRef.current = null;
          bufferingRef.current = false;
          setTrack(null);
          setPlaying(false);
          return;
      }
    },
    [sendToSender],
  );
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  // Boot: debug harness on ?debug=1, otherwise load the CAF SDK and open
  // the custom channel.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("debug")) {
      setMode("debug");
      sendRef.current = (msg) =>
        setDebugLog((log) => [...log.slice(-19), JSON.stringify(msg)]);
      return;
    }
    const script = document.createElement("script");
    script.src = RECEIVER_SDK_URL;
    script.onload = () => {
      const cf = (window as { cast?: typeof cast }).cast?.framework;
      if (!cf) {
        setMode("cast-failed");
        return;
      }
      const ctx = cf.CastReceiverContext.getInstance();
      ctx.addCustomMessageListener(CAST_NAMESPACE, (event) => {
        const msg = parseSenderMessage(event.data);
        if (msg) void handleMessageRef.current(msg);
      });
      ctx.start({
        // No PlayerManager LOAD ever happens on this channel — without
        // this, CAF's media-idle reaper would kill the app mid-track.
        // (The app still closes when the last sender disconnects.)
        disableIdleTimeout: true,
        customNamespaces: { [CAST_NAMESPACE]: cf.system.MessageType.JSON },
      });
      sendRef.current = (msg) => {
        try {
          ctx.sendCustomMessage(CAST_NAMESPACE, undefined, msg);
        } catch {
          // channel not up yet — beats self-correct
        }
      };
      setMode("cast");
      // The sender holds its handoff until the channel is provably open.
      sendRef.current({ type: "ready" });
    };
    script.onerror = () => setMode("cast-failed");
    document.head.appendChild(script);
  }, []);

  // ------------------------------------------------------- debug harness

  const debugInputRef = useRef<HTMLInputElement | null>(null);
  const debugJsonRef = useRef<HTMLTextAreaElement | null>(null);

  const debugLoadTrack = useCallback(async () => {
    const id = Number(debugInputRef.current?.value);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    // Same-origin with the dev session's cookie — the normal quota path.
    const res = await fetch(`/api/tracks/${id}/play`, { method: "POST" });
    if (!res.ok) {
      setDebugLog((log) => [...log.slice(-19), `resolve failed ${res.status}`]);
      return;
    }
    const { url, protocol } = (await res.json()) as {
      url: string;
      protocol: string;
    };
    const msg = parseSenderMessage({
      type: "load",
      trackId: id,
      url,
      protocol,
      positionMs: 0,
      gainDb: 0,
      track: {
        id,
        title: `track ${id}`,
        artist: "debug",
        artistUrl: "https://soundcloud.com/discover",
        artworkUrl: null,
        permalinkUrl: "https://soundcloud.com/discover",
        durationMs: 0,
      },
    });
    if (msg) void handleMessage(msg);
    else setDebugLog((log) => [...log.slice(-19), "load message invalid"]);
  }, [handleMessage]);

  const debugSendJson = useCallback(() => {
    let data: unknown;
    try {
      data = JSON.parse(debugJsonRef.current?.value ?? "");
    } catch {
      setDebugLog((log) => [...log.slice(-19), "bad json"]);
      return;
    }
    const msg = parseSenderMessage(data);
    if (msg) void handleMessage(msg);
    else setDebugLog((log) => [...log.slice(-19), "message rejected"]);
  }, [handleMessage]);

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ background: theme.background }}
    >
      {/* blurred-art fill, StageView's art-mode backdrop */}
      <div className="absolute inset-0 overflow-hidden">
        <CrossfadeArt
          url={track?.artworkUrl ?? null}
          durationMs={1200}
          className="scale-125 object-cover blur-3xl saturate-125 brightness-[0.55]"
        />
      </div>

      {track ? (
        <>
          <div className="absolute inset-0 flex items-center justify-center pt-16 pb-24">
            <div className="relative aspect-square h-[min(62vmin,100%)] overflow-hidden rounded-xl shadow-2xl">
              {track.artworkUrl ? (
                <CrossfadeArt
                  url={track.artworkUrl}
                  durationMs={800}
                  className="object-contain"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-white/5 text-muted">
                  <IconCloud size={96} />
                </div>
              )}
            </div>
          </div>
          <div className="absolute bottom-10 left-10">
            <p className="max-w-[70vw] truncate text-3xl font-bold">
              {track.title}
            </p>
            <p className="mt-1 text-lg text-muted">
              {track.artist} · on SoundCloud
            </p>
          </div>
          {!playing && (
            <p className="absolute right-10 bottom-10 text-lg text-muted">
              paused
            </p>
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted">
          <IconCloud size={72} />
          <p className="text-2xl font-bold text-white/90">nimbus</p>
          <p className="text-sm">
            {mode === "cast-failed" ? "cast sdk failed to load" : "ready to cast"}
          </p>
        </div>
      )}

      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        onPlay={() => {
          setPlaying(true);
          beat();
        }}
        onPause={() => {
          setPlaying(false);
          beat();
        }}
        onWaiting={() => {
          bufferingRef.current = true;
          beat();
        }}
        onPlaying={() => {
          bufferingRef.current = false;
          beat();
        }}
        onSeeked={beat}
        onEnded={() => {
          const id = trackIdRef.current;
          setPlaying(false);
          if (id !== null) sendToSender({ type: "ended", trackId: id });
        }}
        onError={() => {
          const id = trackIdRef.current;
          if (id !== null && (audioRef.current?.src || hlsRef.current)) {
            sendToSender({ type: "error", trackId: id, code: "stall" });
          }
        }}
      />

      {mode === "debug" && !debugStarted && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
          <button
            onClick={() => {
              // The user gesture the browser's autoplay policy wants —
              // build the graph here (a TV needs no such gate).
              const el = audioRef.current;
              if (el && !graphRef.current) graphRef.current = buildAudioGraph(el);
              setDebugStarted(true);
            }}
            className="cursor-pointer rounded-lg border border-white/20 px-6 py-3 text-lg hover:border-white/50"
          >
            start receiver (debug)
          </button>
        </div>
      )}

      {mode === "debug" && debugStarted && (
        <div className="absolute top-4 right-4 z-10 flex w-80 flex-col gap-2 rounded-lg bg-black/70 p-3 text-xs backdrop-blur">
          <div className="flex gap-2">
            <input
              ref={debugInputRef}
              placeholder="track id"
              className="w-24 rounded border border-white/20 bg-transparent px-2 py-1"
            />
            <button
              onClick={() => void debugLoadTrack()}
              className="cursor-pointer rounded border border-white/20 px-2 py-1 hover:border-white/50"
            >
              load
            </button>
            <button
              onClick={() => void handleMessage({ type: "play" })}
              className="cursor-pointer rounded border border-white/20 px-2 py-1 hover:border-white/50"
            >
              play
            </button>
            <button
              onClick={() => void handleMessage({ type: "pause" })}
              className="cursor-pointer rounded border border-white/20 px-2 py-1 hover:border-white/50"
            >
              pause
            </button>
          </div>
          <textarea
            ref={debugJsonRef}
            placeholder='paste a sender message, e.g. {"type":"seek","ms":60000}'
            rows={3}
            className="rounded border border-white/20 bg-transparent px-2 py-1 font-mono"
          />
          <button
            onClick={debugSendJson}
            className="cursor-pointer self-start rounded border border-white/20 px-2 py-1 hover:border-white/50"
          >
            send message
          </button>
          <div className="max-h-40 overflow-y-auto font-mono text-white/60">
            {debugLog.map((line, i) => (
              <div key={i} className="truncate">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
