"use client";

import { artworkSized } from "@/lib/artwork";
import {
  IconCloud,
  IconExpand,
  IconRadio,
  IconShare,
} from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { writePref } from "@/lib/prefs";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

/** Current track info; the links double as the required SoundCloud
 * attribution (track -> permalink, artist -> creator profile). */
export function NowPlaying() {
  const { current, slipstream } = usePlayerState();
  const actions = usePlayerActions();
  const toast = useToast();

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

  const art = artworkSized(current.artworkUrl, "t300x300");

  return (
    <div className="flex min-w-0 items-center gap-3">
      <button
        aria-label="open full-screen art"
        title="open full-screen art"
        onClick={() => {
          // The thumb always opens on the art itself; the bar's expand
          // button keeps whatever mode was last used.
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
          <a
            href={current.artistUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-white hover:underline"
          >
            {current.artist}
          </a>{" "}
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
        aria-label="copy track link"
        onClick={() => {
          void navigator.clipboard
            .writeText(current.permalinkUrl)
            .then(() => toast("link copied"));
        }}
        className="ml-1 shrink-0 cursor-pointer text-muted transition hover:text-white"
      >
        <IconShare size={16} />
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
