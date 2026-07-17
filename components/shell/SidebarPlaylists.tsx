"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { ProviderPlaylist } from "@/lib/provider";
import { SidebarSection } from "./SidebarSection";

export function SidebarPlaylists({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [playlists, setPlaylists] = useState<ProviderPlaylist[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all: ProviderPlaylist[] = [];
      let cursor: string | null = null;
      // Sidebar wants the full list; playlist counts are small.
      for (let page = 0; page < 10; page++) {
        const url: string = cursor
          ? `/api/playlists?cursor=${encodeURIComponent(cursor)}`
          : "/api/playlists";
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as {
          playlists: ProviderPlaylist[];
          nextCursor: string | null;
        };
        all.push(...data.playlists);
        if (cancelled) return;
        setPlaylists([...all]);
        cursor = data.nextCursor;
        if (!cursor) break;
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (playlists.length === 0) return null;

  return (
    // The one section that scrolls: it takes the sidebar's leftover height
    // and keeps its scrollbar (gutter reserved so appearing doesn't shift
    // the titles) to itself — the header chunks above never move.
    <SidebarSection
      id="playlists"
      title="Playlists"
      className="flex min-h-0 flex-1 flex-col"
    >
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto [scrollbar-gutter:stable]">
        {playlists.map((p) => {
          const href = `/playlists/${p.id}`;
          const active = pathname === href;
          return (
            <li key={p.id}>
              <Link
                href={href}
                onClick={onNavigate}
                title={`${p.title} · ${p.trackCount} tracks`}
                className={`-mx-2 block truncate rounded px-2 py-1.5 text-sm transition ${
                  active
                    ? "border-l-2 border-accent bg-white/5 text-white"
                    : "text-muted hover:text-white"
                }`}
              >
                {p.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </SidebarSection>
  );
}
