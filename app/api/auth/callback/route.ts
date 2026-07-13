import { NextResponse, type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { encryptToken, tokenContext } from "@/lib/crypto";
import { getUserByScId, upsertUser, type UpsertUserFields } from "@/lib/db";
import { claimInviteAndCreateUser, InviteInvalidError } from "@/lib/invites";
import { createSession, isOwner, readAndClearDanceCookie } from "@/lib/session";
import { errorResponse } from "@/lib/route-helpers";
import { consumeRateLimit, requestIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

function landing(authError?: string): NextResponse {
  const url = new URL("/", process.env.APP_URL);
  if (authError) url.searchParams.set("auth_error", authError);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const dance = await readAndClearDanceCookie();

  if (
    !code ||
    code.length > 2048 ||
    !state ||
    state.length > 128 ||
    !dance ||
    state !== dance.state
  ) {
    return NextResponse.json(
      { error: "invalid OAuth state — restart login" },
      { status: 400 },
    );
  }

  try {
    consumeRateLimit(`callback:${requestIp(req.headers)}`, 30, 10 * 60_000);
    const provider = getProvider();
    const tokens = await provider.exchangeCode(code, dance.codeVerifier);
    const me = await provider.getMe(tokens.accessToken);

    const fields: UpsertUserFields = {
      scUserId: me.id,
      scPermalink: me.permalinkUrl,
      scUsername: me.username,
      avatarUrl: me.avatarUrl,
      accessTokenEnc: encryptToken(
        tokens.accessToken,
        tokenContext(me.id, "access"),
      ),
      refreshTokenEnc: encryptToken(
        tokens.refreshToken,
        tokenContext(me.id, "refresh"),
      ),
      accessExpiresAt: tokens.expiresAt,
    };

    // Membership ladder: existing member > owner bootstrap > invite claim.
    const existing = await getUserByScId(me.id);
    if (existing) {
      if (existing.disabled) return landing("disabled");
      const user = await upsertUser(fields);
      await createSession({ userId: user.id, scUserId: me.id });
      return landing();
    }

    if (isOwner(me.id)) {
      const user = await upsertUser(fields);
      await createSession({ userId: user.id, scUserId: me.id });
      return landing();
    }

    if (dance.invite) {
      try {
        const user = await claimInviteAndCreateUser(dance.invite, fields);
        await createSession({ userId: user.id, scUserId: me.id });
        return landing();
      } catch (err) {
        if (err instanceof InviteInvalidError) return landing("invite_invalid");
        throw err;
      }
    }

    // This log is how the owner discovers their numeric id on first login.
    console.error(`rejected SoundCloud user id=${me.id} — no membership`);
    return landing("not_invited");
  } catch (err) {
    return errorResponse(err);
  }
}
