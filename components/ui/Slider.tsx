"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Shared pointer-capture slider (seek + volume). Reports live values via
 * onScrub while dragging and the final value via onCommit on release.
 */
export function Slider({
  value,
  max,
  step = max / 20,
  onScrub,
  onCommit,
  ariaLabel,
  className = "",
  disabled = false,
}: {
  value: number;
  max: number;
  step?: number;
  onScrub?: (v: number) => void;
  onCommit: (v: number) => void;
  ariaLabel: string;
  className?: string;
  /** Read-only: still renders progress, ignores pointer/keys, hides thumb. */
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const valueAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * max;
    },
    [max],
  );

  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={`group relative flex h-4 items-center ${
        disabled ? "cursor-default" : "cursor-pointer"
      } ${className}`}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        onScrub?.(valueAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (dragging) onScrub?.(valueAt(e.clientX));
      }}
      onPointerUp={(e) => {
        if (disabled) return;
        setDragging(false);
        onCommit(valueAt(e.clientX));
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          onCommit(Math.min(max, value + step));
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          onCommit(Math.max(0, value - step));
        }
      }}
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-elem">
        <div
          className={`h-full rounded-full ${
            dragging
              ? "bg-accent"
              : disabled
                ? "bg-white"
                : "bg-white group-hover:bg-accent"
          }`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      {!disabled && (
        <div
          className={`absolute h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow ${
            dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          style={{ left: `${ratio * 100}%` }}
        />
      )}
    </div>
  );
}
