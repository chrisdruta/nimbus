/**
 * Queue-source vocabulary: every way audio can be driven, and what the user
 * is allowed to do in each. Local kinds ("likes", "playlist", future "radio")
 * share the pure queue engine in lib/queue.ts; "slipstream" is driven by the
 * follow engine in lib/slipstream.ts and has no local QueueState mutations.
 * The UI gates transport controls off SourceCapabilities instead of
 * hardcoding per-mode checks — a future source is a new row here, not a
 * rethink.
 */

export type SourceKind = "likes" | "playlist" | "slipstream" | "radio";

export interface SourceCapabilities {
  /** next/prev */
  canSkip: boolean;
  /** click a row in the queue panel */
  canJump: boolean;
  canShuffle: boolean;
  canRepeat: boolean;
  /** scrub the seek bar */
  canSeek: boolean;
  /** writes nimbus.queue.v1 */
  persists: boolean;
}

export const CAPS: Record<SourceKind, SourceCapabilities> = {
  likes: {
    canSkip: true,
    canJump: true,
    canShuffle: true,
    canRepeat: true,
    canSeek: true,
    persists: true,
  },
  playlist: {
    canSkip: true,
    canJump: true,
    canShuffle: true,
    canRepeat: true,
    canSeek: true,
    persists: true,
  },
  slipstream: {
    canSkip: false,
    canJump: false,
    canShuffle: false,
    canRepeat: false,
    canSeek: false,
    persists: false,
  },
  // Future related-track continuation: a fixed order you can skip through
  // but not reshuffle or jump around in.
  radio: {
    canSkip: true,
    canJump: false,
    canShuffle: false,
    canRepeat: false,
    canSeek: true,
    persists: true,
  },
};

/** Parse a QueueState.sourceId ("likes" | "playlist:2" | "radio:track:9"). */
export function sourceKindOf(sourceId: string): SourceKind {
  if (sourceId === "likes") return "likes";
  if (sourceId.startsWith("playlist:")) return "playlist";
  if (sourceId.startsWith("radio:")) return "radio";
  return "likes"; // unknown ids behave like the default local source
}

export function capsOf(kind: SourceKind): SourceCapabilities {
  return CAPS[kind];
}
