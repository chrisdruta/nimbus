import { createHmac, timingSafeEqual } from "node:crypto";
import {
  InvalidCursorError,
  ProviderAuthError,
  TrackUnavailableError,
  type ProviderArtist,
  type ProviderFeedItem,
  type ProviderPage,
  type ProviderPlaylist,
  type ProviderStream,
  type ProviderTrack,
  type ProviderUser,
  type TrackSocial,
} from "../provider";

const API_URL = "https://api.soundcloud.com";

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 250;
const RETRY_AFTER_CAP_MS = 2000;
const REQUEST_TIMEOUT_MS = 10_000;
const CURSOR_MAC_BYTES = 32;
const CURSOR_VERSION = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelay(res: Response | null, attempt: number): number {
  const retryAfter = Number(res?.headers.get("retry-after"));
  if (retryAfter > 0) return Math.min(retryAfter * 1000, RETRY_AFTER_CAP_MS);
  return BACKOFF_BASE_MS * 2 ** attempt * (0.5 + Math.random());
}

/** Accepts a path or a full URL; full URLs must be on the SC API origin.
 * Pagination URLs receive stronger signature + path checks below. */
function apiUrl(pathOrUrl: string): string {
  if (!pathOrUrl.startsWith("http")) return `${API_URL}${pathOrUrl}`;
  if (new URL(pathOrUrl).origin !== API_URL) {
    throw new Error("refusing non-SoundCloud API url");
  }
  return pathOrUrl;
}

function isSoundCloudWebHost(hostname: string): boolean {
  return hostname === "soundcloud.com" || hostname.endsWith(".soundcloud.com");
}

function isMediaHost(hostname: string): boolean {
  return (
    hostname === "sndcdn.com" ||
    hostname.endsWith(".sndcdn.com") ||
    hostname === "soundcloud.cloud" ||
    hostname.endsWith(".soundcloud.cloud")
  );
}

function checkedHttpsUrl(
  value: string,
  allowed: (host: string) => boolean,
): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !allowed(url.hostname)) {
    throw new Error("refusing untrusted SoundCloud response URL");
  }
  return url.toString();
}

function webUrl(value: string | undefined): string {
  try {
    return value
      ? checkedHttpsUrl(value, isSoundCloudWebHost)
      : "https://soundcloud.com";
  } catch {
    return "https://soundcloud.com";
  }
}

function artworkUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return checkedHttpsUrl(
      value,
      (host) => host === "sndcdn.com" || host.endsWith(".sndcdn.com"),
    );
  } catch {
    return null;
  }
}

/**
 * Docs specify `Authorization: OAuth <token>` (confirmed working); keep the
 * one-shot Bearer fallback in case that ever flips. Retries transient
 * failures (429/5xx/network) with jittered backoff, honoring Retry-After.
 */
async function scFetch(
  pathOrUrl: string,
  accessToken: string,
): Promise<unknown> {
  const url = apiUrl(pathOrUrl);
  const accept = { Accept: "application/json; charset=utf-8" };
  let lastFailure = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        headers: { ...accept, Authorization: `OAuth ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 401) {
        res = await fetch(url, {
          headers: { ...accept, Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.status === 401) {
          throw new ProviderAuthError("SoundCloud rejected the access token");
        }
      }
      if (res.ok) return res.json();
      lastFailure = `status ${res.status}`;
      if (res.status !== 429 && res.status < 500) break; // 4xx: don't retry
    } catch (err) {
      if (err instanceof ProviderAuthError) throw err;
      lastFailure = `network error: ${err}`; // fetch TypeError etc.
    }
    if (attempt < MAX_ATTEMPTS - 1) await sleep(retryDelay(res, attempt));
  }
  throw new Error(
    `SoundCloud API ${new URL(url).pathname} failed: ${lastFailure}`,
  );
}

/**
 * Non-GET calls (like/follow writes) and existence probes. Same auth and
 * transient-retry behavior as scFetch, but the caller decides what each
 * final status means, so a 404 can be an answer instead of an error.
 */
async function scSend(
  path: string,
  accessToken: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
): Promise<number> {
  const url = apiUrl(path);
  const accept = { Accept: "application/json; charset=utf-8" };
  let lastFailure = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        method,
        headers: { ...accept, Authorization: `OAuth ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 401) {
        res = await fetch(url, {
          method,
          headers: { ...accept, Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.status === 401) {
          throw new ProviderAuthError("SoundCloud rejected the access token");
        }
      }
      void res.body?.cancel();
      if (res.status !== 429 && res.status < 500) return res.status;
      lastFailure = `status ${res.status}`;
    } catch (err) {
      if (err instanceof ProviderAuthError) throw err;
      lastFailure = `network error: ${err}`;
    }
    if (attempt < MAX_ATTEMPTS - 1) await sleep(retryDelay(res, attempt));
  }
  throw new Error(
    `SoundCloud API ${method} ${new URL(url).pathname} failed: ${lastFailure}`,
  );
}

function cursorKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }
  return Buffer.from(secret, "utf8");
}

function cursorMac(payload: Buffer, key: Buffer = cursorKey()): Buffer {
  return createHmac("sha256", key)
    .update("nimbus:pagination:v1\0", "utf8")
    .update(payload)
    .digest();
}

function paginationUrl(nextHref: string, expectedPath: string): string {
  const url = new URL(nextHref, API_URL);
  if (
    url.protocol !== "https:" ||
    url.origin !== API_URL ||
    url.pathname !== expectedPath ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("provider returned an invalid pagination URL");
  }
  return url.toString();
}

/** Cursors carry an HMAC-authenticated next_href and the exact collection
 * path that issued it. This prevents clients from turning a discovery route
 * into an authenticated request oracle for other SoundCloud endpoints. */
function encodeCursor(nextHref: string, expectedPath: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: CURSOR_VERSION,
      path: expectedPath,
      url: paginationUrl(nextHref, expectedPath),
    }),
    "utf8",
  );
  return Buffer.concat([payload, cursorMac(payload)]).toString("base64url");
}

function decodeCursor(cursor: string, expectedPath: string): string {
  // Configuration failures are server errors, not malformed client input.
  const key = cursorKey();
  try {
    const packed = Buffer.from(cursor, "base64url");
    if (packed.toString("base64url") !== cursor) {
      throw new Error("non-canonical cursor encoding");
    }
    if (packed.length <= CURSOR_MAC_BYTES) {
      throw new Error("truncated cursor");
    }
    const payload = packed.subarray(0, -CURSOR_MAC_BYTES);
    const suppliedMac = packed.subarray(-CURSOR_MAC_BYTES);
    const expectedMac = cursorMac(payload, key);
    if (!timingSafeEqual(suppliedMac, expectedMac)) {
      throw new Error("bad cursor signature");
    }
    const parsed = JSON.parse(payload.toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { v?: unknown }).v !== CURSOR_VERSION ||
      (parsed as { path?: unknown }).path !== expectedPath ||
      typeof (parsed as { url?: unknown }).url !== "string"
    ) {
      throw new Error("cursor scope mismatch");
    }
    return paginationUrl(
      (parsed as { url: string }).url,
      expectedPath,
    );
  } catch {
    throw new InvalidCursorError("malformed pagination cursor");
  }
}

interface ScUser {
  id: number;
  username: string;
  permalink_url: string;
  avatar_url?: string | null;
  city?: string | null;
  country?: string | null;
  followers_count?: number | null;
  track_count?: number | null;
}

interface ScTrack {
  id: number;
  title: string;
  duration: number;
  artwork_url: string | null;
  permalink_url: string;
  streamable: boolean | null;
  access?: string; // "playable" | "preview" | "blocked" on newer responses
  waveform_url?: string | null; // PNG on wave.sndcdn.com; .json sibling exists
  // Per the spec, only meaningful on single-track fetches (else false).
  user_favorite?: boolean;
  user: ScUser;
}

interface ScPlaylist {
  id: number;
  title: string;
  track_count: number;
  artwork_url: string | null;
  permalink_url: string;
  duration: number;
}

interface ScPartitioned<T> {
  collection?: T[];
  next_href?: string | null;
}

function toTrack(t: ScTrack): ProviderTrack {
  const artistId =
    typeof t.user?.id === "number" &&
    Number.isSafeInteger(t.user.id) &&
    t.user.id > 0
      ? t.user.id
      : undefined;
  return {
    id: t.id,
    title: t.title,
    artist: t.user?.username ?? "unknown",
    ...(artistId === undefined ? {} : { artistId }),
    artistUrl: webUrl(t.user?.permalink_url),
    artworkUrl: artworkUrl(t.artwork_url),
    permalinkUrl: webUrl(t.permalink_url),
    durationMs: t.duration,
    streamable: (t.streamable ?? true) && t.access !== "blocked",
  };
}

function toPlaylist(p: ScPlaylist): ProviderPlaylist {
  return {
    id: p.id,
    title: p.title,
    trackCount: p.track_count,
    artworkUrl: artworkUrl(p.artwork_url),
    permalinkUrl: webUrl(p.permalink_url),
    durationMs: p.duration,
  };
}

function toArtist(u: ScUser): ProviderArtist {
  const count = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  const text = (s: string | null | undefined) =>
    typeof s === "string" && s.trim() !== "" ? s : null;
  return {
    id: u.id,
    username: u.username,
    permalinkUrl: webUrl(u.permalink_url),
    avatarUrl: artworkUrl(u.avatar_url),
    city: text(u.city),
    country: text(u.country),
    followersCount: count(u.followers_count),
    trackCount: count(u.track_count),
  };
}

/** Some SC endpoints return bare arrays instead of partitioned pages. */
function toPage<S, T>(
  data: ScPartitioned<S> | S[],
  map: (item: S) => T,
  expectedPath: string,
): ProviderPage<T> {
  const items = Array.isArray(data) ? data : (data.collection ?? []);
  const nextHref = Array.isArray(data) ? null : data.next_href;
  return {
    items: items.map(map),
    nextCursor: nextHref ? encodeCursor(nextHref, expectedPath) : null,
  };
}

export async function getMe(accessToken: string): Promise<ProviderUser> {
  const me = (await scFetch("/me", accessToken)) as ScUser;
  return {
    id: me.id,
    username: me.username,
    permalinkUrl: webUrl(me.permalink_url),
    avatarUrl: artworkUrl(me.avatar_url),
  };
}

export async function getLikesPage(
  accessToken: string,
  cursor?: string,
): Promise<ProviderPage<ProviderTrack>> {
  const path = "/me/likes/tracks";
  const url = cursor
    ? decodeCursor(cursor, path)
    : `${path}?limit=200&linked_partitioning=true`;
  const data = (await scFetch(url, accessToken)) as
    ScPartitioned<ScTrack> | ScTrack[];
  return toPage(data, toTrack, path);
}

export async function getPlaylists(
  accessToken: string,
  cursor?: string,
): Promise<ProviderPage<ProviderPlaylist>> {
  const path = "/me/playlists";
  const url = cursor
    ? decodeCursor(cursor, path)
    : `${path}?limit=20&linked_partitioning=true&show_tracks=false`;
  const data = (await scFetch(url, accessToken)) as
    ScPartitioned<ScPlaylist> | ScPlaylist[];
  return toPage(data, toPlaylist, path);
}

export async function getPlaylistTracks(
  accessToken: string,
  playlistId: number,
  cursor?: string,
): Promise<ProviderPage<ProviderTrack>> {
  const path = `/playlists/${playlistId}/tracks`;
  const url = cursor
    ? decodeCursor(cursor, path)
    : `${path}?limit=200&linked_partitioning=true`;
  const data = (await scFetch(url, accessToken)) as
    ScPartitioned<ScTrack> | ScTrack[];
  return toPage(data, toTrack, path);
}

export async function getRelatedTracks(
  accessToken: string,
  trackId: number,
  cursor?: string,
): Promise<ProviderPage<ProviderTrack>> {
  const path = `/tracks/${trackId}/related`;
  const url = cursor
    ? decodeCursor(cursor, path)
    : `${path}?limit=50&linked_partitioning=true`;
  const data = (await scFetch(url, accessToken)) as
    ScPartitioned<ScTrack> | ScTrack[];
  return toPage(data, toTrack, path);
}

/** /me/feed/tracks activity item: the track rides in `origin`; `reposter`
 * is a bare user URN string on repost items (no display name available). */
interface ScFeedItem {
  type?: string;
  origin?: ScTrack | null;
  reposter?: string;
}

function toFeedItem(item: ScFeedItem): ProviderFeedItem | null {
  const t = item?.origin;
  if (typeof t?.id !== "number" || typeof t.title !== "string") return null;
  return { track: toTrack(t), reposted: item.type === "track:repost" };
}

export async function getFeedPage(
  accessToken: string,
  cursor?: string,
): Promise<ProviderPage<ProviderFeedItem>> {
  const path = "/me/feed/tracks";
  const url = cursor
    ? decodeCursor(cursor, path)
    : `${path}?limit=50&linked_partitioning=true`;
  const data = (await scFetch(url, accessToken)) as
    ScPartitioned<ScFeedItem> | ScFeedItem[];
  const page = toPage(data, toFeedItem, path);
  return {
    items: page.items.filter((i): i is ProviderFeedItem => i !== null),
    nextCursor: page.nextCursor,
  };
}

/** Full-catalog search (`GET /tracks?q=`). `access=playable,preview` keeps
 * region-blocked results out — a search full of grey rows helps nobody. */
export async function searchTracks(
  accessToken: string,
  query: string,
  cursor?: string,
): Promise<ProviderPage<ProviderTrack>> {
  const path = "/tracks";
  const url = cursor
    ? decodeCursor(cursor, path)
    : `${path}?q=${encodeURIComponent(query)}` +
      `&access=playable,preview&limit=50&linked_partitioning=true`;
  const data = (await scFetch(url, accessToken)) as
    ScPartitioned<ScTrack> | ScTrack[];
  return toPage(data, toTrack, path);
}

export async function searchArtists(
  accessToken: string,
  query: string,
  cursor?: string,
): Promise<ProviderPage<ProviderArtist>> {
  const path = "/users";
  const url = cursor
    ? decodeCursor(cursor, path)
    : `${path}?q=${encodeURIComponent(query)}&limit=50&linked_partitioning=true`;
  const data = (await scFetch(url, accessToken)) as
    ScPartitioned<ScUser> | ScUser[];
  return toPage(data, toArtist, path);
}

export async function getArtist(
  accessToken: string,
  artistId: number,
): Promise<ProviderArtist> {
  try {
    const user = (await scFetch(`/users/${artistId}`, accessToken)) as ScUser;
    return toArtist(user);
  } catch (err) {
    if (err instanceof ProviderAuthError) throw err;
    // Deleted/unknown artists 4xx here — a per-resource condition, same
    // vocabulary as track lookups.
    throw new TrackUnavailableError(`artist lookup failed: ${err}`);
  }
}

/** No `access` filter: an artist page shows the whole catalog and greys
 * out unplayable tracks, matching library behavior. */
export async function getArtistTracks(
  accessToken: string,
  artistId: number,
  cursor?: string,
): Promise<ProviderPage<ProviderTrack>> {
  const path = `/users/${artistId}/tracks`;
  const url = cursor
    ? decodeCursor(cursor, path)
    : `${path}?limit=50&linked_partitioning=true`;
  const data = (await scFetch(url, accessToken)) as
    ScPartitioned<ScTrack> | ScTrack[];
  return toPage(data, toTrack, path);
}

/** GET /me/followings/{id}: 200 when followed, 404 when not. */
export async function getArtistFollowed(
  accessToken: string,
  artistId: number,
): Promise<boolean> {
  const status = await scSend(`/me/followings/${artistId}`, accessToken, "GET");
  return status >= 200 && status < 300;
}

/** The .json sibling of the waveform PNG: samples on a 0..height scale. */
interface ScWaveform {
  height?: number;
  samples?: number[];
}

/**
 * Whole-track amplitude envelope. The public API serializes waveform_url
 * as a PNG on the sndcdn waveform CDN; swapping the extension yields JSON
 * ({width, height, samples}). That variant is undocumented, so absolutely
 * everything degrades to null rather than throwing.
 */
export async function getWaveform(
  accessToken: string,
  trackId: number,
): Promise<number[] | null> {
  let track: ScTrack;
  try {
    track = (await scFetch(`/tracks/${trackId}`, accessToken)) as ScTrack;
  } catch (err) {
    if (err instanceof ProviderAuthError) throw err;
    return null;
  }
  if (!track.waveform_url) return null;

  let jsonUrl: string;
  try {
    jsonUrl = checkedHttpsUrl(
      track.waveform_url.replace(/\.png$/, ".json"),
      (host) => host === "sndcdn.com" || host.endsWith(".sndcdn.com"),
    );
  } catch {
    return null;
  }
  if (!jsonUrl.endsWith(".json")) return null;

  try {
    // Plain CDN fetch — no auth header leaves the API origin.
    const res = await fetch(jsonUrl, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ScWaveform;
    if (!Array.isArray(data.samples) || data.samples.length === 0) return null;
    if (!data.samples.every((s) => typeof s === "number" && Number.isFinite(s))) {
      return null;
    }
    return data.samples;
  } catch {
    return null;
  }
}

interface ScStreams {
  hls_aac_160_url?: string;
  hls_aac_96_url?: string;
  http_mp3_128_url?: string;
  hls_mp3_128_url?: string;
  hls_opus_64_url?: string;
  preview_mp3_128_url?: string;
}

export async function resolveStream(
  accessToken: string,
  trackId: number,
): Promise<ProviderStream> {
  let streams: ScStreams;
  try {
    streams = (await scFetch(
      `/tracks/${trackId}/streams`,
      accessToken,
    )) as ScStreams;
  } catch (err) {
    if (err instanceof ProviderAuthError) throw err;
    // Deleted/blocked/geo-fenced tracks 4xx here — a per-track condition.
    throw new TrackUnavailableError(`streams lookup failed: ${err}`);
  }
  let picked: ProviderStream;
  if (streams.hls_aac_160_url ?? streams.hls_aac_96_url) {
    picked = {
      url: (streams.hls_aac_160_url ?? streams.hls_aac_96_url)!,
      protocol: "hls",
    };
  } else if (streams.http_mp3_128_url) {
    picked = { url: streams.http_mp3_128_url, protocol: "progressive" };
  } else if (streams.hls_mp3_128_url ?? streams.hls_opus_64_url) {
    picked = {
      url: (streams.hls_mp3_128_url ?? streams.hls_opus_64_url)!,
      protocol: "hls",
    };
  } else if (streams.preview_mp3_128_url) {
    picked = { url: streams.preview_mp3_128_url, protocol: "progressive" };
  } else {
    throw new TrackUnavailableError(`no playable stream for track ${trackId}`);
  }

  // The variant URL lives on api.soundcloud.com and demands the OAuth header,
  // which a media element can't send. Follow the authorized 302 here and hand
  // the browser the final signed CDN URL (CORS-enabled, auth in the query
  // signature) — the audio itself still flows browser -> CDN directly.
  const pickedUrl = new URL(picked.url);
  if (pickedUrl.protocol !== "https:") {
    throw new TrackUnavailableError("provider returned a non-HTTPS stream URL");
  }
  if (isMediaHost(pickedUrl.hostname)) {
    return { url: pickedUrl.toString(), protocol: picked.protocol };
  }
  if (pickedUrl.origin !== API_URL) {
    throw new TrackUnavailableError(
      "provider returned an untrusted stream URL",
    );
  }

  const res = await fetch(pickedUrl, {
    redirect: "manual",
    headers: { Authorization: `OAuth ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  void res.body?.cancel();
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    try {
      return {
        url: checkedHttpsUrl(
          new URL(location, pickedUrl).toString(),
          isMediaHost,
        ),
        protocol: picked.protocol,
      };
    } catch {
      throw new TrackUnavailableError(
        "provider redirected to an untrusted host",
      );
    }
  }
  if (res.ok) return { url: pickedUrl.toString(), protocol: picked.protocol };
  throw new TrackUnavailableError(
    `stream redirect resolution failed: ${res.status}`,
  );
}

// ------------------------------------------------------------ social

export async function getTrackSocial(
  accessToken: string,
  trackId: number,
): Promise<TrackSocial> {
  let track: ScTrack;
  try {
    track = (await scFetch(`/tracks/${trackId}`, accessToken)) as ScTrack;
  } catch (err) {
    if (err instanceof ProviderAuthError) throw err;
    throw new TrackUnavailableError(`track lookup failed: ${err}`);
  }
  const artistId = track.user?.id;
  if (!artistId) {
    throw new TrackUnavailableError(`track ${trackId} has no artist`);
  }
  return {
    liked: track.user_favorite === true,
    artistId,
    artistFollowed: await getArtistFollowed(accessToken, artistId),
  };
}

export async function setTrackLiked(
  accessToken: string,
  trackId: number,
  liked: boolean,
): Promise<void> {
  const status = liked
    ? await scSend(`/likes/tracks/${trackId}`, accessToken, "POST")
    : await scSend(`/likes/tracks/${trackId}`, accessToken, "DELETE");
  // Unliking a track that isn't liked 404s — already in the desired state.
  if (status >= 200 && status < 300) return;
  if (!liked && status === 404) return;
  throw new TrackUnavailableError(
    `${liked ? "like" : "unlike"} failed: status ${status}`,
  );
}

export async function setArtistFollowed(
  accessToken: string,
  artistId: number,
  followed: boolean,
): Promise<void> {
  const status = followed
    ? await scSend(`/me/followings/${artistId}`, accessToken, "PUT")
    : await scSend(`/me/followings/${artistId}`, accessToken, "DELETE");
  if (status >= 200 && status < 300) return;
  if (!followed && status === 404) return; // already not following
  throw new TrackUnavailableError(
    `${followed ? "follow" : "unfollow"} failed: status ${status}`,
  );
}
