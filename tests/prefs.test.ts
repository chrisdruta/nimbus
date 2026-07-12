import { beforeEach, describe, expect, test } from "bun:test";
import { readPref, writePref } from "../lib/prefs";

// Minimal localStorage stub, same approach as tests/queue.test.ts.
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

const isString = (v: unknown): v is string => typeof v === "string";

describe("prefs", () => {
  test("round-trips a value", () => {
    writePref("vizScene", "radial");
    expect(readPref("vizScene", isString)).toBe("radial");
  });

  test("uses the nimbus:pref: prefix", () => {
    writePref("vizScene", "bars");
    expect(store.has("nimbus:pref:vizScene")).toBe(true);
  });

  test("missing key reads as null", () => {
    expect(readPref("nope", isString)).toBeNull();
  });

  test("validator rejects wrong-shaped values", () => {
    writePref("vizScene", 42);
    expect(readPref("vizScene", isString)).toBeNull();
  });

  test("corrupted JSON reads as null", () => {
    store.set("nimbus:pref:vizScene", "{not json");
    expect(readPref("vizScene", isString)).toBeNull();
  });

  test("storage failures are swallowed", () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writePref("x", 1)).not.toThrow();
    expect(readPref("x", isString)).toBeNull();
  });
});
