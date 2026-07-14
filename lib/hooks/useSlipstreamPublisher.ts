"use client";

import { useCallback, useEffect, useRef } from "react";
import { HEARTBEAT_MS } from "@/lib/slipstream";
import type { QueueTrack } from "@/lib/queue";
import type { SharedWire } from "@/lib/shared-queue";

/** Coalesce a scrub or triple-skip into one beat. */
const PUBLISH_DEBOUNCE_MS = 1_000;

export interface PublishedBeat {
  trackId: number;
  positionMs: number;
  playing: boolean;
  window: QueueTrack[];
}

interface PublisherOptions {
  /** playing && not following — the publisher is inert while following,
   * which is what makes chained slipstreams impossible by construction. */
  enabled: boolean;
  /** Reactive triggers: a beat is scheduled when any of these change. */
  trackId: number | null;
  playing: boolean;
  /** Joined id-sequence of the current window; the window payload rides a
   * beat only when this changed since the last successful send. */
  windowKey: string;
  /** Reads refs at send time so the payload is always self-consistent. */
  buildBeat: () => PublishedBeat | null;
  audioEl: () => HTMLAudioElement | null;
  /** Keepalive cadence — HEARTBEAT_MS normally, POLL_MS while hosting a
   * shared session (the beat response doubles as the host's state poll). */
  keepaliveMs?: number;
  /** Read at send time: non-null while hosting a shared session. The beat
   * then carries sharedRev/controlSeq (which also keeps the session row
   * alive — plain beats delete it server-side). */
  shared?: () => { rev: number; controlSeq: number } | null;
  /** Shared-session state from the beat response (queue when the revision
   * moved, a control intent when one is pending). */
  onShared?: (wire: SharedWire) => void;
}

/**
 * Publishes this client's live listening to /api/slipstream. Event-driven
 * beats (track change, play/pause, seek, window change) through a trailing
 * debounce, plus a slow keepalive so followers' staleness checks hold.
 * Every send is best-effort — presence must never disturb playback.
 */
export function useSlipstreamPublisher(opts: PublisherOptions) {
  const {
    enabled,
    trackId,
    playing,
    windowKey,
    buildBeat,
    audioEl,
    keepaliveMs = HEARTBEAT_MS,
    shared,
    onShared,
  } = opts;

  const lastWindowKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const sharedRef = useRef(shared);
  sharedRef.current = shared;
  const onSharedRef = useRef(onShared);
  onSharedRef.current = onShared;

  const send = useCallback(
    async (over?: { playing: boolean }) => {
      const beat = buildBeat();
      if (!beat) return;
      const key = beat.window.map((t) => t.id).join(",");
      const body: Record<string, unknown> = {
        trackId: beat.trackId,
        positionMs: beat.positionMs,
        playing: over?.playing ?? beat.playing,
      };
      if (key !== lastWindowKeyRef.current) body.window = beat.window;
      const sharedState = sharedRef.current?.() ?? null;
      if (sharedState) {
        body.sharedRev = sharedState.rev;
        body.controlSeq = sharedState.controlSeq;
      }
      try {
        const res = await fetch("/api/slipstream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        // Only remember the window as sent when the server took it.
        if (res.ok && body.window !== undefined) lastWindowKeyRef.current = key;
        if (res.ok && sharedState) {
          const data = (await res.json().catch(() => null)) as {
            shared?: SharedWire;
          } | null;
          if (data?.shared) onSharedRef.current?.(data.shared);
        }
      } catch {
        // best-effort
      }
    },
    [buildBeat],
  );

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (enabledRef.current) void send();
    }, PUBLISH_DEBOUNCE_MS);
  }, [send]);

  // Event-driven beats + the final playing:false beat when hosting stops
  // (pause, queue end, or joining someone else's slipstream).
  const prevEnabledRef = useRef(false);
  useEffect(() => {
    if (enabled) {
      schedule();
    } else if (prevEnabledRef.current) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void send({ playing: false });
    }
    prevEnabledRef.current = enabled;
  }, [enabled, trackId, playing, windowKey, schedule, send]);

  // Keepalive so a quiet host doesn't go stale mid-track. A cadence change
  // (start/stop sharing) also schedules a prompt beat so the session's
  // state channel opens without waiting a full interval.
  useEffect(() => {
    if (!enabled) return;
    schedule();
    const iv = setInterval(() => void send(), keepaliveMs);
    return () => clearInterval(iv);
  }, [enabled, keepaliveMs, schedule, send]);

  // Host seeks propagate (through the same debounce).
  useEffect(() => {
    const el = audioEl();
    if (!el) return;
    const onSeeked = () => {
      if (enabledRef.current) schedule();
    };
    el.addEventListener("seeked", onSeeked);
    return () => el.removeEventListener("seeked", onSeeked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);

  // Tab close/navigation: staleness would cover it, but a beacon makes the
  // feed honest within a poll instead of 45s.
  useEffect(() => {
    const onHide = () => {
      if (!enabledRef.current) return;
      const beat = buildBeat();
      if (!beat) return;
      // The beacon must keep carrying sharedRev while hosting a shared
      // session — a plain beat would delete the session row and break
      // quick-reload revival.
      const sharedState = sharedRef.current?.() ?? null;
      const body = JSON.stringify({
        trackId: beat.trackId,
        positionMs: beat.positionMs,
        playing: false,
        ...(sharedState
          ? { sharedRev: sharedState.rev, controlSeq: sharedState.controlSeq }
          : {}),
      });
      navigator.sendBeacon?.(
        "/api/slipstream",
        new Blob([body], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [buildBeat]);
}
