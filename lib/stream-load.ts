import "client-only";

import Hls from "hls.js";

/** A resolved stream as returned by POST /api/tracks/[id]/play. */
export interface StreamSource {
  url: string;
  protocol: "progressive" | "hls" | "unknown";
}

/**
 * Attach a resolved stream to an audio element. Shared by the player and
 * the cast receiver page — both need the same protocol pick.
 *
 * Prefer hls.js over native HLS wherever MSE exists: the native HLS
 * pipelines (Chrome 142+, Safari) don't feed MediaElementSourceNode,
 * which silences the viz and the volume leveler. Native is the fallback
 * for MSE-less browsers (iOS Safari).
 *
 * `onHls` fires with the hls.js instance the moment it exists — before
 * the manifest wait — so the caller can own its lifecycle (destroying a
 * superseded instance mid-load included). Resolves once the element is
 * ready to play() (progressive src set, or HLS manifest parsed).
 */
export async function loadStreamInto(
  el: HTMLAudioElement,
  stream: StreamSource,
  onHls?: (hls: Hls) => void,
): Promise<void> {
  if (stream.protocol !== "hls") {
    el.src = stream.url;
    return;
  }
  if (!Hls.isSupported()) {
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = stream.url;
      return;
    }
    throw new Error("HLS is unsupported");
  }

  const hls = new Hls({ enableWorker: true });
  onHls?.(hls);
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => finish(new Error("HLS manifest timed out")),
      15_000,
    );
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      hls.off(Hls.Events.MANIFEST_PARSED, onManifest);
      hls.off(Hls.Events.ERROR, onError);
      if (error) reject(error);
      else resolve();
    };
    const onManifest = () => finish();
    const onError = (
      _event: string,
      data: { fatal: boolean; type: string },
    ) => {
      if (data.fatal) finish(new Error(`HLS ${data.type}`));
    };
    hls.on(Hls.Events.MANIFEST_PARSED, onManifest);
    hls.on(Hls.Events.ERROR, onError);
    hls.attachMedia(el);
    hls.loadSource(stream.url);
  });
}
