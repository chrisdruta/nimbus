import { describe, expect, test } from "bun:test";
import { AFK_PAUSE_MS, FEED_IDLE_MS, afkAction } from "../lib/afk";

describe("afkAction", () => {
  test("paused clients never act, however idle", () => {
    expect(
      afkAction({ playing: false, following: false, idleForMs: 10 * AFK_PAUSE_MS }),
    ).toBe("none");
    expect(
      afkAction({ playing: false, following: true, idleForMs: 10 * AFK_PAUSE_MS }),
    ).toBe("none");
  });

  test("below the threshold nothing happens", () => {
    expect(
      afkAction({ playing: true, following: false, idleForMs: AFK_PAUSE_MS - 1 }),
    ).toBe("none");
    expect(afkAction({ playing: true, following: false, idleForMs: 0 })).toBe(
      "none",
    );
  });

  test("local playback pauses at the threshold", () => {
    expect(
      afkAction({ playing: true, following: false, idleForMs: AFK_PAUSE_MS }),
    ).toBe("pause");
  });

  test("a following client leaves instead of pausing", () => {
    expect(
      afkAction({ playing: true, following: true, idleForMs: AFK_PAUSE_MS }),
    ).toBe("leave");
  });

  test("negative idle (clock skew) is treated as active", () => {
    expect(
      afkAction({ playing: true, following: false, idleForMs: -1 }),
    ).toBe("none");
  });

  test("feed gate is far shorter than the playback threshold", () => {
    expect(FEED_IDLE_MS).toBeLessThan(AFK_PAUSE_MS);
  });
});
