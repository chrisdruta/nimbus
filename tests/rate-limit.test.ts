import { describe, expect, test } from "bun:test";
import {
  clientIpFrom,
  consumeRateLimit,
  RateLimitError,
} from "../lib/server/rate-limit";

describe("rate limiter", () => {
  test("allows a bounded burst and reports the reset", () => {
    const key = `test:${Math.random()}`;
    consumeRateLimit(key, 2, 10_000, 1_000);
    consumeRateLimit(key, 2, 10_000, 1_000);
    expect(() => consumeRateLimit(key, 2, 10_000, 1_500)).toThrow(
      RateLimitError,
    );
    try {
      consumeRateLimit(key, 2, 10_000, 1_500);
    } catch (err) {
      expect((err as RateLimitError).retryAfterSeconds).toBe(10);
    }
  });

  test("opens a fresh window after reset", () => {
    const key = `test:${Math.random()}`;
    consumeRateLimit(key, 1, 100, 1_000);
    expect(() => consumeRateLimit(key, 1, 100, 1_100)).not.toThrow();
  });

  test("distinct key prefixes count independently", () => {
    const id = Math.random();
    consumeRateLimit(`user:${id}`, 1, 10_000, 1_000);
    expect(() =>
      consumeRateLimit(`provider:${id}`, 1, 10_000, 1_000),
    ).not.toThrow();
    expect(() => consumeRateLimit(`user:${id}`, 1, 10_000, 1_000)).toThrow(
      RateLimitError,
    );
  });
});

describe("clientIpFrom", () => {
  test("no headers collapses to unknown", () => {
    expect(clientIpFrom(null, null)).toBe("unknown");
  });

  test("prefers a valid x-real-ip", () => {
    expect(clientIpFrom("203.0.113.7", "198.51.100.1")).toBe("203.0.113.7");
  });

  test("falls back to the first x-forwarded-for hop", () => {
    expect(clientIpFrom(null, "198.51.100.1, 10.0.0.1")).toBe("198.51.100.1");
    expect(clientIpFrom("not-an-ip", "198.51.100.1")).toBe("198.51.100.1");
  });

  test("rejects garbage in both headers", () => {
    expect(clientIpFrom("<script>", "spoofed, 1.2.3.4")).toBe("unknown");
    expect(clientIpFrom(null, "gopher://evil")).toBe("unknown");
  });

  test("rejects overlong values", () => {
    expect(clientIpFrom("1".repeat(64), null)).toBe("unknown");
  });

  test("accepts IPv6 forms", () => {
    expect(clientIpFrom("2001:db8::1", null)).toBe("2001:db8::1");
    expect(clientIpFrom(null, "::ffff:192.0.2.128")).toBe(
      "::ffff:192.0.2.128",
    );
  });

  test("trims whitespace", () => {
    expect(clientIpFrom("  203.0.113.7  ", null)).toBe("203.0.113.7");
    expect(clientIpFrom(null, "  198.51.100.1 , 10.0.0.1")).toBe(
      "198.51.100.1",
    );
  });
});
