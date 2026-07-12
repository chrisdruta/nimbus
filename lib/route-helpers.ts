import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError, type Session } from "./session";
import { ReauthRequiredError } from "./tokens";
import { ProviderAuthError, TrackUnavailableError } from "./provider";

/** Session-gated JSON route: 401 auth, 422 unavailable track, 500 otherwise. */
export async function withUser(
  fn: (session: Session) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(await requireUser()));
  } catch (err) {
    if (
      err instanceof UnauthorizedError ||
      err instanceof ReauthRequiredError ||
      err instanceof ProviderAuthError
    ) {
      return NextResponse.json({ error: "re-login required" }, { status: 401 });
    }
    if (err instanceof TrackUnavailableError) {
      return NextResponse.json(
        { error: "track unavailable", reason: err.message },
        { status: 422 },
      );
    }
    console.error(err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
