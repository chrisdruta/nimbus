import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const KEY_BYTES = 32;

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be ${KEY_BYTES} bytes base64 (openssl rand -base64 32), got ${buf.length}`,
    );
  }
  return buf;
}

/** AES-256-GCM; output format "iv.ciphertext.tag", each part base64. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, ct, cipher.getAuthTag()]
    .map((b) => b.toString("base64"))
    .join(".");
}

export function decryptToken(blob: string): string {
  const parts = blob.split(".");
  if (parts.length !== 3) throw new Error("malformed encrypted token");
  const [iv, ct, tag] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8",
  );
}
