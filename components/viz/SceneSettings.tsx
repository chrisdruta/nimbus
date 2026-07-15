"use client";

import { STAGE_META, type StageMode } from "@/lib/stage";
import {
  PRESETS,
  SETTINGS_FIELDS,
  resolveSceneSettings,
  withOverride,
  withPreset,
  withReset,
  type SceneSettingsPayload,
} from "@/lib/viz/settings";
import { IconX } from "@/components/ui/icons";

/**
 * Knob label with its hint on hover — a quiet dotted underline marks
 * that there's something to hover. The tooltip floats above the label
 * inside the popover (hand-rolled; no title attribute so it's styled
 * and instant).
 */
function FieldLabel({
  label,
  hint,
  className = "",
}: {
  label: string;
  hint: string;
  className?: string;
}) {
  return (
    <span className={`group/hint relative ${className}`}>
      <span className="underline decoration-white/15 decoration-dotted underline-offset-2 group-hover/hint:decoration-white/40">
        {label}
      </span>
      <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 hidden w-52 rounded-md border border-white/10 bg-black/90 px-2.5 py-1.5 text-[10px] leading-relaxed text-white/70 group-hover/hint:block">
        {hint}
      </span>
    </span>
  );
}

/**
 * Per-scene tuning popover: a compact box anchored just above the "tune"
 * button in the stage's bottom-right corner, so the controls appear
 * where the cursor already is — every change applies live and persists
 * via the parent's onChange. Stays mounted for the reveal transition;
 * `open` drives it.
 */
export function SceneSettings({
  scene,
  open,
  payload,
  onChange,
  onClose,
}: {
  scene: StageMode;
  open: boolean;
  payload: SceneSettingsPayload | null;
  onChange: (next: SceneSettingsPayload) => void;
  onClose: () => void;
}) {
  const resolved = resolveSceneSettings(scene, payload) as unknown as Record<
    string,
    number | boolean
  >;
  const activePreset = payload?.scenes[scene]?.preset ?? PRESETS[scene][0].id;
  const hasOverrides =
    Object.keys(payload?.scenes[scene]?.overrides ?? {}).length > 0;
  const label = STAGE_META.find((s) => s.id === scene)?.label ?? scene;

  return (
    <div
      aria-hidden={!open}
      onClick={(e) => e.stopPropagation()}
      className={`absolute right-6 bottom-14 z-10 flex max-h-[72%] w-72 flex-col overflow-y-auto rounded-xl border border-white/10 bg-black/70 p-4 backdrop-blur-md transition-[opacity,transform] duration-200 ease-out ${
        open
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-white">{label}</h2>
        <button
          aria-label="close tuning"
          onClick={onClose}
          className="cursor-pointer rounded-full p-1.5 text-muted transition hover:bg-white/10 hover:text-white"
        >
          <IconX size={14} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
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

      <div className="mt-4 flex flex-col gap-2.5 border-t border-white/5 pt-4">
        {SETTINGS_FIELDS[scene].map((field) => {
          if (field.kind === "toggle") {
            const on = resolved[field.key] === true;
            return (
              <label
                key={field.key}
                className="flex cursor-pointer items-center justify-between text-xs text-muted"
              >
                <FieldLabel label={field.label} hint={field.hint} />
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
                <FieldLabel label={field.label} hint={field.hint} />
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
              <FieldLabel
                label={field.label}
                hint={field.hint}
                className="w-16 shrink-0"
              />
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

      <div className="mt-4 border-t border-white/5 pt-3">
        <button
          onClick={() => onChange(withReset(payload, scene))}
          className="cursor-pointer text-xs text-muted transition hover:text-white"
        >
          reset to defaults
        </button>
      </div>
    </div>
  );
}
