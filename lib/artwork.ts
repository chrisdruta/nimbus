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
