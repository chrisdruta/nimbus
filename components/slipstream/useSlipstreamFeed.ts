"use client";

import { useEffect, useState } from "react";
import { FEED_IDLE_MS } from "@/lib/afk";
import { idleFor } from "@/lib/hooks/interaction";
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
  /** Host is running a shared (collaborative) session. */
  shared: boolean;
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
      // Idle gate: a visible but untouched tab polling forever is what
      // keeps Neon compute from ever autosuspending. Any interaction
      // resumes on the next tick (≤15s — fine for a presence list).
      if (!document.hidden && idleFor() <= FEED_IDLE_MS) load();
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
