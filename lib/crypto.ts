import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const KEY_BYTES = 32;
const VERSION = "v2";

function decodeKey(raw: string | undefined, name: string): Buffer {
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `${name} must be ${KEY_BYTES} bytes base64 (openssl rand -base64 32), got ${buf.length}`,
    );
  }
  return buf;
}

function currentKey(): Buffer {
  return decodeKey(process.env.TOKEN_ENCRYPTION_KEY, "TOKEN_ENCRYPTION_KEY");
}

function decryptionKeys(): Buffer[] {
  const keys = [currentKey()];
  if (process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS) {
    keys.push(
      decodeKey(
        process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS,
        "TOKEN_ENCRYPTION_KEY_PREVIOUS",
      ),
    );
  }
  return keys;
}

/** AES-256-GCM; v2 output is "v2.iv.ciphertext.tag". Unversioned v1 blobs
 * remain readable during migration. Context is authenticated as GCM AAD. */
export function encryptToken(plain: string, context?: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", currentKey(), iv);
  if (context) cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, ct, cipher.getAuthTag()]
    .map((b) => b.toString("base64"))
    .join(".");
}

export function decryptToken(blob: string, context?: string): string {
  const parts = blob.split(".");
  const versioned = parts[0] === VERSION;
  if ((!versioned && parts.length !== 3) || (versioned && parts.length !== 4)) {
    throw new Error("malformed encrypted token");
  }
  const encoded = versioned ? parts.slice(1) : parts;
  const [iv, ct, tag] = encoded.map((p) => Buffer.from(p, "base64"));
  let lastError: unknown;
  for (const candidate of decryptionKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", candidate, iv);
      if (versioned && context) decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
        "utf8",
      );
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export function tokenContext(
  scUserId: number,
  kind: "access" | "refresh",
): string {
  return `nimbus:soundcloud:${scUserId}:${kind}`;
}
