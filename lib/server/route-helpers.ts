import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import {
  requireAdmin,
  requireUser,
  ForbiddenError,
  UnauthorizedError,
  type Session,
} from "./session";
import { ReauthRequiredError } from "./tokens";
import {
  InvalidCursorError,
  ProviderAuthError,
  TrackUnavailableError,
} from "../provider";
import { QuotaExceededError } from "./quota";
import { consumeRateLimit, RateLimitError } from "./rate-limit";

/** Invalid input to an API route — maps to 400. */
export class BadRequestError extends Error {}

/** Requested resource doesn't exist (or is gone/stale) — maps to 404. */
export class NotFoundError extends Error {}

/** State precondition failed (e.g. queue revision mismatch) — maps to 409.
 * The client should refresh its view and retry. */
export class ConflictError extends Error {}

function toResponse(err: unknown): NextResponse {
  const privateHeaders = { "Cache-Control": "private, no-store" };
  if (
    err instanceof UnauthorizedError ||
    err instanceof ReauthRequiredError ||
    err instanceof ProviderAuthError
  ) {
    return NextResponse.json(
      { error: "re-login required" },
      { status: 401, headers: privateHeaders },
    );
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json(
      { error: err.message },
      { status: 403, headers: privateHeaders },
    );
  }
  if (err instanceof BadRequestError || err instanceof InvalidCursorError) {
    return NextResponse.json(
      { error: err.message },
      { status: 400, headers: privateHeaders },
    );
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json(
      { error: err.message },
      { status: 404, headers: privateHeaders },
    );
  }
  if (err instanceof ConflictError) {
    return NextResponse.json(
      { error: err.message },
      { status: 409, headers: privateHeaders },
    );
  }
  if (err instanceof TrackUnavailableError) {
    return NextResponse.json(
      { error: "track unavailable", reason: err.message },
      { status: 422, headers: privateHeaders },
    );
  }
  if (err instanceof RateLimitError) {
    return NextResponse.json(
      { error: "too many requests" },
      {
        status: 429,
        headers: {
          ...privateHeaders,
          "Retry-After": String(err.retryAfterSeconds),
        },
      },
    );
  }
  if (err instanceof QuotaExceededError) {
    const retryAfter = Math.max(
      0,
      Math.ceil((err.resetsAt.getTime() - Date.now()) / 1000),
    );
    return NextResponse.json(
      {
        error: "quota exceeded",
        scope: err.scope,
        used: err.used,
        limit: err.limit,
        resetsAt: err.resetsAt.toISOString(),
      },
      {
        status: 429,
        headers: {
          ...privateHeaders,
          "Retry-After": String(retryAfter),
        },
      },
    );
  }
  console.error(err);
  return NextResponse.json(
    { error: "internal error" },
    { status: 500, headers: privateHeaders },
  );
}

/** Session-gated JSON route: 401/403 auth, 422 unavailable, 429 quota. */
export async function withUser(
  fn: (session: Session) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const session = await requireUser();
    consumeRateLimit(`user:${session.userId}`, 600, 60_000);
    return NextResponse.json(await fn(session), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toResponse(err);
  }
}

/** Owner-gated JSON route — same error vocabulary as withUser. */
export async function withAdmin(
  fn: (session: Session) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const session = await requireAdmin();
    consumeRateLimit(`admin:${session.userId}`, 180, 60_000);
    return NextResponse.json(await fn(session), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toResponse(err);
  }
}

export function errorResponse(err: unknown): NextResponse {
  return toResponse(err);
}

export function requireSameOrigin(req: NextRequest): void {
  const expected = new URL(process.env.APP_URL ?? "http://localhost").origin;
  if (req.headers.get("origin") !== expected) {
    throw new ForbiddenError("cross-origin request blocked");
  }
}

export async function readJsonBody(
  req: NextRequest,
  maxBytes: number = 16 * 1024,
): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BadRequestError("request body too large");
  }
  if (!req.body) throw new BadRequestError("missing JSON body");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BadRequestError("request body too large");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BadRequestError("malformed JSON body");
  }
}

export function positiveSafeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestError(`bad ${name}: ${value}`);
  }
  return parsed;
}

export function cursorParam(req: NextRequest): string | undefined {
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  if (cursor && (cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor))) {
    throw new BadRequestError("malformed pagination cursor");
  }
  return cursor;
}
