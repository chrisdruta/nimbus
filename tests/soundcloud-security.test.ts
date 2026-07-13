import { afterEach, describe, expect, test } from "bun:test";
import { getLikesPage, resolveStream } from "../lib/soundcloud/api";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
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
});
