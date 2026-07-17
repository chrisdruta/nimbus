"use client";

import { canStartCasting } from "@/lib/cast";
import { IconCast } from "@/components/ui/icons";
import { usePlayerActions, usePlayerState } from "./PlayerProvider";

/** Media-bar cast toggle. Hidden entirely when the Cast SDK is absent or
 * no devices are on the network; disabled (with a why) while slipstream
 * modes own playback. */
export function CastButton() {
  const { cast, slipstream, shared } = usePlayerState();
  const actions = usePlayerActions();
  if (!cast || cast.status === "no-devices") return null;

  const connected = cast.status === "connected";
  const blocked =
    !connected &&
    !canStartCasting({
      following: slipstream !== null,
      hostingShared: shared?.role === "host",
    });

  return (
    <button
      aria-label={connected ? "stop casting" : "cast to tv"}
      title={
        connected
          ? `casting to ${cast.deviceName ?? "tv"} — click to stop`
          : blocked
            ? "leave the slipstream to cast"
            : "cast to tv"
      }
      disabled={blocked}
      onClick={() => (connected ? actions.stopCasting() : actions.startCasting())}
      className={`transition ${
        connected
          ? "cursor-pointer text-accent"
          : cast.status === "connecting"
            ? "cursor-pointer animate-pulse text-accent"
            : blocked
              ? "cursor-default text-muted opacity-40"
              : "cursor-pointer text-muted hover:text-white"
      }`}
    >
      <IconCast size={18} />
    </button>
  );
}
