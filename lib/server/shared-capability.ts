import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const MAC_BYTES = 32;
const VERSION = 1;

export interface SharedCapability {
  userId: number;
  hostId: number;
  sessionId: string;
}

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }
  return Buffer.from(secret, "utf8");
}

function mac(payload: Buffer, secret: Buffer = key()): Buffer {
  return createHmac("sha256", secret)
    .update("nimbus:shared-session:v1\0", "utf8")
    .update(payload)
    .digest();
}

const isId = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** A capability is scoped to one user and one concrete session generation. */
export function mintSharedCapability(cap: SharedCapability): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: VERSION,
      userId: cap.userId,
      hostId: cap.hostId,
      sessionId: cap.sessionId,
    }),
    "utf8",
  );
  return Buffer.concat([payload, mac(payload)]).toString("base64url");
}

export function verifySharedCapability(
  token: string,
  userId: number,
  hostId: number,
): SharedCapability | null {
  const secret = key();
  try {
    if (
      token.length === 0 ||
      token.length > 2048 ||
      !/^[A-Za-z0-9_-]+$/.test(token)
    ) {
      return null;
    }
    const packed = Buffer.from(token, "base64url");
    if (packed.toString("base64url") !== token || packed.length <= MAC_BYTES) {
      return null;
    }
    const payload = packed.subarray(0, -MAC_BYTES);
    const suppliedMac = packed.subarray(-MAC_BYTES);
    if (!timingSafeEqual(suppliedMac, mac(payload, secret))) return null;
    const parsed = JSON.parse(payload.toString("utf8")) as Record<string, unknown>;
    if (
      parsed.v !== VERSION ||
      !isId(parsed.userId) ||
      !isId(parsed.hostId) ||
      parsed.userId !== userId ||
      parsed.hostId !== hostId ||
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId.length === 0 ||
      parsed.sessionId.length > 100
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      hostId: parsed.hostId,
      sessionId: parsed.sessionId,
    };
  } catch {
    return null;
  }
}
