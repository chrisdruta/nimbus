import { describe, expect, test } from "bun:test";
import { cycleStageMode, isStageMode, STAGE_META } from "../lib/stage";
import { SCENE_META } from "../lib/viz/scene";

describe("stage modes", () => {
  test("art leads, every scene follows", () => {
    expect(STAGE_META[0].id).toBe("art");
    expect(STAGE_META.slice(1).map((s) => s.id)).toEqual(
      SCENE_META.map((s) => s.id),
    );
  });

  test("isStageMode accepts art and scene ids, rejects junk", () => {
    expect(isStageMode("art")).toBe(true);
    expect(isStageMode("bars")).toBe(true);
    expect(isStageMode("full")).toBe(false);
    expect(isStageMode(3)).toBe(false);
    expect(isStageMode(undefined)).toBe(false);
  });

  test("cycling wraps in both directions and visits every mode", () => {
    const order = STAGE_META.map((s) => s.id);
    expect(cycleStageMode(order[order.length - 1], 1)).toBe(order[0]);
    expect(cycleStageMode(order[0], -1)).toBe(order[order.length - 1]);
    let mode = order[0];
    const seen = new Set([mode]);
    for (let i = 0; i < order.length - 1; i++) {
      mode = cycleStageMode(mode, 1);
      seen.add(mode);
    }
    expect(seen.size).toBe(order.length);
  });
});
