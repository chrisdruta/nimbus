/**
 * Pure queue engine — no React, no provider imports. The player holds a
 * QueueState and applies these functions; everything returns new state.
 */

export type RepeatMode = "off" | "all" | "one";

/** Minimal snapshot of the current track so the media bar can paint
 * immediately on reload, before the collection refetches. */
export interface QueueTrack {
  id: number;
  title: string;
  artist: string;
  artistUrl: string;
  artworkUrl: string | null;
  permalinkUrl: string;
  durationMs: number;
}

export interface QueueState {
  /** "likes" | `playlist:${id}` */
  sourceId: string;
  /** Track ids in play order — the source of truth. */
  order: number[];
  /** Ids in the collection's natural order (for un-shuffling). */
  sourceOrder: number[];
  /** Index into order; -1 = nothing selected yet. */
  position: number;
  shuffled: boolean;
  /** Seed the current shuffle was derived from (for reproducibility). */
  seed: number;
  repeat: RepeatMode;
  /** Recently played ids, most recent last. */
  history: number[];
  /** Ids that failed to stream this session; advance skips them. */
  unplayable: number[];
}

const HISTORY_CAP = 50;
const STORAGE_KEY = "nimbus.queue.v1";

// ---------------------------------------------------------------- shuffle

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded PRNG; pure and reproducible. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

// ---------------------------------------------------------- construction

export function createQueue(
  sourceId: string,
  trackIds: readonly number[],
  opts?: { shuffle?: boolean; startTrackId?: number; seed?: number },
): QueueState {
  const shuffled = opts?.shuffle ?? false;
  const seed = opts?.seed ?? randomSeed();
  let order = shuffled ? seededShuffle(trackIds, seed) : [...trackIds];

  let position = -1;
  if (opts?.startTrackId !== undefined) {
    // The chosen track leads the shuffled order so playback starts on it.
    if (shuffled) {
      order = [
        opts.startTrackId,
        ...order.filter((id) => id !== opts.startTrackId),
      ];
    }
    position = order.indexOf(opts.startTrackId);
  }

  return {
    sourceId,
    order,
    sourceOrder: [...trackIds],
    position,
    shuffled,
    seed,
    repeat: "off",
    history: [],
    unplayable: [],
  };
}

// ------------------------------------------------------------- selectors

export function currentTrackId(q: QueueState): number | null {
  return q.order[q.position] ?? null;
}

export function upcoming(q: QueueState, n: number): number[] {
  const out: number[] = [];
  for (let i = q.position + 1; i < q.order.length && out.length < n; i++) {
    const id = q.order[i];
    if (!q.unplayable.includes(id)) out.push(id);
  }
  return out;
}

// ------------------------------------------------------------- mutation

function pushHistory(history: readonly number[], id: number | null): number[] {
  if (id === null) return [...history];
  return [...history, id].slice(-HISTORY_CAP);
}

function nextPlayableIndex(q: QueueState, from: number): number | null {
  for (let i = from; i < q.order.length; i++) {
    if (!q.unplayable.includes(q.order[i])) return i;
  }
  return null;
}

/**
 * Advance. `ended: true` means playback should stop (repeat off, queue
 * exhausted) — state.position is left on the last track.
 */
export function next(q: QueueState): { state: QueueState; ended: boolean } {
  const current = currentTrackId(q);

  if (q.repeat === "one" && current !== null) {
    return {
      state: { ...q, history: pushHistory(q.history, current) },
      ended: false,
    };
  }

  const history = pushHistory(q.history, current);
  let idx = nextPlayableIndex(q, q.position + 1);
  if (idx === null && q.repeat === "all") {
    idx = nextPlayableIndex(q, 0);
  }
  if (idx === null) {
    return { state: { ...q, history }, ended: true };
  }
  return { state: { ...q, position: idx, history }, ended: false };
}

/** Step back: most recent history entry first, else previous in order. */
export function prev(q: QueueState): QueueState {
  const fromHistory = q.history[q.history.length - 1];
  if (fromHistory !== undefined) {
    const idx = q.order.indexOf(fromHistory);
    if (idx !== -1) {
      return { ...q, position: idx, history: q.history.slice(0, -1) };
    }
  }
  for (let i = q.position - 1; i >= 0; i--) {
    if (!q.unplayable.includes(q.order[i])) return { ...q, position: i };
  }
  return q;
}

export function jumpTo(q: QueueState, trackId: number): QueueState {
  const idx = q.order.indexOf(trackId);
  if (idx === -1) return q;
  return {
    ...q,
    position: idx,
    history: pushHistory(q.history, currentTrackId(q)),
  };
}

export function setRepeat(q: QueueState, mode: RepeatMode): QueueState {
  return { ...q, repeat: mode };
}

/**
 * Toggle shuffle. Turning it on reshuffles the whole collection with a new
 * seed, keeping the current track first (unless keepCurrentFirst=false);
 * turning it off restores ascending source order around the current track.
 */
export function toggleShuffle(
  q: QueueState,
  keepCurrentFirst = true,
): QueueState {
  const current = currentTrackId(q);
  if (!q.shuffled) {
    const seed = randomSeed();
    let order = seededShuffle(q.order, seed);
    if (keepCurrentFirst && current !== null) {
      order = [current, ...order.filter((id) => id !== current)];
    }
    return {
      ...q,
      shuffled: true,
      seed,
      order,
      position: current === null ? -1 : 0,
    };
  }
  const inQueue = new Set(q.order);
  const order = q.sourceOrder.filter((id) => inQueue.has(id));
  return {
    ...q,
    shuffled: false,
    order,
    position: current === null ? -1 : order.indexOf(current),
  };
}

/** Record a track as unstreamable; caller then calls next(). */
export function markUnplayable(q: QueueState, trackId: number): QueueState {
  if (q.unplayable.includes(trackId)) return q;
  return { ...q, unplayable: [...q.unplayable, trackId] };
}

/**
 * Sync with a refetched collection: drop ids that vanished, append new ids
 * to the end of the order (shuffled or not — they arrive as discoveries).
 */
export function reconcile(
  q: QueueState,
  freshTrackIds: readonly number[],
): QueueState {
  const fresh = new Set(freshTrackIds);
  const current = currentTrackId(q);
  const kept = q.order.filter((id) => fresh.has(id));
  const known = new Set(q.order);
  const added = freshTrackIds.filter((id) => !known.has(id));
  const order = [...kept, ...added];
  return {
    ...q,
    order,
    sourceOrder: [...freshTrackIds],
    position: current === null ? -1 : order.indexOf(current),
    history: q.history.filter((id) => fresh.has(id)),
  };
}

// ----------------------------------------------------------- persistence

export interface PersistedQueue {
  state: QueueState;
  currentTrack: QueueTrack | null;
  savedAt: number;
}

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function saveQueue(
  state: QueueState,
  currentTrack: QueueTrack | null,
): void {
  const payload: PersistedQueue = { state, currentTrack, savedAt: Date.now() };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // quota/private mode — persistence is best-effort
  }
}

export function loadQueue(): PersistedQueue | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedQueue;
    const s = parsed?.state;
    if (
      typeof s?.sourceId !== "string" ||
      !Array.isArray(s?.order) ||
      typeof s?.position !== "number" ||
      !["off", "all", "one"].includes(s?.repeat)
    ) {
      return null;
    }
    return {
      state: {
        ...s,
        sourceOrder: Array.isArray(s.sourceOrder) ? s.sourceOrder : [...s.order],
        history: Array.isArray(s.history) ? s.history : [],
        unplayable: Array.isArray(s.unplayable) ? s.unplayable : [],
      },
      currentTrack: parsed.currentTrack ?? null,
      savedAt: parsed.savedAt ?? 0,
    };
  } catch {
    return null;
  }
}

export function clearQueue(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
