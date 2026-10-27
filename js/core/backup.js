// A whole-device backup of SDA Sabbath in one file (.sdabackup, a stored ZIP): settings, plans, templates,
// hymnbooks, imported Bibles, banners and their pictures, and (if chosen) slides and videos.
// Used by "Back up to Google Drive" and "Save a backup file", and restored on another device.
import { db } from './db.js';
import { zipBlobs, readZip, ZIP_MAX } from '../lib/blobzip.js';
import { exportableSettings, sanitizeImportedSettings } from './settings.js';
import { scrubUrls } from './util.js';
import { lsKey, LEGACY_LOCAL } from './storens.js';

export const FORMAT = 'sda-sabbath-backup';
export const EXT = '.sdabackup';
const SETTINGS_KEY = lsKey('settings.v1');
// Small per-browser extras, written in backups under their short names (older backups used the 'selah-…' names).
const EXTRA_LOCAL = ['recent-colours', 'bn-wide', 'ai-history'];
const extraName = (k) => (LEGACY_LOCAL[k] && EXTRA_LOCAL.includes(LEGACY_LOCAL[k]) ? LEGACY_LOCAL[k] : k);
// Settings that belong to this computer (its screens, its companion, its stage key), never copied across.
const DEVICE_ONLY = { display: true, companion: true };
const DEVICE_ONLY_PATHS = [['stage', 'hostKey'], ['stage', 'useWindow'], ['stage', 'second'], ['stage', 'screenLabel'], ['stage', 'screenLabel2'], ['ai', 'apiKey']];

const isBlob = (v) => typeof Blob !== 'undefined' && v instanceof Blob;
const isHandle = (v) => typeof FileSystemHandle !== 'undefined' && v instanceof FileSystemHandle;

/** What a backup would hold, without building it (for the size shown next to the tick boxes). */
export async function measure() {
  const files = await db.all('files').catch(() => []);
  const out = { slides: 0, slideBytes: 0, videos: 0, videoBytes: 0, videosOnPc: 0 };
  for (const f of files) {
    if (!f) continue;
    if (f.kind === 'deck') { out.slides++; out.slideBytes += f.size || 0; }
    else if (f.kind === 'media') { out.videos++; out.videoBytes += f.size || (f.blob && f.blob.size) || 0; if (!f.blob && f.handle) out.videosOnPc++; }
  }
  return out;
}

/** Build the backup. opts: {slides, videos, device}. Returns {blob, stats}. */
export async function buildBackup(opts = {}, onProgress) {
  const blobs = [];
  const stats = { plans: 0, hymnbooks: 0, bibles: 0, banners: 0, slides: 0, videos: 0, pictures: 0, skipped: [] };
  let found = false; // set by enc when a value held a file handle (cannot be copied)
  const blobRef = (b) => {
    const path = 'blobs/' + (blobs.length + 1);
    blobs.push({ name: path, blob: b });
    return { $blob: path, type: b.type || '' };
  };
  const enc = (v, depth = 0) => {
    if (v == null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    if (isBlob(v)) return blobRef(v);
    if (isHandle(v)) { found = true; return null; }
    if (depth > 30) return null;
    if (Array.isArray(v)) return v.map((x) => enc(x, depth + 1));
    if (ArrayBuffer.isView(v)) return blobRef(new Blob([v]));
    const p = Object.getPrototypeOf(v);
    if (p !== Object.prototype && p !== null) return null;
    const o = {};
    Object.keys(v).forEach((k) => { const x = enc(v[k], depth + 1); if (x !== undefined) o[k] = x; });
    return o;
  };
  const stores = {};
  const step = (t) => onProgress && onProgress({ text: t });

  step('Collecting plans, hymnbooks and Bibles…');
  for (const store of ['plans', 'hymnbooks', 'bibles', 'kv']) {
    const keys = await db.keys(store).catch(() => []);
    const rows = [];
    for (const k of keys) {
      if (store === 'kv' && typeof k !== 'string') continue;
      const v = await db.get(store, k).catch(() => undefined);
      if (v === undefined) continue;
      found = false;
      const e = enc(v);
      if (found && store === 'kv') continue; // e.g. remembered folders on this PC: they only work here
      rows.push([k, e]);
    }
    stores[store] = rows;
  }
  stats.plans = stores.plans.length;
  stats.hymnbooks = stores.hymnbooks.length;
  stats.bibles = stores.bibles.filter(([k]) => String(k).startsWith('info:')).length;
  const bannerRow = stores.kv.find(([k]) => k === 'banners');
  stats.banners = bannerRow && Array.isArray(bannerRow[1]) ? bannerRow[1].length : 0;

  step('Collecting pictures, slides and videos…');
  const files = [], renders = [];
  for (const rec of await db.all('files').catch(() => [])) {
    if (!rec || !rec.id) continue;
    if (rec.kind === 'deck') {
      if (!opts.slides) continue;
      stats.slides++;
      const keys = rec.type === 'pptx' ? [rec.id + '/frames'] : rec.type === 'web' ? [] : Array.from({ length: rec.count || 0 }, (_, i) => rec.id + '/' + i);
      for (const k of keys) { const r = await db.get('renders', k).catch(() => null); if (r) renders.push([k, enc(r)]); }
      files.push(enc(rec));
    } else if (rec.kind === 'media') {
      if (!opts.videos) continue;
      let blob = isBlob(rec.blob) ? rec.blob : null;
      if (!blob && rec.handle) {
        try {
          if (rec.handle.queryPermission && (await rec.handle.queryPermission({ mode: 'read' })) !== 'granted') await rec.handle.requestPermission({ mode: 'read' });
          blob = await rec.handle.getFile();
        } catch (e) { blob = null; }
      }
      if (!blob) { if (!rec.remote) stats.skipped.push(rec.name || 'a video'); continue; }
      stats.videos++;
      files.push(Object.assign(enc(Object.assign({}, rec, { blob: null, handle: null })), { blob: blobRef(blob), type: rec.type || blob.type || '' }));
    } else {
      stats.pictures++;
      files.push(enc(rec));
    }
  }

  // Settings and the small per-browser extras.
  let settings = {};
  try { settings = exportableSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { settings = {}; }
  const local = {};
  EXTRA_LOCAL.forEach((k) => { try { const v = localStorage.getItem(lsKey(k)); if (v != null) local[k] = v; } catch (e) { /* */ } });

  const bytes = blobs.reduce((a, b) => a + b.blob.size, 0);
  if (bytes > ZIP_MAX - 50e6) throw new Error('This backup would be larger than 4 GB. Leave the videos out (keep them on the PC) and try again.');
  const manifest = { format: FORMAT, version: 1, app: 'SDA Sabbath', made: new Date().toISOString(), device: opts.device || '',
    includes: { slides: !!opts.slides, videos: !!opts.videos }, stats, settings, local, stores, files, renders };
  step('Packing…');
  const blob = await zipBlobs([{ name: 'backup.json', text: JSON.stringify(manifest) }].concat(blobs),
    onProgress ? (f) => onProgress({ text: 'Packing… ' + Math.round(f * 100) + '%', frac: f }) : undefined);
  stats.bytes = blob.size;
  return { blob, stats };
}

/** Read a backup file's summary (what is in it) without restoring. */
export async function readBackup(file) {
  const entries = await readZip(file);
  const j = entries.get('backup.json');
  if (!j) throw new Error('This is not an SDA Sabbath backup.');
  const m = JSON.parse(await j.text());
  if (!m || m.format !== FORMAT) throw new Error('This is not an SDA Sabbath backup.');
  return { manifest: m, entries };
}

/** Put a backup on this device. Items with the same name are replaced; everything else here stays. */
export async function restoreBackup(pkg, onProgress) {
  const { manifest: m, entries } = pkg;
  const dec = (v, depth = 0) => {
    if (v == null || typeof v !== 'object') return v;
    if (typeof v.$blob === 'string') { const b = entries.get(v.$blob); return b ? b.slice(0, b.size, v.type || '') : null; }
    if (depth > 30) return null;
    if (Array.isArray(v)) return v.map((x) => dec(x, depth + 1));
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = dec(v[k], depth + 1); });
    return o;
  };
  const step = (t, f) => onProgress && onProgress({ text: t, frac: f });
  const done = { plans: 0, hymnbooks: 0, bibles: 0, files: 0 };
  const stores = m.stores || {};
  let i = 0;
  const total = Object.values(stores).reduce((a, r) => a + r.length, 0) + (m.files || []).length + (m.renders || []).length;
  const tick = () => { i++; if (i % 20 === 0) step('Restoring… ' + Math.round((i / total) * 100) + '%', i / total); };
  for (const store of ['plans', 'hymnbooks', 'bibles', 'kv']) {
    const rows = (stores[store] || []).filter((r) => Array.isArray(r) && r.length === 2);
    const batch = [];
    for (const [k, v] of rows) {
      if (store === 'kv' && /:checked$/.test(String(k))) continue;
      // Plans and hymnbooks: links are checked the same way as the older .json import (http/https only).
      batch.push([k, dec(store === 'plans' || store === 'hymnbooks' ? scrubUrls(v) : v)]); tick();
      if (batch.length >= 50) await db.putMany(store, batch.splice(0));
    }
    if (batch.length) await db.putMany(store, batch);
    if (store in done) done[store] = rows.length;
  }
  for (const f of m.files || []) { if (f && f.id) { await db.put('files', f.id, dec(f)); done.files++; } tick(); }
  for (const r of m.renders || []) { if (Array.isArray(r)) await db.put('renders', r[0], dec(r[1])); tick(); }
  // Settings: everything except what belongs to this computer.
  try {
    const here = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    // Only known settings with the right types (a backup file may come from anyone); this device's AI key stays.
    const clean = sanitizeImportedSettings(m.settings || {});
    const next = Object.assign({}, here);
    Object.keys(clean).forEach((k) => { next[k] = clean[k] && typeof clean[k] === 'object' && !Array.isArray(clean[k]) ? Object.assign({}, here[k] || {}, clean[k]) : clean[k]; });
    Object.keys(DEVICE_ONLY).forEach((k) => { if (here[k] !== undefined) next[k] = here[k]; else delete next[k]; });
    if (here.ai && here.ai.apiKey !== undefined) next.ai = Object.assign({}, next.ai || {}, { apiKey: here.ai.apiKey });
    DEVICE_ONLY_PATHS.forEach(([a, b]) => {
      if (!next[a] || typeof next[a] !== 'object') return;
      next[a] = Object.assign({}, next[a]);
      if (here[a] && here[a][b] !== undefined) next[a][b] = here[a][b]; else delete next[a][b];
    });
    next.app = Object.assign({}, next.app || {}, { setupDone: true });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    Object.entries(m.local || {}).forEach(([k, v]) => { const n = extraName(k); if (EXTRA_LOCAL.includes(n)) localStorage.setItem(lsKey(n), v); });
  } catch (e) { /* settings could not be saved: the rest is restored */ }
  step('Done', 1);
  return done;
}

export const backupName = (device) => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return 'SDA Sabbath backup ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + 'h' + p(d.getMinutes())
    + (device ? ' (' + String(device).replace(/[\\/:*?"<>|]/g, '').slice(0, 40) + ')' : '') + EXT;
};
