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
import { formatReset } from "@/lib/format";
import {
  createQueue,
  currentTrackId,
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
  POLL_MS,
  WINDOW_SIZE,
  clockOffset,
  expectedPositionMs,
  nextInWindow,
  planSync,
  type FollowerLocal,
  type SlipstreamSnapshot,
} from "@/lib/slipstream";
import { useMediaSession } from "@/lib/hooks/useMediaSession";
import {
  useSlipstreamPublisher,
  type PublishedBeat,
} from "@/lib/hooks/useSlipstreamPublisher";
import { useToast } from "@/components/ui/Toast";

export type VizMode = "off" | "mini" | "full";

/** Stops runaway skip loops when many tracks in a row fail to stream. */
const MAX_CONSECUTIVE_FAILURES = 5;
/** Consecutive follower poll failures tolerated before treating the host
 * as gone (network blips shouldn't end a follow). */
const MAX_POLL_FAILURES = 3;
const VOLUME_KEY = "nimbus:volume";

export interface SlipstreamHost {
  userId: number;
  username: string | null;
  avatarUrl: string | null;
}

export interface SlipstreamStatus {
  host: SlipstreamHost;
  /** Follower paused locally (or is quota-blocked); host state won't resume us. */
  userPaused: boolean;
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
}

const hostLabel = (h: SlipstreamHost) => h.username ?? "member";

export interface PlayerState {
  current: QueueTrack | null;
  playing: boolean;
  shuffled: boolean;
  shuffleMode: ShuffleMode;
  repeat: RepeatMode;
  volume: number;
  vizMode: VizMode;
  queue: QueueState | null;
  /** What the active source lets the user do; UI gates transport off this. */
  caps: SourceCapabilities;
  /** Set while following someone's slipstream. */
  slipstream: SlipstreamStatus | null;
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
  togglePlay(): void;
  nextTrack(): void;
  prevTrack(): void;
  jumpToTrack(trackId: number): void;
  toggleShuffleMode(): void;
  /** Switch shuffle algorithm; turns shuffle on and reshuffles. */
  setShuffleMode(mode: ShuffleMode): void;
  cycleRepeat(): void;
  setVolume(v: number): void;
  setVizMode(mode: VizMode): void;
  getMeta(trackId: number): QueueTrack | undefined;
  upcomingTracks(n: number): QueueTrack[];
  /** Follow a member's live queue (read-only). Parks the local queue. */
  joinSlipstream(hostId: number): Promise<void>;
  /** Back to the parked local queue, exactly as it was left. */
  leaveSlipstream(): void;
}

export interface PlayerRefs {
  audioRef: RefObject<HTMLAudioElement | null>;
  analyserRef: RefObject<AnalyserNode | null>;
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
    artistUrl: t.artistUrl,
    artworkUrl: t.artworkUrl,
    permalinkUrl: t.permalinkUrl,
    durationMs: t.durationMs,
  };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const toast = useToast();

  const [queue, setQueueState] = useState<QueueState | null>(null);
  const [current, setCurrent] = useState<QueueTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [vizMode, setVizModeState] = useState<VizMode>("mini");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<QueueState | null>(null);
  const metaRef = useRef<Map<number, QueueTrack>>(new Map());
  const failStreakRef = useRef(0);
  const playsRef = useRef<Map<number, { playCount: number; lastPlayedAt: number }>>(
    new Map(),
  );
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

  /** Mirror the UI-relevant slice of followRef into React state. */
  const publishFollowState = useCallback(() => {
    const f = followRef.current;
    setSlipstream(f ? { host: f.host, userPaused: f.userPaused } : null);
  }, []);

  // Late-bound so async loops always see the current implementations.
  const followPlayRef = useRef<(trackId: number, atMs: number) => void>(() => {});
  const leaveSlipstreamRef = useRef<() => void>(() => {});
  const pollTickRef = useRef<() => void>(() => {});

  const setQueue = useCallback((q: QueueState | null) => {
    queueRef.current = q;
    setQueueState(q);
  }, []);

  // ---------------------------------------------------------- rehydrate

  useEffect(() => {
    const persisted = loadQueue();
    if (persisted) {
      setQueue(persisted.state);
      setCurrent(persisted.currentTrack);
      if (persisted.currentTrack) {
        metaRef.current.set(persisted.currentTrack.id, persisted.currentTrack);
      }
    }
    const storedVolume = Number(localStorage.getItem(VOLUME_KEY));
    if (storedVolume >= 0 && storedVolume <= 1 && !Number.isNaN(storedVolume)) {
      setVolumeState(storedVolume);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist queue + snapshot whenever they change (post-rehydration).
  // Never while following: `current` shows the host's track then and must
  // not overwrite the parked local snapshot.
  useEffect(() => {
    if (followRef.current) return;
    if (queue) saveQueue(queue, current);
  }, [queue, current]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = volume;
  }, [volume]);

  // -------------------------------------------------------- audio graph

  const ensureGraph = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (ctxRef.current) {
      void ctxRef.current.resume();
      return;
    }
    // A media element accepts exactly one MediaElementSourceNode, ever —
    // build the graph once and reuse it for the app's lifetime.
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    // 2048 gives ~21.5 Hz/bin bass resolution and a ~46 ms scope window.
    // Down-smoothing lives in the cava-style gravity (lib/viz/dsp.ts), so
    // the analyser's own smoothing stays low to keep onsets sharp.
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    ctxRef.current = ctx;
    analyserRef.current = analyser;
    void ctx.resume();
  }, []);

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
        plays: Array<{ trackId: number; playCount: number; lastPlayedAt: string }>;
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
    | { ok: true; url: string }
    | { ok: false; kind: "auth" | "quota" | "unavailable" | "error"; message: string };

  /** Fetch + error vocabulary only — no queue or follow side effects. The
   * local and follow consumers decide what each outcome means. */
  const resolveStream = useCallback(
    async (trackId: number): Promise<ResolveOutcome> => {
      const meta = metaRef.current.get(trackId);
      const label = meta ? `"${meta.title}"` : `track ${trackId}`;
      const res = await fetch(`/api/tracks/${trackId}/play`).catch(() => null);
      if (res?.ok) {
        const { url } = (await res.json()) as { url: string };
        return { ok: true, url };
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

  /** Local-queue consumer — today's semantics, unchanged. */
  const resolveAndPlay = useCallback(
    async (trackId: number) => {
      const el = audioRef.current;
      if (!el) return;
      ensureGraph();
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
      el.src = outcome.url;
      try {
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
    [ensureGraph, resolveStream, setQueue, toast],
  );

  const advance = useCallback(() => {
    const q = queueRef.current;
    if (!q) return;
    const { state, ended } = next(q);
    setQueue(state);
    if (ended) {
      setPlaying(false);
      return;
    }
    const id = currentTrackId(state);
    if (id !== null) void resolveAndPlay(id);
  }, [resolveAndPlay, setQueue]);
  advanceRef.current = advance;

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

      el.src = outcome.url;
      try {
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
    [ensureGraph, publishFollowState, resolveStream, toast],
  );
  followPlayRef.current = (trackId, atMs) => void followPlay(trackId, atMs);

  const leaveSlipstream = useCallback(() => {
    const f = followRef.current;
    if (!f) return;
    followRef.current = null;
    setSlipstream(null);
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
        toast(
          `${hostLabel(f.host)}'s slipstream ended — back to your queue`,
        );
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
      const res = await fetch(`/api/slipstreams/${f.host.userId}`);
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
  }, [applySync, toast]);
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
      };
      // Fill gaps only — our own cache entries stay authoritative.
      for (const t of wire.window) {
        if (!metaRef.current.has(t.id)) metaRef.current.set(t.id, t);
      }
      publishFollowState();
      toast(`in ${hostLabel(host)}'s slipstream`);
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

  // ------------------------------------------------------------- actions

  const actions = useMemo<PlayerActions>(() => {
    const playCurrentOf = (q: QueueState) => {
      const id = currentTrackId(q);
      if (id !== null) void resolveAndPlay(id);
    };

    return {
      playFrom(sourceKey, tracks, startTrackId, opts) {
        // Choosing your own music is an implicit leave.
        if (followRef.current) leaveSlipstreamRef.current();
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
          // Collections grow as pages stream in; fold new ids into the queue.
          const known = new Set(q.order);
          const additions = tracks.filter(
            (t) => t.streamable && !known.has(t.id),
          );
          if (additions.length > 0) {
            setQueue(
              reconcile(q, [...q.sourceOrder, ...additions.map((t) => t.id)]),
            );
          }
        }
      },

      togglePlay() {
        const el = audioRef.current;
        if (!el) return;
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
      nextTrack: () => {
        if (followRef.current) return;
        advanceRef.current();
      },

      prevTrack() {
        if (followRef.current) return;
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
        if (followRef.current) return;
        pendingSeekRef.current = null;
        const q = queueRef.current;
        if (!q) return;
        const jumped = jumpTo(q, trackId);
        setQueue(jumped);
        void resolveAndPlay(trackId);
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
        setVolumeState(clamped);
        try {
          localStorage.setItem(VOLUME_KEY, String(clamped));
        } catch {
          // best-effort
        }
      },

      setVizMode: setVizModeState,

      getMeta: (trackId) => metaRef.current.get(trackId),

      upcomingTracks(n) {
        const f = followRef.current;
        if (f) {
          // The rest of the host's window after wherever we actually are.
          const anchor = f.localTrackId ?? f.snap.trackId;
          const at = f.snap.window.findIndex((t) => t.id === anchor);
          return f.snap.window.slice(at === -1 ? 1 : at + 1, at === -1 ? n + 1 : at + 1 + n);
        }
        const q = queueRef.current;
        if (!q) return [];
        return upcoming(q, n)
          .map((id) => metaRef.current.get(id))
          .filter((t): t is QueueTrack => t !== undefined);
      },

      joinSlipstream,

      leaveSlipstream,
    };
  }, [
    buildCtx,
    ensureGraph,
    ensurePlays,
    joinSlipstream,
    leaveSlipstream,
    publishFollowState,
    resolveAndPlay,
    setQueue,
  ]);

  // Keep `current` in sync with the queue position (not while following —
  // `current` shows the host's track then).
  useEffect(() => {
    if (!queue || followRef.current) return;
    const id = currentTrackId(queue);
    if (id === null) return;
    const meta = metaRef.current.get(id);
    if (meta) setCurrent(meta);
  }, [queue]);

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
      positionMs: Math.max(
        0,
        Math.floor((audioRef.current?.currentTime ?? 0) * 1000),
      ),
      playing: playingRef.current,
      window: [meta, ...rest],
    };
  }, []);

  useSlipstreamPublisher({
    // Inert while following — that's what makes chained follows impossible.
    enabled: playing && !slipstream && current !== null,
    trackId: current?.id ?? null,
    playing,
    windowKey,
    buildBeat,
    audioEl: audioElGetter,
  });

  const state = useMemo<PlayerState>(
    () => ({
      current,
      playing,
      shuffled: queue?.shuffled ?? false,
      shuffleMode: queue?.shuffleMode ?? "classic",
      repeat: queue?.repeat ?? "off",
      volume,
      vizMode,
      queue,
      caps: capsOf(
        slipstream ? "slipstream" : sourceKindOf(queue?.sourceId ?? "likes"),
      ),
      slipstream,
    }),
    [current, playing, queue, slipstream, volume, vizMode],
  );

  const refs = useMemo<PlayerRefs>(() => ({ audioRef, analyserRef }), []);

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
