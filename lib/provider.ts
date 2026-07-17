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
  /** Provider id of the artist; absent on records persisted before it
   * existed (backfilled as undefined — UI must degrade to artistUrl). */
  artistId?: number;
  artistUrl: string;
  artworkUrl: string | null;
  permalinkUrl: string;
  durationMs: number;
  /** False when the provider marks the track non-streamable off-platform. */
  streamable: boolean;
  /** True when the provider serves only a short (~30s) preview stream.
   * Absent on full tracks and on records persisted before the field existed. */
  preview?: boolean;
}

/** An artist profile — the subject of search results and artist pages. */
export interface ProviderArtist {
  id: number;
  username: string;
  permalinkUrl: string;
  avatarUrl: string | null;
  city: string | null;
  country: string | null;
  /** Null when the provider omits the count on this response shape. */
  followersCount: number | null;
  trackCount: number | null;
}

export interface ProviderPlaylist {
  id: number;
  title: string;
  trackCount: number;
  artworkUrl: string | null;
  permalinkUrl: string;
  durationMs: number;
}

export interface ProviderFeedItem {
  track: ProviderTrack;
  /** True when the item reached the feed as a repost. The public API only
   * exposes the reposter as a bare URN, so there is no name to show. */
  reposted: boolean;
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

/** The viewer's relationship to a track: liked it, follows its artist. */
export interface TrackSocial {
  liked: boolean;
  artistId: number;
  artistFollowed: boolean;
}

/** The provider rejected our credentials even after refresh — re-login. */
export class ProviderAuthError extends Error {}

/** This specific track cannot be streamed (blocked/region/API-disabled). */
export class TrackUnavailableError extends Error {}

/** A pagination cursor failed integrity or route-binding validation. */
export class InvalidCursorError extends Error {}

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
  getRelatedTracks(
    accessToken: string,
    trackId: number,
    cursor?: string,
  ): Promise<ProviderPage<ProviderTrack>>;
  getFeedPage(
    accessToken: string,
    cursor?: string,
  ): Promise<ProviderPage<ProviderFeedItem>>;
  searchTracks(
    accessToken: string,
    query: string,
    cursor?: string,
  ): Promise<ProviderPage<ProviderTrack>>;
  searchArtists(
    accessToken: string,
    query: string,
    cursor?: string,
  ): Promise<ProviderPage<ProviderArtist>>;
  getArtist(accessToken: string, artistId: number): Promise<ProviderArtist>;
  getArtistTracks(
    accessToken: string,
    artistId: number,
    cursor?: string,
  ): Promise<ProviderPage<ProviderTrack>>;
  getArtistFollowed(accessToken: string, artistId: number): Promise<boolean>;
  resolveStream(accessToken: string, trackId: number): Promise<ProviderStream>;
  /**
   * Whole-track amplitude samples (arbitrary integer scale), or null when
   * the provider has none. Deliberately a method, not a ProviderTrack
   * field — lists shouldn't carry per-track waveform URLs around.
   */
  getWaveform(accessToken: string, trackId: number): Promise<number[] | null>;
  getTrackSocial(accessToken: string, trackId: number): Promise<TrackSocial>;
  /** Both are idempotent: re-liking / un-liking something already in that
   * state succeeds quietly. */
  setTrackLiked(
    accessToken: string,
    trackId: number,
    liked: boolean,
  ): Promise<void>;
  setArtistFollowed(
    accessToken: string,
    artistId: number,
    followed: boolean,
  ): Promise<void>;
}

export function getProvider(): MusicProvider {
  return soundcloudProvider;
}
