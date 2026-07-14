"use client";

/**
 * Module-level interaction clock: when did the user last touch the page?
 * One set of window listeners feeds every consumer (AFK auto-pause, feed
 * poll idle gate). Deliberately not React state — reading it must never
 * cause renders, and consumers sample it on their own cadences.
 */

let lastAt = 0;
let installed = false;

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  lastAt = Date.now();
  const mark = () => {
    lastAt = Date.now();
  };
  for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(event, mark, { passive: true, capture: true });
  }
}

/** Presence signal from non-DOM entry points (hardware media keys route
 * through the Media Session API without page events). */
export function markInteraction(): void {
  install();
  lastAt = Date.now();
}

export function lastInteractionAt(): number {
  install();
  return lastAt;
}

/** Milliseconds since the last interaction (0 on the server). */
export function idleFor(now: number = Date.now()): number {
  install();
  return Math.max(0, now - lastAt);
}
