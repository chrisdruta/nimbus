import { soundcloudProvider } from "./soundcloud";

/** Normalized shapes — nothing outside lib/soundcloud/ sees raw SC responses. */

export interface ProviderTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface ProviderUser {
  id: number;
  username: string;
  permalinkUrl: string;
}

export interface ProviderTrack {
  id: number;
  title: string;
  artist: string;
  artistUrl: string;
  artworkUrl: string | null;
  permalinkUrl: string;
  durationMs: number;
  /** False when the provider marks the track non-streamable off-platform. */
  streamable: boolean;
}

export interface ProviderStream {
  url: string;
  protocol: "progressive" | "hls" | "unknown";
}

export interface MusicProvider {
  /** Where to send the user's browser to authorize (OAuth 2.1 + PKCE). */
  authorizeUrl(params: { state: string; codeChallenge: string }): string;
  exchangeCode(code: string, codeVerifier: string): Promise<ProviderTokens>;
  refresh(refreshToken: string): Promise<ProviderTokens>;
  getMe(accessToken: string): Promise<ProviderUser>;
  getLikesPage(accessToken: string): Promise<ProviderTrack[]>;
  resolveStream(accessToken: string, trackId: number): Promise<ProviderStream>;
}

export function getProvider(): MusicProvider {
  return soundcloudProvider;
}
