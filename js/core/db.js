// Minimal IndexedDB wrapper. Stores:
//   kv        misc key/values (file handles, plans index, ...)
//   files     user media: {id, name, type, size, kind, blob?, handle?, added, meta}
//   renders   pre-rendered slide images: key `${deckId}/${page}` -> {full: Blob, thumb: Blob}
//   bibles    imported Bibles: `info:${id}` -> info, `${id}/${book}` -> chapters
//   hymnbooks imported / edited hymnbooks: id -> {id, name, lang, hymns}
//   plans     service plans: id -> {id, name, items, updated}

import { DB_NAME, lsKey } from './storens.js';

// Named after this app's address folder (storens.js): another app on the same website (SDA_Sabbath) has its own.
const NAME = DB_NAME;
const OLD_NAME = 'selah'; // the name shared with SDA_Sabbath before; copied from once, never changed or deleted
const VERSION = 1;
const STORES = ['kv', 'files', 'renders', 'bibles', 'hymnbooks', 'plans'];
let dbp = null;
// When the browser will not open its database (some private windows, storage turned off, a damaged
// profile), Church Service keeps working with an in-memory store for this session instead of failing.
let mem = null;
function useMemory(why) {
  if (!mem) {
    mem = new Map(STORES.map((s) => [s, new Map()]));
    console.warn('Church Service: saving is not available here (' + why + '); working in memory for this session.');
    try { window.dispatchEvent(new CustomEvent('selah-storage', { detail: { off: true, why: String(why) } })); } catch (e) { /* */ }
  }
  return null;
}

/** Open the old shared database only if it exists (opening a missing one would create an empty one that would
 *  break the other app). Resolves to the database or null. */
async function openOld() {
  try {
    if (indexedDB.databases) {
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === OLD_NAME)) return null;
    }
  } catch (e) { /* fall through */ }
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(OLD_NAME); } catch (e) { resolve(null); return; }
    let created = false;
    req.onupgradeneeded = () => { created = true; try { req.transaction.abort(); } catch (e) { /* */ } };
    req.onsuccess = () => { if (created) { try { req.result.close(); } catch (e) { /* */ } resolve(null); } else resolve(req.result); };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/** First start after the separation: copy the plans, hymnbooks, Bibles, slides and media saved under the old
 *  shared name into this app's own database, a few records at a time (videos can be large). */
async function copyFromOld(d) {
  const flag = lsKey('separated.db');
  try { if (localStorage.getItem(flag)) return; } catch (e) { return; }
  const old = await openOld();
  if (old) {
    try { window.dispatchEvent(new CustomEvent('selah-migrate', { detail: { start: true } })); } catch (e) { /* */ }
    try {
      for (const store of STORES) {
        if (!old.objectStoreNames.contains(store)) continue;
        const keys = await wrap(old.transaction(store, 'readonly').objectStore(store).getAllKeys());
        for (let i = 0; i < keys.length; i += 20) {
          const part = keys.slice(i, i + 20);
          const rt = old.transaction(store, 'readonly').objectStore(store);
          const vals = await Promise.all(part.map((k) => wrap(rt.get(k))));
          await new Promise((resolve, reject) => {
            const t = d.transaction(store, 'readwrite'); const s = t.objectStore(store);
            part.forEach((k, j) => { if (vals[j] !== undefined) s.put(vals[j], k); });
            t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
          });
        }
      }
    } catch (e) {
      console.warn('Copying the old data was not finished', e);
      try { window.dispatchEvent(new CustomEvent('selah-migrate', { detail: { error: String(e && e.message || e) } })); } catch (er) { /* */ }
      try { old.close(); } catch (er) { /* */ }
      return;   // no flag: tried again next start (records already copied are simply written again)
    }
    try { old.close(); } catch (e) { /* */ }
    try { window.dispatchEvent(new CustomEvent('selah-migrate', { detail: { done: true } })); } catch (e) { /* */ }
  }
  try { localStorage.setItem(flag, new Date().toISOString()); } catch (e) { /* */ }
}

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(NAME, VERSION); } catch (e) { resolve(useMemory(e && e.message)); return; }
    const timer = setTimeout(() => resolve(useMemory('the database did not answer')), 8000);
    req.onupgradeneeded = () => {
      const d = req.result;
      STORES.forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); });
    };
    req.onsuccess = () => { clearTimeout(timer); copyFromOld(req.result).catch(() => {}).then(() => resolve(req.result)); };
    req.onerror = () => { clearTimeout(timer); resolve(useMemory(req.error && req.error.message)); };
    req.onblocked = () => console.warn('Database upgrade waiting for another Church Service tab to close.');
  });
  return dbp;
}

// In-memory versions of the operations below (same results, nothing kept after closing).
const memOps = {
  get: (st, k) => st.get(k),
  put: (st, k, v) => { st.set(k, v); },
  del: (st, k) => { st.delete(k); },
  keys: (st) => Array.from(st.keys()),
  all: (st) => Array.from(st.values()),
};

function wrap(req) {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}

/** A save that failed because the device is full: said once here (app.js shows it), whether or not the caller
 *  waits for the result, so a change that was not kept is never lost silently. */
function reportFull(err) {
  const msg = (err && (err.name + ' ' + err.message)) || '';
  if (/QuotaExceeded|quota|disk|space/i.test(msg)) { try { window.dispatchEvent(new CustomEvent('selah-storage-full')); } catch (e) { /* not in a page */ } }
  return err;
}

async function tx(store, mode, fn) {
  const d = await open();
  if (!d) return fn.memory ? fn.memory(mem.get(store)) : undefined;
  const t = d.transaction(store, mode);
  const s = t.objectStore(store);
  const r = fn(s);
  const res = r && typeof r.onsuccess !== 'undefined' ? wrap(r) : Promise.resolve(r);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(reportFull(t.error));
    t.onabort = () => reject(reportFull(t.error));
  });
  return res;
}

const op = (fn, memory) => { fn.memory = memory; return fn; };
export const db = {
  get: (store, key) => tx(store, 'readonly', op((s) => s.get(key), (m) => memOps.get(m, key))),
  put: (store, key, val) => tx(store, 'readwrite', op((s) => s.put(val, key), (m) => memOps.put(m, key, val))),
  del: (store, key) => tx(store, 'readwrite', op((s) => s.delete(key), (m) => memOps.del(m, key))),
  keys: (store) => tx(store, 'readonly', op((s) => s.getAllKeys(), (m) => memOps.keys(m))),
  all: (store) => tx(store, 'readonly', op((s) => s.getAll(), (m) => memOps.all(m))),
  /** Delete every key starting with prefix (e.g. all renders of a deck). */
  delPrefix: async (store, prefix) => tx(store, 'readwrite', op((s) => s.delete(IDBKeyRange.bound(prefix, prefix + '\uffff')),
    (m) => { for (const k of Array.from(m.keys())) if (typeof k === 'string' && k.startsWith(prefix)) m.delete(k); })),
  /** Many puts in one transaction (much faster on low-end storage). */
  putMany: (store, entries) => tx(store, 'readwrite', op((s) => { entries.forEach(([k, v]) => s.put(v, k)); }, (m) => { entries.forEach(([k, v]) => m.set(k, v)); })),
  /** True when saving is not available and data only lives until the app is closed. */
  inMemory: () => !!mem,
};

/** Ask the browser not to evict our data (Bibles, slides) when storage is low. */
export async function persistStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) { /* ignore */ }
  return false;
}
