import {
  ProviderAuthError,
  TrackUnavailableError,
  type ProviderPage,
  type ProviderPlaylist,
  type ProviderStream,
  type ProviderTrack,
  type ProviderUser,
} from "../provider";

const API_URL = "https://api.soundcloud.com";

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 250;
const RETRY_AFTER_CAP_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelay(res: Response | null, attempt: number): number {
  const retryAfter = Number(res?.headers.get("retry-after"));
  if (retryAfter > 0) return Math.min(retryAfter * 1000, RETRY_AFTER_CAP_MS);
  return BACKOFF_BASE_MS * 2 ** attempt * (0.5 + Math.random());
}

/** Accepts a path or a full URL (pagination follows next_href); full URLs
 * must be on the SC API origin — cursors are client-supplied. */
function apiUrl(pathOrUrl: string): string {
  if (!pathOrUrl.startsWith("http")) return `${API_URL}${pathOrUrl}`;
  if (new URL(pathOrUrl).origin !== API_URL) {
    throw new Error("refusing non-SoundCloud API url");
  }
  return pathOrUrl;
}

/**
 * Docs specify `Authorization: OAuth <token>` (confirmed working); keep the
 * one-shot Bearer fallback in case that ever flips. Retries transient
 * failures (429/5xx/network) with jittered backoff, honoring Retry-After.
 */
async function scFetch(pathOrUrl: string, accessToken: string): Promise<unknown> {
  const url = apiUrl(pathOrUrl);
  const accept = { Accept: "application/json; charset=utf-8" };
  let lastFailure = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        headers: { ...accept, Authorization: `OAuth ${accessToken}` },
      });
      if (res.status === 401) {
        res = await fetch(url, {
          headers: { ...accept, Authorization: `Bearer ${accessToken}` },
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
  throw new Error(`SoundCloud API ${new URL(url).pathname} failed: ${lastFailure}`);
}

/** Cursors are base64url-wrapped next_href URLs; apiUrl() re-validates the
 * origin after decode since they round-trip through the client. */
function encodeCursor(nextHref: string): string {
  return Buffer.from(nextHref, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, "base64url").toString("utf8");
}

interface ScUser {
  id: number;
  username: string;
  permalink_url: string;
  avatar_url?: string | null;
}

interface ScTrack {
  id: number;
  title: string;
  duration: number;
  artwork_url: string | null;
  permalink_url: string;
  streamable: boolean | null;
  access?: string; // "playable" | "preview" | "blocked" on newer responses
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
  return {
    id: t.id,
    title: t.title,
    artist: t.user?.username ?? "unknown",
    artistUrl: t.user?.permalink_url ?? "",
    artworkUrl: t.artwork_url,
    permalinkUrl: t.permalink_url,
    durationMs: t.duration,
    streamable: (t.streamable ?? true) && t.access !== "blocked",
  };
}

function toPlaylist(p: ScPlaylist): ProviderPlaylist {
  return {
    id: p.id,
    title: p.title,
    trackCount: p.track_count,
    artworkUrl: p.artwork_url,
    permalinkUrl: p.permalink_url,
    durationMs: p.duration,
  };
}

/** Some SC endpoints return bare arrays instead of partitioned pages. */
function toPage<S, T>(
  data: ScPartitioned<S> | S[],
  map: (item: S) => T,
): ProviderPage<T> {
  const items = Array.isArray(data) ? data : (data.collection ?? []);
  const nextHref = Array.isArray(data) ? null : data.next_href;
  return {
    items: items.map(map),
    nextCursor: nextHref ? encodeCursor(nextHref) : null,
  };
}

export async function getMe(accessToken: string): Promise<ProviderUser> {
  const me = (await scFetch("/me", accessToken)) as ScUser;
  return {
    id: me.id,
    username: me.username,
    permalinkUrl: me.permalink_url,
    avatarUrl: me.avatar_url ?? null,
  };
}

export async function getLikesPage(
  accessToken: string,
  cursor?: string,
): Promise<ProviderPage<ProviderTrack>> {
  const url = cursor
    ? decodeCursor(cursor)
    : "/me/likes/tracks?limit=200&linked_partitioning=true";
  const data = (await scFetch(url, accessToken)) as
    | ScPartitioned<ScTrack>
    | ScTrack[];
  return toPage(data, toTrack);
}

export async function getPlaylists(
  accessToken: string,
  cursor?: string,
): Promise<ProviderPage<ProviderPlaylist>> {
  const url = cursor
    ? decodeCursor(cursor)
    : "/me/playlists?limit=20&linked_partitioning=true&show_tracks=false";
  const data = (await scFetch(url, accessToken)) as
    | ScPartitioned<ScPlaylist>
    | ScPlaylist[];
  return toPage(data, toPlaylist);
}

export async function getPlaylistTracks(
  accessToken: string,
  playlistId: number,
  cursor?: string,
): Promise<ProviderPage<ProviderTrack>> {
  const url = cursor
    ? decodeCursor(cursor)
    : `/playlists/${playlistId}/tracks?limit=200&linked_partitioning=true`;
  const data = (await scFetch(url, accessToken)) as
    | ScPartitioned<ScTrack>
    | ScTrack[];
  return toPage(data, toTrack);
}

interface ScStreams {
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
  if (streams.http_mp3_128_url) {
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
  const res = await fetch(picked.url, {
    redirect: "manual",
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  void res.body?.cancel();
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    return {
      url: new URL(location, picked.url).toString(),
      protocol: picked.protocol,
    };
  }
  if (res.ok) return picked; // already directly fetchable
  throw new TrackUnavailableError(
    `stream redirect resolution failed: ${res.status}`,
  );
}
