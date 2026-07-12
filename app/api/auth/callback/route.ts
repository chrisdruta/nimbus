import { NextResponse, type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { encryptToken } from "@/lib/crypto";
import { upsertUser } from "@/lib/db";
import { createSession, isOwner, readAndClearDanceCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const dance = await readAndClearDanceCookie();

  if (!code || !state || !dance || state !== dance.state) {
    return NextResponse.json(
      { error: "invalid OAuth state — restart login" },
      { status: 400 },
    );
  }

  const provider = getProvider();
  const tokens = await provider.exchangeCode(code, dance.codeVerifier);
  const me = await provider.getMe(tokens.accessToken);

  if (!isOwner(me.id)) {
    // This log is how the owner discovers their numeric id on first login.
    console.error(
      `rejected SoundCloud user id=${me.id} (${me.permalinkUrl}) — ` +
        `set OWNER_SC_USER_ID to allow`,
    );
    return NextResponse.json({ error: "not an approved user" }, { status: 403 });
  }

  const user = await upsertUser({
    scUserId: me.id,
    scPermalink: me.permalinkUrl,
    accessTokenEnc: encryptToken(tokens.accessToken),
    refreshTokenEnc: encryptToken(tokens.refreshToken),
    accessExpiresAt: tokens.expiresAt,
  });
  await createSession({ userId: user.id, scUserId: me.id });

  return NextResponse.redirect(new URL("/", process.env.APP_URL));
}
