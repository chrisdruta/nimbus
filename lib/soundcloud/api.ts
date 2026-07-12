import type { ProviderStream, ProviderTrack, ProviderUser } from "../provider";

const API_URL = "https://api.soundcloud.com";

/**
 * Docs have historically specified `Authorization: OAuth <token>`; OAuth 2.1
 * services conventionally use `Bearer`. Try the documented form first and
 * fall back once — verify against current docs when credentials exist.
 */
async function scFetch(path: string, accessToken: string): Promise<unknown> {
  const url = `${API_URL}${path}`;
  const accept = { Accept: "application/json; charset=utf-8" };
  let res = await fetch(url, {
    headers: { ...accept, Authorization: `OAuth ${accessToken}` },
  });
  if (res.status === 401) {
    res = await fetch(url, {
      headers: { ...accept, Authorization: `Bearer ${accessToken}` },
    });
  }
  if (!res.ok) {
    throw new Error(`SoundCloud API ${path} failed: ${res.status}`);
  }
  return res.json();
}

interface ScUser {
  id: number;
  username: string;
  permalink_url: string;
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

export async function getMe(accessToken: string): Promise<ProviderUser> {
  const me = (await scFetch("/me", accessToken)) as ScUser;
  return { id: me.id, username: me.username, permalinkUrl: me.permalink_url };
}

/** First page only — full pagination is Milestone 2. */
export async function getLikesPage(
  accessToken: string,
): Promise<ProviderTrack[]> {
  const data = (await scFetch(
    "/me/likes/tracks?limit=25&linked_partitioning=true",
    accessToken,
  )) as { collection?: ScTrack[] } | ScTrack[];
  const tracks = Array.isArray(data) ? data : (data.collection ?? []);
  return tracks.map(toTrack);
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
  const streams = (await scFetch(
    `/tracks/${trackId}/streams`,
    accessToken,
  )) as ScStreams;
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
    throw new Error(`no playable stream for track ${trackId}`);
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
  throw new Error(`stream redirect resolution failed: ${res.status}`);
}
