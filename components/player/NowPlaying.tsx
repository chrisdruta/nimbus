"use client";

import { artworkSized } from "@/lib/artwork";
import { IconCloud, IconShare } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { usePlayerState } from "./PlayerProvider";

/** Current track info; the links double as the required SoundCloud
 * attribution (track -> permalink, artist -> creator profile). */
export function NowPlaying() {
  const { current } = usePlayerState();
  const toast = useToast();

  if (!current) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted">
        <div className="flex h-14 w-14 items-center justify-center rounded bg-elem/40">
          <IconCloud size={20} />
        </div>
        nothing playing
      </div>
    );
  }

  const art = artworkSized(current.artworkUrl, "t300x300");

  return (
    <div className="flex min-w-0 items-center gap-3">
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt="" className="h-14 w-14 rounded object-cover" />
      ) : (
        <div className="flex h-14 w-14 items-center justify-center rounded bg-elem/40 text-muted">
          <IconCloud size={20} />
        </div>
      )}
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
    </div>
  );
}
