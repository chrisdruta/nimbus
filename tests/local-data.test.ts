import { describe, expect, test } from "bun:test";
import { isNimbusKey } from "../lib/local-data";

describe("isNimbusKey", () => {
  test("matches every key family nimbus writes", () => {
    expect(isNimbusKey("nimbus.queue.v1:42")).toBe(true);
    expect(isNimbusKey("nimbus:volume")).toBe(true);
    expect(isNimbusKey("nimbus:pref:autoRadio")).toBe(true);
    expect(isNimbusKey("nimbus:pref:sidebar:playlists:collapsed")).toBe(true);
  });

  test("leaves foreign keys alone", () => {
    expect(isNimbusKey("nimbusish")).toBe(false);
    expect(isNimbusKey("other:nimbus:key")).toBe(false);
    expect(isNimbusKey("theme")).toBe(false);
    expect(isNimbusKey("")).toBe(false);
  });
});
