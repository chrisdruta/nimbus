"use client";

import { STAGE_META, type StageMode } from "@/lib/stage";

export function ScenePicker({
  active,
  onSelect,
}: {
  active: StageMode;
  onSelect: (id: StageMode) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {STAGE_META.map(({ id, label }) => (
        <button
          key={id}
          onClick={(e) => {
            e.stopPropagation(); // keep the backdrop click-to-close intact
            onSelect(id);
          }}
          className={`cursor-pointer rounded-full px-4 py-1.5 text-sm transition ${
            id === active
              ? "bg-accent text-white"
              : "bg-white/10 text-muted hover:bg-white/20 hover:text-white"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
