"use client";

import { useState } from "react";
import { STAGE_META, type StageMode } from "@/lib/stage";

/**
 * Corner text stack: idle, it's just the active mode's lowercase name;
 * hover/focus/tap unfolds the full mode list (plus the shortcut hint)
 * rising from the same corner. Pure type, no pills — the collapsed label
 * and the expanded list cross-fade in place.
 */
export function ScenePicker({
  active,
  onSelect,
}: {
  active: StageMode;
  onSelect: (id: StageMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeLabel = STAGE_META.find((s) => s.id === active)?.label ?? active;

  return (
    <div
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      className="flex flex-col items-start [text-shadow:0_1px_10px_rgba(0,0,0,0.85)]"
    >
      {open ? (
        <>
          {STAGE_META.map(({ id, label }, i) => (
            <button
              key={id}
              onClick={(e) => {
                e.stopPropagation(); // keep the backdrop click-to-close intact
                onSelect(id);
                setOpen(false);
              }}
              style={{ animationDelay: `${i * 25}ms` }}
              className={`flex cursor-pointer items-center gap-2 py-0.5 text-sm transition motion-safe:animate-[art-fade-in_0.2s_ease-out_both] ${
                id === active
                  ? "text-white"
                  : "text-muted hover:text-white"
              }`}
            >
              <span
                aria-hidden
                className={`h-px w-3 ${
                  id === active ? "bg-accent" : "bg-transparent"
                }`}
              />
              {label}
            </button>
          ))}
          <p className="mt-1.5 pl-5 text-[10px] text-muted/80">
            ←→ · 1–6 · esc
          </p>
        </>
      ) : (
        <button
          aria-expanded={false}
          aria-label="choose stage mode"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-white"
        >
          <span aria-hidden className="h-px w-3 bg-accent" />
          {activeLabel}
        </button>
      )}
    </div>
  );
}
