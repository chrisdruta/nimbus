/**
 * Pure queue engine — no React, no provider imports. The player holds a
 * QueueState and applies these functions; everything returns new state.
 */

export type RepeatMode = "off" | "all" | "one";

export type ShuffleMode = "classic" | "artist-spaced" | "rediscovery";

/**
 * External knowledge the pure engine can't hold — injected by the caller.
 * Every mode degrades gracefully when fields are missing.
 */
export interface ShuffleContext {
  /** Artist display name for a track (from the player's metadata cache). */
  artistOf?: (id: number) => string | undefined;
  /** Play tally for a track; undefined = never played. */
  playsOf?: (
    id: number,
  ) => { playCount: number; lastPlayedAt: number } | undefined;
  /** Injectable clock (ms epoch) for deterministic tests. */
  now?: number;
}

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
  /** Which shuffle algorithm orders the queue (kept across off/on). */
  shuffleMode: ShuffleMode;
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

/** Move `first` to index 0 without disturbing the relative rest. */
function pinFirst(order: number[], first: number | undefined): number[] {
  if (first === undefined || order[0] === first || !order.includes(first)) {
    return order;
  }
  return [first, ...order.filter((id) => id !== first)];
}

/**
 * Post-shuffle repair pass: walk the order and, whenever a track shares
 * an artist with either of the two before it, swap in the next track
 * that conflicts with neither (fallback: differs from the immediate
 * neighbor only). Index 0 is never moved; the result stays a permutation.
 * O(n) typical; O(n²) worst case when one artist dominates — fine at
 * few-thousand-track library scale.
 */
function spaceArtists(
  order: number[],
  artistOf: (id: number) => string | undefined,
): number[] {
  const out = [...order];
  const keys = new Map<number, string | undefined>();
  for (const id of out) {
    const raw = artistOf(id);
    keys.set(id, raw === undefined ? undefined : raw.trim().toLowerCase());
  }
  const key = (id: number) => keys.get(id);

  for (let i = 1; i < out.length; i++) {
    const a = key(out[i]);
    if (a === undefined) continue;
    const prev1 = key(out[i - 1]);
    const prev2 = i >= 2 ? key(out[i - 2]) : undefined;
    if (a !== prev1 && a !== prev2) continue;

    let best = -1;
    let fallback = -1;
    for (let j = i + 1; j < out.length; j++) {
      const k = key(out[j]);
      if (k !== prev1 && k !== prev2) {
        best = j;
        break;
      }
      if (fallback === -1 && k !== prev1) fallback = j;
    }
    const swap = best !== -1 ? best : fallback;
    if (swap !== -1) {
      [out[i], out[swap]] = [out[swap], out[i]];
    }
    // else: the remaining suffix is all this artist — nothing to fix.
  }
  return out;
}

/**
 * Weighted shuffle by exponential race: each track draws a key
 * −ln(u)/w and the smallest keys go first — exactly weighted sampling
 * without replacement, so rarely-played tracks *tend* early while still
 * interleaving like a shuffle. Never-played tracks get w=3 vs ≤1 for
 * played ones; recency halves the weight of something played today vs.
 * 90+ days ago at equal counts. Missing play data ⇒ uniform weights.
 */
function rediscoveryOrder(
  ids: readonly number[],
  seed: number,
  ctx: ShuffleContext,
): number[] {
  const rand = mulberry32(seed);
  const now = ctx.now ?? Date.now();
  const keyed = ids.map((id, index) => {
    const plays = ctx.playsOf?.(id);
    let w: number;
    if (plays === undefined) {
      w = 3;
    } else {
      const days = Math.min(
        90,
        Math.max(0, (now - plays.lastPlayedAt) / 86_400_000),
      );
      w = (1 / (1 + plays.playCount)) * (0.5 + (0.5 * days) / 90);
    }
    const u = Math.max(rand(), 1e-12);
    return { id, index, key: -Math.log(u) / w };
  });
  keyed.sort((a, b) => a.key - b.key || a.index - b.index);
  return keyed.map((k) => k.id);
}

/**
 * Unified shuffle entry point. `classic` is byte-identical to the
 * original seededShuffle+pin behavior for the same seed, so persisted
 * queues keep their order across this change.
 */
export function shuffleOrder(
  ids: readonly number[],
  opts: {
    mode: ShuffleMode;
    seed: number;
    first?: number;
    ctx?: ShuffleContext;
  },
): number[] {
  const ctx = opts.ctx ?? {};
  if (opts.mode === "rediscovery") {
    return pinFirst(rediscoveryOrder(ids, opts.seed, ctx), opts.first);
  }
  const base = pinFirst(seededShuffle(ids, opts.seed), opts.first);
  if (opts.mode === "artist-spaced" && ctx.artistOf) {
    // Repair after pinning so index 0 is never displaced.
    return spaceArtists(base, ctx.artistOf);
  }
  return base;
}

// ---------------------------------------------------------- construction

export function createQueue(
  sourceId: string,
  trackIds: readonly number[],
  opts?: {
    shuffle?: boolean;
    startTrackId?: number;
    seed?: number;
    shuffleMode?: ShuffleMode;
    ctx?: ShuffleContext;
  },
): QueueState {
  const shuffled = opts?.shuffle ?? false;
  const seed = opts?.seed ?? randomSeed();
  const shuffleMode = opts?.shuffleMode ?? "classic";
  // The chosen track leads the shuffled order so playback starts on it.
  const order = shuffled
    ? shuffleOrder(trackIds, {
        mode: shuffleMode,
        seed,
        first: opts?.startTrackId,
        ctx: opts?.ctx,
      })
    : [...trackIds];

  const position =
    opts?.startTrackId === undefined ? -1 : order.indexOf(opts.startTrackId);

  return {
    sourceId,
    order,
    sourceOrder: [...trackIds],
    position,
    shuffled,
    shuffleMode,
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
  ctx: ShuffleContext = {},
): QueueState {
  const current = currentTrackId(q);
  if (!q.shuffled) {
    const seed = randomSeed();
    const order = shuffleOrder(q.order, {
      mode: q.shuffleMode,
      seed,
      first: keepCurrentFirst && current !== null ? current : undefined,
      ctx,
    });
    return {
      ...q,
      shuffled: true,
      seed,
      order,
      position: current === null ? -1 : order.indexOf(current),
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

/**
 * Switch shuffle algorithm: turns shuffle on (if off) and reshuffles the
 * whole queue under the new mode with a fresh seed, keeping the current
 * track playing at position 0. Re-selecting the active mode reshuffles.
 */
export function setShuffleMode(
  q: QueueState,
  mode: ShuffleMode,
  ctx: ShuffleContext = {},
): QueueState {
  const current = currentTrackId(q);
  const seed = randomSeed();
  const order = shuffleOrder(q.order, {
    mode,
    seed,
    first: current ?? undefined,
    ctx,
  });
  return {
    ...q,
    shuffled: true,
    shuffleMode: mode,
    seed,
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
 * Fold newly discovered ids into a live queue (a collection walk streaming
 * in pages). Unshuffled: append in arrival order. Shuffled: insert each id
 * at a seeded random index strictly after `position`, so late pages mix
 * into the unplayed remainder instead of piling up at the tail. Never
 * drops ids — removal stays reconcile's job.
 */
export function integrate(
  q: QueueState,
  newIds: readonly number[],
  _ctx: ShuffleContext = {},
): QueueState {
  const known = new Set(q.order);
  const fresh = newIds.filter((id) => !known.has(id));
  if (fresh.length === 0) return q;

  const sourceOrder = [...q.sourceOrder, ...fresh];
  if (!q.shuffled) {
    return { ...q, order: [...q.order, ...fresh], sourceOrder };
  }

  // Uniform seeded insertion for every mode; artist-spacing/rediscovery
  // weighting of insertions would visibly reorder the upcoming list on
  // each page, so it's deliberately not applied here.
  const rand = mulberry32((q.seed ^ q.order.length) >>> 0);
  const order = [...q.order];
  const floor = q.position + 1;
  for (const id of fresh) {
    const span = order.length - floor + 1;
    order.splice(floor + Math.floor(rand() * span), 0, id);
  }
  return { ...q, order, sourceOrder };
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
        shuffleMode: ["classic", "artist-spaced", "rediscovery"].includes(
          s.shuffleMode,
        )
          ? s.shuffleMode
          : "classic",
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
