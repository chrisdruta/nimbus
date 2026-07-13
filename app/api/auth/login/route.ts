import { NextResponse, type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { generatePkce, generateState } from "@/lib/pkce";
import { setDanceCookie } from "@/lib/session";
import { errorResponse } from "@/lib/route-helpers";
import { consumeRateLimit, requestIp } from "@/lib/rate-limit";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    consumeRateLimit(`login:${requestIp(req.headers)}`, 30, 10 * 60_000);
    const { verifier, challenge } = generatePkce();
    const state = generateState();
    const rawInvite = req.nextUrl.searchParams.get("invite") ?? undefined;
    const invite =
      rawInvite && /^[A-Za-z0-9_-]{22}$/.test(rawInvite)
        ? rawInvite
        : undefined;
    await setDanceCookie({ state, codeVerifier: verifier, invite });
    return NextResponse.redirect(
      getProvider().authorizeUrl({ state, codeChallenge: challenge }),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
