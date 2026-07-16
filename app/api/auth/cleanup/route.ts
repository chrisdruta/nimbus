import { NextResponse } from "next/server";
import {
  clearSession,
  readSession,
  setFarewellHeaders,
} from "@/lib/server/session";
import { getUserAuth } from "@/lib/server/db";

export const runtime = "nodejs";

/**
 * Invalid-session farewell. Server components can only redirect() — they
 * can't expire cookies or attach Clear-Site-Data — so the shell bounces
 * removed/disabled members through this route, which verifies the session
 * really is invalid before wiping anything: a cross-site GET against a
 * signed-out visitor or a valid member is a plain redirect home.
 */
export async function GET() {
  const home = () =>
    NextResponse.redirect(new URL("/", process.env.APP_URL), 303);
  const session = await readSession();
  if (!session) return home();

  let membership: Awaited<ReturnType<typeof getUserAuth>>;
  try {
    membership = await getUserAuth(session.userId);
  } catch {
    // Transient DB failure is not evidence of invalidity — never wipe on it.
    return home();
  }
  if (
    membership &&
    !membership.disabled &&
    membership.scUserId === session.scUserId
  ) {
    return home();
  }

  const reason = membership?.disabled ? "disabled" : "removed";
  await clearSession();
  const res = NextResponse.redirect(
    new URL(`/?bye=${reason}`, process.env.APP_URL),
    303,
  );
  setFarewellHeaders(res.headers);
  return res;
}
