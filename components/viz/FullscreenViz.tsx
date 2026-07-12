"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SceneHost } from "./SceneHost";
import { ScenePicker } from "./ScenePicker";
import { createScene } from "./scenes";
import { useVizTheme } from "./useVizTheme";
import { isSceneId, SCENE_META, type SceneId } from "@/lib/viz/scene";
import { readPref, writePref } from "@/lib/prefs";
import { usePlayerActions, usePlayerState } from "@/components/player/PlayerProvider";

const CHROME_HIDE_MS = 2500;

export function FullscreenViz() {
  const { vizMode, current } = usePlayerState();
  const actions = usePlayerActions();
  const theme = useVizTheme(current?.artworkUrl ?? null);
  const open = vizMode === "full";

  const [sceneId, setSceneId] = useState<SceneId>(
    () => readPref("vizScene", isSceneId) ?? "bars",
  );
  const scene = useMemo(() => createScene(sceneId), [sceneId]);

  const selectScene = useCallback((id: SceneId) => {
    setSceneId(id);
    writePref("vizScene", id);
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

  useEffect(() => {
    if (!open) return;
    pokeChrome(); // visible on open, then start the idle countdown

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        actions.setVizMode("mini");
        return;
      }
      const order = SCENE_META.map((s) => s.id);
      const idx = order.indexOf(sceneId);
      if (e.key === "ArrowRight") {
        selectScene(order[(idx + 1) % order.length]);
        pokeChrome();
      } else if (e.key === "ArrowLeft") {
        selectScene(order[(idx - 1 + order.length) % order.length]);
        pokeChrome();
      } else if (/^[1-4]$/.test(e.key)) {
        selectScene(order[Number(e.key) - 1]);
        pokeChrome();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [open, sceneId, actions, selectScene, pokeChrome]);

  if (!open) return null;

  const chrome = `transition-opacity duration-500 ${
    chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"
  }`;

  return (
    <div
      className="fixed inset-0 z-40 cursor-pointer bg-side"
      onClick={() => actions.setVizMode("mini")}
      onMouseMove={pokeChrome}
      onTouchStart={pokeChrome}
    >
      <SceneHost scene={scene} theme={theme} className="h-full w-full" />

      {current && (
        <div className={`pointer-events-none absolute bottom-8 left-8 ${chrome}`}>
          <p className="text-2xl font-bold">{current.title}</p>
          <p className="mt-1 text-muted">
            {current.artist} · on SoundCloud
          </p>
        </div>
      )}

      <div
        className={`absolute bottom-8 left-1/2 -translate-x-1/2 ${chrome}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ScenePicker active={sceneId} onSelect={selectScene} />
      </div>

      <p className={`absolute top-6 right-6 text-xs text-muted ${chrome}`}>
        ←→ scenes · esc to close
      </p>
    </div>
  );
}
