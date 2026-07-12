import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError, type Session } from "./session";
import { ReauthRequiredError } from "./tokens";

/** Session-gated JSON route: 401 on auth problems, 500 otherwise. */
export async function withUser(
  fn: (session: Session) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(await requireUser()));
  } catch (err) {
    if (
      err instanceof UnauthorizedError ||
      err instanceof ReauthRequiredError
    ) {
      return NextResponse.json({ error: "re-login required" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
