// Shared Praise Choruses: songs that churches shared from the Hymns tab and the maintainer approved.
// They live in the repository (data/hymns/community/choruses.json, MIDI files in …/midi/) and every copy of
// SDA Sabbath fetches the list when it is online, so everyone gets new choruses without an app update.
// The copy in the app's own files is used until the first successful check (and offline).
import { db } from './db.js';

const SITE = 'https://leemcq.github.io/Church_Service/';
const PATH = 'data/hymns/community/choruses.json';
const KEY = 'community-choruses';
export const COMMUNITY_BOOK = 'choruses';
export const FIRST_NUMBER = 501;          // shared choruses are numbered 501 upwards in every church
export const REPO = 'LeeMcQ/Church_Service';
const EVERY = 6 * 3600 * 1000;            // check at most every 6 hours (unless asked)

const remoteBase = () => (/github\.io$/.test(location.hostname) ? new URL('./', location.href).href : SITE);
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max) : '');
const lines = (a) => (Array.isArray(a) ? a.filter((l) => typeof l === 'string').map((l) => str(l, 300)).filter(Boolean).slice(0, 40) : []);

/** Keep only well-formed songs (the file comes from the internet). */
function clean(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.songs)) return null;
  const seen = new Set();
  const songs = [];
  for (const s of doc.songs.slice(0, 5000)) {
    if (!s || typeof s !== 'object') continue;
    const n = +s.n;
    if (!Number.isInteger(n) || n < FIRST_NUMBER || n > 99999 || seen.has(n)) continue;
    const v = (Array.isArray(s.v) ? s.v : []).map(lines).filter((x) => x.length).slice(0, 20);
    const c = lines(s.c);
    const t = str(s.t, 120);
    if (!t || (!v.length && !c.length)) continue;
    seen.add(n);
    songs.push({ n, t, a: str(s.a, 120), v: v.length ? v : [c], c: v.length && c.length ? c : null,
      id: str(s.id, 80), by: str(s.by, 80), added: str(s.added, 20),
      midi: /^data\/hymns\/community\/midi\/[a-z0-9-]+\.mid$/.test(s.midi || '') ? s.midi : '' });
  }
  return { rev: +doc.rev || 0, updated: str(doc.updated, 40), songs };
}

/** The shared choruses known on this device (newest of: last download, the app's own copy). */
export async function communitySongs() {
  let saved = null, bundled = null;
  try { saved = clean(await db.get('kv', KEY)); } catch (e) { saved = null; }
  try { const r = await fetch(PATH); if (r.ok) bundled = clean(await r.json()); } catch (e) { bundled = null; }
  const best = [saved, bundled].filter(Boolean).sort((a, b) => b.rev - a.rev)[0];
  return best || { rev: 0, updated: '', songs: [] };
}

/** Look for new shared choruses (and their MIDI). Returns {changed, added, error}. */
export async function syncCommunity({ force = false } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { changed: false, added: 0, offline: true };
  const last = await db.get('kv', KEY + ':checked').catch(() => 0);
  if (!force && last && Date.now() - last < EVERY) return { changed: false, added: 0, skipped: true };
  const have = await communitySongs();
  let doc;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(remoteBase() + PATH + '?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    doc = clean(await r.json());
    if (!doc) throw new Error('not a chorus list');
  } catch (e) { return { changed: false, added: 0, error: e.message || String(e) }; }
  await db.put('kv', KEY + ':checked', Date.now()).catch(() => {});
  // MIDI for shared choruses, kept on this device so it plays offline.
  for (const s of doc.songs) {
    if (!s.midi) continue;
    const id = 'cmidi:' + COMMUNITY_BOOK + ':' + s.n;
    const got = await db.get('files', id).catch(() => null);
    if (got && got.src === s.midi) continue;
    try {
      const r = await fetch(remoteBase() + s.midi, { cache: 'no-store' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      if (String.fromCharCode(...head) !== 'MThd' || blob.size > 2 * 1048576) continue;
      await db.put('files', id, { id, kind: 'midi', name: s.t, src: s.midi, community: true, blob: blob.slice(0, blob.size, 'audio/midi'), added: Date.now() });
    } catch (e) { /* try again next time */ }
  }
  if (doc.rev <= have.rev && doc.songs.length <= have.songs.length) return { changed: false, added: 0 };
  await db.put('kv', KEY, doc);
  const old = new Set(have.songs.map((s) => s.n));
  return { changed: true, added: doc.songs.filter((s) => !old.has(s.n)).length };
}

/** A song as plain text with "Chorus:" marking the chorus (the format of the Hymns editor and the issue form). */
export function songText(hy) {
  const parts = [];
  (hy.v || []).forEach((s, i) => { parts.push(s.join('\n')); if (i === 0 && hy.c && hy.c.length) parts.push('Chorus:\n' + hy.c.join('\n')); });
  return parts.join('\n\n');
}

/** The address of a new GitHub issue with the song filled in (the "Share a chorus" form). */
export function shareUrl(hy, { church = '', rights = '' } = {}) {
  const p = new URLSearchParams({ template: 'chorus.yml', title: 'Chorus: ' + hy.t, 'song-title': hy.t, author: hy.a || '', lyrics: songText(hy), church });
  if (rights) p.set('rights', rights);
  return 'https://github.com/' + REPO + '/issues/new?' + p.toString();
}
