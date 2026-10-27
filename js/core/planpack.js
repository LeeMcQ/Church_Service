// Plan packages (.sdaplan): a service plan or plan template in one file, with the slides, pictures,
// banners and (if wanted) videos it uses, so it can be backed up or shared with another media team.
// Bible passages and hymns travel as references: every copy of Church Service has them.
//
//   const pack = await collectPlan(items, opts)      -> { manifest, blobs, stats }
//   const blob = await packageBlob(pack, onProgress) -> a .sdaplan file (a stored ZIP: plan.json + media/…)
//   const pkg = await openPackage(file)              -> { manifest, entries } (also reads old .json exports)
//   const res = await installPackage(pkg, hooks)     -> { items, made: {decks, videos, banners, pictures}, reused }
import { db } from './db.js';
import { uid, isBlob } from './util.js';
import { zipBlobs, readZip } from '../lib/blobzip.js';

export const FORMAT = 'sda-sabbath-plan';
export const EXT = '.sdaplan';
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const EXTS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'application/pdf': '.pdf' };
const extOf = (b, name) => EXTS[b.type] || ((/\.[a-z0-9]{2,5}$/i.exec(name || '') || [''])[0].toLowerCase()) || '.bin';

/** What a plan uses from this device. opts: {media: true, videos: true}. */
export async function collectPlan(items, opts = {}) {
  const withMedia = opts.media !== false, withVideos = opts.videos !== false;
  const blobs = [];
  const files = [], renders = [], banners = [], missing = [];
  const seenFiles = new Set(), seenBanners = new Set();
  const stats = { decks: 0, pictures: 0, banners: 0, videos: 0, videoBytes: 0, mediaBytes: 0, skippedVideos: 0 };
  const allFiles = await db.all('files').catch(() => []);
  const fileIds = new Set(allFiles.map((f) => f.id));

  const blobRef = (b, name) => {
    const path = 'media/' + (blobs.length + 1) + extOf(b, name);
    blobs.push({ name: path, blob: b });
    return { $blob: path, type: b.type || '' };
  };
  // Copy a stored value, putting every Blob into the package. File handles and streams stay behind.
  const enc = (v, depth = 0, name = '') => {
    if (v == null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    if (isBlob(v)) return blobRef(v, name);
    if (depth > 20 || (typeof FileSystemHandle !== 'undefined' && v instanceof FileSystemHandle)) return null;
    if (Array.isArray(v)) return v.map((x) => enc(x, depth + 1, name));
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return null;
    const o = {};
    Object.keys(v).forEach((k) => { if (k !== 'handle') { const x = enc(v[k], depth + 1, name); if (x !== undefined) o[k] = x; } });
    return o;
  };

  async function addFile(id, label) {
    if (!id || seenFiles.has(id)) return true;
    seenFiles.add(id);
    const rec = await db.get('files', id).catch(() => null);
    if (!rec) { missing.push(label || 'A file'); return false; }
    if (rec.kind === 'media') {
      let blob = rec.blob || null;
      if (!blob && rec.handle && withVideos && opts.ask !== false) {
        try {
          if (rec.handle.queryPermission && (await rec.handle.queryPermission({ mode: 'read' })) !== 'granted') await rec.handle.requestPermission({ mode: 'read' });
          blob = await rec.handle.getFile();
        } catch (e) { blob = null; }
      }
      if (!blob && rec.handle && opts.ask === false && withVideos) { stats.videos++; stats.videoBytes += rec.size || 0; stats.handles = (stats.handles || 0) + 1; return true; }
      if (!withVideos || !blob) { stats.skippedVideos++; if (withVideos) missing.push(rec.name || label || 'A video'); return false; }
      stats.videos++; stats.videoBytes += blob.size; stats.videoBlobBytes = (stats.videoBlobBytes || 0) + blob.size;
      files.push(Object.assign(enc(Object.assign({}, rec, { blob: null })), { blob: blobRef(blob, rec.name), type: rec.type || blob.type || '' }));
      return true;
    }
    if (rec.kind === 'deck') {
      stats.decks++;
      if (rec.type === 'pptx') {
        const r = await db.get('renders', id + '/frames').catch(() => null);
        if (r) renders.push({ key: id + '/frames', value: enc(r) });
      } else if (rec.type !== 'web') {
        for (let i = 0; i < (rec.count || 0); i++) {
          const r = await db.get('renders', id + '/' + i).catch(() => null);
          if (r) renders.push({ key: id + '/' + i, value: enc(r) });
        }
      }
    } else stats.pictures++;
    files.push(enc(rec, 0, rec.name));
    return true;
  }
  // Every string inside a banner that names a stored file (its pictures, background, music).
  const fileRefsIn = (v, out = new Set(), depth = 0) => {
    if (typeof v === 'string') { if (fileIds.has(v)) out.add(v); } else if (v && typeof v === 'object' && depth < 20) Object.values(v).forEach((x) => fileRefsIn(x, out, depth + 1));
    return out;
  };
  let lib = null;
  async function addBanner(id, label) {
    if (!id || seenBanners.has(id)) return;
    seenBanners.add(id);
    if (!lib) { const raw = await db.get('kv', 'banners').catch(() => null); lib = Array.isArray(raw) ? raw : []; }
    const b = lib.find((x) => x && x.id === id);
    if (!b) { missing.push(label || 'A banner'); return; }
    for (const fid of fileRefsIn(b)) await addFile(fid);
    banners.push(JSON.parse(JSON.stringify(b)));
    stats.banners++;
  }

  if (withMedia) {
    for (const it of items) {
      if (!it || it.heading) continue;
      if (it.tab === 'slides' && it.deck) await addFile(it.deck, it.label);
      else if (it.tab === 'video' && it.item) await addFile(it.item, it.label);
      else if (it.tab === 'ai' && it.banner) await addBanner(it.banner, it.label);
    }
  }
  stats.mediaBytes = blobs.reduce((a, b) => a + b.blob.size, 0);
  stats.otherBytes = stats.mediaBytes - (stats.videoBlobBytes || 0);
  const plan = items.map((it) => { const c = JSON.parse(JSON.stringify(it)); delete c.done; return c; });
  const manifest = { format: FORMAT, version: 2, app: 'Church Service', made: new Date().toISOString(), kind: opts.kind || 'plan', name: opts.name || 'Service plan',
    items: plan, files, renders, banners, missing, links: !withMedia };
  return { manifest, blobs, stats };
}

export async function packageBlob(pack, onProgress) {
  return zipBlobs([{ name: 'plan.json', text: JSON.stringify(pack.manifest) }].concat(pack.blobs), onProgress);
}

/** Read a .sdaplan package, or a plan exported as .json by older versions. */
export async function openPackage(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const entries = await readZip(file);
    const pj = entries.get('plan.json');
    if (!pj) throw new Error('This file has no plan in it.');
    const manifest = JSON.parse(await pj.text());
    if (!isObj(manifest) || manifest.format !== FORMAT || !Array.isArray(manifest.items)) throw new Error('This is not a Church Service plan file.');
    return { manifest, entries };
  }
  const p = JSON.parse(await file.text());
  if (isObj(p) && p.format === FORMAT && Array.isArray(p.items)) return { manifest: p, entries: new Map() };
  if (!isObj(p) || !Array.isArray(p.items)) throw new Error('Not a Church Service plan file.');
  return { manifest: { format: FORMAT, version: 1, kind: 'plan', name: p.name || 'Imported plan', items: p.items, files: [], renders: [], banners: [], missing: [], links: true }, entries: new Map() };
}

/** Put a package's media on this device (reusing what is already here) and return the plan's parts, re-linked. */
export async function installPackage(pkg, hooks = {}) {
  const { manifest: m, entries } = pkg;
  const dec = (v, depth = 0) => {
    if (v == null || typeof v !== 'object' || depth > 22) return v;
    if (Array.isArray(v)) return v.map((x) => dec(x, depth + 1));
    if (typeof v.$blob === 'string') { const b = entries.get(v.$blob); return b ? b.slice(0, b.size, v.type || '') : null; }
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = dec(v[k], depth + 1); });
    return o;
  };
  const here = await db.all('files').catch(() => []);
  const idMap = new Map();
  const made = { decks: 0, videos: 0, pictures: 0, banners: 0 };
  let reused = 0;
  for (const raw of Array.isArray(m.files) ? m.files : []) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !['deck', 'media', 'banner-bg'].includes(raw.kind)) continue;
    // The same file already on this device (same kind, name and size): use it, do not copy it again.
    const same = here.find((f) => f.kind === raw.kind && f.name === raw.name && (f.size || 0) === (raw.size || 0) && (f.count || 0) === (raw.count || 0) && f.type === raw.type);
    if (same) { idMap.set(raw.id, same.id); reused++; continue; }
    const nid = (raw.kind === 'deck' ? 'd' : raw.kind === 'media' ? 'm' : 'p') + uid();
    idMap.set(raw.id, nid);
    const rec = dec(raw);
    rec.id = nid; rec.added = Date.now();
    delete rec.handle;
    if (raw.kind === 'media' && !isBlob(rec.blob)) continue;
    await db.put('files', nid, rec);
    if (raw.kind === 'deck') made.decks++; else if (raw.kind === 'media') made.videos++; else made.pictures++;
  }
  for (const r of Array.isArray(m.renders) ? m.renders : []) {
    if (!isObj(r) || typeof r.key !== 'string') continue;
    const i = r.key.indexOf('/');
    const old = r.key.slice(0, i), nid = idMap.get(old);
    if (!nid || here.some((f) => f.id === nid)) continue; // reused deck: its pages are already here
    await db.put('renders', nid + r.key.slice(i), dec(r.value));
  }
  // Banners: new ids, file ids swapped for this device's.
  const swap = (v, depth = 0) => {
    if (typeof v === 'string') return idMap.get(v) || v;
    if (!v || typeof v !== 'object' || depth > 20) return v;
    if (Array.isArray(v)) return v.map((x) => swap(x, depth + 1));
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = swap(v[k], depth + 1); });
    return o;
  };
  const bannerMap = new Map();
  const newBanners = [];
  const lib = (await db.get('kv', 'banners').catch(() => null)) || [];
  for (const b of Array.isArray(m.banners) ? m.banners : []) {
    if (!isObj(b) || typeof b.id !== 'string') continue;
    const nb = swap(b);
    const same = lib.find((x) => x && x.name === nb.name && JSON.stringify([x.tpl, x.f, x.s, x.els, x.pages]) === JSON.stringify([nb.tpl, nb.f, nb.s, nb.els, nb.pages]));
    if (same) { bannerMap.set(b.id, same.id); reused++; continue; }
    nb.id = 'b-' + uid(); delete nb.group; nb.created = nb.updated = Date.now();
    bannerMap.set(b.id, nb.id);
    newBanners.push(nb);
  }
  if (newBanners.length) {
    if (hooks.addBanners) await hooks.addBanners(newBanners);
    else await db.put('kv', 'banners', newBanners.concat(lib));
    made.banners = newBanners.length;
  }
  const items = m.items.filter(isObj).map((it) => {
    const c = Object.assign({}, it, { id: uid() });
    delete c.done;
    if (c.deck) c.deck = idMap.get(c.deck) || c.deck;
    if (c.item) c.item = idMap.get(c.item) || c.item;
    if (c.banner) c.banner = bannerMap.get(c.banner) || c.banner;
    return c;
  });
  if (made.decks && hooks.reloadSlides) await hooks.reloadSlides();
  if (made.videos && hooks.reloadVideos) await hooks.reloadVideos();
  return { items, made, reused };
}

export const fmtSize = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? Math.max(1, Math.round(n / 1048576)) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
