import { describe, expect, test, beforeEach } from "bun:test";
import { randomBytes } from "node:crypto";
import { createCipheriv } from "node:crypto";
import { decryptToken, encryptToken } from "../lib/crypto";

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
});

describe("token encryption", () => {
  test("round-trips", () => {
    const token = "sc-access-token-" + randomBytes(24).toString("hex");
    const blob = encryptToken(token);
    expect(blob).not.toContain(token);
    expect(blob.split(".")).toHaveLength(4);
    expect(decryptToken(blob)).toBe(token);
  });

  test("unique IV per encryption", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });

  test("rejects tampered ciphertext", () => {
    const [version, iv, ct, tag] = encryptToken("secret").split(".");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 0xff;
    const tampered = [version, iv, flipped.toString("base64"), tag].join(".");
    expect(() => decryptToken(tampered)).toThrow();
  });

  test("rejects wrong key", () => {
    const blob = encryptToken("secret");
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptToken(blob)).toThrow();
  });

  test("binds versioned ciphertext to its context", () => {
    const blob = encryptToken("secret", "user:1:access");
    expect(decryptToken(blob, "user:1:access")).toBe("secret");
    expect(() => decryptToken(blob, "user:2:access")).toThrow();
  });

  test("decrypts with the previous key during rotation", () => {
    const oldKey = process.env.TOKEN_ENCRYPTION_KEY!;
    const blob = encryptToken("secret", "context");
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = oldKey;
    expect(decryptToken(blob, "context")).toBe("secret");
  });

  test("decrypts legacy unversioned blobs for rolling migration", () => {
    const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "base64");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update("legacy", "utf8"), cipher.final()]);
    const blob = [iv, ct, cipher.getAuthTag()]
      .map((part) => part.toString("base64"))
      .join(".");
    expect(decryptToken(blob, "new-context")).toBe("legacy");
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
