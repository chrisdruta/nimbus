"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SceneHost } from "./SceneHost";
import { ScenePicker } from "./ScenePicker";
import { createScene } from "./scenes";
import { useVizTheme } from "./useVizTheme";
import { extractPalette, loadArtworkImage } from "@/lib/artwork";
import { CrossfadeArt } from "@/components/art/CrossfadeArt";
import { cycleStageMode, isStageMode, STAGE_META, type StageMode } from "@/lib/stage";
import { SCENE_META } from "@/lib/viz/scene";
import { SceneSettings } from "./SceneSettings";
import {
  isSceneSettingsPayload,
  resolveDsp,
  resolveSceneSettings,
  type ArtSettings,
  type SceneSettingsPayload,
} from "@/lib/viz/settings";
import type { TrackShape } from "@/lib/viz/trackshape";

// Track shapes are immutable per track — cache for the page lifetime.
// null means "fetched, provider has none"; absent means "not fetched yet".
const shapeCache = new Map<number, TrackShape | null>();
import {
  IconCloud,
  IconCollapse,
  IconExpand,
  IconX,
} from "@/components/ui/icons";
import { readPref, writePref } from "@/lib/prefs";
import { usePlayerActions, usePlayerState } from "@/components/player/PlayerProvider";

const CHROME_HIDE_MS = 2500;

/**
 * The stage: pure-artwork "art" mode plus the viz scenes, all over the
 * current track's blurred artwork. Rendered by AppShell as an overlay on
 * the main content area — the shell (sidebar, queue, media bar) stays.
 * Scenes paint on transparency; this owns the backdrop layers beneath.
 */
export function StageView() {
  const { stageOpen, current } = usePlayerState();
  const actions = usePlayerActions();
  const theme = useVizTheme(current?.artworkUrl ?? null);

  const [mode, setMode] = useState<StageMode>(
    () =>
      readPref("stageMode", isStageMode) ??
      // pre-stage sessions stored their scene under vizScene
      readPref("vizScene", isStageMode) ??
      "art",
  );
  const scene = useMemo(
    () => (mode === "art" ? null : createScene(mode)),
    [mode],
  );

  // Scene-name flash on mode change: big lowercase label, fades on its
  // own via the stage-flash animation (keyed by nonce to restart).
  const [flash, setFlash] = useState<{ label: string; n: number } | null>(
    null,
  );
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const selectMode = useCallback((id: StageMode) => {
    if (id !== modeRef.current) {
      const label = STAGE_META.find((s) => s.id === id)?.label ?? id;
      setFlash((f) => ({ label, n: (f?.n ?? 0) + 1 }));
    }
    setMode(id);
    writePref("stageMode", id);
  }, []);

  // Per-scene tuning: presets + advanced overrides, persisted as one
  // versioned payload.
  const [settings, setSettings] = useState<SceneSettingsPayload | null>(() =>
    readPref("sceneSettings", isSceneSettingsPayload),
  );
  const changeSettings = useCallback((next: SceneSettingsPayload) => {
    setSettings(next);
    writePref("sceneSettings", next);
  }, []);
  const [tuneOpen, setTuneOpen] = useState(false);
  const tuneOpenRef = useRef(tuneOpen);
  tuneOpenRef.current = tuneOpen;
  const dsp = useMemo(
    () => (mode === "art" ? undefined : resolveDsp(mode, settings)),
    [mode, settings],
  );
  const visual = useMemo(
    () => resolveSceneSettings(mode, settings),
    [mode, settings],
  );
  // The popover follows the active mode across switches; it only closes
  // when the stage itself does.
  useEffect(() => {
    if (!stageOpen) setTuneOpen(false);
  }, [stageOpen]);

  // Navigation happens under the overlay (sidebar links stay clickable),
  // so a route change closes the stage — otherwise the page you asked
  // for loads invisibly behind it.
  const pathname = usePathname();
  const prevPathname = useRef(pathname);
  useEffect(() => {
    if (pathname !== prevPathname.current) {
      prevPathname.current = pathname;
      actions.closeStage();
    }
  }, [pathname, actions]);

  // True browser fullscreen on the stage element itself — the shell
  // (sidebar, queue, media bar) stays behind, so this is the only way to
  // get the stage edge-to-edge on a monitor.
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen().catch(() => {});
  }, []);

  // Chrome (picker, track meta, hints) shows on pointer activity and
  // hides after a quiet spell — unless the tuning panel is open (hiding
  // it mid-drag would yank the slider away).
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pokeChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!tuneOpenRef.current) setChromeVisible(false);
    }, CHROME_HIDE_MS);
  }, []);

  // Whole-track lookahead: fetch the current track's waveform shape while
  // the stage is open. Absence (fetch failed, provider has none) is fine —
  // scenes render identically without it.
  const [shape, setShape] = useState<TrackShape | null>(null);
  useEffect(() => {
    if (!stageOpen || !current) {
      setShape(null);
      return;
    }
    const id = current.id;
    const cached = shapeCache.get(id);
    if (cached !== undefined) {
      setShape(cached);
      return;
    }
    setShape(null);
    const ctrl = new AbortController();
    fetch(`/api/tracks/${id}/waveform`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : { shape: null }))
      .then((data: { shape?: TrackShape | null }) => {
        const s = data.shape ?? null;
        shapeCache.set(id, s);
        if (!ctrl.signal.aborted) setShape(s);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [stageOpen, current]);

  // Warm palettes + artwork for what's next so a track change swaps the
  // scene's colors immediately instead of lingering on the old theme
  // while the new art downloads.
  useEffect(() => {
    if (!stageOpen) return;
    for (const t of actions.upcomingTracks(3)) {
      void extractPalette(t.artworkUrl);
      void loadArtworkImage(t.artworkUrl);
    }
  }, [stageOpen, current, actions]);

  // Entry points steer the opening mode by writing the pref first (the
  // artwork thumb forces "art"), so re-read it on every open.
  useEffect(() => {
    if (!stageOpen) return;
    const preferred = readPref("stageMode", isStageMode);
    if (preferred) setMode(preferred);
  }, [stageOpen]);

  useEffect(() => {
    if (!stageOpen) return;
    pokeChrome(); // visible on open, then start the idle countdown

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Esc peels layers: tuning drawer, then browser fullscreen
        // (which owns the key), then the stage itself.
        if (tuneOpenRef.current) {
          setTuneOpen(false);
          pokeChrome();
          return;
        }
        if (document.fullscreenElement) return;
        actions.closeStage();
        return;
      }
      if (e.key === "ArrowRight") {
        selectMode(cycleStageMode(mode, 1));
        pokeChrome();
      } else if (e.key === "ArrowLeft") {
        selectMode(cycleStageMode(mode, -1));
        pokeChrome();
      } else if (/^[1-6]$/.test(e.key)) {
        const meta = STAGE_META[Number(e.key) - 1];
        if (meta) {
          selectMode(meta.id);
          pokeChrome();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [stageOpen, mode, actions, selectMode, pokeChrome]);

  if (!stageOpen) return null;

  // Chrome shows fast and breathes away slowly; the bottom clusters get
  // a slight downward drift on top of the fade.
  const chrome = `transition-opacity ${
    chromeVisible
      ? "opacity-100 duration-200"
      : "pointer-events-none opacity-0 duration-1000"
  }`;
  const chromeDrift = `transition-[opacity,transform] ${
    chromeVisible
      ? "translate-y-0 opacity-100 duration-200"
      : "pointer-events-none motion-safe:translate-y-1 opacity-0 duration-1000"
  }`;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-20 overflow-hidden"
      style={{ background: theme.background }}
      onMouseMove={pokeChrome}
      onTouchStart={pokeChrome}
    >
      {/* Blurred-art fill; dimmer under scenes so they keep contrast. */}
      <div className="absolute inset-0 overflow-hidden">
        <CrossfadeArt
          url={current?.artworkUrl ?? null}
          durationMs={1200}
          className={`scale-125 object-cover blur-3xl saturate-125 ${
            mode === "art" ? "brightness-[0.55]" : "brightness-[0.35]"
          }`}
        />
      </div>
      {mode !== "art" && <div className="absolute inset-0 bg-black/40" />}

      {mode === "art" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={`relative aspect-square h-[min(70vmin,calc(100%-8rem))] overflow-hidden rounded-xl shadow-2xl ${
              (visual as ArtSettings).breathe
                ? "motion-safe:animate-[stage-breathe_14s_ease-in-out_infinite_alternate]"
                : ""
            }`}
          >
            {current?.artworkUrl ? (
              <CrossfadeArt
                url={current.artworkUrl}
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
      ) : (
        scene && (
          // Absolute so the canvas paints above the (absolute) backdrop
          // layers — in-flow elements would composite beneath them. Scenes
          // with a maxWidth render as a centered column; the backdrop
          // stays full-bleed, so the insets read as margin (extra at the
          // bottom keeps floor-anchored scenes off the media-bar border).
          <div className="absolute inset-0 flex justify-center px-4 pt-6 pb-8">
            <div
              className="h-full w-full"
              style={{
                maxWidth: SCENE_META.find((s) => s.id === mode)?.maxWidth,
              }}
            >
              <SceneHost
                scene={scene}
                theme={theme}
                dsp={dsp}
                visual={visual}
                trackShape={
                  current ? { shape, durationMs: current.durationMs } : undefined
                }
                className="h-full w-full"
              />
            </div>
          </div>
        )
      )}

      {/* window controls, paired top-right */}
      <div className={`absolute top-6 right-6 flex items-center gap-2 ${chrome}`}>
        <button
          aria-label={isFullscreen ? "exit full screen" : "full screen"}
          title={isFullscreen ? "exit full screen" : "full screen"}
          onClick={toggleFullscreen}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-black/25 text-muted backdrop-blur-sm transition hover:bg-black/50 hover:text-white"
        >
          {isFullscreen ? <IconCollapse size={15} /> : <IconExpand size={15} />}
        </button>
        <button
          aria-label="close stage"
          title="close stage"
          onClick={() => actions.closeStage()}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-black/25 text-muted backdrop-blur-sm transition hover:bg-black/50 hover:text-white"
        >
          <IconX size={16} />
        </button>
      </div>

      {/* top-left track meta */}
      {current && (
        <div className={`absolute top-6 left-6 ${chrome}`}>
          <a
            href={current.permalinkUrl}
            target="_blank"
            rel="noreferrer"
            className="block max-w-[60vw] truncate text-2xl font-bold hover:underline"
          >
            {current.title}
          </a>
          <p className="mt-1 text-muted">
            {current.artistId ? (
              // Navigating happens under the overlay — close the stage so
              // the artist page is actually visible.
              <Link
                href={`/artists/${current.artistId}`}
                onClick={() => actions.closeStage()}
                className="hover:text-white hover:underline"
              >
                {current.artist}
              </Link>
            ) : (
              <a
                href={current.artistUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-white hover:underline"
              >
                {current.artist}
              </a>
            )}{" "}
            ·{" "}
            <a
              href={current.permalinkUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-white hover:underline"
            >
              on SoundCloud
            </a>
          </p>
        </div>
      )}

      {/* scene-name flash on mode switch (skipped under reduced motion) */}
      {flash && (
        <div
          key={flash.n}
          className="pointer-events-none absolute inset-x-0 bottom-[24%] hidden text-center motion-safe:block"
        >
          <span className="inline-block animate-[stage-flash_0.9s_ease-out_forwards] text-4xl font-bold text-white/90 [text-shadow:0_2px_16px_rgba(0,0,0,0.7)]">
            {flash.label}
          </span>
        </div>
      )}

      {/* mode switching lives in the bottom-left corner */}
      <div className={`absolute bottom-6 left-6 ${chromeDrift}`}>
        <ScenePicker active={mode} onSelect={selectMode} />
      </div>

      <button
        onClick={() => {
          setTuneOpen((v) => !v);
          pokeChrome();
        }}
        className={`absolute right-6 bottom-6 cursor-pointer text-sm [text-shadow:0_1px_10px_rgba(0,0,0,0.85)] hover:text-white ${
          tuneOpen ? "text-white" : "text-muted"
        } ${chromeDrift}`}
      >
        tune
      </button>

      <SceneSettings
        scene={mode}
        open={tuneOpen}
        payload={settings}
        onChange={changeSettings}
        onClose={() => {
          setTuneOpen(false);
          pokeChrome();
        }}
      />
    </div>
  );
}
