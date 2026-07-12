import { describe, expect, test, beforeEach } from "bun:test";
import { randomBytes } from "node:crypto";
import { decryptToken, encryptToken } from "../lib/crypto";

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("token encryption", () => {
  test("round-trips", () => {
    const token = "sc-access-token-" + randomBytes(24).toString("hex");
    const blob = encryptToken(token);
    expect(blob).not.toContain(token);
    expect(blob.split(".")).toHaveLength(3);
    expect(decryptToken(blob)).toBe(token);
  });

  test("unique IV per encryption", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });

  test("rejects tampered ciphertext", () => {
    const [iv, ct, tag] = encryptToken("secret").split(".");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 0xff;
    const tampered = [iv, flipped.toString("base64"), tag].join(".");
    expect(() => decryptToken(tampered)).toThrow();
  });

  test("rejects wrong key", () => {
    const blob = encryptToken("secret");
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptToken(blob)).toThrow();
  });

  test("rejects malformed blob", () => {
    expect(() => decryptToken("not-a-blob")).toThrow("malformed");
  });

  test("rejects bad key length", () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(() => encryptToken("x")).toThrow("32 bytes");
  });

  test("rejects missing key", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow("not set");
  });
});
