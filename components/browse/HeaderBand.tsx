"use client";

import { artworkSized } from "@/lib/artwork";

/** Browse-view header. Sits directly on the ambient backdrop — no tint
 * band of its own, just a soft top scrim so the title always reads. */
export function HeaderBand({
  title,
  subtitle,
  artworkUrl,
  actions,
}: {
  title: string;
  subtitle?: string;
  artworkUrl: string | null;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3 bg-gradient-to-b from-black/30 to-transparent px-6 pt-8 pb-4 2xl:px-10">
      {artworkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artworkSized(artworkUrl, "t300x300") ?? undefined}
          alt=""
          className="hidden h-24 w-24 rounded-md object-cover shadow-xl sm:block"
        />
      )}
      <div className="min-w-0 flex-1 basis-52">
        <h1 className="truncate text-2xl font-bold 2xl:text-3xl">{title}</h1>
        {subtitle && (
          <p className="mt-1 truncate text-xs text-muted 2xl:text-sm">{subtitle}</p>
        )}
      </div>
      {/* Actions anchor the band's right edge; on narrow screens they wrap
          to their own row below the title. */}
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
