"use client";

import { useEffect, useState } from "react";
import { FEED_POLL_MS } from "@/lib/slipstream";

export interface FeedRow {
  hostId: number;
  username: string | null;
  avatarUrl: string | null;
  track: {
    id: number;
    title: string;
    artist: string;
    artworkUrl: string | null;
  } | null;
  updatedAt: string;
}

/** Visibility-gated poll of who's listening right now. Mount once (the
 * media bar) and pass the rows down; don't stack pollers. */
export function useSlipstreamFeed(): { rows: FeedRow[]; you: number | null } {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [you, setYou] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/slipstreams")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { slipstreams: FeedRow[]; you: number } | null) => {
          if (cancelled || !data) return;
          setRows(data.slipstreams);
          setYou(data.you);
        })
        .catch(() => {});
    };
    load();
    const iv = setInterval(() => {
      if (!document.hidden) load();
    }, FEED_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { rows, you };
}
