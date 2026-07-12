import { NextResponse, type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { generatePkce, generateState } from "@/lib/pkce";
import { setDanceCookie } from "@/lib/session";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  // The invite code rides the signed dance cookie, never the SoundCloud
  // redirect, so it can't leak via referrers or the provider's logs.
  const invite = req.nextUrl.searchParams.get("invite") ?? undefined;
  await setDanceCookie({ state, codeVerifier: verifier, invite });
  return NextResponse.redirect(
    getProvider().authorizeUrl({ state, codeChallenge: challenge }),
  );
}
