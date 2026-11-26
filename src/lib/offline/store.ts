/**
 * A small key-value store on the phone (wave 39): IndexedDB, or localStorage where IndexedDB is blocked (some private
 * browsing modes). Browser only; every call fails soft so the page keeps working without storage.
 */
const DB = "hpams-offline";
const STORE = "kv";

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}

export async function storeGet<T>(key: string): Promise<T | null> {
  const db = await open();
  if (!db) {
    try { const v = localStorage.getItem(`${DB}:${key}`); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
  }
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function storeSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    try { localStorage.setItem(`${DB}:${key}`, JSON.stringify(value)); } catch { /* full or blocked */ }
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

/** A key for a queued change: random, safe in a URL. */
export function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * On sign-out: forget the kept copies of jobs (keys ending in ":data") and the kept My jobs page, so the next person
 * on a shared phone doesn't see them. Changes not yet sent are kept; they go out when their owner signs in again.
 */
export async function forgetKeptCopies(): Promise<void> {
  try { navigator.serviceWorker?.controller?.postMessage("hpams-clear"); } catch { /* no worker */ }
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(`${DB}:`) && k.endsWith(":data")) localStorage.removeItem(k); } catch { /* blocked */ }
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const req = st.getAllKeys();
      req.onsuccess = () => { for (const k of req.result) if (String(k).endsWith(":data")) st.delete(k); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}
