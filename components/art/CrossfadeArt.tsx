"use client";

import { useEffect, useRef, useState } from "react";
import { artworkSized, loadArtworkImage } from "@/lib/artwork";

interface Layer {
  src: string;
  key: number;
}

/**
 * Stacked-image crossfade: when `url` changes, the new artwork is decoded
 * off-screen first, then mounts on top and fades in while the old layer
 * lingers underneath — never a half-loaded pop, only opacity animates.
 */
export function CrossfadeArt({
  url,
  className = "",
  durationMs = 1000,
}: {
  url: string | null;
  className?: string;
  durationMs?: number;
}) {
  const sized = artworkSized(url, "t500x500");
  const [layers, setLayers] = useState<Layer[]>([]);
  const keyRef = useRef(0);
  const latestRef = useRef<string | null>(null);

  useEffect(() => {
    latestRef.current = sized;
    if (!sized) {
      setLayers([]);
      return;
    }
    let stale = false;
    void loadArtworkImage(url).then((img) => {
      if (stale || latestRef.current !== sized) return;
      if (!img) {
        setLayers([]); // decode failed — let the fallback underneath show
        return;
      }
      setLayers((prev) =>
        prev[prev.length - 1]?.src === sized
          ? prev
          : [...prev.slice(-1), { src: sized, key: ++keyRef.current }],
      );
    });
    return () => {
      stale = true;
    };
  }, [sized, url]);

  // Once the top layer has fully faded in, the one beneath is invisible.
  useEffect(() => {
    if (layers.length < 2) return;
    const t = setTimeout(
      () => setLayers((prev) => prev.slice(-1)),
      durationMs + 100,
    );
    return () => clearTimeout(t);
  }, [layers, durationMs]);

  return (
    <>
      {layers.map((l) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={l.key}
          src={l.src}
          alt=""
          aria-hidden
          className={`absolute inset-0 h-full w-full ${className}`}
          style={{ animation: `art-fade-in ${durationMs}ms ease forwards` }}
        />
      ))}
    </>
  );
}
