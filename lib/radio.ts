/**
 * Pure radio engine — selectors over QueueState for infinite related-track
 * stations. The queue itself is the station's memory: `order` holds every id
 * ever queued (radio never reconciles), `history`/`position` say what played,
 * `unplayable` tracks failures. The player owns the fetching and the
 * session-local bits (in-flight flag, tried-seed set); everything here is
 * deterministic and unit-tested.
 */

import { currentTrackId, type QueueState } from "./queue";

/** Refill when this few playable tracks remain ahead of the position. */
export const RADIO_LOW_WATER = 5;
/** Soft station cap — bounds the persisted localStorage payload. */
export const RADIO_MAX_TRACKS = 500;
/** Seeds tried per refill pass before declaring the station dry. */
export const RADIO_SEED_ATTEMPTS = 3;

export function radioSourceId(seedTrackId: number): string {
  return `radio:track:${seedTrackId}`;
}

/** The station's original seed track id, or null for non-radio sources. */
export function radioSeedOf(sourceId: string): number | null {
  const m = /^radio:track:(\d+)$/.exec(sourceId);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Playable tracks strictly after the current position. */
export function remainingPlayable(q: QueueState): number {
  const bad = new Set(q.unplayable);
  let n = 0;
  for (let i = q.position + 1; i < q.order.length; i++) {
    if (!bad.has(q.order[i])) n++;
  }
  return n;
}

export function shouldRefill(q: QueueState): boolean {
  return (
    remainingPlayable(q) <= RADIO_LOW_WATER && q.order.length < RADIO_MAX_TRACKS
  );
}

/**
 * Seed for the next related fetch: the current track, then history
 * newest-first, then the station's original seed — skipping `tried`.
 * Null means every candidate is exhausted.
 */
export function nextSeed(
  q: QueueState,
  tried: ReadonlySet<number>,
): number | null {
  const candidates: number[] = [];
  const current = currentTrackId(q);
  if (current !== null) candidates.push(current);
  for (let i = q.history.length - 1; i >= 0; i--) candidates.push(q.history[i]);
  const original = radioSeedOf(q.sourceId);
  if (original !== null) candidates.push(original);
  for (const id of candidates) {
    if (!tried.has(id)) return id;
  }
  return null;
}

/**
 * Candidate ids not already in the queue, in candidate order, truncated so
 * the grown queue stays within RADIO_MAX_TRACKS.
 */
export function filterFresh(
  candidateIds: readonly number[],
  q: QueueState,
): number[] {
  const known = new Set(q.order);
  const room = Math.max(0, RADIO_MAX_TRACKS - q.order.length);
  const fresh: number[] = [];
  for (const id of candidateIds) {
    if (fresh.length >= room) break;
    if (known.has(id)) continue;
    known.add(id);
    fresh.push(id);
  }
  return fresh;
}
