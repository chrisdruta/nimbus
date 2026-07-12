import { describe, expect, test } from "bun:test";
import {
  decideQuota,
  nextUtcMidnight,
  utcDayKey,
  QuotaExceededError,
  type QuotaInput,
} from "../lib/quota";

function input(overrides: Partial<QuotaInput>): QuotaInput {
  return {
    userCount: 0,
    globalCount: 0,
    userLimit: 150,
    globalLimit: 12000,
    ownerExempt: false,
    ...overrides,
  };
}

describe("decideQuota", () => {
  test("allows under both caps", () => {
    expect(decideQuota(input({ userCount: 149, globalCount: 11999 }))).toEqual({
      allowed: true,
    });
  });

  test("denies user scope at the user cap", () => {
    expect(decideQuota(input({ userCount: 150 }))).toEqual({
      allowed: false,
      scope: "user",
    });
  });

  test("denies over the user cap", () => {
    expect(decideQuota(input({ userCount: 151 }))).toEqual({
      allowed: false,
      scope: "user",
    });
  });

  test("denies global scope at the global cap", () => {
    expect(decideQuota(input({ globalCount: 12000 }))).toEqual({
      allowed: false,
      scope: "global",
    });
  });

  test("global takes precedence when both are exceeded", () => {
    expect(
      decideQuota(input({ userCount: 150, globalCount: 12000 })),
    ).toEqual({ allowed: false, scope: "global" });
  });

  test("owner exemption bypasses the user cap", () => {
    expect(
      decideQuota(input({ userCount: 5000, ownerExempt: true })),
    ).toEqual({ allowed: true });
  });

  test("owner exemption does not bypass the global cap", () => {
    expect(
      decideQuota(input({ globalCount: 12000, ownerExempt: true })),
    ).toEqual({ allowed: false, scope: "global" });
  });

  test("zero user limit blocks non-owner immediately", () => {
    expect(decideQuota(input({ userLimit: 0 }))).toEqual({
      allowed: false,
      scope: "user",
    });
  });

  test("zero global limit blocks everyone including owner", () => {
    expect(
      decideQuota(input({ globalLimit: 0, ownerExempt: true })),
    ).toEqual({ allowed: false, scope: "global" });
  });
});

describe("utcDayKey", () => {
  test("formats the UTC calendar day", () => {
    expect(utcDayKey(new Date("2026-07-12T15:30:00Z"))).toBe("2026-07-12");
  });

  test("uses UTC, not local time, at day boundaries", () => {
    expect(utcDayKey(new Date("2026-07-12T23:59:59.999Z"))).toBe("2026-07-12");
    expect(utcDayKey(new Date("2026-07-13T00:00:00.000Z"))).toBe("2026-07-13");
  });
});

describe("nextUtcMidnight", () => {
  test("returns the start of the next UTC day", () => {
    expect(nextUtcMidnight(new Date("2026-07-12T15:30:00Z")).toISOString()).toBe(
      "2026-07-13T00:00:00.000Z",
    );
  });

  test("just before midnight rolls to the next day", () => {
    expect(
      nextUtcMidnight(new Date("2026-07-12T23:59:59.999Z")).toISOString(),
    ).toBe("2026-07-13T00:00:00.000Z");
  });

  test("exactly at midnight targets the following midnight", () => {
    expect(
      nextUtcMidnight(new Date("2026-07-13T00:00:00.000Z")).toISOString(),
    ).toBe("2026-07-14T00:00:00.000Z");
  });

  test("year boundary", () => {
    expect(
      nextUtcMidnight(new Date("2026-12-31T12:00:00Z")).toISOString(),
    ).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("QuotaExceededError", () => {
  test("carries the 429 payload fields", () => {
    const resetsAt = new Date("2026-07-13T00:00:00Z");
    const err = new QuotaExceededError("user", 150, 150, resetsAt);
    expect(err.scope).toBe("user");
    expect(err.used).toBe(150);
    expect(err.limit).toBe(150);
    expect(err.resetsAt).toBe(resetsAt);
    expect(err.message).toContain("150/150");
  });

  test("Retry-After seconds derive from resetsAt", () => {
    const now = new Date("2026-07-12T23:00:00Z");
    const err = new QuotaExceededError("global", 12000, 12000, nextUtcMidnight(now));
    const retryAfter = Math.ceil((err.resetsAt.getTime() - now.getTime()) / 1000);
    expect(retryAfter).toBe(3600);
  });
});
