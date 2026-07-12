"use client";

import { useEffect, useState } from "react";
import { artworkSized, averageColor } from "@/lib/artwork";

/** Artwork-tinted gradient band over the browse view (legacy signature). */
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
  const [tint, setTint] = useState("#282828");

  useEffect(() => {
    let cancelled = false;
    void averageColor(artworkSized(artworkUrl, "t300x300")).then((c) => {
      if (!cancelled) setTint(c);
    });
    return () => {
      cancelled = true;
    };
  }, [artworkUrl]);

  return (
    <header
      className="flex items-end gap-6 px-6 pt-16 pb-6 transition-[background] duration-1000"
      style={{
        background: `linear-gradient(to bottom, ${tint}, var(--color-main))`,
      }}
    >
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
