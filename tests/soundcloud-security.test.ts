import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getFeedPage,
  getLikesPage,
  getRelatedTracks,
  resolveStream,
} from "../lib/soundcloud/api";
import { InvalidCursorError } from "../lib/provider";

const realFetch = globalThis.fetch;
const realSessionSecret = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = realSessionSecret;
});

describe.serial("SoundCloud trust boundary", () => {
  test("never sends OAuth to a provider-supplied foreign stream host", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({
        http_mp3_128_url: "https://attacker.example/audio.mp3",
      });
    }) as unknown as typeof fetch;

    await expect(resolveStream("secret-token", 1)).rejects.toThrow(
      "untrusted stream URL",
    );
    expect(calls).toBe(1);
  });

  test("accepts current SoundCloud AAC media hosts without forwarding OAuth", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({
        hls_aac_160_url:
          "https://playback.media-streaming.soundcloud.cloud/t/aac/playlist.m3u8?sig=x",
      });
    }) as unknown as typeof fetch;

    const stream = await resolveStream("secret-token", 1);
    expect(stream.protocol).toBe("hls");
    expect(new URL(stream.url).hostname).toEndWith("soundcloud.cloud");
    expect(calls).toBe(1);
  });

  test("normalizes untrusted link and artwork fields", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        collection: [
          {
            id: 1,
            title: "track",
            duration: 1,
            streamable: true,
            artwork_url: "https://tracker.example/art.jpg",
            permalink_url: "javascript:alert(1)",
            user: {
              id: 2,
              username: "artist",
              permalink_url: "javascript:alert(2)",
            },
          },
        ],
      })) as unknown as typeof fetch;

    const page = await getLikesPage("secret-token");
    expect(page.items[0].artworkUrl).toBeNull();
    expect(page.items[0].permalinkUrl).toBe("https://soundcloud.com");
    expect(page.items[0].artistUrl).toBe("https://soundcloud.com");
  });

  test("follows an authentic cursor on the collection that issued it", async () => {
    const next =
      "https://api.soundcloud.com/me/feed/tracks?limit=50&offset=50&linked_partitioning=true";
    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return Response.json(
        seen.length === 1
          ? { collection: [], next_href: next }
          : { collection: [] },
      );
    }) as unknown as typeof fetch;

    const first = await getFeedPage("secret-token");
    expect(first.nextCursor).not.toBeNull();
    await getFeedPage("secret-token", first.nextCursor!);
    expect(seen).toEqual([
      "https://api.soundcloud.com/me/feed/tracks?limit=50&linked_partitioning=true",
      next,
    ]);
  });

  test("rejects a cursor replayed against another collection", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({
        collection: [],
        next_href:
          "https://api.soundcloud.com/me/feed/tracks?limit=50&offset=50",
      });
    }) as unknown as typeof fetch;

    const cursor = (await getFeedPage("secret-token")).nextCursor!;
    await expect(
      getRelatedTracks("secret-token", 123, cursor),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    expect(calls).toBe(1);
  });

  test("rejects a forged cursor before fetching", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({ collection: [] });
    }) as unknown as typeof fetch;
    const forged = Buffer.from(
      "https://api.soundcloud.com/tracks/123/streams",
      "utf8",
    ).toString("base64url");

    await expect(
      getFeedPage("secret-token", forged),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    expect(calls).toBe(0);
  });

  test("rejects a tampered authentic cursor before following it", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({
        collection: [],
        next_href:
          "https://api.soundcloud.com/me/feed/tracks?limit=50&offset=50",
      });
    }) as unknown as typeof fetch;

    const cursor = (await getFeedPage("secret-token")).nextCursor!;
    const last = cursor.at(-1)!;
    const tampered = `${cursor.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    await expect(
      getFeedPage("secret-token", tampered),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    expect(calls).toBe(1);
  });
});
