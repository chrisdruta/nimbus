"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ProviderTrack } from "@/lib/provider";
import type Hls from "hls.js";
import { formatReset } from "@/lib/format";
import { buildAudioGraph, LIMITER_THRESHOLD_DB } from "@/lib/audio-graph";
import { loadStreamInto } from "@/lib/stream-load";
import {
  canStartCasting,
  castPositionMs,
  shouldReresolve,
  type CastPlayhead,
} from "@/lib/cast";
import {
  useCastSender,
  type CastSender,
  type CastSenderStatus,
} from "@/lib/hooks/useCastSender";
import {
  createQueue,
  currentTrackId,
  enqueue,
  integrate,
  jumpTo,
  loadQueue,
  markUnplayable,
  next,
  prev,
  reconcile,
  saveQueue,
  setRepeat,
  setShuffleMode as engineSetShuffleMode,
  toggleShuffle,
  upcoming,
  type QueueState,
  type QueueTrack,
  type RepeatMode,
  type ShuffleContext,
  type ShuffleMode,
} from "@/lib/queue";
import { capsOf, sourceKindOf, type SourceCapabilities } from "@/lib/sources";
import {
  canAutoContinue,
  filterFresh,
  nextSeed,
  seedStation,
  shouldRefill,
  RADIO_SEED_ATTEMPTS,
} from "@/lib/radio";
import {
  HEARTBEAT_MS,
  POLL_MS,
  WINDOW_SIZE,
  clockOffset,
  expectedPositionMs,
  nextInWindow,
  planSync,
  publisherEnabled,
  type FollowerLocal,
  type SlipstreamSnapshot,
} from "@/lib/slipstream";
import {
  SHARED_SEED_COUNT,
  applySharedOrder,
  seedEntries,
  type SharedControl,
  type SharedQueueEntry,
  type SharedWire,
} from "@/lib/shared-queue";
import {
  LEVELER,
  accumulate,
  blockMeanSquare,
  createLevelerState,
  dbToLinear,
  gainDbFor,
  isLoudnessCachePayload,
  loadLoudnessMap,
  loudnessDb,
  rememberLoudness,
  serializeLoudnessMap,
  type LevelerState,
} from "@/lib/loudness";
import { readPref, writePref } from "@/lib/prefs";
import { AFK_CHECK_MS, afkAction } from "@/lib/afk";
import { idleFor } from "@/lib/hooks/interaction";
import { useMediaSession } from "@/lib/hooks/useMediaSession";
import {
  useSlipstreamPublisher,
  type PublishedBeat,
} from "@/lib/hooks/useSlipstreamPublisher";
import { useToast } from "@/components/ui/Toast";

/** Stops runaway skip loops when many tracks in a row fail to stream. */
const MAX_CONSECUTIVE_FAILURES = 5;
/** Consecutive follower poll failures tolerated before treating the host
 * as gone (network blips shouldn't end a follow). */
const MAX_POLL_FAILURES = 3;
const VOLUME_KEY = "nimbus:volume";

// ------------------------------------------------------- volume leveling
/** How often the leveler samples the analyser's time-domain window. */
const LEVELER_BLOCK_MS = 250;
/** Persist the estimate every N gated blocks once it's cache-worthy. */
const LEVELER_SAVE_EVERY = 20;
/** Gain ramp time constants (s): slow while refining, fast on seeds. */
const LEVELER_RAMP_S = 0.4;
const LEVELER_SEED_RAMP_S = 0.05;

export interface SlipstreamHost {
  userId: number;
  username: string | null;
  avatarUrl: string | null;
}

export interface SlipstreamStatus {
  host: SlipstreamHost;
  /** Follower paused locally (or is quota-blocked); host state won't resume us. */
  userPaused: boolean;
  /** The host is running a shared session — we have queue-edit and skip
   * control (routed as intents the host applies). */
  shared: boolean;
}

/** The active shared session from this client's perspective — host or
 * joined guest. `entries` is the agreed upcoming list (server truth,
 * refreshed by revision on every beat/poll). */
export interface SharedSessionState {
  role: "host" | "guest";
  hostId: number;
  entries: SharedQueueEntry[];
}

/** Follower-mode session — lives in a ref; `SlipstreamStatus` mirrors the
 * UI-relevant slice into React state. */
interface FollowSession {
  host: SlipstreamHost;
  snap: SlipstreamSnapshot;
  clockOffsetMs: number;
  userPaused: boolean;
  /** What we're actually on (current state can lag async resolution). */
  localTrackId: number | null;
  /** Tracks that 422'd/errored for us this session — window-local, never
   * touches the parked queue's unplayable list. */
  unavailable: Set<number>;
  /** Our copy ended before the host's (30s preview / shorter encode). */
  endedEarlyOn: number | null;
  pollFailures: number;
  /** Shared-session state while the host is sharing; null on plain follow. */
  shared: {
    capability: string;
    revision: number;
    controlSeq: number;
    entries: SharedQueueEntry[];
  } | null;
}

/** Wire shape of GET /api/slipstreams/[userId]. */
interface SnapshotWire {
  hostId: number;
  username: string | null;
  avatarUrl: string | null;
  trackId: number;
  positionMs: number;
  playing: boolean;
  window: QueueTrack[];
  updatedAtMs: number;
  serverNowMs: number;
  shared: {
    capability: string;
    revision: number;
    controlSeq: number;
    /** Embedded only when our `?rev=` was behind. */
    queue?: SharedQueueEntry[];
  } | null;
}

const hostLabel = (h: SlipstreamHost) => h.username ?? "member";

export interface PlayerState {
  current: QueueTrack | null;
  playing: boolean;
  shuffled: boolean;
  shuffleMode: ShuffleMode;
  repeat: RepeatMode;
  volume: number;
  /** Volume leveling (per-track loudness normalization) enabled. */
  leveling: boolean;
  /** When a local collection queue ends, continue with radio from the last track. */
  autoRadio: boolean;
  /** Hide plain listening presence from the feed (shared sessions still show). */
  privateListening: boolean;
  /** Fullscreen stage (art + viz scenes) visibility. */
  stageOpen: boolean;
  queue: QueueState | null;
  /** What the active source lets the user do; UI gates transport off this. */
  caps: SourceCapabilities;
  /** Set while following someone's slipstream. */
  slipstream: SlipstreamStatus | null;
  /** Set while in a shared session, hosting or joined. */
  shared: SharedSessionState | null;
  /** Google Cast devices/session; null while the SDK is absent (no app
   * id, non-Chrome) — the cast button hides entirely then. */
  cast: {
    status: Exclude<CastSenderStatus, "unavailable">;
    deviceName: string | null;
    /** Device volume (0..1) — the volume slider drives this while casting. */
    deviceVolume: number;
  } | null;
}

export interface PlayerActions {
  /** Start playback over a collection; tracks arrive in source order. */
  playFrom(
    sourceKey: string,
    tracks: readonly ProviderTrack[],
    startTrackId?: number,
    opts?: { shuffle?: boolean },
  ): void;
  /** Feed newly loaded pages: metadata cache + queue reconciliation. */
  registerTracks(sourceKey: string, tracks: readonly ProviderTrack[]): void;
  /** Sync the queue against a COMPLETE collection — the only path that
   * drops vanished ids, so never call it with a partial walk. */
  syncSource(sourceKey: string, tracks: readonly ProviderTrack[]): void;
  togglePlay(): void;
  nextTrack(): void;
  prevTrack(): void;
  jumpToTrack(trackId: number): void;
  /** Start an infinite related-tracks station seeded from one track. */
  startRadio(track: QueueTrack): void;
  toggleShuffleMode(): void;
  /** Switch shuffle algorithm; turns shuffle on and reshuffles. */
  setShuffleMode(mode: ShuffleMode): void;
  cycleRepeat(): void;
  setVolume(v: number): void;
  /** Toggle volume leveling; off restores the untouched signal path. */
  setLeveling(on: boolean): void;
  /** Toggle auto-continue into radio when a collection queue ends. */
  setAutoRadio(on: boolean): void;
  /** Toggle private listening (server-stored; presence drops immediately). */
  setPrivateListening(on: boolean): void;
  openStage(): void;
  closeStage(): void;
  getMeta(trackId: number): QueueTrack | undefined;
  upcomingTracks(n: number): QueueTrack[];
  /** Non-destructive enqueue into the local queue ("next" lands right
   * after the current track). In a shared session it delegates to the
   * session queue (append-only); in plain follow mode it's a no-op. */
  queueTrack(track: QueueTrack, where: "next" | "last"): void;
  /** Follow a member's live queue (read-only). Parks the local queue. */
  joinSlipstream(hostId: number): Promise<void>;
  /** Back to the parked local queue, exactly as it was left. */
  leaveSlipstream(): void;
  /** Share the current queue: friends can join, queue tracks, and skip.
   * Replaces the local queue context (audio keeps playing). */
  startSharedSession(): void;
  /** Stop sharing; the queue stays as-is and playback continues. */
  stopSharedSession(): void;
  /** Queue a track into the active shared session (host or guest). */
  addToSharedQueue(track: QueueTrack): void;
  removeFromSharedQueue(trackId: number): void;
  /** Swap a shared entry with its neighbor (revision-checked reorder). */
  moveInSharedQueue(trackId: number, dir: -1 | 1): void;
  /** Open the browser's Cast device picker. */
  startCasting(): void;
  /** End the cast session (playback parks locally at the TV's position). */
  stopCasting(): void;
  /** Seek the active output — local element or cast receiver. */
  seekTo(ms: number): void;
}

export interface PlayerRefs {
  audioRef: RefObject<HTMLAudioElement | null>;
  analyserRef: RefObject<AnalyserNode | null>;
  /** Playhead of the active output (ms) — the local element normally,
   * extrapolated cast status while casting. Read per frame, not state. */
  positionMsNow(): number;
}

const StateCtx = createContext<PlayerState | null>(null);
const ActionsCtx = createContext<PlayerActions | null>(null);
const RefsCtx = createContext<PlayerRefs | null>(null);

export function usePlayerState(): PlayerState {
  const ctx = useContext(StateCtx);
  if (!ctx) throw new Error("usePlayerState outside PlayerProvider");
  return ctx;
}

export function usePlayerActions(): PlayerActions {
  const ctx = useContext(ActionsCtx);
  if (!ctx) throw new Error("usePlayerActions outside PlayerProvider");
  return ctx;
}

export function usePlayerRefs(): PlayerRefs {
  const ctx = useContext(RefsCtx);
  if (!ctx) throw new Error("usePlayerRefs outside PlayerProvider");
  return ctx;
}

function toQueueTrack(t: ProviderTrack): QueueTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    ...(t.artistId === undefined ? {} : { artistId: t.artistId }),
    artistUrl: t.artistUrl,
    artworkUrl: t.artworkUrl,
    permalinkUrl: t.permalinkUrl,
    durationMs: t.durationMs,
    ...(t.preview === true ? { preview: true } : {}),
  };
}

/** Strip a shared entry to the QueueTrack shape the metadata cache holds. */
function entryToTrack(e: SharedQueueEntry): QueueTrack {
  return {
    id: e.id,
    title: e.title,
    artist: e.artist,
    ...(e.artistId === undefined ? {} : { artistId: e.artistId }),
    artistUrl: e.artistUrl,
    artworkUrl: e.artworkUrl,
    permalinkUrl: e.permalinkUrl,
    durationMs: e.durationMs,
    ...(e.preview === true ? { preview: true } : {}),
  };
}

export function PlayerProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId: number;
}) {
  const toast = useToast();

  const [queue, setQueueState] = useState<QueueState | null>(null);
  const [current, setCurrent] = useState<QueueTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [leveling, setLevelingState] = useState(true);
  const [autoRadio, setAutoRadioState] = useState(false);
  const [privateListening, setPrivateListeningState] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  // ------------------------------------------------------ volume leveling
  const levelerGainRef = useRef<GainNode | null>(null);
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);
  const levelingRef = useRef(true);
  const levelerRef = useRef<LevelerState>(createLevelerState());
  /** trackId → measured loudness (dBFS), LRU-persisted across sessions. */
  const loudnessMapRef = useRef<Map<number, number>>(new Map());
  /** Track the leveler is currently measuring (mirrors `current`). */
  const levelerTrackRef = useRef<number | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const queueRef = useRef<QueueState | null>(null);
  const metaRef = useRef<Map<number, QueueTrack>>(new Map());
  const failStreakRef = useRef(0);
  // ------------------------------------------------------- radio (session)
  /** Shared in-flight refill so concurrent triggers await one fetch pass. */
  const radioRefillRef = useRef<Promise<boolean> | null>(null);
  /** Seeds whose related lists yielded nothing new this session. */
  const radioTriedSeedsRef = useRef<Set<number>>(new Set());
  /** Every seed candidate is exhausted — the station is dry. */
  const radioEndedRef = useRef(false);
  /** Pref mirror for advance(): continue ended collections with radio. */
  const autoRadioRef = useRef(false);
  const playsRef = useRef<
    Map<number, { playCount: number; lastPlayedAt: number }>
  >(new Map());
  const playsFetchedAtRef = useRef(0);

  // ------------------------------------------------- slipstream (follower)
  const [slipstream, setSlipstream] = useState<SlipstreamStatus | null>(null);
  const followRef = useRef<FollowSession | null>(null);
  /** In-track playhead of the parked local queue, restored on leave. */
  const parkedRef = useRef<{ elapsedMs: number } | null>(null);
  /** One-shot seek applied when this exact track next resolves locally. */
  const pendingSeekRef = useRef<{ trackId: number; ms: number } | null>(null);
  const playingRef = useRef(false);
  playingRef.current = playing;

  // -------------------------------------------------------------- casting
  /** Live while a cast session owns the output (local audio is silent). */
  const castRef = useRef<{
    /** Last status beat from the receiver + when it arrived. */
    playhead: CastPlayhead | null;
    /** Last quota-burning re-resolve, for the expiry retry policy. */
    lastRetry: { trackId: number; positionMs: number } | null;
  } | null>(null);
  /** Local playhead captured at session start; shipped once the receiver
   * says it's ready (messages sent earlier can be dropped). */
  const handoffRef = useRef<{
    trackId: number;
    positionMs: number;
    wasPlaying: boolean;
  } | null>(null);
  /** The last successfully resolved stream — cast start/resume reuses the
   * URL already in hand instead of burning another play resolution. */
  const lastStreamRef = useRef<{
    trackId: number;
    url: string;
    protocol: "progressive" | "hls" | "unknown";
  } | null>(null);
  /** Assigned right after the hook call below; refs keep the async cast
   * callbacks off the actions memo's dependency graph. */
  const castSenderRef = useRef<CastSender | null>(null);
  /** Late-bound like advanceRef — resolveAndPlay ships loads through it. */
  const castLoadRef = useRef<
    (
      stream: { trackId: number; url: string; protocol: "progressive" | "hls" | "unknown" },
      atMs: number,
    ) => void
  >(() => {});
  /** Fallback timer: ship the handoff even if `ready` never arrives. */
  const handoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------- shared (sessions)
  const [shared, setShared] = useState<SharedSessionState | null>(null);
  /** Hosting state: server queue revision, last applied control seq, and
   * the entries as last confirmed by the server. */
  const hostSessionRef = useRef<{
    capability: string;
    revision: number;
    controlSeq: number;
    entries: SharedQueueEntry[];
  } | null>(null);

  /** Mirror the active shared session (either role) into React state. */
  const publishSharedState = useCallback(() => {
    const f = followRef.current;
    if (f) {
      setShared(
        f.shared
          ? { role: "guest", hostId: f.host.userId, entries: f.shared.entries }
          : null,
      );
      return;
    }
    const hs = hostSessionRef.current;
    setShared(
      hs ? { role: "host", hostId: userId, entries: hs.entries } : null,
    );
  }, [userId]);

  /** Mirror the UI-relevant slice of followRef into React state. */
  const publishFollowState = useCallback(() => {
    const f = followRef.current;
    setSlipstream(
      f
        ? { host: f.host, userPaused: f.userPaused, shared: f.shared !== null }
        : null,
    );
    publishSharedState();
  }, [publishSharedState]);

  // Late-bound so async loops always see the current implementations.
  const followPlayRef = useRef<(trackId: number, atMs: number) => void>(
    () => {},
  );
  const leaveSlipstreamRef = useRef<() => void>(() => {});
  const pollTickRef = useRef<() => void>(() => {});
  const stopSharedSessionRef = useRef<() => void>(() => {});
  const sharedRemoveRef = useRef<(trackId: number) => void>(() => {});

  const setQueue = useCallback((q: QueueState | null) => {
    queueRef.current = q;
    setQueueState(q);
  }, []);

  // ---------------------------------------------------------- rehydrate

  // Server-stored privacy pref — cross-device, so it can't live in
  // localStorage like the other toggles.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me/privacy")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { privateListening: boolean } | null) => {
        if (!cancelled && data) setPrivateListeningState(data.privateListening);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const persisted = loadQueue(userId);
    if (persisted) {
      setQueue(persisted.state);
      setCurrent(persisted.currentTrack);
      if (persisted.currentTrack) {
        metaRef.current.set(persisted.currentTrack.id, persisted.currentTrack);
      }
      // Self-contained sources (radio, feed) have no library walk to refill
      // the metadata cache — restore their persisted snapshot.
      for (const t of persisted.tracks ?? []) metaRef.current.set(t.id, t);
      // A persisted shared-kind queue may belong to a still-live session
      // (quick reload while hosting) — revive it; otherwise it's just a
      // plain local queue now.
      if (persisted.state.sourceId === "shared") {
        void (async () => {
          const res = await fetch("/api/slipstream/session").catch(() => null);
          if (!res?.ok) return;
          const { session } = (await res.json()) as {
            session: {
              capability: string;
              revision: number;
              controlSeq: number;
              queue: SharedQueueEntry[];
            } | null;
          };
          if (!session || followRef.current) return;
          hostSessionRef.current = {
            capability: session.capability,
            revision: session.revision,
            controlSeq: session.controlSeq,
            entries: session.queue,
          };
          for (const t of session.queue) {
            if (!metaRef.current.has(t.id)) {
              metaRef.current.set(t.id, entryToTrack(t));
            }
          }
          const q = queueRef.current;
          if (q && q.sourceId === "shared") {
            setQueue(applySharedOrder(q, session.queue.map((e) => e.id)));
          }
          publishSharedState();
        })();
      }
    }
    const storedVolume = Number(localStorage.getItem(VOLUME_KEY));
    if (storedVolume >= 0 && storedVolume <= 1 && !Number.isNaN(storedVolume)) {
      setVolumeState(storedVolume);
    }
    const storedLeveling =
      readPref("leveling", (v): v is boolean => typeof v === "boolean") ?? true;
    levelingRef.current = storedLeveling;
    setLevelingState(storedLeveling);
    const storedAutoRadio =
      readPref("autoRadio", (v): v is boolean => typeof v === "boolean") ??
      false;
    autoRadioRef.current = storedAutoRadio;
    setAutoRadioState(storedAutoRadio);
    loudnessMapRef.current = loadLoudnessMap(
      readPref("loudness", isLoudnessCachePayload),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist queue + snapshot whenever they change (post-rehydration).
  // Never while following: `current` shows the host's track then and must
  // not overwrite the parked local snapshot.
  useEffect(() => {
    if (followRef.current) return;
    if (!queue) return;
    const snapshot = capsOf(sourceKindOf(queue.sourceId)).restoresFromLibrary
      ? undefined
      : queue.order
          .map((id) => metaRef.current.get(id))
          .filter((t): t is QueueTrack => t !== undefined);
    saveQueue(userId, queue, current, snapshot);
  }, [queue, current, userId]);

  useEffect(() => {
    const el = audioRef.current;
    // Perceptual taper: loudness perception is ~logarithmic, so a linear
    // slider crams all audible change into its bottom fifth. Squaring the
    // slider value spreads the useful range across the whole travel
    // (half-slider ≈ 25% signal ≈ −12 dB). State and persistence stay in
    // slider domain; only the element sees the curve. The leveler is
    // unaffected — it reads back `el.volume`, whatever the mapping.
    if (el) el.volume = volume * volume;
  }, [volume]);

  // -------------------------------------------------------- audio graph

  /** Ramp the leveler gain (no-op until the graph exists). */
  const applyLevelerGain = useCallback((db: number, rampS: number) => {
    const ctx = ctxRef.current;
    const gain = levelerGainRef.current;
    if (!ctx || !gain) return;
    gain.gain.setTargetAtTime(dbToLinear(db), ctx.currentTime, rampS);
  }, []);

  const ensureGraph = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (ctxRef.current) {
      void ctxRef.current.resume();
      return;
    }
    // Build the graph once and reuse it for the app's lifetime (a media
    // element accepts exactly one MediaElementSourceNode, ever — the
    // topology and its rationale live in lib/audio-graph.ts).
    const { ctx, analyser, gain, limiter } = buildAudioGraph(el);
    if (!levelingRef.current) limiter.threshold.value = 0;
    ctxRef.current = ctx;
    analyserRef.current = analyser;
    levelerGainRef.current = gain;
    limiterRef.current = limiter;
    // The graph may be born mid-track (first user gesture) — seed the gain
    // for whatever the leveler already knows about the current track.
    if (levelingRef.current) {
      const id = levelerTrackRef.current;
      const known = id !== null ? loudnessMapRef.current.get(id) : undefined;
      if (known !== undefined) {
        gain.gain.value = dbToLinear(gainDbFor(known));
      }
    }
    void ctx.resume();
  }, []);

  // New track: reset the estimate and seed the gain — from cache when the
  // track's loudness is already known, else neutral until measured.
  useEffect(() => {
    const id = current?.id ?? null;
    levelerTrackRef.current = id;
    levelerRef.current = createLevelerState();
    if (!levelingRef.current) return;
    const known = id !== null ? loudnessMapRef.current.get(id) : undefined;
    applyLevelerGain(
      known !== undefined ? gainDbFor(known) : 0,
      LEVELER_SEED_RAMP_S,
    );
  }, [current?.id, applyLevelerGain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sample the analyser's time-domain window while playing; each block
  // refines the integrated estimate and eases the gain toward target.
  // Estimates that have seen enough signal persist across sessions.
  useEffect(() => {
    if (!playing || !leveling) return;
    let buf: Float32Array<ArrayBuffer> | null = null;
    const iv = setInterval(() => {
      const analyser = analyserRef.current;
      const el = audioRef.current;
      // While casting the analyser sees silence — the gate would hold,
      // but don't even sample (and never risk poisoning the cache).
      if (castRef.current) return;
      if (!analyser || !el || el.paused) return;
      if (!buf || buf.length !== analyser.fftSize) {
        buf = new Float32Array(analyser.fftSize);
      }
      // The element's volume scales the signal *before* the graph, so
      // divide it back out — estimates must be volume-independent or the
      // leveler would fight the volume slider and poison the cache.
      if (el.muted || el.volume === 0) return;
      analyser.getFloatTimeDomainData(buf);
      const ms = blockMeanSquare(buf) / (el.volume * el.volume);
      const next = accumulate(levelerRef.current, ms);
      if (next === levelerRef.current) return; // gated — silence
      levelerRef.current = next;
      const db = loudnessDb(next);
      if (db === null) return;
      applyLevelerGain(gainDbFor(db), LEVELER_RAMP_S);
      const id = levelerTrackRef.current;
      if (
        id !== null &&
        next.blocks >= LEVELER.cacheBlocks &&
        next.blocks % LEVELER_SAVE_EVERY === 0
      ) {
        loudnessMapRef.current = rememberLoudness(
          loudnessMapRef.current,
          id,
          db,
        );
        writePref("loudness", serializeLoudnessMap(loudnessMapRef.current));
      }
    }, LEVELER_BLOCK_MS);
    return () => clearInterval(iv);
  }, [playing, leveling, applyLevelerGain]);

  // -------------------------------------------------------- shuffle ctx

  const PLAYS_TTL_MS = 5 * 60_000;

  /** Fetch play tallies lazily — only rediscovery shuffles consume them.
   * Failure degrades to uniform weights (an empty map). */
  const ensurePlays = useCallback(async (): Promise<void> => {
    if (Date.now() - playsFetchedAtRef.current < PLAYS_TTL_MS) return;
    try {
      const res = await fetch("/api/plays");
      if (!res.ok) return;
      const { plays } = (await res.json()) as {
        plays: Array<{
          trackId: number;
          playCount: number;
          lastPlayedAt: string;
        }>;
      };
      playsRef.current = new Map(
        plays.map((p) => [
          p.trackId,
          { playCount: p.playCount, lastPlayedAt: Date.parse(p.lastPlayedAt) },
        ]),
      );
      playsFetchedAtRef.current = Date.now();
    } catch {
      // best-effort
    }
  }, [PLAYS_TTL_MS]);

  const buildCtx = useCallback(
    (): ShuffleContext => ({
      artistOf: (id) => metaRef.current.get(id)?.artist,
      playsOf: (id) => playsRef.current.get(id),
      now: Date.now(),
    }),
    [],
  );

  // ------------------------------------------------------------ playback

  const advanceRef = useRef<() => void>(() => {});

  type ResolveOutcome =
    | { ok: true; url: string; protocol: "progressive" | "hls" | "unknown" }
    | {
        ok: false;
        kind: "auth" | "quota" | "unavailable" | "error";
        message: string;
      };

  /** Fetch + error vocabulary only — no queue or follow side effects. The
   * local and follow consumers decide what each outcome means. */
  const resolveStream = useCallback(
    async (trackId: number): Promise<ResolveOutcome> => {
      const meta = metaRef.current.get(trackId);
      const label = meta ? `"${meta.title}"` : `track ${trackId}`;
      const res = await fetch(`/api/tracks/${trackId}/play`, {
        method: "POST",
      }).catch(() => null);
      if (res?.ok) {
        const { url, protocol } = (await res.json()) as {
          url: string;
          protocol: "progressive" | "hls" | "unknown";
        };
        return { ok: true, url, protocol };
      }
      if (res && (res.status === 401 || res.status === 403)) {
        return {
          ok: false,
          kind: "auth",
          message:
            res.status === 401
              ? "session expired — sign in again"
              : "your account is disabled",
        };
      }
      if (res?.status === 429) {
        const q = (await res.json().catch(() => null)) as {
          scope?: string;
          resetsAt?: string;
        } | null;
        return {
          ok: false,
          kind: "quota",
          message:
            q?.scope === "user" && q.resetsAt
              ? `daily play limit reached — resets ${formatReset(q.resetsAt)}`
              : q?.resetsAt
                ? `nimbus hit its daily stream budget — resets ${formatReset(q.resetsAt)}`
                : "stream quota exceeded — try again later",
        };
      }
      return {
        ok: false,
        kind: res?.status === 422 ? "unavailable" : "error",
        message:
          res?.status === 422
            ? `${label} isn't streamable — skipping`
            : `couldn't play ${label} — skipping`,
      };
    },
    [],
  );

  const loadStream = useCallback(
    async (
      el: HTMLAudioElement,
      stream: Extract<ResolveOutcome, { ok: true }>,
    ): Promise<void> => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      // The instance registers into hlsRef before the manifest wait so a
      // superseding load (or unmount) can destroy it mid-flight.
      await loadStreamInto(el, stream, (hls) => {
        hlsRef.current = hls;
      });
    },
    [],
  );

  useEffect(
    () => () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    },
    [],
  );

  /** Local-queue consumer — today's semantics, unchanged. While casting,
   * the resolved URL ships to the receiver instead of the local element;
   * everything upstream (queue, quota, error vocabulary) is shared. */
  const resolveAndPlay = useCallback(
    async (trackId: number) => {
      const el = audioRef.current;
      if (!el) return;
      if (!castRef.current) ensureGraph();
      setCurrent(metaRef.current.get(trackId) ?? null);

      const outcome = await resolveStream(trackId);
      if (followRef.current) return; // joined a slipstream mid-resolve
      if (!outcome.ok) {
        toast(outcome.message, "error");
        if (outcome.kind === "auth" || outcome.kind === "quota") {
          // Quota: pause where we are. Skipping would spam the API and
          // wrongly mark playable tracks unplayable.
          setPlaying(false);
          return;
        }
        failStreakRef.current += 1;
        const q = queueRef.current;
        if (q) setQueue(markUnplayable(q, trackId));
        // Hosting a shared session: a track nobody's host can stream must
        // leave the shared list too, or it lingers for every guest.
        if (hostSessionRef.current?.entries.some((e) => e.id === trackId)) {
          sharedRemoveRef.current(trackId);
        }
        if (failStreakRef.current >= MAX_CONSECUTIVE_FAILURES) {
          toast("too many failures in a row — stopping playback", "error");
          failStreakRef.current = 0;
          setPlaying(false);
          return;
        }
        advanceRef.current();
        return;
      }

      failStreakRef.current = 0;
      lastStreamRef.current = {
        trackId,
        url: outcome.url,
        protocol: outcome.protocol,
      };
      if (castRef.current) {
        const pending = pendingSeekRef.current;
        const atMs = pending?.trackId === trackId ? pending.ms : 0;
        pendingSeekRef.current = null;
        castLoadRef.current(lastStreamRef.current, atMs);
        return;
      }
      try {
        await loadStream(el, outcome);
        await el.play();
        setPlaying(true);
        // Returning from a slipstream: land back at the parked playhead.
        const pending = pendingSeekRef.current;
        if (pending?.trackId === trackId) {
          pendingSeekRef.current = null;
          if (pending.ms > 1_000) el.currentTime = pending.ms / 1000;
        }
      } catch {
        // Autoplay policy or transient decode issue; leave paused.
        setPlaying(false);
      }
    },
    [ensureGraph, loadStream, resolveStream, setQueue, toast],
  );

  // ---------------------------------------------------------------- radio

  /** Grow a radio queue with related tracks: try seeds (current → history →
   * original) until one yields fresh ids. Resolves true when the queue grew.
   * Related fetches are discovery calls — they never touch the fail streak
   * or quota; a transient failure just leaves the next trigger to retry. */
  const refillRadio = useCallback((): Promise<boolean> => {
    if (radioRefillRef.current) return radioRefillRef.current;
    const sourceId = queueRef.current?.sourceId;
    if (
      !sourceId ||
      sourceKindOf(sourceId) !== "radio" ||
      radioEndedRef.current ||
      followRef.current
    ) {
      return Promise.resolve(false);
    }
    const run = async (): Promise<boolean> => {
      for (let attempt = 0; attempt < RADIO_SEED_ATTEMPTS; attempt++) {
        const q = queueRef.current;
        // The user may have switched sources while we were fetching.
        if (!q || q.sourceId !== sourceId) return false;
        const seedId = nextSeed(q, radioTriedSeedsRef.current);
        if (seedId === null) break;
        const res = await fetch(`/api/tracks/${seedId}/related`).catch(
          () => null,
        );
        if (!res?.ok) return false; // transient — the next trigger retries
        const { tracks } = (await res.json()) as { tracks: ProviderTrack[] };
        const now = queueRef.current;
        if (!now || now.sourceId !== sourceId) return false;
        for (const t of tracks) metaRef.current.set(t.id, toQueueTrack(t));
        const candidates = tracks.filter((t) => t.streamable).map((t) => t.id);
        const fresh = filterFresh(candidates, now);
        if (fresh.length > 0) {
          setQueue(integrate(now, fresh, buildCtx()));
          return true;
        }
        radioTriedSeedsRef.current.add(seedId);
      }
      radioEndedRef.current = true;
      return false;
    };
    const inFlight = run().finally(() => {
      radioRefillRef.current = null;
    });
    radioRefillRef.current = inFlight;
    return inFlight;
  }, [buildCtx, setQueue]);

  const advance = useCallback(() => {
    const q = queueRef.current;
    if (!q) return;
    const { state, ended } = next(q);
    setQueue(state);
    if (ended) {
      setPlaying(false);
      const kind = sourceKindOf(state.sourceId);
      if (kind === "radio") {
        // Normally the low-water refill keeps this unreachable; hitting it
        // means the fetch lost the race (or the station is dry). Wait it
        // out and step forward if the queue grew.
        void refillRadio().then((grew) => {
          if (grew) advanceRef.current();
          else if (radioEndedRef.current) {
            toast("radio ran out of related tracks");
          }
        });
        return;
      }
      // Collection ended (repeat off — "all" wraps, "one" never ends).
      // Optionally flow into radio seeded from the track that just finished,
      // without replaying it: the station starts with the seed already
      // consumed, so the post-refill advance lands on the first related
      // track. A streak > 0 means we got here via a stream error, not a
      // clean end — don't seed a station from a broken track.
      if (
        !autoRadioRef.current ||
        !canAutoContinue(kind) ||
        failStreakRef.current > 0 ||
        followRef.current ||
        hostSessionRef.current
      ) {
        return;
      }
      const seedId = currentTrackId(state);
      const seed = seedId !== null ? metaRef.current.get(seedId) : undefined;
      if (!seed) return;
      pendingSeekRef.current = null;
      radioTriedSeedsRef.current = new Set();
      radioEndedRef.current = false;
      const station = seedStation(seed.id, state.shuffleMode);
      setQueue(station);
      void refillRadio().then((grew) => {
        if (grew) {
          toast(`radio · ${seed.title}`);
          advanceRef.current();
          return;
        }
        // Dry (or transient fetch failure): restore the finished queue
        // untouched, unless the user already moved on to something else.
        if (queueRef.current?.sourceId === station.sourceId) setQueue(state);
        if (radioEndedRef.current) {
          toast("couldn't continue with radio — no related tracks");
        }
      });
      return;
    }
    const id = currentTrackId(state);
    if (id !== null) void resolveAndPlay(id);
  }, [refillRadio, resolveAndPlay, setQueue, toast]);
  advanceRef.current = advance;

  // -------------------------------------------------------------- casting

  /** Ship a load to the receiver: the signed URL plus everything the TV
   * needs to render and level — the receiver never fetches our API. */
  const castLoad = useCallback(
    (
      stream: {
        trackId: number;
        url: string;
        protocol: "progressive" | "hls" | "unknown";
      },
      atMs: number,
    ) => {
      const meta = metaRef.current.get(stream.trackId);
      if (!meta) return;
      const loudness = loudnessMapRef.current.get(stream.trackId);
      castSenderRef.current?.send({
        type: "load",
        trackId: stream.trackId,
        url: stream.url,
        protocol: stream.protocol,
        positionMs: Math.max(0, Math.floor(atMs)),
        gainDb: loudness !== undefined ? gainDbFor(loudness) : 0,
        // Strip to the wire shape — the cache may hold richer objects.
        track: {
          id: meta.id,
          title: meta.title,
          artist: meta.artist,
          ...(meta.artistId === undefined ? {} : { artistId: meta.artistId }),
          artistUrl: meta.artistUrl,
          artworkUrl: meta.artworkUrl,
          permalinkUrl: meta.permalinkUrl,
          durationMs: meta.durationMs,
          ...(meta.preview === true ? { preview: true } : {}),
        },
      });
      setPlaying(true);
    },
    [],
  );
  castLoadRef.current = castLoad;

  /** Ship the captured handoff exactly once (the receiver's `ready`, its
   * per-sender re-announce, and the sender's fallback timer all funnel
   * here; whichever fires first consumes it). */
  const flushHandoff = useCallback(() => {
    if (handoffTimerRef.current) {
      clearTimeout(handoffTimerRef.current);
      handoffTimerRef.current = null;
    }
    const h = handoffRef.current;
    handoffRef.current = null;
    if (!castRef.current || !h) return;
    if (lastStreamRef.current?.trackId !== h.trackId) return;
    if (h.wasPlaying) {
      castLoadRef.current(lastStreamRef.current, h.positionMs);
    } else {
      // Paused handoff: hold the position; play sends the load.
      pendingSeekRef.current = { trackId: h.trackId, ms: h.positionMs };
    }
  }, []);

  const castSender = useCastSender({
    onConnected({ deviceName, resumed }) {
      // The button gates this, but sessions can also arrive via auto-join.
      if (
        !canStartCasting({
          following: followRef.current !== null,
          hostingShared: hostSessionRef.current !== null,
        })
      ) {
        castSenderRef.current?.stop();
        return;
      }
      castRef.current = { playhead: null, lastRetry: null };
      // Capture the local playhead for the handoff (shipped on `ready`),
      // then silence local output — the TV is the speaker now. A resumed
      // session (sender reload) adopts the receiver's status beats instead.
      const el = audioRef.current;
      const q = queueRef.current;
      const id = q ? currentTrackId(q) : null;
      handoffRef.current =
        !resumed &&
        el !== null &&
        id !== null &&
        lastStreamRef.current?.trackId === id &&
        el.src !== ""
          ? {
              trackId: id,
              positionMs: el.currentTime * 1000,
              wasPlaying: !el.paused,
            }
          : null;
      if (el) {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
      hlsRef.current?.destroy();
      hlsRef.current = null;
      setPlaying(false); // until the receiver's beats confirm
      // Belt and braces for the ready handshake: if the receiver's
      // announce is lost, ship the handoff anyway once the channel has
      // had time to settle.
      if (handoffTimerRef.current) clearTimeout(handoffTimerRef.current);
      if (handoffRef.current) {
        handoffTimerRef.current = setTimeout(flushHandoff, 3_000);
      }
      toast(`casting to ${deviceName ?? "tv"}`);
    },

    onDisconnected() {
      const c = castRef.current;
      if (!c) return;
      castRef.current = null;
      handoffRef.current = null;
      if (handoffTimerRef.current) {
        clearTimeout(handoffTimerRef.current);
        handoffTimerRef.current = null;
      }
      // Park where the TV was; pressing play resumes locally from there
      // via the pendingSeek machinery (mirrors leaving a slipstream).
      const q = queueRef.current;
      const id = q ? currentTrackId(q) : null;
      const ph = c.playhead;
      if (ph && id !== null && ph.trackId === id) {
        pendingSeekRef.current = {
          trackId: id,
          ms: castPositionMs(ph, Date.now(), metaRef.current.get(id)?.durationMs),
        };
      }
      setPlaying(false);
      toast("cast ended");
    },

    onMessage(msg) {
      const c = castRef.current;
      if (!c) return;
      switch (msg.type) {
        case "ready": {
          flushHandoff();
          return;
        }
        case "status": {
          c.playhead = {
            trackId: msg.trackId,
            positionMs: msg.positionMs,
            playing: msg.playing,
            atLocalMs: Date.now(),
          };
          const q = queueRef.current;
          if (
            q &&
            currentTrackId(q) === msg.trackId &&
            playingRef.current !== msg.playing
          ) {
            setPlaying(msg.playing);
          }
          return;
        }
        case "ended": {
          const q = queueRef.current;
          if (q && currentTrackId(q) === msg.trackId) advanceRef.current();
          return;
        }
        case "error": {
          const q = queueRef.current;
          const id = q ? currentTrackId(q) : null;
          if (id === null || msg.trackId !== id) return;
          const atMs =
            c.playhead && c.playhead.trackId === id
              ? castPositionMs(
                  c.playhead,
                  Date.now(),
                  metaRef.current.get(id)?.durationMs,
                )
              : 0;
          if (shouldReresolve(c.lastRetry, id, atMs)) {
            // One quota play: a fresh signed URL, reloaded at position.
            c.lastRetry = { trackId: id, positionMs: atMs };
            pendingSeekRef.current = { trackId: id, ms: atMs };
            void resolveAndPlay(id);
          } else {
            toast("stream error on the tv — skipping", "error");
            advanceRef.current();
          }
          return;
        }
      }
    },
  });
  castSenderRef.current = castSender;

  /** Playhead of the active output (ms) — see PlayerRefs.positionMsNow. */
  const positionMsNow = useCallback((): number => {
    const c = castRef.current;
    const q = queueRef.current;
    const id = q ? currentTrackId(q) : null;
    if (c?.playhead && id !== null && c.playhead.trackId === id) {
      return castPositionMs(
        c.playhead,
        Date.now(),
        metaRef.current.get(id)?.durationMs,
      );
    }
    return (audioRef.current?.currentTime ?? 0) * 1000;
  }, []);

  // Prefetch more of the station a few tracks before it runs out.
  useEffect(() => {
    if (!queue || followRef.current) return;
    if (sourceKindOf(queue.sourceId) !== "radio") return;
    if (shouldRefill(queue)) void refillRadio();
  }, [queue, refillRadio]);

  // -------------------------------------------------- slipstream follower

  /** Follow-mode consumer: failures skip within the host's window and never
   * touch the parked queue's unplayable list or fail streak. */
  const followPlay = useCallback(
    async (trackId: number, atMs: number) => {
      const el = audioRef.current;
      const f = followRef.current;
      if (!el || !f) return;
      ensureGraph();
      f.localTrackId = trackId;
      setCurrent(metaRef.current.get(trackId) ?? null);

      const outcome = await resolveStream(trackId);
      const now = followRef.current;
      if (!now || now.localTrackId !== trackId) return; // left or moved on
      if (!outcome.ok) {
        if (outcome.kind === "auth") {
          toast(outcome.message, "error");
          leaveSlipstreamRef.current();
          return;
        }
        if (outcome.kind === "quota") {
          // Stay attached, paused; polls are free and play retries.
          toast(outcome.message, "error");
          now.userPaused = true;
          publishFollowState();
          el.pause();
          setPlaying(false);
          return;
        }
        now.unavailable.add(trackId);
        const nextId = nextInWindow(now.snap.window, trackId, now.unavailable);
        if (nextId === null) {
          toast(
            "none of these tracks will stream for you — leaving slipstream",
            "error",
          );
          leaveSlipstreamRef.current();
          return;
        }
        followPlayRef.current(nextId, 0);
        return;
      }

      try {
        await loadStream(el, outcome);
        await el.play();
        setPlaying(true);
        // play() resolving means metadata is up — a positional join/switch
        // can seek immediately; tiny offsets aren't worth a rebuffer.
        if (atMs > 1_000) el.currentTime = atMs / 1000;
      } catch {
        // Autoplay policy — stay attached, paused; user gesture resumes.
        setPlaying(false);
      }
    },
    [ensureGraph, loadStream, publishFollowState, resolveStream, toast],
  );
  followPlayRef.current = (trackId, atMs) => void followPlay(trackId, atMs);

  const leaveSlipstream = useCallback(() => {
    const f = followRef.current;
    if (!f) return;
    followRef.current = null;
    setSlipstream(null);
    setShared(null);
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load(); // the empty-src togglePlay path re-resolves our own track
    }
    setPlaying(false);
    // Restore the parked queue's face; pressing play resumes at the parked
    // playhead via pendingSeekRef.
    const q = queueRef.current;
    const id = q ? currentTrackId(q) : null;
    if (id !== null && parkedRef.current) {
      pendingSeekRef.current = { trackId: id, ms: parkedRef.current.elapsedMs };
    }
    parkedRef.current = null;
    setCurrent(id !== null ? (metaRef.current.get(id) ?? null) : null);
  }, []);
  leaveSlipstreamRef.current = leaveSlipstream;

  /** Apply one planSync decision to the audio element. */
  const applySync = useCallback(() => {
    const f = followRef.current;
    const el = audioRef.current;
    if (!f || !el) return;
    const correctedNow = Date.now() + f.clockOffsetMs;
    const local: FollowerLocal = {
      trackId: f.localTrackId,
      positionMs: el.currentTime * 1000,
      playing: !el.paused,
      userPaused: f.userPaused,
      endedEarlyOn: f.endedEarlyOn,
      unavailable: f.unavailable,
    };
    const action = planSync(f.snap, local, correctedNow);
    switch (action.type) {
      case "seek":
        el.currentTime = action.toMs / 1000;
        break;
      case "play-track":
        followPlayRef.current(action.trackId, action.atMs);
        break;
      case "pause":
        el.pause();
        setPlaying(false);
        break;
      case "resume":
        if (!el.src) {
          followPlayRef.current(f.snap.trackId, action.atMs);
        } else {
          void el.play().then(
            () => {
              setPlaying(true);
              if (Math.abs(el.currentTime * 1000 - action.atMs) > 1_000) {
                el.currentTime = action.atMs / 1000;
              }
            },
            () => setPlaying(false),
          );
        }
        break;
      case "ended":
        toast(`${hostLabel(f.host)}'s slipstream ended — back to your queue`);
        leaveSlipstreamRef.current();
        break;
      case "none":
        break;
    }
  }, [toast]);

  const pollTick = useCallback(async () => {
    const f = followRef.current;
    if (!f) return;
    try {
      const res = await fetch(
        `/api/slipstreams/${f.host.userId}?rev=${f.shared?.revision ?? 0}`,
      );
      if (res.status === 404) {
        toast(`${hostLabel(f.host)}'s slipstream ended — back to your queue`);
        leaveSlipstreamRef.current();
        return;
      }
      if (!res.ok) throw new Error(`snapshot ${res.status}`);
      const wire = (await res.json()) as SnapshotWire;
      const now = followRef.current;
      if (!now) return;
      now.pollFailures = 0;
      now.clockOffsetMs = clockOffset(wire.serverNowMs, Date.now());
      now.snap = {
        hostId: wire.hostId,
        trackId: wire.trackId,
        positionMs: wire.positionMs,
        playing: wire.playing,
        window: wire.window,
        updatedAtMs: wire.updatedAtMs,
      };
      // The early-end hold is only for the host's *current* track.
      if (now.endedEarlyOn !== null && now.endedEarlyOn !== wire.trackId) {
        now.endedEarlyOn = null;
      }
      // Fill gaps only — our own cache entries stay authoritative.
      for (const t of wire.window) {
        if (!metaRef.current.has(t.id)) metaRef.current.set(t.id, t);
      }
      // Shared-session state rides the same poll. The queue is embedded
      // only when our revision was behind; otherwise keep what we have.
      const wasShared = now.shared !== null;
      if (wire.shared) {
        const entries = wire.shared.queue ?? now.shared?.entries ?? [];
        now.shared = {
          capability: wire.shared.capability,
          revision: wire.shared.revision,
          controlSeq: wire.shared.controlSeq,
          entries,
        };
        for (const t of entries) {
          if (!metaRef.current.has(t.id)) {
            metaRef.current.set(t.id, entryToTrack(t));
          }
        }
      } else {
        now.shared = null;
        if (wasShared) {
          toast("session is no longer shared — following read-only");
        }
      }
      if (wasShared !== (now.shared !== null) || wire.shared?.queue) {
        publishFollowState();
      }
      applySync();
    } catch {
      const now = followRef.current;
      if (!now) return;
      now.pollFailures += 1;
      if (now.pollFailures >= MAX_POLL_FAILURES) {
        toast(
          `lost ${hostLabel(now.host)}'s slipstream — back to your queue`,
          "error",
        );
        leaveSlipstreamRef.current();
      }
    }
  }, [applySync, publishFollowState, toast]);
  pollTickRef.current = () => void pollTick();

  useEffect(() => {
    if (!slipstream) return;
    const iv = setInterval(() => pollTickRef.current(), POLL_MS);
    return () => clearInterval(iv);
  }, [slipstream?.host.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const joinSlipstream = useCallback(
    async (hostId: number) => {
      const el = audioRef.current;
      if (!el || followRef.current?.host.userId === hostId) return;
      // Casting and slipstream modes stay mutually exclusive (v1).
      if (castRef.current) {
        toast("stop casting to join a slipstream");
        return;
      }
      // Joining someone is an implicit stop of your own shared session.
      if (hostSessionRef.current) stopSharedSessionRef.current();
      const res = await fetch(`/api/slipstreams/${hostId}`).catch(() => null);
      if (!res?.ok) {
        toast(
          res?.status === 404
            ? "that slipstream isn't live right now"
            : "couldn't join the slipstream — try again",
          "error",
        );
        return;
      }
      const wire = (await res.json()) as SnapshotWire;
      // Park the local queue on first join only — switching hosts keeps the
      // original park so leaving always lands where *you* left off.
      if (!followRef.current) {
        parkedRef.current = { elapsedMs: el.currentTime * 1000 };
        el.pause();
      }
      const host: SlipstreamHost = {
        userId: wire.hostId,
        username: wire.username,
        avatarUrl: wire.avatarUrl,
      };
      followRef.current = {
        host,
        snap: {
          hostId: wire.hostId,
          trackId: wire.trackId,
          positionMs: wire.positionMs,
          playing: wire.playing,
          window: wire.window,
          updatedAtMs: wire.updatedAtMs,
        },
        clockOffsetMs: clockOffset(wire.serverNowMs, Date.now()),
        userPaused: false,
        localTrackId: null,
        unavailable: new Set(),
        endedEarlyOn: null,
        pollFailures: 0,
        shared: wire.shared
          ? {
              capability: wire.shared.capability,
              revision: wire.shared.revision,
              controlSeq: wire.shared.controlSeq,
              entries: wire.shared.queue ?? [],
            }
          : null,
      };
      // Fill gaps only — our own cache entries stay authoritative.
      for (const t of wire.window) {
        if (!metaRef.current.has(t.id)) metaRef.current.set(t.id, t);
      }
      for (const t of wire.shared?.queue ?? []) {
        if (!metaRef.current.has(t.id)) metaRef.current.set(t.id, entryToTrack(t));
      }
      publishFollowState();
      toast(
        wire.shared
          ? `in ${hostLabel(host)}'s shared session — queue away`
          : `in ${hostLabel(host)}'s slipstream`,
      );
      const atMs = expectedPositionMs(
        followRef.current.snap,
        Date.now() + followRef.current.clockOffsetMs,
      );
      followPlayRef.current(wire.trackId, atMs);
    },
    [publishFollowState, toast],
  );

  /** Local track ended (or errored) while following: optimistically advance
   * into the host's window; the END_GRACE hold prevents ping-pong and the
   * early-end mark stops preview tracks from re-resolving every poll. */
  const followTrackEnded = useCallback(() => {
    const f = followRef.current;
    const el = audioRef.current;
    if (!f || f.localTrackId === null) return;
    const duration =
      metaRef.current.get(f.localTrackId)?.durationMs ??
      f.snap.window.find((t) => t.id === f.localTrackId)?.durationMs ??
      0;
    const endedAtMs = (el?.currentTime ?? 0) * 1000;
    if (duration > 0 && duration - endedAtMs > 10_000) {
      f.endedEarlyOn = f.localTrackId;
    }
    const nextId = nextInWindow(f.snap.window, f.localTrackId, f.unavailable);
    if (nextId !== null) followPlayRef.current(nextId, 0);
    else setPlaying(false); // window exhausted — wait for the next poll
  }, []);

  // ------------------------------------------------------ shared sessions

  /** Fill metadata gaps from shared entries — own cache stays authoritative. */
  const absorbEntries = useCallback((entries: readonly SharedQueueEntry[]) => {
    for (const e of entries) {
      if (!metaRef.current.has(e.id)) metaRef.current.set(e.id, entryToTrack(e));
    }
  }, []);

  /** Host applies a guest's transport intent to the local queue — the
   * host's audio element is the session's only clock. */
  const applySharedControl = useCallback(
    (control: SharedControl) => {
      const el = audioRef.current;
      const q = queueRef.current;
      if (!q || q.sourceId !== "shared") return;
      if (control.type === "prev") {
        // Same convention as local prev: early in a track go back, later
        // restart it (and coalesced double-prevs restart, harmlessly).
        if (el && el.currentTime > 3) {
          el.currentTime = 0;
          return;
        }
        const stepped = prev(q);
        if (stepped === q) {
          if (el) el.currentTime = 0;
          return;
        }
        setQueue(stepped);
        const id = currentTrackId(stepped);
        if (id !== null) void resolveAndPlay(id);
        return;
      }
      if (
        control.trackId === currentTrackId(q) ||
        !q.order.includes(control.trackId) ||
        q.unplayable.includes(control.trackId)
      ) {
        return; // stale/duplicate intent — already there or gone
      }
      setQueue(jumpTo(q, control.trackId));
      void resolveAndPlay(control.trackId);
    },
    [resolveAndPlay, setQueue],
  );

  /** Host-side state channel: shared wire arriving with each beat response. */
  const applyHostShared = useCallback(
    (wire: SharedWire) => {
      const hs = hostSessionRef.current;
      if (!hs) return;
      hs.revision = wire.revision;
      if (wire.queue !== undefined) {
        hs.entries = wire.queue;
        absorbEntries(wire.queue);
        const q = queueRef.current;
        if (q && q.sourceId === "shared" && !followRef.current) {
          setQueue(applySharedOrder(q, wire.queue.map((e) => e.id)));
        }
        publishSharedState();
      }
      if (wire.control && wire.controlSeq > hs.controlSeq) {
        hs.controlSeq = wire.controlSeq;
        applySharedControl(wire.control);
      } else {
        hs.controlSeq = Math.max(hs.controlSeq, wire.controlSeq);
      }
    },
    [absorbEntries, applySharedControl, publishSharedState, setQueue],
  );

  /** Apply a queue-mutation response (the new server truth) for our role. */
  const applySharedTruth = useCallback(
    (revision: number, entries: SharedQueueEntry[]) => {
      const f = followRef.current;
      if (f) {
        if (!f.shared) return;
        f.shared = { ...f.shared, revision, entries };
        absorbEntries(entries);
        publishSharedState();
        return;
      }
      const hs = hostSessionRef.current;
      if (!hs) return;
      hs.revision = revision;
      hs.entries = entries;
      absorbEntries(entries);
      const q = queueRef.current;
      if (q && q.sourceId === "shared") {
        setQueue(applySharedOrder(q, entries.map((e) => e.id)));
      }
      publishSharedState();
    },
    [absorbEntries, publishSharedState, setQueue],
  );

  const postQueueOp = useCallback(
    async (
      hostId: number,
      op:
        | { op: "add"; track: QueueTrack }
        | { op: "remove"; trackId: number }
        | { op: "reorder"; order: number[]; expectedRevision: number },
    ) => {
      const capability =
        followRef.current?.shared?.capability ??
        hostSessionRef.current?.capability;
      if (!capability) return false;
      const res = await fetch(`/api/slipstreams/${hostId}/queue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nimbus-Shared-Capability": capability,
        },
        body: JSON.stringify(op),
      }).catch(() => null);
      if (res?.ok) {
        const { revision, queue } = (await res.json()) as {
          revision: number;
          queue: SharedQueueEntry[];
        };
        applySharedTruth(revision, queue);
        return true;
      }
      if (res?.status === 409) {
        toast("queue changed under you — try again", "error");
      } else if (res?.status === 404) {
        toast("the session is gone", "error");
      } else {
        const err = (await res?.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast(
          err?.error === "already queued"
            ? "already in the session queue"
            : err?.error === "queue full"
              ? "session queue is full"
              : "couldn't edit the session queue",
          "error",
        );
      }
      return false;
    },
    [applySharedTruth, toast],
  );

  /** Guest transport intent; the host applies it within a beat (≤5s). */
  const postControl = useCallback(
    async (hostId: number, control: SharedControl) => {
      const capability = followRef.current?.shared?.capability;
      if (!capability) return;
      const res = await fetch(`/api/slipstreams/${hostId}/control`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nimbus-Shared-Capability": capability,
        },
        body: JSON.stringify(control),
      }).catch(() => null);
      if (!res?.ok) toast("couldn't reach the session", "error");
    },
    [toast],
  );

  const startSharedSession = useCallback(async () => {
    const q = queueRef.current;
    if (!q || followRef.current || hostSessionRef.current) return;
    // Casting and slipstream modes stay mutually exclusive (v1).
    if (castRef.current) {
      toast("stop casting to share the session");
      return;
    }
    const cur = currentTrackId(q);
    if (cur === null) return;
    const seed = seedEntries(upcoming(q, SHARED_SEED_COUNT), (id) =>
      metaRef.current.get(id),
    );
    const res = await fetch("/api/slipstream/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queue: seed }),
    }).catch(() => null);
    if (!res?.ok) {
      toast("couldn't start the shared session", "error");
      return;
    }
    const { capability, revision, queue: entries } = (await res.json()) as {
      capability: string;
      revision: number;
      queue: SharedQueueEntry[];
    };
    hostSessionRef.current = {
      capability,
      revision,
      controlSeq: 0,
      entries,
    };
    // A deliberate new playback context (like playFrom): the previous
    // queue is replaced, not parked. Audio is untouched.
    const order = [cur, ...entries.map((e) => e.id)];
    setQueue({
      sourceId: "shared",
      order,
      sourceOrder: [...order],
      position: 0,
      shuffled: false,
      shuffleMode: q.shuffleMode,
      seed: q.seed,
      repeat: "off",
      history: [],
      unplayable: q.unplayable,
    });
    publishSharedState();
    toast("session shared — friends can queue tracks and skip");
  }, [publishSharedState, setQueue, toast]);

  const stopSharedSession = useCallback(() => {
    if (!hostSessionRef.current) return;
    hostSessionRef.current = null;
    publishSharedState();
    // Best-effort: the next plain heartbeat self-heals the row anyway.
    void fetch("/api/slipstream/session", { method: "DELETE" }).catch(
      () => {},
    );
  }, [publishSharedState]);
  stopSharedSessionRef.current = stopSharedSession;

  // ------------------------------------------------------------- actions

  const actions = useMemo<PlayerActions>(() => {
    const playCurrentOf = (q: QueueState) => {
      const id = currentTrackId(q);
      if (id !== null) void resolveAndPlay(id);
    };

    /** Whose session queue edits should target; null when not in one. */
    const sessionHostId = (): number | null => {
      const f = followRef.current;
      if (f) return f.shared ? f.host.userId : null;
      return hostSessionRef.current ? userId : null;
    };

    const addToShared = (track: QueueTrack): void => {
      const hostId = sessionHostId();
      if (hostId === null) return;
      // Strip to the wire shape — callers may hand us richer objects.
      const clean: QueueTrack = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        ...(track.artistId === undefined ? {} : { artistId: track.artistId }),
        artistUrl: track.artistUrl,
        artworkUrl: track.artworkUrl,
        permalinkUrl: track.permalinkUrl,
        durationMs: track.durationMs,
        ...(track.preview === true ? { preview: true } : {}),
      };
      metaRef.current.set(clean.id, clean);
      void postQueueOp(hostId, { op: "add", track: clean }).then((ok) => {
        if (ok) toast(`queued for the session · ${clean.title}`);
      });
    };

    return {
      playFrom(sourceKey, tracks, startTrackId, opts) {
        // Choosing your own music is an implicit leave / stop-sharing.
        if (followRef.current) leaveSlipstreamRef.current();
        if (hostSessionRef.current) stopSharedSessionRef.current();
        pendingSeekRef.current = null;
        for (const t of tracks) metaRef.current.set(t.id, toQueueTrack(t));
        const playable = tracks.filter((t) => t.streamable).map((t) => t.id);
        if (playable.length === 0) return;
        // Carry the active shuffle algorithm into the new queue.
        const mode = queueRef.current?.shuffleMode ?? "classic";
        const shuffle = opts?.shuffle ?? false;
        void (async () => {
          if (shuffle && mode === "rediscovery") await ensurePlays();
          let q = createQueue(sourceKey, playable, {
            shuffle,
            startTrackId,
            shuffleMode: mode,
            ctx: buildCtx(),
          });
          if (currentTrackId(q) === null) q = jumpTo(q, q.order[0]);
          failStreakRef.current = 0;
          setQueue(q);
          playCurrentOf(q);
        })();
      },

      registerTracks(sourceKey, tracks) {
        for (const t of tracks) metaRef.current.set(t.id, toQueueTrack(t));
        const q = queueRef.current;
        if (q && q.sourceId === sourceKey) {
          // Collections grow as pages stream in; fold new ids into the
          // queue — shuffled queues mix them into the unplayed remainder.
          const additions = tracks.filter((t) => t.streamable).map((t) => t.id);
          const merged = integrate(q, additions, buildCtx());
          if (merged !== q) setQueue(merged);
        }
      },

      syncSource(sourceKey, tracks) {
        for (const t of tracks) metaRef.current.set(t.id, toQueueTrack(t));
        const q = queueRef.current;
        if (q && q.sourceId === sourceKey) {
          const fresh = tracks.filter((t) => t.streamable).map((t) => t.id);
          setQueue(reconcile(integrate(q, fresh, buildCtx()), fresh));
        }
      },

      togglePlay() {
        const el = audioRef.current;
        if (!el) return;
        const c = castRef.current;
        if (c) {
          const q = queueRef.current;
          if (!q) return;
          const id = currentTrackId(q);
          if (id === null) return;
          if (playingRef.current) {
            castSenderRef.current?.send({ type: "pause" });
            setPlaying(false);
            return;
          }
          if (c.playhead?.trackId === id) {
            castSenderRef.current?.send({ type: "play" });
            setPlaying(true);
            return;
          }
          // Nothing loaded on the TV yet — reuse the URL already in hand
          // (paused handoff, reload) before burning a play resolution. A
          // stale URL just errors on the receiver and re-resolves once.
          const pending = pendingSeekRef.current;
          const atMs = pending?.trackId === id ? pending.ms : 0;
          if (lastStreamRef.current?.trackId === id) {
            pendingSeekRef.current = null;
            castLoadRef.current(lastStreamRef.current, atMs);
          } else {
            void resolveAndPlay(id);
          }
          return;
        }
        const f = followRef.current;
        if (f) {
          // Following: pause is purely local; resume snaps back to the host.
          if (el.paused) {
            ensureGraph();
            f.userPaused = false;
            publishFollowState();
            pollTickRef.current(); // immediate poll → resume/seek per plan
          } else {
            f.userPaused = true;
            publishFollowState();
            el.pause();
            setPlaying(false);
          }
          return;
        }
        const q = queueRef.current;
        if (!q) return;
        const id = currentTrackId(q);
        if (id === null) return;
        if (el.paused) {
          ensureGraph();
          // After a reload there is no src yet — resolve a fresh stream URL.
          if (!el.src) {
            void resolveAndPlay(id);
            return;
          }
          void el.play().then(
            () => setPlaying(true),
            () => void resolveAndPlay(id), // stale signed URL — re-resolve
          );
        } else {
          el.pause();
          setPlaying(false);
        }
      },

      // Hardware media keys route here too — the caps-disabled UI isn't the
      // only entry point, so follow mode gates at the action layer as well.
      // In a shared session skips become control intents the host applies.
      nextTrack: () => {
        const f = followRef.current;
        if (f) {
          if (!f.shared) return;
          const target = f.shared.entries[0];
          if (!target) {
            toast("nothing queued — add something first");
            return;
          }
          void postControl(f.host.userId, {
            type: "play",
            trackId: target.id,
          });
          return;
        }
        advanceRef.current();
      },

      prevTrack() {
        const f = followRef.current;
        if (f) {
          if (f.shared) void postControl(f.host.userId, { type: "prev" });
          return;
        }
        const el = audioRef.current;
        const q = queueRef.current;
        if (!q) return;
        // Convention: early in a track, go back; later, restart it.
        if (el && el.currentTime > 3) {
          el.currentTime = 0;
          return;
        }
        const stepped = prev(q);
        if (stepped === q) {
          if (el) el.currentTime = 0;
          return;
        }
        setQueue(stepped);
        playCurrentOf(stepped);
      },

      jumpToTrack(trackId) {
        const f = followRef.current;
        if (f) {
          if (f.shared?.entries.some((e) => e.id === trackId)) {
            void postControl(f.host.userId, { type: "play", trackId });
          }
          return;
        }
        pendingSeekRef.current = null;
        const q = queueRef.current;
        if (!q) return;
        const jumped = jumpTo(q, trackId);
        setQueue(jumped);
        void resolveAndPlay(trackId);
      },

      startRadio(track) {
        // Choosing your own music is an implicit leave / stop-sharing.
        if (followRef.current) leaveSlipstreamRef.current();
        if (hostSessionRef.current) stopSharedSessionRef.current();
        pendingSeekRef.current = null;
        radioTriedSeedsRef.current = new Set();
        radioEndedRef.current = false;
        failStreakRef.current = 0;
        metaRef.current.set(track.id, track);
        // The seed plays immediately; the refill machinery fills in the
        // station behind it.
        const q = seedStation(
          track.id,
          queueRef.current?.shuffleMode ?? "classic",
        );
        setQueue(q);
        void resolveAndPlay(track.id);
        void refillRadio();
        toast(`radio · ${track.title}`);
      },

      toggleShuffleMode() {
        if (followRef.current) return;
        const q = queueRef.current;
        if (!q) return;
        void (async () => {
          if (!q.shuffled && q.shuffleMode === "rediscovery") {
            await ensurePlays();
          }
          setQueue(toggleShuffle(q, true, buildCtx()));
        })();
      },

      setShuffleMode(mode) {
        if (followRef.current) return;
        void (async () => {
          if (mode === "rediscovery") await ensurePlays();
          const q = queueRef.current;
          if (!q) return;
          setQueue(engineSetShuffleMode(q, mode, buildCtx()));
        })();
      },

      cycleRepeat() {
        if (followRef.current) return;
        const q = queueRef.current;
        if (!q) return;
        const order: RepeatMode[] = ["off", "all", "one"];
        setQueue(setRepeat(q, order[(order.indexOf(q.repeat) + 1) % 3]));
      },

      setVolume(v) {
        const clamped = Math.min(1, Math.max(0, v));
        // While casting the slider drives the device; the local volume
        // (state + persistence) stays untouched for the return.
        if (castRef.current) {
          castSenderRef.current?.setDeviceVolume(clamped);
          return;
        }
        setVolumeState(clamped);
        try {
          localStorage.setItem(VOLUME_KEY, String(clamped));
        } catch {
          // best-effort
        }
      },

      setLeveling(on) {
        levelingRef.current = on;
        setLevelingState(on);
        writePref("leveling", on);
        const limiter = limiterRef.current;
        const ctx = ctxRef.current;
        if (limiter && ctx) {
          limiter.threshold.setTargetAtTime(
            on ? LIMITER_THRESHOLD_DB : 0,
            ctx.currentTime,
            0.1,
          );
        }
        if (!on) {
          applyLevelerGain(0, LEVELER_RAMP_S);
          return;
        }
        // Re-engage with the freshest knowledge: this session's estimate
        // if it exists, else the cached loudness.
        const id = levelerTrackRef.current;
        const known =
          loudnessDb(levelerRef.current) ??
          (id !== null ? loudnessMapRef.current.get(id) : undefined);
        if (known != null) applyLevelerGain(gainDbFor(known), LEVELER_RAMP_S);
      },

      setAutoRadio(on) {
        autoRadioRef.current = on;
        setAutoRadioState(on);
        writePref("autoRadio", on);
      },

      setPrivateListening(on) {
        // Optimistic: the publisher gate reacts immediately (sending the
        // final playing:false beat); the server is the durable copy.
        setPrivateListeningState(on);
        void fetch("/api/me/privacy", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ privateListening: on }),
        })
          .then((res) => {
            if (!res.ok) throw new Error();
          })
          .catch(() => {
            setPrivateListeningState(!on);
            toast("couldn't update private listening", "error");
          });
      },

      openStage: () => setStageOpen(true),
      closeStage: () => setStageOpen(false),

      getMeta: (trackId) => metaRef.current.get(trackId),

      upcomingTracks(n) {
        const f = followRef.current;
        if (f) {
          // Shared session: the agreed list IS what's upcoming (the
          // 10-track window that drives audio advance is a prefix of it).
          if (f.shared) return f.shared.entries.slice(0, n).map(entryToTrack);
          // The rest of the host's window after wherever we actually are.
          const anchor = f.localTrackId ?? f.snap.trackId;
          const at = f.snap.window.findIndex((t) => t.id === anchor);
          return f.snap.window.slice(
            at === -1 ? 1 : at + 1,
            at === -1 ? n + 1 : at + 1 + n,
          );
        }
        const q = queueRef.current;
        if (!q) return [];
        return upcoming(q, n)
          .map((id) => metaRef.current.get(id))
          .filter((t): t is QueueTrack => t !== undefined);
      },

      joinSlipstream,

      leaveSlipstream,

      startSharedSession: () => void startSharedSession(),

      stopSharedSession() {
        stopSharedSession();
        toast("stopped sharing — the queue is yours again");
      },

      addToSharedQueue(track) {
        addToShared(track);
      },

      queueTrack(track, where) {
        // Shared session (host or guest): the session queue is the queue —
        // append there. The wire is append-only, so `where` is moot.
        if (sessionHostId() !== null) {
          addToShared(track);
          return;
        }
        // Plain follow mode: the local queue is parked — leave it alone.
        // (The UI hides the buttons; media-key-style belt and braces.)
        if (followRef.current) return;
        const q = queueRef.current;
        if (!q) return;
        metaRef.current.set(track.id, track);
        const nq = enqueue(q, track.id, where);
        if (nq === q) return;
        setQueue(nq);
        toast(
          where === "next"
            ? `up next · ${track.title}`
            : `queued · ${track.title}`,
        );
      },

      removeFromSharedQueue(trackId) {
        const hostId = sessionHostId();
        if (hostId === null) return;
        void postQueueOp(hostId, { op: "remove", trackId });
      },

      moveInSharedQueue(trackId, dir) {
        const hostId = sessionHostId();
        if (hostId === null) return;
        const s = followRef.current
          ? followRef.current.shared
          : hostSessionRef.current;
        if (!s) return;
        const ids = s.entries.map((e) => e.id);
        const at = ids.indexOf(trackId);
        const to = at + dir;
        if (at === -1 || to < 0 || to >= ids.length) return;
        [ids[at], ids[to]] = [ids[to], ids[at]];
        void postQueueOp(hostId, {
          op: "reorder",
          order: ids,
          expectedRevision: s.revision,
        });
      },

      startCasting() {
        if (
          !canStartCasting({
            following: followRef.current !== null,
            hostingShared: hostSessionRef.current !== null,
          })
        ) {
          toast("leave the slipstream to cast");
          return;
        }
        castSenderRef.current?.start();
      },

      stopCasting() {
        castSenderRef.current?.stop();
      },

      seekTo(ms) {
        const c = castRef.current;
        if (c) {
          const clamped = Math.max(0, Math.floor(ms));
          castSenderRef.current?.send({ type: "seek", ms: clamped });
          // Optimistic: the scrubber shouldn't snap back for a beat.
          if (c.playhead) {
            c.playhead = {
              ...c.playhead,
              positionMs: clamped,
              atLocalMs: Date.now(),
            };
          }
          return;
        }
        const el = audioRef.current;
        if (el) el.currentTime = ms / 1000;
      },
    };
  }, [
    applyLevelerGain,
    buildCtx,
    ensureGraph,
    ensurePlays,
    joinSlipstream,
    leaveSlipstream,
    postControl,
    postQueueOp,
    publishFollowState,
    resolveAndPlay,
    setQueue,
    startSharedSession,
    stopSharedSession,
    toast,
    userId,
  ]);
  sharedRemoveRef.current = (trackId) => actions.removeFromSharedQueue(trackId);

  // Keep `current` in sync with the queue position (not while following —
  // `current` shows the host's track then).
  useEffect(() => {
    if (!queue || followRef.current) return;
    const id = currentTrackId(queue);
    if (id === null) return;
    const meta = metaRef.current.get(id);
    if (meta) setCurrent(meta);
  }, [queue]);

  // AFK guard: an unattended playing client eventually silences itself.
  // Pausing stops the heartbeats for free (the publisher is gated on
  // `playing`); a follower leaves instead so its 5s snapshot poll stops
  // too. The daily play quota remains the hard backstop.
  useEffect(() => {
    if (!playing && !slipstream) return;
    const iv = setInterval(() => {
      const action = afkAction({
        playing: playingRef.current,
        following: followRef.current !== null,
        idleForMs: idleFor(),
      });
      if (action === "pause") {
        // While casting the local element is silent — pause the TV.
        if (castRef.current) castSenderRef.current?.send({ type: "pause" });
        audioRef.current?.pause();
        setPlaying(false);
        toast("paused — looks like you stepped away");
      } else if (action === "leave") {
        toast("left the slipstream — you seemed away");
        leaveSlipstreamRef.current();
      }
    }, AFK_CHECK_MS);
    return () => clearInterval(iv);
  }, [playing, slipstream, toast]);

  const audioElGetter = useCallback(() => audioRef.current, []);
  useMediaSession({
    current,
    playing,
    audioEl: audioElGetter,
    onPlay: actions.togglePlay,
    onPause: actions.togglePlay,
    onNext: actions.nextTrack,
    onPrev: actions.prevTrack,
  });

  // ---------------------------------------------- slipstream (publishing)

  const windowKey = useMemo(() => {
    if (!queue) return "";
    const id = currentTrackId(queue);
    if (id === null) return "";
    return [id, ...upcoming(queue, WINDOW_SIZE - 1)].join(",");
  }, [queue]);

  const buildBeat = useCallback((): PublishedBeat | null => {
    const q = queueRef.current;
    if (!q) return null;
    const id = currentTrackId(q);
    if (id === null) return null;
    const meta = metaRef.current.get(id);
    if (!meta) return null;
    const rest = upcoming(q, WINDOW_SIZE - 1)
      .map((tid) => metaRef.current.get(tid))
      .filter((t): t is QueueTrack => t !== undefined);
    return {
      trackId: id,
      // The active output's playhead — cast position while casting, so
      // published presence stays truthful with the TV.
      positionMs: Math.max(0, Math.floor(positionMsNow())),
      playing: playingRef.current,
      window: [meta, ...rest],
    };
  }, [positionMsNow]);

  const sharedBeatState = useCallback(() => {
    const hs = hostSessionRef.current;
    return hs ? { rev: hs.revision, controlSeq: hs.controlSeq } : null;
  }, []);

  useSlipstreamPublisher({
    // Inert while following or listening privately (hosting a shared
    // session publishes regardless — sharing is its own explicit act).
    enabled: publisherEnabled({
      playing,
      hasTrack: current !== null,
      following: slipstream !== null,
      privateListening,
      hostingShared: shared?.role === "host",
    }),
    trackId: current?.id ?? null,
    playing,
    windowKey,
    buildBeat,
    audioEl: audioElGetter,
    // Hosting a shared session: 5s beats whose responses double as the
    // host's state poll (queue by revision, pending control intents).
    keepaliveMs: shared?.role === "host" ? POLL_MS : HEARTBEAT_MS,
    shared: sharedBeatState,
    onShared: applyHostShared,
  });

  const state = useMemo<PlayerState>(
    () => ({
      current,
      playing,
      shuffled: queue?.shuffled ?? false,
      shuffleMode: queue?.shuffleMode ?? "classic",
      repeat: queue?.repeat ?? "off",
      volume,
      leveling,
      autoRadio,
      privateListening,
      stageOpen,
      queue,
      caps: capsOf(
        slipstream
          ? slipstream.shared
            ? "slipstream-shared"
            : "slipstream"
          : sourceKindOf(queue?.sourceId ?? "likes"),
      ),
      slipstream,
      shared,
      cast:
        castSender.status === "unavailable"
          ? null
          : {
              status: castSender.status,
              deviceName: castSender.deviceName,
              deviceVolume: castSender.deviceVolume,
            },
    }),
    [
      current,
      playing,
      queue,
      shared,
      slipstream,
      volume,
      leveling,
      autoRadio,
      privateListening,
      stageOpen,
      castSender.status,
      castSender.deviceName,
      castSender.deviceVolume,
    ],
  );

  const refs = useMemo<PlayerRefs>(
    () => ({ audioRef, analyserRef, positionMsNow }),
    [positionMsNow],
  );

  return (
    <StateCtx.Provider value={state}>
      <ActionsCtx.Provider value={actions}>
        <RefsCtx.Provider value={refs}>
          <audio
            ref={audioRef}
            crossOrigin="anonymous"
            onEnded={() => {
              if (followRef.current) followTrackEnded();
              else advanceRef.current();
            }}
            onError={() => {
              // Signed CDN URLs expire; a load error mid-session usually
              // means a stale URL — surface and move on.
              if (!audioRef.current?.src) return;
              if (followRef.current) {
                // Same shape as an early end: advance in the window and
                // let the next poll straighten things out.
                followTrackEnded();
                return;
              }
              toast("stream error — skipping", "error");
              advanceRef.current();
            }}
          />
          {children}
        </RefsCtx.Provider>
      </ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}
