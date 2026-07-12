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
  avatarUrl: string | null;
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

export interface ProviderPlaylist {
  id: number;
  title: string;
  trackCount: number;
  artworkUrl: string | null;
  permalinkUrl: string;
  durationMs: number;
}

export interface ProviderStream {
  url: string;
  protocol: "progressive" | "hls" | "unknown";
}

export interface ProviderPage<T> {
  items: T[];
  /** Opaque token for the next page; null when exhausted. */
  nextCursor: string | null;
}

/** The provider rejected our credentials even after refresh — re-login. */
export class ProviderAuthError extends Error {}

/** This specific track cannot be streamed (blocked/region/API-disabled). */
export class TrackUnavailableError extends Error {}

export interface MusicProvider {
  /** Where to send the user's browser to authorize (OAuth 2.1 + PKCE). */
  authorizeUrl(params: { state: string; codeChallenge: string }): string;
  exchangeCode(code: string, codeVerifier: string): Promise<ProviderTokens>;
  refresh(refreshToken: string): Promise<ProviderTokens>;
  getMe(accessToken: string): Promise<ProviderUser>;
  getLikesPage(
    accessToken: string,
    cursor?: string,
  ): Promise<ProviderPage<ProviderTrack>>;
  getPlaylists(
    accessToken: string,
    cursor?: string,
  ): Promise<ProviderPage<ProviderPlaylist>>;
  getPlaylistTracks(
    accessToken: string,
    playlistId: number,
    cursor?: string,
  ): Promise<ProviderPage<ProviderTrack>>;
  resolveStream(accessToken: string, trackId: number): Promise<ProviderStream>;
}

export function getProvider(): MusicProvider {
  return soundcloudProvider;
}
