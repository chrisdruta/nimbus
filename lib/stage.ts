/**
 * Fullscreen stage modes: the pure-artwork "art" mode plus every viz
 * scene, one ordered strip the stage cycles through.
 */

import { isSceneId, SCENE_META, type SceneId } from "@/lib/viz/scene";

export type StageMode = "art" | SceneId;

export const STAGE_META: ReadonlyArray<{ id: StageMode; label: string }> = [
  { id: "art", label: "art" },
  ...SCENE_META,
];

export function isStageMode(v: unknown): v is StageMode {
  return v === "art" || isSceneId(v);
}

export function cycleStageMode(mode: StageMode, dir: 1 | -1): StageMode {
  const order = STAGE_META.map((s) => s.id);
  const idx = order.indexOf(mode);
  return order[(idx + dir + order.length) % order.length];
}
