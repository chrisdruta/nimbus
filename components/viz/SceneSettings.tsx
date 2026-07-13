"use client";

import { useState } from "react";
import type { SceneId } from "@/lib/viz/scene";
import {
  PRESETS,
  SETTINGS_FIELDS,
  resolveSceneSettings,
  withOverride,
  withPreset,
  withReset,
  type SceneSettingsPayload,
} from "@/lib/viz/settings";

/**
 * Per-scene tuning panel: preset pills plus an "advanced" disclosure of
 * raw knobs. Opens above the scene picker; every change applies live and
 * persists via the parent's onChange.
 */
export function SceneSettings({
  scene,
  payload,
  onChange,
  onClose,
}: {
  scene: SceneId;
  payload: SceneSettingsPayload | null;
  onChange: (next: SceneSettingsPayload) => void;
  onClose: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const resolved = resolveSceneSettings(scene, payload) as unknown as Record<
    string,
    number | boolean
  >;
  const activePreset = payload?.scenes[scene]?.preset ?? PRESETS[scene][0].id;
  const hasOverrides =
    Object.keys(payload?.scenes[scene]?.overrides ?? {}).length > 0;

  return (
    <div
      className="w-72 rounded-xl border border-white/10 bg-black/70 p-4 backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS[scene].map((p) => (
          <button
            key={p.id}
            onClick={() => onChange(withPreset(payload, scene, p.id))}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs transition ${
              p.id === activePreset && !hasOverrides
                ? "bg-accent text-white"
                : "bg-white/10 text-muted hover:bg-white/20 hover:text-white"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <button
          onClick={() => setAdvanced((v) => !v)}
          className="cursor-pointer text-muted transition hover:text-white"
        >
          {advanced ? "advanced −" : "advanced +"}
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onChange(withReset(payload, scene))}
            className="cursor-pointer text-muted transition hover:text-white"
          >
            reset
          </button>
          <button
            onClick={onClose}
            className="cursor-pointer text-muted transition hover:text-white"
          >
            close
          </button>
        </div>
      </div>

      {advanced && (
        <div className="mt-3 flex flex-col gap-2.5">
          {SETTINGS_FIELDS[scene].map((field) => {
            if (field.kind === "toggle") {
              const on = resolved[field.key] === true;
              return (
                <label
                  key={field.key}
                  className="flex cursor-pointer items-center justify-between text-xs text-muted"
                >
                  {field.label}
                  <button
                    onClick={() =>
                      onChange(withOverride(payload, scene, field.key, !on))
                    }
                    className={`cursor-pointer rounded-full px-2.5 py-0.5 transition ${
                      on
                        ? "bg-accent/80 text-white"
                        : "bg-white/10 hover:bg-white/20"
                    }`}
                  >
                    {on ? "on" : "off"}
                  </button>
                </label>
              );
            }
            const value = Number(resolved[field.key]);
            if (field.kind === "choice") {
              return (
                <div
                  key={field.key}
                  className="flex items-center justify-between text-xs text-muted"
                >
                  {field.label}
                  <div className="flex gap-1">
                    {field.options.map((opt) => (
                      <button
                        key={opt}
                        onClick={() =>
                          onChange(withOverride(payload, scene, field.key, opt))
                        }
                        className={`cursor-pointer rounded px-1.5 py-0.5 transition ${
                          opt === value
                            ? "bg-accent/80 text-white"
                            : "bg-white/10 hover:bg-white/20"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <label
                key={field.key}
                className="flex items-center gap-2 text-xs text-muted"
              >
                <span className="w-16 shrink-0">{field.label}</span>
                <input
                  type="range"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={value}
                  onChange={(e) =>
                    onChange(
                      withOverride(
                        payload,
                        scene,
                        field.key,
                        Number(e.target.value),
                      ),
                    )
                  }
                  className="h-1 w-full cursor-pointer accent-accent"
                />
                <span className="w-10 shrink-0 text-right tabular-nums">
                  {value}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
