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
  return new TextEncoder().encode(raw);
}

// Secure cookies would be dropped on plain-http origins other than localhost;
// key off the configured origin so local dev works in every browser.
function secureCookies(): boolean {
  return (process.env.APP_URL ?? "").startsWith("https:");
}

async function sign(payload: Record<string, unknown>, ttlSeconds: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

async function verify(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(session: Session): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await sign({ ...session }, SESSION_TTL_S), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verify(token);
  if (
    typeof payload?.userId !== "number" ||
    typeof payload?.scUserId !== "number"
  ) {
    return null;
  }
  return { userId: payload.userId, scUserId: payload.scUserId };
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function setDanceCookie(dance: OauthDance): Promise<void> {
  const jar = await cookies();
  jar.set(DANCE_COOKIE, await sign({ ...dance }, DANCE_TTL_S), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/api/auth",
    maxAge: DANCE_TTL_S,
  });
}

export async function readAndClearDanceCookie(): Promise<OauthDance | null> {
  const jar = await cookies();
  const token = jar.get(DANCE_COOKIE)?.value;
  jar.delete({ name: DANCE_COOKIE, path: "/api/auth" });
  if (!token) return null;
  const payload = await verify(token);
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
  return session;
}

/** Membership + owner gate for admin routes. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireUser();
  if (!isOwner(session.scUserId)) throw new ForbiddenError("not the owner");
  return session;
}
