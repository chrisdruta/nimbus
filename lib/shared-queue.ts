/**
 * Pure shared-session queue engine — no fetch, no DB (the lib/queue.ts
 * precedent). A shared slipstream's upcoming list lives server-side as
 * SharedQueueEntry[] with a revision counter; these functions are the only
 * mutation/reconcile logic, used by both the API routes (via the store's
 * row lock) and the host's client-side reconcile.
 *
 * Transport control (next/prev/jump) is NOT queue state: only the host's
 * audio element advances playback, so skips are a one-slot last-writer-wins
 * intent (SharedControl) the host applies locally. "play" carries an
 * explicit target so two people pressing next coalesce to the same track.
 */

import type { QueueState, QueueTrack } from "./queue";
import { parseQueueTracks } from "./slipstream";

/** Upper bound on the shared upcoming list. */
export const SHARED_QUEUE_CAP = 100;

/** How much of the host's upcoming queue seeds a new session. Deliberately
 * far below the cap: a session is about collaborating on what's next, and
 * a big library queue would otherwise fill every addable slot. */
export const SHARED_SEED_COUNT = 25;

export interface SharedQueueEntry extends QueueTrack {
  /** Display name of whoever queued it; null for session-seed entries. */
  addedBy: string | null;
}

export type SharedControl =
  | { type: "play"; trackId: number }
  | { type: "prev" };

/** Shared-session state as it rides poll/heartbeat responses. `queue` and
 * `control` are embedded only when the client's revision/seq are behind. */
export interface SharedWire {
  revision: number;
  controlSeq: number;
  queue?: SharedQueueEntry[];
  control?: SharedControl;
}

export type QueueOp =
  | { op: "add"; track: QueueTrack }
  | { op: "remove"; trackId: number }
  | { op: "reorder"; order: number[]; expectedRevision: number };

export type AddError = "duplicate" | "full";

// ------------------------------------------------------- server mutations

/** Append a track. Rejects ids already queued or currently playing (the
 * host's current track is not part of the upcoming list). */
export function addEntry(
  queue: readonly SharedQueueEntry[],
  entry: SharedQueueEntry,
  currentTrackId: number | null,
): { queue: SharedQueueEntry[] } | { error: AddError } {
  if (entry.id === currentTrackId || queue.some((e) => e.id === entry.id)) {
    return { error: "duplicate" };
  }
  if (queue.length >= SHARED_QUEUE_CAP) return { error: "full" };
  return { queue: [...queue, entry] };
}

/** Remove by id; `changed: false` when absent (idempotent). */
export function removeEntry(
  queue: readonly SharedQueueEntry[],
  trackId: number,
): { queue: SharedQueueEntry[]; changed: boolean } {
  const next = queue.filter((e) => e.id !== trackId);
  return { queue: next, changed: next.length !== queue.length };
}

/** Alias with heartbeat semantics: pop the entry the host just started
 * playing. A jump plays its target now and keeps the rest queued. */
export const pruneCurrent = removeEntry;

/** Rearrange to `order`, which must be an exact permutation of the queued
 * ids — anything added, dropped, or duplicated returns null. */
export function reorderEntries(
  queue: readonly SharedQueueEntry[],
  order: readonly number[],
): SharedQueueEntry[] | null {
  if (order.length !== queue.length) return null;
  const byId = new Map(queue.map((e) => [e.id, e]));
  if (byId.size !== queue.length) return null;
  const next: SharedQueueEntry[] = [];
  const seen = new Set<number>();
  for (const id of order) {
    const entry = byId.get(id);
    if (!entry || seen.has(id)) return null;
    seen.add(id);
    next.push(entry);
  }
  return next;
}

// --------------------------------------------------------- host reconcile

/**
 * Rewrite the host's local queue so everything after the playing track is
 * exactly the shared list. The played prefix is kept for prev/history but
 * drops ids that reappear in sharedIds (a jump-back replays them); the
 * current track is filtered out of sharedIds (prune race: a beat's
 * server-side prune may not have landed yet). Order stays duplicate-free.
 */
export function applySharedOrder(
  q: QueueState,
  sharedIds: readonly number[],
): QueueState {
  const currentId = q.position >= 0 ? q.order[q.position] : null;
  const upcoming: number[] = [];
  const inUpcoming = new Set<number>();
  for (const id of sharedIds) {
    if (id === currentId || inUpcoming.has(id)) continue;
    inUpcoming.add(id);
    upcoming.push(id);
  }
  const prefix =
    currentId === null
      ? []
      : q.order.slice(0, q.position).filter((id) => !inUpcoming.has(id));
  const order =
    currentId === null ? upcoming : [...prefix, currentId, ...upcoming];
  return {
    ...q,
    order,
    sourceOrder: [...order],
    position: currentId === null ? -1 : prefix.length,
  };
}

/** Session seed: the host's current upcoming ids, resolved to entries.
 * Ids without cached metadata are skipped — they can't ride the wire. */
export function seedEntries(
  upcomingIds: readonly number[],
  metaOf: (id: number) => QueueTrack | undefined,
): SharedQueueEntry[] {
  const out: SharedQueueEntry[] = [];
  for (const id of upcomingIds) {
    if (out.length >= SHARED_QUEUE_CAP) break;
    const meta = metaOf(id);
    if (meta) out.push({ ...meta, addedBy: null });
  }
  return out;
}

// -------------------------------------------------------- wire validation

const isId = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Validated parse of a transport-control intent; null on violation. */
export function parseControl(v: unknown): SharedControl | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Record<string, unknown>;
  if (c.type === "prev") return { type: "prev" };
  if (c.type === "play" && isId(c.trackId)) {
    return { type: "play", trackId: c.trackId };
  }
  return null;
}

/** Validated parse of a queue-mutation request body; null on violation.
 * Track metadata goes through parseQueueTracks — the same XSS-safe
 * validation as heartbeat windows (entries render in members' DOMs). */
export function parseQueueOp(v: unknown): QueueOp | null {
  if (typeof v !== "object" || v === null) return null;
  const b = v as Record<string, unknown>;
  if (b.op === "add") {
    const tracks = parseQueueTracks([b.track], 1);
    if (!tracks || tracks.length !== 1) return null;
    return { op: "add", track: tracks[0] };
  }
  if (b.op === "remove") {
    if (!isId(b.trackId)) return null;
    return { op: "remove", trackId: b.trackId };
  }
  if (b.op === "reorder") {
    if (
      !Array.isArray(b.order) ||
      b.order.length > SHARED_QUEUE_CAP ||
      !b.order.every(isId) ||
      typeof b.expectedRevision !== "number" ||
      !Number.isSafeInteger(b.expectedRevision) ||
      b.expectedRevision < 0
    ) {
      return null;
    }
    return {
      op: "reorder",
      order: b.order as number[],
      expectedRevision: b.expectedRevision,
    };
  }
  return null;
}
