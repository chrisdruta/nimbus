"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type SceneSettingsPayload,
} from "@/lib/viz/settings";
import type { TrackShape } from "@/lib/viz/trackshape";

// Track shapes are immutable per track — cache for the page lifetime.
// null means "fetched, provider has none"; absent means "not fetched yet".
const shapeCache = new Map<number, TrackShape | null>();
import { IconCloud } from "@/components/ui/icons";
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

  const selectMode = useCallback((id: StageMode) => {
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
    () => (mode === "art" ? undefined : resolveSceneSettings(mode, settings)),
    [mode, settings],
  );
  useEffect(() => setTuneOpen(false), [mode, stageOpen]);

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
        actions.closeStage();
        return;
      }
      if (e.key === "ArrowRight") {
        selectMode(cycleStageMode(mode, 1));
        pokeChrome();
      } else if (e.key === "ArrowLeft") {
        selectMode(cycleStageMode(mode, -1));
        pokeChrome();
      } else if (/^[1-5]$/.test(e.key)) {
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

  const chrome = `transition-opacity duration-500 ${
    chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"
  }`;

  return (
    <div
      className="absolute inset-0 z-20 cursor-pointer overflow-hidden"
      style={{ background: theme.background }}
      onClick={() => actions.closeStage()}
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
          <div className="relative aspect-square h-[min(70vmin,72%)] overflow-hidden rounded-xl shadow-2xl motion-safe:animate-[stage-breathe_14s_ease-in-out_infinite_alternate]">
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
          // stays full-bleed.
          <div className="absolute inset-0 flex justify-center">
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

      {/* top-left track meta: the shell's open-queue button owns the top-right */}
      {current && (
        <div
          className={`absolute top-6 left-6 ${chrome}`}
          onClick={(e) => e.stopPropagation()}
        >
          <a
            href={current.permalinkUrl}
            target="_blank"
            rel="noreferrer"
            className="block max-w-[60vw] truncate text-2xl font-bold hover:underline"
          >
            {current.title}
          </a>
          <p className="mt-1 text-muted">
            <a
              href={current.artistUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-white hover:underline"
            >
              {current.artist}
            </a>{" "}
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

      <div
        className={`absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3 ${chrome}`}
        onClick={(e) => e.stopPropagation()}
      >
        {tuneOpen && mode !== "art" && (
          <SceneSettings
            scene={mode}
            payload={settings}
            onChange={changeSettings}
            onClose={() => {
              setTuneOpen(false);
              pokeChrome();
            }}
          />
        )}
        <div className="flex items-center gap-2">
          <ScenePicker active={mode} onSelect={selectMode} />
          {mode !== "art" && (
            <button
              onClick={() => {
                setTuneOpen((v) => !v);
                pokeChrome();
              }}
              className={`cursor-pointer rounded-full px-4 py-1.5 text-sm transition ${
                tuneOpen
                  ? "bg-white/20 text-white"
                  : "bg-white/10 text-muted hover:bg-white/20 hover:text-white"
              }`}
            >
              tune
            </button>
          )}
        </div>
      </div>

      {/* tucked into the corner, below the picker row's baseline, so the
          centered pill cluster can never collide with it */}
      <p
        className={`absolute right-4 bottom-3 hidden text-xs text-muted sm:block ${chrome}`}
      >
        ←→ modes · esc to close
      </p>
    </div>
  );
}
