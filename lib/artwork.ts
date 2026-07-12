import { buildHistogram, pickVibrant } from "./viz/palette";

/** SoundCloud artwork URLs embed their size ("...-large.jpg" = 100x100);
 * swapping the suffix requests other renditions from the same CDN. */
export function artworkSized(
  url: string | null,
  size: "t300x300" | "t500x500" | "large",
): string | null {
  return url ? url.replace(/-large(\.\w+)$/, `-${size}$1`) : null;
}

const DEFAULT_TINT = "#282828";
const tintCache = new Map<string, string>();

/**
 * Average color of an artwork image for the browse header band, blended
 * toward the page background so overlaid text stays legible. Falls back to
 * a neutral tint if the image fails or the canvas is tainted.
 */
export async function averageColor(url: string | null): Promise<string> {
  if (!url) return DEFAULT_TINT;
  const cached = tintCache.get(url);
  if (cached) return cached;

  const color = await new Promise<string>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve(DEFAULT_TINT);
    img.onload = () => {
      try {
        const side = 8;
        const canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        const g = canvas.getContext("2d");
        if (!g) return resolve(DEFAULT_TINT);
        g.drawImage(img, 0, 0, side, side);
        const { data } = g.getImageData(0, 0, side, side);
        let r = 0;
        let gr = 0;
        let b = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          gr += data[i + 1];
          b += data[i + 2];
        }
        // Blend ~45% of the artwork color into the dark background.
        const mix = (c: number) => Math.round((c / n) * 0.45 + 24 * 0.55);
        resolve(`rgb(${mix(r)}, ${mix(gr)}, ${mix(b)})`);
      } catch {
        resolve(DEFAULT_TINT); // tainted canvas — CORS-less image host
      }
    };
    img.src = url;
  });

  tintCache.set(url, color);
  return color;
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
 * Same CORS/taint story as averageColor; falls back to the app accent.
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
