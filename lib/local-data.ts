import "client-only";

/**
 * Local-footprint eraser. Queue/history metadata in localStorage and the
 * library cache in IndexedDB can expose listening history on a shared
 * browser, so both the "erase local data" action and the invalid-session
 * farewell sweep clear everything nimbus ever wrote on this origin — for
 * every user, not just the one currently signed in.
 */

export function isNimbusKey(key: string): boolean {
  // Covers nimbus.queue.v1:{userId}, nimbus:volume, and nimbus:pref:*.
  return key.startsWith("nimbus:") || key.startsWith("nimbus.");
}

export async function eraseLocalData(): Promise<void> {
  try {
    for (const key of Object.keys(localStorage).filter(isNimbusKey)) {
      localStorage.removeItem(key);
    }
  } catch {
    // storage blocked — best-effort
  }
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase("nimbus");
      // onblocked: another tab holds a connection; the delete completes
      // when it closes — don't hang the caller on it.
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
