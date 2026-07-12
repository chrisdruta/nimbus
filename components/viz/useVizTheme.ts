"use client";

import { useEffect, useState } from "react";
import { extractPalette, loadArtworkImage } from "@/lib/artwork";
import type { VizTheme } from "@/lib/viz/scene";

const FALLBACK: VizTheme = {
  accent: "#ff4200",
  accentRgb: [255, 66, 0],
  background: "#0c0c0c",
  artwork: null,
  reducedMotion: false,
};

/** Blend the vibrant color ~12% into near-black for a tinted backdrop. */
function tintedBackground([r, g, b]: [number, number, number]): string {
  const mix = (c: number) => Math.round(c * 0.12 + 12 * 0.88);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/**
 * Artwork-derived theme for the active track. Returns the fallback
 * immediately, then swaps in the palette + decoded image; the previous
 * artwork is kept until the new one finishes decoding (no flash).
 */
export function useVizTheme(artworkUrl: string | null): VizTheme {
  const [theme, setTheme] = useState<VizTheme>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      extractPalette(artworkUrl),
      loadArtworkImage(artworkUrl),
    ]).then(([palette, artwork]) => {
      if (cancelled) return;
      setTheme({
        accent: palette.vibrant,
        accentRgb: palette.vibrantRgb,
        background: palette.fromArtwork
          ? tintedBackground(palette.vibrantRgb)
          : FALLBACK.background,
        artwork,
        reducedMotion: false, // SceneHost overrides from matchMedia
      });
    });
    return () => {
      cancelled = true;
    };
  }, [artworkUrl]);

  return theme;
}
