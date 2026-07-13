import { buildHistogram, pickVibrant } from "./viz/palette";

/** SoundCloud artwork URLs embed their size ("...-large.jpg" = 100x100);
 * swapping the suffix requests other renditions from the same CDN. */
export function artworkSized(
  url: string | null,
  size: "t300x300" | "t500x500" | "large",
): string | null {
  return url ? url.replace(/-large(\.\w+)$/, `-${size}$1`) : null;
}

export interface ArtPalette {
  vibrant: string;
  vibrantRgb: [number, number, number];
  /** False when extraction failed and the app accent was used. */
  fromArtwork: boolean;
}

const FALLBACK_PALETTE: ArtPalette = {
  vibrant: "#ff4200",
  vibrantRgb: [255, 66, 0],
  fromArtwork: false,
};

const paletteCache = new Map<string, Promise<ArtPalette>>();

/**
 * Dominant vibrant color of an artwork image for visualization theming.
 * Tainted/CORS-less images fall back to the app accent.
 */
export function extractPalette(url: string | null): Promise<ArtPalette> {
  if (!url) return Promise.resolve(FALLBACK_PALETTE);
  const cached = paletteCache.get(url);
  if (cached) return cached;

  const promise = new Promise<ArtPalette>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve(FALLBACK_PALETTE);
    img.onload = () => {
      try {
        const side = 24;
        const canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        const g = canvas.getContext("2d");
        if (!g) return resolve(FALLBACK_PALETTE);
        g.drawImage(img, 0, 0, side, side);
        const { data } = g.getImageData(0, 0, side, side);
        const rgb = pickVibrant(buildHistogram(data));
        if (!rgb) return resolve(FALLBACK_PALETTE);
        const [r, gr, b] = rgb;
        resolve({
          vibrant: `rgb(${r}, ${gr}, ${b})`,
          vibrantRgb: [r, gr, b],
          fromArtwork: true,
        });
      } catch {
        resolve(FALLBACK_PALETTE); // tainted canvas — CORS-less image host
      }
    };
    img.src = url;
  });

  paletteCache.set(url, promise);
  return promise;
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

/** Decoded high-res artwork for scenes that draw it; null on failure. */
export function loadArtworkImage(
  url: string | null,
): Promise<HTMLImageElement | null> {
  const sized = artworkSized(url, "t500x500");
  if (!sized) return Promise.resolve(null);
  const cached = imageCache.get(sized);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve(null);
    img.onload = () => resolve(img);
    img.src = sized;
  });
  imageCache.set(sized, promise);
  return promise;
}
