"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAST_NAMESPACE,
  parseReceiverMessage,
  type ReceiverMessage,
  type SenderMessage,
} from "@/lib/cast";

/** Loading the framework flavor gives cast.framework on top of the base
 * chrome.cast API. Injected by our nonced bundle, which is what makes it
 * (and the loads it chains) trusted under the CSP's 'strict-dynamic'. */
const SDK_URL =
  "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

export type CastSenderStatus =
  /** SDK absent (no app id, non-Chrome, script failed) — hide the button. */
  | "unavailable"
  | "no-devices"
  | "idle"
  | "connecting"
  | "connected";

export interface CastSender {
  status: CastSenderStatus;
  deviceName: string | null;
  /** Cast device volume (0..1, linear — the device owns its own taper). */
  deviceVolume: number;
  /** Open the browser's device picker. */
  start(): void;
  /** End the session and stop playback on the device. */
  stop(): void;
  send(msg: SenderMessage): void;
  setDeviceVolume(v: number): void;
}

interface CastSenderCallbacks {
  /** A validated receiver message (status beat, ended, error, ready). */
  onMessage(msg: ReceiverMessage): void;
  /** Session established: fresh launch (resumed=false) or a rejoin after
   * a sender reload (resumed=true — the receiver may already be playing). */
  onConnected(opts: { deviceName: string | null; resumed: boolean }): void;
  onDisconnected(): void;
}

const getCast = () =>
  (window as { cast?: typeof cast }).cast?.framework !== undefined
    ? (window as { cast?: typeof cast }).cast
    : undefined;

const getChromeCast = () =>
  (window as { chrome?: { cast?: typeof chrome.cast } }).chrome?.cast;

/**
 * Google Cast sender glue: SDK script injection, session lifecycle, the
 * custom message channel, and device volume. Degrades to "unavailable"
 * (button hidden) when the SDK can't load — non-Chrome, headless, or no
 * NEXT_PUBLIC_CAST_APP_ID configured. All policy (what to send, handoffs,
 * gating) stays in the PlayerProvider; this hook only moves messages.
 */
export function useCastSender(cb: CastSenderCallbacks): CastSender {
  const [status, setStatus] = useState<CastSenderStatus>("unavailable");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceVolume, setDeviceVolume] = useState(1);
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const playerRef = useRef<cast.framework.RemotePlayer | null>(null);
  const controllerRef = useRef<cast.framework.RemotePlayerController | null>(
    null,
  );

  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_CAST_APP_ID;
    if (!appId) return;
    let disposed = false;
    let ctx: cast.framework.CastContext | null = null;
    let onCastState:
      | ((e: cast.framework.CastStateEventData) => void)
      | null = null;
    let onSessionState:
      | ((e: cast.framework.SessionStateEventData) => void)
      | null = null;

    const onSessionMessage = (_ns: string, raw: string) => {
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      const msg = parseReceiverMessage(data);
      if (msg && !disposed) cbRef.current.onMessage(msg);
    };

    const attachSession = (
      session: cast.framework.CastSession,
      resumed: boolean,
    ) => {
      // Re-adding the same listener reference is a no-op on rejoin.
      session.addMessageListener(CAST_NAMESPACE, onSessionMessage);
      let name: string | null = null;
      try {
        name = session.getCastDevice().friendlyName ?? null;
      } catch {
        // device info is cosmetic
      }
      setDeviceName(name);
      cbRef.current.onConnected({ deviceName: name, resumed });
    };

    const init = () => {
      const cf = getCast()?.framework;
      const cc = getChromeCast();
      if (disposed || !cf || !cc) return;
      ctx = cf.CastContext.getInstance();
      ctx.setOptions({
        receiverApplicationId: appId,
        autoJoinPolicy: cc.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      const mapState = (s: string): CastSenderStatus =>
        s === cf.CastState.NO_DEVICES_AVAILABLE
          ? "no-devices"
          : s === cf.CastState.CONNECTING
            ? "connecting"
            : s === cf.CastState.CONNECTED
              ? "connected"
              : "idle";
      setStatus(mapState(ctx.getCastState()));
      onCastState = (e) => setStatus(mapState(e.castState));
      onSessionState = (e) => {
        if (e.sessionState === cf.SessionState.SESSION_STARTED) {
          attachSession(e.session, false);
        } else if (e.sessionState === cf.SessionState.SESSION_RESUMED) {
          attachSession(e.session, true);
        } else if (e.sessionState === cf.SessionState.SESSION_ENDED) {
          setDeviceName(null);
          cbRef.current.onDisconnected();
        }
      };
      ctx.addEventListener(
        cf.CastContextEventType.CAST_STATE_CHANGED,
        onCastState as (
          e: cast.framework.CastStateEventData &
            cast.framework.SessionStateEventData,
        ) => void,
      );
      ctx.addEventListener(
        cf.CastContextEventType.SESSION_STATE_CHANGED,
        onSessionState as (
          e: cast.framework.CastStateEventData &
            cast.framework.SessionStateEventData,
        ) => void,
      );
      const player = new cf.RemotePlayer();
      const controller = new cf.RemotePlayerController(player);
      controller.addEventListener(
        cf.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
        () => setDeviceVolume(player.volumeLevel),
      );
      playerRef.current = player;
      controllerRef.current = controller;
    };

    if (getCast()) {
      init();
    } else {
      window.__onGCastApiAvailable = (available) => {
        if (available) init();
      };
      if (!document.querySelector(`script[src="${SDK_URL}"]`)) {
        const s = document.createElement("script");
        s.src = SDK_URL;
        document.head.appendChild(s);
      }
    }

    return () => {
      disposed = true;
      window.__onGCastApiAvailable = undefined;
      const cf = getCast()?.framework;
      if (ctx && cf && onCastState && onSessionState) {
        ctx.removeEventListener(
          cf.CastContextEventType.CAST_STATE_CHANGED,
          onCastState as (
            e: cast.framework.CastStateEventData &
              cast.framework.SessionStateEventData,
          ) => void,
        );
        ctx.removeEventListener(
          cf.CastContextEventType.SESSION_STATE_CHANGED,
          onSessionState as (
            e: cast.framework.CastStateEventData &
              cast.framework.SessionStateEventData,
          ) => void,
        );
      }
    };
  }, []);

  const start = useCallback(() => {
    const cf = getCast()?.framework;
    if (!cf) return;
    void cf.CastContext.getInstance()
      .requestSession()
      .catch(() => {
        // user dismissed the picker
      });
  }, []);

  const stop = useCallback(() => {
    getCast()?.framework.CastContext.getInstance().endCurrentSession(true);
  }, []);

  const send = useCallback((msg: SenderMessage) => {
    const session = getCast()
      ?.framework.CastContext.getInstance()
      .getCurrentSession();
    void session?.sendMessage(CAST_NAMESPACE, msg).catch(() => {
      // channel hiccup — status beats self-correct
    });
  }, []);

  const setDeviceVolumeCb = useCallback((v: number) => {
    const player = playerRef.current;
    const controller = controllerRef.current;
    if (!player || !controller) return;
    player.volumeLevel = Math.min(1, Math.max(0, v));
    controller.setVolumeLevel();
    setDeviceVolume(player.volumeLevel);
  }, []);

  return {
    status,
    deviceName,
    deviceVolume,
    start,
    stop,
    send,
    setDeviceVolume: setDeviceVolumeCb,
  };
}
