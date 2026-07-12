"use client";

import { use, useEffect, useState } from "react";
import { BrowseView } from "@/components/browse/BrowseView";
import type { ProviderPlaylist } from "@/lib/provider";

/** Walk the playlists pages until this one turns up (usually page one). */
function usePlaylistMeta(id: number): ProviderPlaylist | null {
  const [meta, setMeta] = useState<ProviderPlaylist | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let cursor: string | null = null;
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
        const found = data.playlists.find((p) => p.id === id);
        if (found) {
          if (!cancelled) setMeta(found);
          return;
        }
        cursor = data.nextCursor;
        if (!cursor) return;
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  return meta;
}

export default function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const playlistId = Number(id);
  const meta = usePlaylistMeta(playlistId);

  return (
    <BrowseView
      source={{ kind: "playlist", id: playlistId }}
      title={meta?.title ?? "Playlist"}
      subtitle={meta ? `${meta.trackCount} tracks` : undefined}
    />
  );
}
