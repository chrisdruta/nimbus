import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getUserAuth } from "./db";

const SESSION_COOKIE = "nimbus_session";
const DANCE_COOKIE = "nimbus_oauth";
const SESSION_TTL_S = 7 * 24 * 60 * 60;
const DANCE_TTL_S = 10 * 60;

export interface Session {
  userId: number;
  scUserId: number;
}

/** Carries PKCE state (and any invite code) across the OAuth round-trip. */
export interface OauthDance {
  state: string;
  codeVerifier: string;
  invite?: string;
}

export class UnauthorizedError extends Error {}

/** Authenticated but not allowed: disabled account or non-admin. */
export class ForbiddenError extends Error {}

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error("SESSION_SECRET is not set");
  const encoded = new TextEncoder().encode(raw);
  if (encoded.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }
  return encoded;
}

// Secure cookies would be dropped on plain-http origins other than localhost;
// key off the configured origin so local dev works in every browser.
function secureCookies(): boolean {
  return (process.env.APP_URL ?? "").startsWith("https:");
}

type TokenKind = "session" | "oauth";

function cookieName(base: string, prefix: "__Host-" | "__Secure-"): string {
  return secureCookies() ? `${prefix}${base}` : base;
}

async function sign(
  payload: Record<string, unknown>,
  ttlSeconds: number,
  kind: TokenKind,
) {
  return new SignJWT({ ...payload, kind })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("nimbus")
    .setAudience(`nimbus:${kind}`)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

async function verify(
  token: string,
  kind: TokenKind,
): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      issuer: "nimbus",
      audience: `nimbus:${kind}`,
    });
    if (payload.kind !== kind) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(session: Session): Promise<void> {
  const jar = await cookies();
  jar.set(
    cookieName(SESSION_COOKIE, "__Host-"),
    await sign({ ...session }, SESSION_TTL_S, "session"),
    {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_S,
    },
  );
}

export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(cookieName(SESSION_COOKIE, "__Host-"))?.value;
  if (!token) return null;
  const payload = await verify(token, "session");
  if (
    typeof payload?.userId !== "number" ||
    typeof payload?.scUserId !== "number"
  ) {
    return null;
  }
  return { userId: payload.userId, scUserId: payload.scUserId };
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(cookieName(SESSION_COOKIE, "__Host-"));
  // Remove the pre-hardening cookie after rollout as well.
  if (secureCookies()) jar.delete(SESSION_COOKIE);
}

/** Make the browser forget this origin: caches plus localStorage,
 * IndexedDB, and sessionStorage. Shared by explicit logout and the
 * invalid-session farewell. Browsers only honor Clear-Site-Data over
 * HTTPS, so the landing page also runs a client-side sweep as the
 * HTTP-dev fallback. */
export function setFarewellHeaders(headers: Headers): void {
  headers.set("Clear-Site-Data", '"cache", "storage"');
  headers.set("Cache-Control", "no-store");
}

export async function setDanceCookie(dance: OauthDance): Promise<void> {
  const jar = await cookies();
  jar.set(
    cookieName(DANCE_COOKIE, "__Secure-"),
    await sign({ ...dance }, DANCE_TTL_S, "oauth"),
    {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "lax",
      path: "/api/auth",
      maxAge: DANCE_TTL_S,
    },
  );
}

export async function readAndClearDanceCookie(): Promise<OauthDance | null> {
  const jar = await cookies();
  const name = cookieName(DANCE_COOKIE, "__Secure-");
  const token = jar.get(name)?.value;
  jar.delete({ name, path: "/api/auth" });
  if (!token) return null;
  const payload = await verify(token, "oauth");
  if (
    typeof payload?.state !== "string" ||
    typeof payload?.codeVerifier !== "string"
  ) {
    return null;
  }
  return {
    state: payload.state,
    codeVerifier: payload.codeVerifier,
    invite: typeof payload.invite === "string" ? payload.invite : undefined,
  };
}

export function isOwner(scUserId: number): boolean {
  const owner = process.env.OWNER_SC_USER_ID;
  return owner !== undefined && owner !== "" && Number(owner) === scUserId;
}

/**
 * Session + membership gate for every protected route. DB-backed so that
 * disabling or removing a user cuts them off on their next request despite
 * the 7-day session JWT.
 */
export async function requireUser(): Promise<Session> {
  const session = await readSession();
  if (!session) throw new UnauthorizedError("no session");
  const membership = await getUserAuth(session.userId);
  if (!membership) throw new UnauthorizedError("user removed");
  if (membership.disabled) throw new ForbiddenError("account disabled");
  if (membership.scUserId !== session.scUserId) {
    throw new UnauthorizedError("session identity mismatch");
  }
  return session;
}

/** Membership + owner gate for admin routes. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireUser();
  if (!isOwner(session.scUserId)) throw new ForbiddenError("not the owner");
  return session;
}
