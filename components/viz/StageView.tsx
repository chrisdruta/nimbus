"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SceneHost } from "./SceneHost";
import { ScenePicker } from "./ScenePicker";
import { createScene } from "./scenes";
import { useVizTheme } from "./useVizTheme";
import { CrossfadeArt } from "@/components/art/CrossfadeArt";
import { cycleStageMode, isStageMode, STAGE_META, type StageMode } from "@/lib/stage";
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

  // Chrome (picker, track meta, hints) shows on pointer activity and
  // hides after a quiet spell.
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pokeChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
  }, []);

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
          // layers — in-flow elements would composite beneath them.
          <SceneHost
            scene={scene}
            theme={theme}
            className="absolute inset-0 h-full w-full"
          />
        )
      )}

      {current && (
        <div
          className={`absolute bottom-8 left-8 ${chrome}`}
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
        className={`absolute bottom-8 left-1/2 -translate-x-1/2 ${chrome}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ScenePicker active={mode} onSelect={selectMode} />
      </div>

      {/* top-left: the shell's open-queue button owns the top-right */}
      <p className={`absolute top-6 left-6 text-xs text-muted ${chrome}`}>
        ←→ modes · esc to close
      </p>
    </div>
  );
}
