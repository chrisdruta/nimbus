import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mintSharedCapability,
  verifySharedCapability,
} from "../lib/server/shared-capability";

const originalSecret = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

describe("shared-session capabilities", () => {
  const cap = { userId: 7, hostId: 9, sessionId: "2026-07-14T00:00:00.000Z" };

  test("round-trips only for the bound user and host", () => {
    const token = mintSharedCapability(cap);
    expect(verifySharedCapability(token, 7, 9)).toEqual(cap);
    expect(verifySharedCapability(token, 8, 9)).toBeNull();
    expect(verifySharedCapability(token, 7, 10)).toBeNull();
  });

  test("rejects tampering and malformed tokens", () => {
    const token = mintSharedCapability(cap);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(verifySharedCapability(tampered, 7, 9)).toBeNull();
    expect(verifySharedCapability("not-a-capability", 7, 9)).toBeNull();
  });

  test("a restarted session receives a distinct capability", () => {
    const first = mintSharedCapability(cap);
    const second = mintSharedCapability({
      ...cap,
      sessionId: "2026-07-14T00:01:00.000Z",
    });
    expect(second).not.toBe(first);
  });
});
