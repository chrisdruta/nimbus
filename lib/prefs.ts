/**
 * Tiny persisted-preference helpers (localStorage, JSON, best-effort).
 * Callers pass a validator so corrupted/stale values read as absent.
 */

const PREFIX = "nimbus:pref:";

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readPref<T>(
  name: string,
  validate: (v: unknown) => v is T,
): T | null {
  try {
    const raw = storage()?.getItem(PREFIX + name);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePref<T>(name: string, value: T): void {
  try {
    storage()?.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // quota/private mode — persistence is best-effort
  }
}
