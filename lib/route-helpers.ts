import { NextResponse } from "next/server";
import {
  requireAdmin,
  requireUser,
  ForbiddenError,
  UnauthorizedError,
  type Session,
} from "./session";
import { ReauthRequiredError } from "./tokens";
import { ProviderAuthError, TrackUnavailableError } from "./provider";
import { QuotaExceededError } from "./quota";

/** Invalid input to an API route — maps to 400. */
export class BadRequestError extends Error {}

/** Requested resource doesn't exist (or is gone/stale) — maps to 404. */
export class NotFoundError extends Error {}

function toResponse(err: unknown): NextResponse {
  if (
    err instanceof UnauthorizedError ||
    err instanceof ReauthRequiredError ||
    err instanceof ProviderAuthError
  ) {
    return NextResponse.json({ error: "re-login required" }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof BadRequestError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof TrackUnavailableError) {
    return NextResponse.json(
      { error: "track unavailable", reason: err.message },
      { status: 422 },
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
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  console.error(err);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}

/** Session-gated JSON route: 401/403 auth, 422 unavailable, 429 quota. */
export async function withUser(
  fn: (session: Session) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(await requireUser()));
  } catch (err) {
    return toResponse(err);
  }
}

/** Owner-gated JSON route — same error vocabulary as withUser. */
export async function withAdmin(
  fn: (session: Session) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(await requireAdmin()));
  } catch (err) {
    return toResponse(err);
  }
}
