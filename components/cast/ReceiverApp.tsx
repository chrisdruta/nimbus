"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Hls from "hls.js";
import {
  CAST_NAMESPACE,
  STATUS_BEAT_MS,
  TV_PROFILE,
  parseSenderMessage,
  type ReceiverMessage,
  type SenderMessage,
} from "@/lib/cast";
import { buildAudioGraph, type AudioGraph } from "@/lib/audio-graph";
import { loadStreamInto } from "@/lib/stream-load";
import { LEVELER, dbToLinear } from "@/lib/loudness";
import type { QueueTrack } from "@/lib/queue";
import type { StageMode } from "@/lib/stage";
import { SCENE_META } from "@/lib/viz/scene";
import { resolveDsp, resolveSceneSettings } from "@/lib/viz/settings";
import { artworkSized, loadArtworkImage } from "@/lib/artwork";
import { SceneHost } from "@/components/viz/SceneHost";
import { createScene } from "@/components/viz/scenes";
import { useVizTheme } from "@/components/viz/useVizTheme";
import { IconCloud } from "@/components/ui/icons";

const RECEIVER_SDK_URL =
  "https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js";

/** Advance the on-screen boot probe (installed pre-bundle by the page). */
const stage = (s: string) =>
  (
    window as unknown as { __nimbusCastStage?: (s: string) => void }
  ).__nimbusCastStage?.(s);

type Mode =
  | "boot"
  /** ?debug=1 — CAF stubbed; the panel injects messages by hand. */
  | "debug"
  | "cast"
  | "cast-failed";

// All styling on this page is inline, deliberately: the Cast web runtime
// is ~Chrome 87 and cannot parse Tailwind v4's output (oklch, color-mix,
// @layer — Chrome 111+), so the app stylesheet arrives broken here.
// Inline style objects are plain CSS properties and survive anywhere.
const muted = "#9a9aa0";
const fill: CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};
const mono: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
};
const debugButton: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  ...mono,
};

/** Decode-then-swap artwork (no half-loaded pop); plain <img>, no
 * Tailwind. Old-runtime-safe stand-in for CrossfadeArt. */
function ReceiverArt({
  url,
  style,
}: {
  url: string | null;
  style?: CSSProperties;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    let stale = false;
    void loadArtworkImage(url).then((img) => {
      if (!stale) setSrc(img ? artworkSized(url, "t500x500") : null);
    });
    return () => {
      stale = true;
    };
  }, [url]);
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      style={{
        ...fill,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        ...style,
      }}
    />
  );
}

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
  /** RefObject view of the graph's analyser for SceneHost. */
  const analyserRef = useRef<AnalyserNode | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const trackIdRef = useRef<number | null>(null);
  const bufferingRef = useRef(false);
  const sendRef = useRef<(msg: ReceiverMessage) => void>(() => {});

  const [mode, setMode] = useState<Mode>("boot");
  const [track, setTrack] = useState<QueueTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  /** TV stage mode, driven by the sender's scene messages. */
  const [tvMode, setTvMode] = useState<StageMode>("bars");
  const [upNext, setUpNext] = useState<QueueTrack[]>([]);
  const [debugStarted, setDebugStarted] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  /** First fatal error, rendered on screen — a TV has no console, and
   * the platform kills an app whose start() never ran, so this is the
   * only reliable way to see why. */
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    const onError = (e: ErrorEvent) =>
      setFatal((f) => f ?? `${e.message} @ ${e.filename ?? "?"}:${e.lineno ?? 0}`);
    const onRejection = (e: PromiseRejectionEvent) =>
      setFatal((f) => f ?? `unhandled rejection: ${String(e.reason)}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const theme = useVizTheme(track?.artworkUrl ?? null);

  // Scene under the TV profile: house-default tuning, thinner spectrum,
  // capped frame rate, DPR pinned to 1 (SceneHost knobs). The piano
  // keeps its key count — bars there are semitone-aligned.
  const scene = useMemo(
    () => (tvMode === "art" ? null : createScene(tvMode)),
    [tvMode],
  );
  const dsp = useMemo(() => {
    if (tvMode === "art") return undefined;
    const d = resolveDsp(tvMode, null);
    return tvMode === "piano" ? d : { ...d, barCount: TV_PROFILE.barCount };
  }, [tvMode]);
  const visual = useMemo(
    () => (tvMode === "art" ? undefined : resolveSceneSettings(tvMode, null)),
    [tvMode],
  );

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
          if (!graphRef.current) {
            graphRef.current = buildAudioGraph(el);
            analyserRef.current = graphRef.current.analyser;
          }
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
            console.log("[nimbus-cast] playing", msg.trackId);
          } catch (err) {
            console.warn("[nimbus-cast] load failed", msg.trackId, err);
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
          setUpNext([]);
          return;
        case "scene":
          setTvMode(msg.mode);
          return;
        case "upnext":
          setUpNext(msg.tracks);
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
    stage("boot:react");
    // The page's inline script runs before the probe divs are parsed —
    // paint the UA (plus a CSS capability readout: the runtime masks its
    // Chrome version, and the day these flip to y the /cast surface can
    // go back to Tailwind) here instead, where the DOM is complete.
    const ua = document.getElementById("cast-ua-probe");
    if (ua) {
      const sup = (prop: string, val: string) => {
        try {
          return CSS.supports(prop, val) ? "y" : "n";
        } catch {
          return "n";
        }
      };
      const css = `oklch:${sup("color", "oklch(50% 0.1 200)")} mix:${sup(
        "color",
        "color-mix(in oklab, red, blue)",
      )} layer:${"CSSLayerBlockRule" in window ? "y" : "n"}`;
      ua.textContent = `${navigator.userAgent} · ${css}`;
    }
    if (new URLSearchParams(window.location.search).has("debug")) {
      setMode("debug");
      stage("debug");
      sendRef.current = (msg) =>
        setDebugLog((log) => [...log.slice(-19), JSON.stringify(msg)]);
      return;
    }
    const script = document.createElement("script");
    script.src = RECEIVER_SDK_URL;
    script.onload = () => {
      stage("sdk:loaded");
      try {
        initCast();
      } catch (err) {
        setFatal((f) => f ?? `init: ${String(err)}`);
        setMode("cast-failed");
        stage("cast:failed");
      }
    };
    const initCast = () => {
      const cf = (window as { cast?: typeof cast }).cast?.framework;
      if (!cf) {
        setMode("cast-failed");
        return;
      }
      // Defensive constant lookups: this branch only ever runs on real
      // hardware (desktop uses the debug stub), and a missing namespace
      // must not throw before ctx.start() — the platform kills any app
      // whose start never completes.
      const sys = (
        cf as unknown as {
          system?: {
            EventType?: Record<string, string>;
            MessageType?: Record<string, string>;
          };
        }
      ).system;
      const senderConnected = sys?.EventType?.SENDER_CONNECTED ?? "senderconnected";
      const jsonType = sys?.MessageType?.JSON ?? "JSON";
      const ctx = cf.CastReceiverContext.getInstance();
      ctx.addCustomMessageListener(CAST_NAMESPACE, (event) => {
        // Tolerate a string payload — depends on how the platform honors
        // the JSON namespace registration.
        let data = event.data;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch {
            console.warn("[nimbus-cast] unparseable message", event.data);
            return;
          }
        }
        const msg = parseSenderMessage(data);
        // Breadcrumbs for chrome://inspect debugging on real hardware.
        if (msg) {
          console.log("[nimbus-cast] recv", msg.type);
          void handleMessageRef.current(msg);
        } else {
          console.warn("[nimbus-cast] rejected message", data);
        }
      });
      sendRef.current = (msg) => {
        try {
          ctx.sendCustomMessage(CAST_NAMESPACE, undefined, msg);
          if (msg.type !== "status") console.log("[nimbus-cast] sent", msg.type);
        } catch (err) {
          console.warn("[nimbus-cast] send failed", msg.type, err);
        }
      };
      // `ready` gates the sender's handoff, and a broadcast during boot
      // races the channel handshake and gets dropped — announce it to
      // each sender as it actually connects instead (this also covers a
      // second sender joining later).
      try {
        ctx.addEventListener(senderConnected, (event) => {
          console.log("[nimbus-cast] sender connected", event.senderId);
          sendRef.current({ type: "ready" });
        });
      } catch (err) {
        // Lose the re-announce, keep the app alive (3s sender fallback).
        console.warn("[nimbus-cast] sender-connected listener failed", err);
      }
      ctx.start({
        // No PlayerManager LOAD ever happens on this channel — without
        // this, CAF's media-idle reaper would kill the app mid-track.
        // (The app still closes when the last sender disconnects.)
        disableIdleTimeout: true,
        customNamespaces: { [CAST_NAMESPACE]: jsonType },
      });
      console.log("[nimbus-cast] receiver started", CAST_NAMESPACE);
      setMode("cast");
      stage("cast:started");
    };
    script.onerror = () => {
      setFatal((f) => f ?? "cast sdk script failed to load");
      setMode("cast-failed");
      stage("sdk:load-failed");
    };
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
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: "hidden",
        background: theme.background,
        color: "#fff",
        fontFamily: "var(--font-comfortaa), system-ui, sans-serif",
      }}
    >
      {/* blurred-art fill, StageView's art-mode backdrop (dimmer under
          scenes so they keep contrast) */}
      <div style={{ ...fill, overflow: "hidden" }}>
        <ReceiverArt
          url={track?.artworkUrl ?? null}
          style={{
            transform: "scale(1.25)",
            filter: `blur(64px) saturate(1.25) brightness(${
              track && scene ? 0.35 : 0.55
            })`,
          }}
        />
      </div>
      {track && scene && (
        <div style={{ ...fill, background: "rgba(0,0,0,0.4)" }} />
      )}

      {track ? (
        <>
          {scene ? (
            <div
              style={{
                ...fill,
                display: "flex",
                justifyContent: "center",
                paddingTop: 24,
                paddingLeft: 32,
                paddingRight: 32,
                paddingBottom: 110,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: "100%",
                  maxWidth: SCENE_META.find((s) => s.id === tvMode)?.maxWidth,
                }}
              >
                <SceneHost
                  scene={scene}
                  theme={theme}
                  analyserRef={analyserRef}
                  playing={playing}
                  getPositionSec={() => audioRef.current?.currentTime ?? 0}
                  dsp={dsp}
                  visual={visual}
                  maxFps={TV_PROFILE.maxFps}
                  fixedDpr={TV_PROFILE.dpr}
                  style={{ height: "100%", width: "100%" }}
                />
              </div>
            </div>
          ) : (
            <div
              style={{
                ...fill,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                paddingTop: 56,
                paddingBottom: 96,
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "58vmin",
                  height: "58vmin",
                  overflow: "hidden",
                  borderRadius: 12,
                  boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
                  background: "rgba(255,255,255,0.05)",
                }}
              >
                {track.artworkUrl ? (
                  <ReceiverArt url={track.artworkUrl} />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: muted,
                    }}
                  >
                    <IconCloud size={96} />
                  </div>
                )}
              </div>
            </div>
          )}
          <div style={{ position: "absolute", left: 40, bottom: 36 }}>
            <p
              style={{
                margin: 0,
                maxWidth: "55vw",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                fontSize: 30,
                fontWeight: 700,
                textShadow: "0 1px 10px rgba(0,0,0,0.85)",
              }}
            >
              {track.title}
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 18, color: muted }}>
              {track.artist} · on SoundCloud
            </p>
          </div>
          <div
            style={{
              position: "absolute",
              right: 40,
              bottom: 36,
              maxWidth: "38vw",
              textAlign: "right",
              color: muted,
              textShadow: "0 1px 10px rgba(0,0,0,0.85)",
            }}
          >
            {!playing && (
              <p style={{ margin: "0 0 8px", fontSize: 18 }}>paused</p>
            )}
            {upNext.length > 0 && (
              <>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
                  up next
                </p>
                {upNext.map((t) => (
                  <p
                    key={t.id}
                    style={{
                      margin: "2px 0 0",
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      fontSize: 14,
                    }}
                  >
                    {t.title} · {t.artist}
                  </p>
                ))}
              </>
            )}
          </div>
        </>
      ) : (
        <div
          style={{
            ...fill,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            color: muted,
          }}
        >
          <IconCloud size={72} />
          <p
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 700,
              color: "rgba(255,255,255,0.9)",
            }}
          >
            nimbus
          </p>
          <p style={{ margin: 0, fontSize: 14 }}>
            {mode === "cast-failed" ? "cast sdk failed to load" : "ready to cast"}
          </p>
        </div>
      )}

      {fatal && (
        <p
          style={{
            position: "absolute",
            left: 32,
            right: 32,
            top: 24,
            zIndex: 20,
            margin: 0,
            textAlign: "center",
            color: "#f87171",
            textShadow: "0 1px 8px rgba(0,0,0,0.9)",
            ...mono,
            fontSize: 14,
          }}
        >
          {fatal}
        </p>
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
        <div
          style={{
            ...fill,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.7)",
          }}
        >
          <button
            onClick={() => {
              // The user gesture the browser's autoplay policy wants —
              // build the graph here (a TV needs no such gate).
              const el = audioRef.current;
              if (el && !graphRef.current) {
                graphRef.current = buildAudioGraph(el);
                analyserRef.current = graphRef.current.analyser;
              }
              setDebugStarted(true);
            }}
            style={{
              ...debugButton,
              padding: "12px 24px",
              fontSize: 18,
              fontFamily: "inherit",
            }}
          >
            start receiver (debug)
          </button>
        </div>
      )}

      {mode === "debug" && debugStarted && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            width: 320,
            padding: 12,
            borderRadius: 8,
            background: "rgba(0,0,0,0.7)",
            ...mono,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={debugInputRef}
              placeholder="track id"
              style={{
                ...debugButton,
                cursor: "text",
                width: 96,
              }}
            />
            <button onClick={() => void debugLoadTrack()} style={debugButton}>
              load
            </button>
            <button
              onClick={() => void handleMessage({ type: "play" })}
              style={debugButton}
            >
              play
            </button>
            <button
              onClick={() => void handleMessage({ type: "pause" })}
              style={debugButton}
            >
              pause
            </button>
          </div>
          <textarea
            ref={debugJsonRef}
            placeholder='paste a sender message, e.g. {"type":"seek","ms":60000}'
            rows={3}
            style={{ ...debugButton, cursor: "text", resize: "vertical" }}
          />
          <button
            onClick={debugSendJson}
            style={{ ...debugButton, alignSelf: "flex-start" }}
          >
            send message
          </button>
          <div
            style={{
              maxHeight: 160,
              overflowY: "auto",
              color: "rgba(255,255,255,0.6)",
            }}
          >
            {debugLog.map((line, i) => (
              <div
                key={i}
                style={{
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
