/**
 * Queue-source vocabulary: every way audio can be driven, and what the user
 * is allowed to do in each. Local kinds ("likes", "playlist", future "radio")
 * share the pure queue engine in lib/queue.ts; "slipstream" is driven by the
 * follow engine in lib/slipstream.ts and has no local QueueState mutations.
 * The UI gates transport controls off SourceCapabilities instead of
 * hardcoding per-mode checks — a future source is a new row here, not a
 * rethink.
 */

export type SourceKind =
  | "likes"
  | "playlist"
  | "slipstream"
  | "slipstream-shared"
  | "radio"
  | "feed"
  | "shared";

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
  /** A page-mounted library walk repopulates the metadata cache after
   * reload; self-contained sources must persist their own track snapshots. */
  restoresFromLibrary: boolean;
}

export const CAPS: Record<SourceKind, SourceCapabilities> = {
  likes: {
    canSkip: true,
    canJump: true,
    canShuffle: true,
    canRepeat: true,
    canSeek: true,
    persists: true,
    restoresFromLibrary: true,
  },
  playlist: {
    canSkip: true,
    canJump: true,
    canShuffle: true,
    canRepeat: true,
    canSeek: true,
    persists: true,
    restoresFromLibrary: true,
  },
  slipstream: {
    canSkip: false,
    canJump: false,
    canShuffle: false,
    canRepeat: false,
    canSeek: false,
    persists: false,
    restoresFromLibrary: false,
  },
  // Following a shared (collaborative) session: skip/jump route as control
  // intents the host applies — the host's audio stays the only clock, so
  // seeking is still out.
  "slipstream-shared": {
    canSkip: true,
    canJump: true,
    canShuffle: false,
    canRepeat: false,
    canSeek: false,
    persists: false,
    restoresFromLibrary: false,
  },
  // Related-track continuation: a fixed order you can skip through but not
  // reshuffle or jump around in.
  radio: {
    canSkip: true,
    canJump: false,
    canShuffle: false,
    canRepeat: false,
    canSeek: true,
    persists: true,
    restoresFromLibrary: false,
  },
  // The queue only ever holds tracks the user actually loaded, so the
  // loaded window behaves like a normal finite collection.
  feed: {
    canSkip: true,
    canJump: true,
    canShuffle: true,
    canRepeat: true,
    canSeek: true,
    persists: true,
    restoresFromLibrary: false,
  },
  // Hosting a shared session (and its leftover queue after stop-sharing):
  // a normal local queue, but shuffle/repeat would rewrite or loop the
  // agreed order out from under collaborators, so both stay off. Snapshots
  // persist like radio/feed — there's no single library walk behind it.
  shared: {
    canSkip: true,
    canJump: true,
    canShuffle: false,
    canRepeat: false,
    canSeek: true,
    persists: true,
    restoresFromLibrary: false,
  },
};

/** Parse a QueueState.sourceId
 * ("likes" | "playlist:2" | "radio:track:9" | "feed"). */
export function sourceKindOf(sourceId: string): SourceKind {
  if (sourceId === "likes") return "likes";
  if (sourceId === "feed") return "feed";
  if (sourceId === "shared") return "shared";
  if (sourceId.startsWith("playlist:")) return "playlist";
  if (sourceId.startsWith("radio:")) return "radio";
  return "likes"; // unknown ids behave like the default local source
}

export function capsOf(kind: SourceKind): SourceCapabilities {
  return CAPS[kind];
}
