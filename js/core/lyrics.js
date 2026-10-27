// Online lyrics finder (optional, needs internet). Looks in several public lyric sources that a browser may
// call directly, ranks what it finds by how well it fits what the person typed, and turns the chosen words
// into the same stanza + chorus form the hymn and chorus books use, ready for slides.
//
// Sources: LRCLIB (lrclib.net) and Lyrics.ovh. If an AI key is set, the AI is only asked WHICH songs the typed
// words probably belong to (title and singer); the lyrics themselves always come from the sources, never from
// the AI. Lyrics are the property of their owners: the app shows a licence reminder (CCLI) before use.
import { normalize } from './util.js';
import * as ai from './ai.js';

const TIMEOUT = 9000;

async function getJson(url, ms = TIMEOUT) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ------------------------------------------------------------ text helpers
const words = (s) => normalize(s).replace(/[^a-z0-9À-￿' ]+/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'is', 'my', 'me', 'i', 'you', 'we', 'he', 'it', 'our', 'your', 'with', 'by']);
const key = (s) => words(s).join(' ');

/** "Above all by Michael W Smith" / "Above all - Michael W Smith" -> {text, artist}. */
export function splitQuery(q) {
  const s = String(q || '').trim().replace(/\s+/g, ' ');
  const m = /^(.*?)\s+(?:by|-|–|—)\s+(.+)$/i.exec(s);
  if (m && m[1].length >= 2 && m[2].length >= 2) return { text: m[1].trim(), artist: m[2].trim() };
  return { text: s, artist: '' };
}

function firstLines(lyrics, n = 2) {
  return String(lyrics || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l)).slice(0, n).join(' / ');
}

/** 0..1: how well a song fits the typed words (title, singer, and any words found inside the lyrics). */
export function scoreSong(c, q) {
  const { text, artist } = splitQuery(q);
  const qw = words(text).filter((w) => !STOP.has(w));
  const all = words(text);
  if (!all.length) return 0;
  const tw = new Set(words(c.title));
  const titleHit = qw.length ? qw.filter((w) => tw.has(w)).length / qw.length : 0;
  const titleExact = key(c.title) === key(text) ? 1 : 0;
  const titleStarts = key(c.title).startsWith(key(text)) || key(text).startsWith(key(c.title)) ? 0.9 : 0;
  let lyr = 0;
  if (c.lyrics) {
    const body = ' ' + key(c.lyrics) + ' ';
    if (all.length >= 2 && body.includes(' ' + all.join(' ') + ' ')) lyr = 1;
    else if (qw.length) lyr = (qw.filter((w) => body.includes(' ' + w + ' ')).length / qw.length) * 0.85;
  }
  let s = Math.max(titleExact, titleStarts, titleHit * 0.9, lyr * 0.9);
  if (titleHit > 0 && lyr > 0.5) s = Math.min(1, s + 0.08);
  if (artist) {
    const aw = words(artist), cw = new Set(words(c.artist));
    const hit = aw.length ? aw.filter((w) => cw.has(w)).length / aw.length : 0;
    s = s * (0.7 + 0.3 * hit);
  }
  return Math.max(0, Math.min(1, s));
}
export const matchLabel = (s) => (s >= 0.85 ? 'Best match' : s >= 0.55 ? 'Likely' : 'Possible');

// ------------------------------------------------------------ sources
async function lrclib(params) {
  const j = await getJson('https://lrclib.net/api/search?' + new URLSearchParams(params));
  return (Array.isArray(j) ? j : []).filter((x) => x && !x.instrumental && (x.trackName || x.name)).map((x) => ({
    source: 'LRCLIB', title: String(x.trackName || x.name), artist: String(x.artistName || ''), album: String(x.albumName || ''),
    lyrics: typeof x.plainLyrics === 'string' && x.plainLyrics.trim() ? x.plainLyrics : '',
    url: x.id ? 'https://lrclib.net/api/get/' + x.id : '',
  }));
}
async function ovhSuggest(q) {
  const j = await getJson('https://api.lyrics.ovh/suggest/' + encodeURIComponent(q));
  return ((j && j.data) || []).filter((x) => x && x.title).slice(0, 8).map((x) => ({
    source: 'Lyrics.ovh', title: String(x.title_short || x.title), artist: String((x.artist && x.artist.name) || ''), album: String((x.album && x.album.title) || ''), lyrics: '',
    fetch: async () => {
      const r = await getJson('https://api.lyrics.ovh/v1/' + encodeURIComponent((x.artist && x.artist.name) || '-') + '/' + encodeURIComponent(x.title_short || x.title));
      return String((r && r.lyrics) || '');
    },
  }));
}

/** AI names likely songs (title and singer only). Lyrics are then looked up in the sources. */
async function aiGuesses(q) {
  const reply = await ai.aiText({
    system: 'You identify Christian hymns, Sabbath-school and praise songs from a few words. Reply with JSON only. Never write any lyrics.',
    prompt: 'Words typed: "' + q + '"\nGive up to 4 songs these words most likely belong to (title and the usual singer, group or hymn author).' +
      '\nReply exactly: {"songs":[{"title":"…","artist":"…"}]}',
    maxTokens: 300,
  });
  const j = ai.parseJsonReply(reply);
  return ((j && Array.isArray(j.songs)) ? j.songs : []).map((s) => ({ title: String((s && s.title) || '').trim(), artist: String((s && s.artist) || '').trim() }))
    .filter((s) => s.title).slice(0, 4);
}

/** Search every source at once. Slow or blocked sources are skipped. Returns {results, errors, offline}. */
export async function findSongs(query, { useAi = false, onUpdate } = {}) {
  const q = String(query || '').trim();
  const { text, artist } = splitQuery(q);
  const errors = [];
  const found = [];
  const note = (src) => (e) => { errors.push(src + ': ' + ((e && e.message) || e)); return []; };
  const jobs = [
    lrclib({ q: text + (artist ? ' ' + artist : '') }).catch(note('LRCLIB')),
    ovhSuggest(text + (artist ? ' ' + artist : '')).catch(note('Lyrics.ovh')),
  ];
  if (artist) jobs.push(lrclib({ track_name: text, artist_name: artist }).catch(note('LRCLIB')));
  if (useAi && ai.hasKey()) {
    jobs.push(aiGuesses(q).then(async (gs) => {
      const lots = await Promise.all(gs.map((g) => lrclib({ track_name: g.title, artist_name: g.artist }).catch(() => lrclib({ q: g.title + ' ' + g.artist })).catch(() => [])));
      return lots.flatMap((arr, i) => arr.slice(0, 3).map((c) => Object.assign(c, { aiPick: true, ...(i === 0 ? { aiFirst: true } : {}) })));
    }).catch(note('AI')));
  }
  await Promise.all(jobs.map((p) => p.then((arr) => { found.push(...arr); if (onUpdate) onUpdate(rank(found, q)); })));
  return { results: rank(found, q), errors };
}

/** Merge copies of the same song, score, sort. */
export function rank(list, q) {
  const by = new Map();
  list.forEach((c) => {
    const k = key(c.title) + '|' + key(c.artist);
    const old = by.get(k);
    if (!old) { by.set(k, Object.assign({}, c)); return; }
    if (!old.lyrics && c.lyrics) { old.lyrics = c.lyrics; old.url = c.url; old.source = c.source; delete old.fetch; }
    else if (c.lyrics && old.lyrics && c.lyrics.length > old.lyrics.length * 1.1) old.lyrics = c.lyrics;
    if (c.aiPick) old.aiPick = true;
    if (!old.fetch && !old.lyrics && c.fetch) old.fetch = c.fetch;
  });
  const out = Array.from(by.values()).map((c) => {
    c.score = scoreSong(c, q) + (c.aiPick ? 0.06 : 0);
    if (c.score > 1) c.score = 1;
    c.preview = firstLines(c.lyrics);
    return c;
  });
  out.sort((a, b) => (b.score - a.score) || (!!b.lyrics - !!a.lyrics) || a.title.localeCompare(b.title));
  return out.filter((c) => c.score >= 0.18 || c.aiPick).slice(0, 12);
}

/** Make sure a result has its lyrics (some sources need a second request). Returns the plain text. */
export async function lyricsOf(c) {
  if (c.lyrics) return c.lyrics;
  if (c.fetch) { c.lyrics = await c.fetch(); }
  if (!c.lyrics) {
    // Last try: the first source, asking by exact title and singer.
    const arr = await lrclib({ track_name: c.title, artist_name: c.artist }).catch(() => []);
    const best = arr.find((x) => x.lyrics);
    if (best) c.lyrics = best.lyrics;
  }
  if (!c.lyrics) throw new Error('This source has no words for “' + c.title + '”. Try another result.');
  c.preview = firstLines(c.lyrics);
  return c.lyrics;
}

// ------------------------------------------------------------ plain lyrics -> stanzas
const HEAD = /^[\[(]\s*(verse|chorus|refrain|pre[- ]?chorus|bridge|tag|intro|outro|instrumental|interlude|hook|v\d|c\d)\b[^\])]*[\])]\s*:?\s*$|^(verse|chorus|refrain|pre[- ]?chorus|bridge)\s*\d*\s*:\s*$/i;
const NOISE = /^(paroles de la chanson.*|lyrics (?:for|of) .*|\(?instrumental\)?|\.{3}|-{3,}|\*{3,}|\d+\s*embed|you might also like.*)$/i;

/**
 * Plain lyrics from a web source -> {v:[[line…]…], c:[line…]|null}, the form used by the hymn and chorus books.
 * [Chorus] / Chorus: headers mark the chorus; a stanza sung again word for word is also taken as the chorus.
 */
export function songFromPlain(raw) {
  const text = String(raw || '').replace(/\r/g, '').replace(/ /g, ' ');
  const blocks = [];
  let cur = [], label = '', chorusNext = false;
  const flush = () => { if (cur.length) blocks.push({ lines: cur, chorus: chorusNext }); cur = []; chorusNext = false; };
  text.split('\n').forEach((line0) => {
    const line = line0.trim();
    if (!line) { flush(); return; }
    if (NOISE.test(line)) return;
    if (HEAD.test(line)) {
      flush();
      label = line.toLowerCase();
      chorusNext = /chorus|refrain|hook/.test(label) && !/pre/.test(label);
      return;
    }
    cur.push(line.replace(/^\d+[.)]\s+/, ''));
  });
  flush();
  // Instrumental-only blocks (headers marked intro/outro/instrumental with no real words) are skipped.
  let stanzas = blocks.filter((b) => b.lines.length);
  // No blank lines at all in a long text: cut into fours.
  if (stanzas.length === 1 && stanzas[0].lines.length > 8) {
    const L = stanzas[0].lines; stanzas = [];
    for (let i = 0; i < L.length; i += 4) stanzas.push({ lines: L.slice(i, i + 4), chorus: false });
  }
  const sig = (b) => key(b.lines.join(' '));
  const counts = new Map();
  stanzas.forEach((b) => counts.set(sig(b), (counts.get(sig(b)) || 0) + 1));
  let chorus = null;
  const marked = stanzas.find((b) => b.chorus);
  if (marked) chorus = marked.lines;
  else {
    // Most repeated stanza (at least twice), preferring the earliest.
    let best = null;
    stanzas.forEach((b) => { const n = counts.get(sig(b)); if (n >= 2 && (!best || n > best.n)) best = { n, b }; });
    if (best && stanzas.length > 2) chorus = best.b.lines;
  }
  const cs = chorus ? key(chorus.join(' ')) : '';
  const seen = new Set();
  const v = [];
  stanzas.forEach((b) => {
    const s = sig(b);
    if (cs && (s === cs || b.chorus)) return;   // the chorus is kept once, in c
    if (seen.has(s)) return;                    // a verse sung twice is shown once
    seen.add(s); v.push(b.lines);
  });
  if (!v.length && chorus) return { v: [chorus], c: null };
  return { v, c: chorus };
}

/** The editable text for a song, in the same form as Hymns → Edit ("Chorus:" after the first stanza). */
export function songText(p) {
  const parts = [];
  p.v.forEach((s, i) => { parts.push(s.join('\n')); if (i === 0 && p.c) parts.push('Chorus:\n' + p.c.join('\n')); });
  if (!p.v.length && p.c) parts.push('Chorus:\n' + p.c.join('\n'));
  return parts.join('\n\n');
}

/** Search BitMidi for MIDI files matching a title. Returns {name, url, score}[]. BitMidi does not allow requests
 *  from other websites (no CORS header), so in most browsers it cannot answer: after the first failure it is not
 *  asked again until the app restarts (no error per search result, no wait). Same title: answered from memory. */
let midiDown = false;
const midiMemo = new Map();
export function midiSearchAvailable() { return !midiDown; }
export async function findMidi(title) {
  const q = String(title || '').trim();
  if (!q || midiDown) return [];
  if (midiMemo.has(q.toLowerCase())) return midiMemo.get(q.toLowerCase());
  const p = findMidiOnline(q);
  midiMemo.set(q.toLowerCase(), p);
  return p;
}
async function findMidiOnline(q) {
  try {
    let j;
    try { j = await getJson('https://bitmidi.com/api/midi/search?q=' + encodeURIComponent(q)); }
    catch (e) { if (e && (e.name === 'TypeError' || e.name === 'AbortError')) midiDown = true; throw e; }
    const results = (j && j.result && j.result.results) || [];
    return results.slice(0, 8).map((x) => {
      const name = String(x.name || '').replace(/\.mid$/i, '');
      const qw = words(q).filter((w) => !STOP.has(w));
      const nw = new Set(words(name));
      const hit = qw.length ? qw.filter((w) => nw.has(w)).length / qw.length : 0;
      return {
        name,
        url: 'https://bitmidi.com' + (x.downloadUrl || ''),
        score: hit,
        source: 'BitMidi',
      };
    }).filter((x) => x.url && x.score >= 0.3).sort((a, b) => b.score - a.score);
  } catch (e) { return []; }
}

/** Download a MIDI file as a Blob. */
export async function fetchMidi(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.blob();
  } finally { clearTimeout(t); }
}
export function sourceLinks(q) {
  const e = encodeURIComponent(q);
  return [
    ['Hymnary.org', 'https://hymnary.org/search?qu=' + e],
    ['Hymnal.net', 'https://www.hymnal.net/en/search/all/all/' + e],
    ['SDA Hymnals', 'https://sdahymnals.com/?s=' + e],
    ['Open Hymnal', 'https://openhymnal.org/search.html?q=' + e],
    ['Google', 'https://www.google.com/search?q=' + encodeURIComponent(q + ' lyrics')],
  ];
}
