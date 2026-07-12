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
  toggleShuffle,
  upcoming,
  type QueueState,
  type QueueTrack,
  type RepeatMode,
} from "@/lib/queue";
import { useMediaSession } from "@/lib/hooks/useMediaSession";
import { useToast } from "@/components/ui/Toast";

export type VizMode = "off" | "mini" | "full";

/** Stops runaway skip loops when many tracks in a row fail to stream. */
const MAX_CONSECUTIVE_FAILURES = 5;
const VOLUME_KEY = "nimbus:volume";

export interface PlayerState {
  current: QueueTrack | null;
  playing: boolean;
  shuffled: boolean;
  repeat: RepeatMode;
  volume: number;
  vizMode: VizMode;
  queue: QueueState | null;
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
  cycleRepeat(): void;
  setVolume(v: number): void;
  setVizMode(mode: VizMode): void;
  getMeta(trackId: number): QueueTrack | undefined;
  upcomingTracks(n: number): QueueTrack[];
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
  useEffect(() => {
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
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    ctxRef.current = ctx;
    analyserRef.current = analyser;
    void ctx.resume();
  }, []);

  // ------------------------------------------------------------ playback

  const advanceRef = useRef<() => void>(() => {});

  const resolveAndPlay = useCallback(
    async (trackId: number) => {
      const el = audioRef.current;
      if (!el) return;
      ensureGraph();
      setCurrent(metaRef.current.get(trackId) ?? null);

      const res = await fetch(`/api/tracks/${trackId}/play`);
      if (!res.ok) {
        const meta = metaRef.current.get(trackId);
        const label = meta ? `"${meta.title}"` : `track ${trackId}`;
        if (res.status === 401 || res.status === 403) {
          toast(
            res.status === 401
              ? "session expired — sign in again"
              : "your account is disabled",
            "error",
          );
          setPlaying(false);
          return;
        }
        if (res.status === 429) {
          // Quota exhausted — pause where we are. Skipping would spam the
          // API and wrongly mark playable tracks unplayable.
          const q = (await res.json()) as { scope: string; resetsAt: string };
          toast(
            q.scope === "user"
              ? `daily play limit reached — resets ${formatReset(q.resetsAt)}`
              : `nimbus hit its daily stream budget — resets ${formatReset(q.resetsAt)}`,
            "error",
          );
          setPlaying(false);
          return;
        }
        failStreakRef.current += 1;
        toast(
          res.status === 422
            ? `${label} isn't streamable — skipping`
            : `couldn't play ${label} — skipping`,
          "error",
        );
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

      const { url } = (await res.json()) as { url: string };
      failStreakRef.current = 0;
      el.src = url;
      try {
        await el.play();
        setPlaying(true);
      } catch {
        // Autoplay policy or transient decode issue; leave paused.
        setPlaying(false);
      }
    },
    [ensureGraph, setQueue, toast],
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

  // ------------------------------------------------------------- actions

  const actions = useMemo<PlayerActions>(() => {
    const playCurrentOf = (q: QueueState) => {
      const id = currentTrackId(q);
      if (id !== null) void resolveAndPlay(id);
    };

    return {
      playFrom(sourceKey, tracks, startTrackId, opts) {
        for (const t of tracks) metaRef.current.set(t.id, toQueueTrack(t));
        const playable = tracks.filter((t) => t.streamable).map((t) => t.id);
        if (playable.length === 0) return;
        let q = createQueue(sourceKey, playable, {
          shuffle: opts?.shuffle ?? false,
          startTrackId,
        });
        if (currentTrackId(q) === null) q = jumpTo(q, q.order[0]);
        failStreakRef.current = 0;
        setQueue(q);
        playCurrentOf(q);
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
        const q = queueRef.current;
        if (!el || !q) return;
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

      nextTrack: () => advanceRef.current(),

      prevTrack() {
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
        const q = queueRef.current;
        if (!q) return;
        const jumped = jumpTo(q, trackId);
        setQueue(jumped);
        void resolveAndPlay(trackId);
      },

      toggleShuffleMode() {
        const q = queueRef.current;
        if (!q) return;
        setQueue(toggleShuffle(q));
      },

      cycleRepeat() {
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
        const q = queueRef.current;
        if (!q) return [];
        return upcoming(q, n)
          .map((id) => metaRef.current.get(id))
          .filter((t): t is QueueTrack => t !== undefined);
      },
    };
  }, [ensureGraph, resolveAndPlay, setQueue]);

  // Keep `current` in sync with the queue position.
  useEffect(() => {
    if (!queue) return;
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

  const state = useMemo<PlayerState>(
    () => ({
      current,
      playing,
      shuffled: queue?.shuffled ?? false,
      repeat: queue?.repeat ?? "off",
      volume,
      vizMode,
      queue,
    }),
    [current, playing, queue, volume, vizMode],
  );

  const refs = useMemo<PlayerRefs>(() => ({ audioRef, analyserRef }), []);

  return (
    <StateCtx.Provider value={state}>
      <ActionsCtx.Provider value={actions}>
        <RefsCtx.Provider value={refs}>
          <audio
            ref={audioRef}
            crossOrigin="anonymous"
            onEnded={() => advanceRef.current()}
            onError={() => {
              // Signed CDN URLs expire; a load error mid-session usually
              // means a stale URL — surface and move on.
              if (audioRef.current?.src) {
                toast("stream error — skipping", "error");
                advanceRef.current();
              }
            }}
          />
          {children}
        </RefsCtx.Provider>
      </ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}
