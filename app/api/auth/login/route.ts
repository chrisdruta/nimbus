import { NextResponse } from "next/server";
import { getProvider } from "@/lib/provider";
import { generatePkce, generateState } from "@/lib/pkce";
import { setDanceCookie } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  await setDanceCookie({ state, codeVerifier: verifier });
  return NextResponse.redirect(
    getProvider().authorizeUrl({ state, codeChallenge: challenge }),
  );
}
