import { describe, expect, test } from "bun:test";
import { consumeRateLimit, RateLimitError } from "../lib/server/rate-limit";

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
});
