/**
 * Minimal promise wrapper over IndexedDB — one database, one object store,
 * get/set/delete/keys. Everything is best-effort: any failure (private
 * mode, quota, no IDB at all) resolves to null/undefined so callers
 * degrade to fetch-only behavior.
 */

const DB_NAME = "nimbus";
const DB_VERSION = 1;
const STORE = "library";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result ?? null);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export function idbGet(key: string): Promise<unknown> {
  return withStore("readonly", (s) => s.get(key));
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  await withStore("readwrite", (s) => s.put(value, key));
}

export async function idbDelete(key: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(key));
}

export async function idbKeys(): Promise<string[]> {
  const keys = await withStore("readonly", (s) => s.getAllKeys());
  return (keys ?? []).filter((k): k is string => typeof k === "string");
}
