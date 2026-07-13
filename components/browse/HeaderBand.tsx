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
    <header className="flex items-end gap-6 bg-gradient-to-b from-black/30 to-transparent px-6 pt-16 pb-6">
      {artworkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artworkSized(artworkUrl, "t300x300") ?? undefined}
          alt=""
          className="hidden h-36 w-36 rounded-md object-cover shadow-2xl sm:block"
        />
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-4xl font-bold">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        {actions && <div className="mt-4 flex items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}
