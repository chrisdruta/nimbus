"use client";

import { artworkSized } from "@/lib/artwork";
import {
  IconChevronDown,
  IconChevronUp,
  IconCloud,
  IconPanelRight,
  IconX,
} from "@/components/ui/icons";
import { formatDuration } from "@/lib/format";
import { currentTrackId, type QueueTrack } from "@/lib/queue";
import { canAutoContinue, radioSeedOf } from "@/lib/radio";
import { sourceKindOf } from "@/lib/sources";
import type { SharedQueueEntry } from "@/lib/shared-queue";
import type { FeedRow } from "@/components/slipstream/useSlipstreamFeed";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

function Row({
  track,
  onClick,
  highlight = false,
}: {
  track: QueueTrack;
  onClick?: () => void;
  highlight?: boolean;
}) {
  const art = artworkSized(track.artworkUrl, "large");
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left ${
        onClick ? "cursor-pointer hover:bg-white/5" : ""
      }`}
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt="" className="h-9 w-9 rounded object-cover" />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded bg-elem/40 text-muted">
          <IconCloud size={14} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${highlight ? "text-accent" : ""}`}>
          {track.title}
        </p>
        <p className="truncate text-xs text-muted">{track.artist}</p>
      </div>
      <span className="text-xs tabular-nums text-muted">
        {formatDuration(track.durationMs)}
      </span>
    </button>
  );
}

/** A shared-session entry: jump on click, hover reveals move/remove.
 * (A div with button semantics — the affordances are real <button>s and
 * buttons can't nest.) */
function SharedRow({
  entry,
  onJump,
  onRemove,
  onMove,
  isFirst,
  isLast,
}: {
  entry: SharedQueueEntry;
  onJump?: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const art = artworkSized(entry.artworkUrl, "large");
  const iconBtn =
    "flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-muted transition hover:text-white disabled:cursor-default disabled:opacity-30";
  return (
    <div
      role="button"
      tabIndex={onJump ? 0 : -1}
      onClick={onJump}
      onKeyDown={(e) => {
        if (onJump && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onJump();
        }
      }}
      className={`group flex w-full items-center gap-3 rounded px-2 py-1.5 text-left ${
        onJump ? "cursor-pointer hover:bg-white/5" : ""
      }`}
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt="" className="h-9 w-9 rounded object-cover" />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded bg-elem/40 text-muted">
          <IconCloud size={14} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{entry.title}</p>
        <p className="truncate text-xs text-muted">
          {entry.artist}
          {entry.addedBy && ` · added by ${entry.addedBy}`}
        </p>
      </div>
      <span className="hidden shrink-0 items-center group-hover:flex">
        <button
          aria-label="move up"
          title="move up"
          disabled={isFirst}
          onClick={(e) => {
            e.stopPropagation();
            onMove(-1);
          }}
          className={iconBtn}
        >
          <IconChevronUp size={13} />
        </button>
        <button
          aria-label="move down"
          title="move down"
          disabled={isLast}
          onClick={(e) => {
            e.stopPropagation();
            onMove(1);
          }}
          className={iconBtn}
        >
          <IconChevronDown size={13} />
        </button>
        <button
          aria-label="remove from session"
          title="remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={`${iconBtn} hover:text-accent`}
        >
          <IconX size={12} />
        </button>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted group-hover:hidden">
        {formatDuration(entry.durationMs)}
      </span>
    </div>
  );
}

/** Who's live, as rows the user can join/leave from. */
function LiveSection({ rows, you }: { rows: FeedRow[]; you: number | null }) {
  const { slipstream } = usePlayerState();
  const actions = usePlayerActions();

  return (
    <>
      <p className="px-2 py-1 text-xs text-muted">listening now</p>
      <ul className="space-y-0.5 pb-2">
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
                  {r.shared && (
                    <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 py-px text-[10px] text-accent">
                      shared
                    </span>
                  )}
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
                <div className="flex items-center gap-2.5 rounded px-2 py-1.5">
                  {inner}
                </div>
              ) : active ? (
                <div className="flex items-center gap-2.5 rounded border-l-2 border-accent bg-white/5 px-2 py-1.5">
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
                  title={
                    r.shared
                      ? `join ${name}'s shared session`
                      : `join ${name}'s slipstream`
                  }
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-left transition hover:bg-white/5"
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Unified right column: live presence up top (when anyone's on), the
 * queue below — one home for everything social + upcoming. Rendered as
 * a persistent, collapsible layout column by AppShell. */
export function SidePanel({
  onClose,
  feed,
  you,
}: {
  onClose: () => void;
  feed: FeedRow[];
  you: number | null;
}) {
  const {
    current,
    shuffled,
    shuffleMode,
    caps,
    slipstream,
    shared,
    queue,
    autoRadio,
  } = usePlayerState();
  const actions = usePlayerActions();
  const upNext = actions.upcomingTracks(40);
  const hostName = slipstream?.host.username ?? "member";
  const hosting = shared?.role === "host";
  const radioSeed =
    !slipstream && queue ? radioSeedOf(queue.sourceId) : null;
  const radioSeedTitle =
    radioSeed !== null ? actions.getMeta(radioSeed)?.title : undefined;
  const upNextLabel = shared
    ? "up next · shared"
    : slipstream
      ? `up next · from ${hostName}`
      : radioSeed !== null
        ? "up next · radio"
        : shuffled
          ? shuffleMode === "classic"
            ? "up next · shuffled"
            : `up next · shuffled (${shuffleMode})`
          : "up next";
  const showAutoRadio =
    !slipstream &&
    !shared &&
    queue !== null &&
    canAutoContinue(sourceKindOf(queue.sourceId));
  // The queue engine still holds the parked local queue while following.
  const parkedId = slipstream && queue ? currentTrackId(queue) : null;
  const parked = parkedId !== null ? actions.getMeta(parkedId) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-4 pb-2">
        <h2 className="text-sm font-semibold tracking-widest text-muted uppercase">
          {slipstream ? "Slipstream" : hosting ? "Shared session" : "Queue"}
        </h2>
        <div className="flex items-center gap-3">
          {!slipstream && !hosting && current && (
            <button
              onClick={actions.startSharedSession}
              title="share this queue — friends can join, queue tracks, and skip"
              className="shrink-0 cursor-pointer text-xs text-muted transition hover:text-accent"
            >
              share session
            </button>
          )}
          <button
            aria-label="collapse queue"
            title="collapse"
            onClick={onClose}
            className="cursor-pointer text-muted transition hover:text-white"
          >
            <IconPanelRight size={16} />
          </button>
        </div>
      </div>
      {!slipstream && radioSeedTitle && (
        <div className="px-4 pb-2">
          <span className="block truncate text-xs text-accent">
            radio · {radioSeedTitle}
          </span>
        </div>
      )}
      {hosting && (
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="truncate text-xs text-accent">
            sharing your queue — friends can edit it
          </span>
          <button
            onClick={actions.stopSharedSession}
            className="shrink-0 cursor-pointer text-xs text-muted transition hover:text-accent"
          >
            stop sharing
          </button>
        </div>
      )}
      {slipstream && (
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="truncate text-xs text-accent">
            in {hostName}&apos;s {slipstream.shared ? "shared session" : "slipstream"}
          </span>
          <button
            onClick={actions.leaveSlipstream}
            className="shrink-0 cursor-pointer text-xs text-muted transition hover:text-accent"
          >
            leave
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {/* Your own row alone just mirrors the media bar — the live section
            earns its space once someone else is listening. */}
        {feed.some((r) => r.hostId !== you) && (
          <LiveSection rows={feed} you={you} />
        )}
        {current && (
          <>
            <p className="px-2 py-1 text-xs text-muted">now playing</p>
            <Row track={current} highlight />
          </>
        )}
        {/* A truly idle queue gets one quiet hint instead of empty
            "up next / end of queue" scaffolding. */}
        {!slipstream && !current && upNext.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted">
            nothing queued — play something and it lands here
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 px-2 py-1 pt-3">
              <p className="text-xs text-muted">{upNextLabel}</p>
              {showAutoRadio && (
                <button
                  role="switch"
                  aria-checked={autoRadio}
                  title="when the queue ends, keep going with related tracks"
                  onClick={() => actions.setAutoRadio(!autoRadio)}
                  className={`shrink-0 cursor-pointer text-xs transition ${
                    autoRadio ? "text-accent" : "text-muted hover:text-white"
                  }`}
                >
                  continue with radio
                </button>
              )}
            </div>
            {(shared ? shared.entries.length : upNext.length) === 0 && (
              <p className="px-2 py-2 text-sm text-muted">
                {shared
                  ? "nothing queued — add tracks from your library"
                  : slipstream
                    ? `waiting for ${hostName}…`
                    : "end of queue"}
              </p>
            )}
          </>
        )}
        {shared
          ? shared.entries.map((e, i) => (
              <SharedRow
                key={e.id}
                entry={e}
                isFirst={i === 0}
                isLast={i === shared.entries.length - 1}
                onJump={
                  caps.canJump ? () => actions.jumpToTrack(e.id) : undefined
                }
                onRemove={() => actions.removeFromSharedQueue(e.id)}
                onMove={(dir) => actions.moveInSharedQueue(e.id, dir)}
              />
            ))
          : upNext.map((t) => (
              <Row
                key={t.id}
                track={t}
                onClick={
                  caps.canJump ? () => actions.jumpToTrack(t.id) : undefined
                }
              />
            ))}
      </div>
      {slipstream && parked && (
        <div className="flex items-center justify-between gap-2 border-t border-black/40 px-4 py-3">
          <p className="min-w-0 truncate text-xs text-muted">
            your queue · paused on &ldquo;{parked.title}&rdquo;
          </p>
          <button
            onClick={actions.leaveSlipstream}
            className="shrink-0 cursor-pointer text-xs text-muted transition hover:text-accent"
          >
            return
          </button>
        </div>
      )}
    </div>
  );
}
