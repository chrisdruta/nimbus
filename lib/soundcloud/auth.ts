import type { ProviderTokens } from "../provider";

const AUTHORIZE_URL = "https://secure.soundcloud.com/authorize";
const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function redirectUri(): string {
  return `${env("APP_URL")}/api/auth/callback`;
}

export function authorizeUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", env("SOUNDCLOUD_CLIENT_ID"));
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function tokenRequest(
  grant: Record<string, string>,
): Promise<ProviderTokens> {
  const body = new URLSearchParams({
    client_id: env("SOUNDCLOUD_CLIENT_ID"),
    client_secret: env("SOUNDCLOUD_CLIENT_SECRET"),
    ...grant,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json; charset=utf-8",
    },
    body,
  });
  if (!res.ok) {
    // The response body may echo request params; never log it wholesale.
    throw new Error(`SoundCloud token request failed: ${res.status}`);
  }
  const json = (await res.json()) as TokenResponse;
  if (!json.access_token || !json.refresh_token) {
    throw new Error("SoundCloud token response missing tokens");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
  };
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<ProviderTokens> {
  return tokenRequest({
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code_verifier: codeVerifier,
    code,
  });
}

/** SoundCloud refresh tokens are single-use: the response carries a NEW
 * refresh token and callers must persist both tokens together. */
export async function refresh(refreshToken: string): Promise<ProviderTokens> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}
