"use client";

import { useEffect, useState } from "react";
import { FEED_POLL_MS } from "@/lib/slipstream";
import { IconCloud } from "@/components/ui/icons";
import { SidebarSection } from "@/components/shell/SidebarSection";
import { usePlayerActions, usePlayerState } from "@/components/player/PlayerProvider";

interface FeedRow {
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

/** Who's listening right now — the join surface for slipstreams. Renders
 * nothing when nobody's live. */
export function LiveFeed() {
  const { slipstream } = usePlayerState();
  const actions = usePlayerActions();
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

  if (rows.length === 0) return null;

  return (
    <SidebarSection id="listening-now" title="listening now">
      <ul className="space-y-0.5">
        {rows.map((r) => {
          const self = r.hostId === you;
          const active = slipstream?.host.userId === r.hostId;
          const name = r.username ?? "member";
          const inner = (
            <>
              {r.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.avatarUrl}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elem text-muted">
                  <IconCloud size={13} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {name}
                  {self && <span className="text-muted"> (you)</span>}
                </p>
                {r.track && (
                  <p className="truncate text-xs text-muted">
                    {r.track.title} — {r.track.artist}
                  </p>
                )}
              </div>
            </>
          );
          return (
            <li key={r.hostId}>
              {self ? (
                <div className="-mx-2 flex items-center gap-2.5 rounded px-2 py-1.5">
                  {inner}
                </div>
              ) : active ? (
                <div className="-mx-2 flex items-center gap-2.5 rounded border-l-2 border-accent bg-white/5 px-2 py-1.5">
                  {inner}
                  <button
                    onClick={actions.leaveSlipstream}
                    className="shrink-0 cursor-pointer text-xs text-muted transition hover:text-accent"
                  >
                    leave
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => void actions.joinSlipstream(r.hostId)}
                  title={`join ${name}'s slipstream`}
                  className="-mx-2 flex w-full cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-left transition hover:bg-white/5"
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </SidebarSection>
  );
}
