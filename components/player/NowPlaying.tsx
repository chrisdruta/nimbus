"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { artworkSized } from "@/lib/artwork";
import {
  IconCloud,
  IconExpand,
  IconFollow,
  IconFollowing,
  IconHeart,
  IconRadio,
} from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { writePref } from "@/lib/prefs";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

interface Social {
  liked: boolean;
  artistId: number;
  artistFollowed: boolean;
}

/** Current track info; the permalink links double as the required
 * SoundCloud attribution. The artist name prefers the in-app artist page
 * (which links back to the creator's SoundCloud profile itself). */
export function NowPlaying() {
  const { current, slipstream, stageOpen } = usePlayerState();
  const actions = usePlayerActions();
  const toast = useToast();

  // Like/follow state for the current track, fetched lazily; null while
  // unknown (buttons render disabled). Toggles are optimistic with revert.
  const [social, setSocial] = useState<Social | null>(null);
  useEffect(() => {
    setSocial(null);
    const id = current?.id;
    if (id === undefined) return;
    const ctrl = new AbortController();
    fetch(`/api/tracks/${id}/social`, { signal: ctrl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<Social>) : null))
      .then((s) => {
        if (s && !ctrl.signal.aborted) setSocial(s);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted">
        <div className="flex h-16 w-16 items-center justify-center rounded-md bg-elem/40">
          <IconCloud size={22} />
        </div>
        nothing playing
      </div>
    );
  }

  const toggleLike = () => {
    if (!social) return;
    const next = !social.liked;
    setSocial({ ...social, liked: next });
    fetch(`/api/tracks/${current.id}/like`, {
      method: next ? "PUT" : "DELETE",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`like ${res.status}`);
      })
      .catch(() => {
        setSocial((s) => (s ? { ...s, liked: !next } : s));
        toast("couldn't update like", "error");
      });
  };

  const toggleFollow = () => {
    if (!social) return;
    const next = !social.artistFollowed;
    setSocial({ ...social, artistFollowed: next });
    fetch(`/api/artists/${social.artistId}/follow`, {
      method: next ? "PUT" : "DELETE",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`follow ${res.status}`);
        toast(next ? `following ${current.artist}` : `unfollowed ${current.artist}`);
      })
      .catch(() => {
        setSocial((s) => (s ? { ...s, artistFollowed: !next } : s));
        toast("couldn't update follow", "error");
      });
  };

  const art = artworkSized(current.artworkUrl, "t300x300");

  return (
    <div className="flex min-w-0 items-center gap-3">
      <button
        aria-label={stageOpen ? "close stage" : "open full-screen art"}
        title={stageOpen ? "close stage" : "open full-screen art"}
        onClick={() => {
          if (stageOpen) {
            actions.closeStage();
            return;
          }
          // The thumb always opens on the art itself; other stage entries
          // keep whatever mode was last used.
          writePref("stageMode", "art");
          actions.openStage();
        }}
        className="group relative shrink-0 cursor-pointer"
      >
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt="" className="h-16 w-16 rounded-md object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-md bg-elem/40 text-muted">
            <IconCloud size={22} />
          </div>
        )}
        <span className="absolute inset-0 flex items-center justify-center rounded bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
          <IconExpand size={16} />
        </span>
      </button>
      <div className="min-w-0">
        <a
          href={current.permalinkUrl}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-medium hover:underline"
          title={`${current.title} on SoundCloud`}
        >
          {current.title}
        </a>
        <div className="truncate text-xs text-muted">
          {current.artistId ? (
            <Link
              href={`/artists/${current.artistId}`}
              className="hover:text-white hover:underline"
            >
              {current.artist}
            </Link>
          ) : (
            <a
              href={current.artistUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-white hover:underline"
            >
              {current.artist}
            </a>
          )}{" "}
          ·{" "}
          <a
            href={current.permalinkUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-white hover:underline"
          >
            on SoundCloud
          </a>
        </div>
        {slipstream && (
          <div className="truncate text-[11px]">
            <span className="text-accent">
              in {slipstream.host.username ?? "member"}&apos;s slipstream
            </span>{" "}
            <button
              onClick={actions.leaveSlipstream}
              className="cursor-pointer text-muted transition hover:text-accent"
            >
              · leave
            </button>
          </div>
        )}
      </div>
      <button
        aria-label={social?.liked ? "unlike track" : "like track"}
        title={social?.liked ? "unlike" : "like"}
        disabled={!social}
        onClick={toggleLike}
        className={`ml-1 shrink-0 cursor-pointer transition disabled:cursor-default disabled:opacity-40 ${
          social?.liked ? "text-accent" : "text-muted hover:text-white"
        }`}
      >
        <IconHeart size={16} fill={social?.liked ? "currentColor" : "none"} />
      </button>
      <button
        aria-label={
          social?.artistFollowed
            ? `unfollow ${current.artist}`
            : `follow ${current.artist}`
        }
        title={social?.artistFollowed ? "unfollow artist" : "follow artist"}
        disabled={!social}
        onClick={toggleFollow}
        className={`shrink-0 cursor-pointer transition disabled:cursor-default disabled:opacity-40 ${
          social?.artistFollowed ? "text-accent" : "text-muted hover:text-white"
        }`}
      >
        {social?.artistFollowed ? (
          <IconFollowing size={16} />
        ) : (
          <IconFollow size={16} />
        )}
      </button>
      <button
        aria-label="start radio from this track"
        title="start radio"
        onClick={() => actions.startRadio(current)}
        className="shrink-0 cursor-pointer text-muted transition hover:text-white"
      >
        <IconRadio size={16} />
      </button>
    </div>
  );
}
