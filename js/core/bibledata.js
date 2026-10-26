// Bible data access. Built-in translations are per-book JSON files (precached by the
// service worker); imported ones (NIV, Xhosa, …) live in IndexedDB in the same shape.
// Only a handful of books are kept in memory at once so low-RAM phones stay responsive.
import { db } from './db.js';
import { EN, AF, XH, OSIS, resolveBook } from './books.js';
import { esc } from './util.js';

const infoCache = new Map();
const bookCache = new Map(); // `${id}/${b}` -> chapters (LRU)
const MAX_BOOKS = 8;
let listCache = null;

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

// Licensed Bibles in data/bibles-private/ exist only in builds made on a church's own machine.
// tools/build.py lists them in asset-manifest.json, so look there first instead of requesting a
// file that is missing on the public site (that showed up as a 404 error on every page load).
let privateListed = null;
function hasPrivateBibles() {
  if (!privateListed) {
    privateListed = fetchJSON('asset-manifest.json')
      .then((m) => !Array.isArray(m.files) || m.files.indexOf('data/bibles-private/index.json') >= 0)
      .catch(() => true); // no manifest (plain dev server): just try
  }
  return privateListed;
}

/** All translations: [{id, abbr, name, lang, license, src:'builtin'|'private'|'imported', dir}] */
export async function listTranslations(force) {
  if (listCache && !force) return listCache;
  const out = [];
  for (const [dir, src] of [['data/bibles', 'builtin'], ['data/bibles-private', 'private']]) {
    if (src === 'private' && !(await hasPrivateBibles())) continue;
    try { (await fetchJSON(dir + '/index.json')).forEach((t) => out.push(Object.assign({}, t, { src, dir: dir + '/' + t.id }))); }
    catch (e) { /* private folder is optional */ }
  }
  try {
    const keys = await db.keys('bibles');
    for (const k of keys) {
      if (typeof k === 'string' && k.startsWith('info:')) {
        const info = await db.get('bibles', k);
        if (info && !out.some((t) => t.id === info.id)) out.push({ id: info.id, abbr: info.abbr, name: info.name, lang: info.lang, license: info.license, src: 'imported' });
      }
    }
  } catch (e) { console.warn('bible list', e); }
  listCache = out;
  return out;
}

export async function getInfo(id) {
  if (infoCache.has(id)) return infoCache.get(id);
  const list = await listTranslations();
  const t = list.find((x) => x.id === id) || list[0];
  if (!t) throw new Error('No Bibles installed');
  let info;
  if (t.src === 'imported') info = await db.get('bibles', 'info:' + t.id);
  else info = await fetchJSON(t.dir + '/info.json');
  if (!info || typeof info !== 'object') throw new Error(t.abbr + ' could not be read. Remove it in Settings → Bibles & hymns and add it again.');
  info = Object.assign({}, info, { src: t.src, dir: t.dir });
  // Imported Bibles saved by an older version, or damaged: make every book entry usable.
  const bk = Array.isArray(info.books) ? info.books : [];
  info.books = EN.map((n, i) => {
    const b = bk[i];
    return Array.isArray(b) ? [typeof b[0] === 'string' && b[0] ? b[0] : n, +b[1] || 0, Array.isArray(b[2]) ? b[2] : []] : [n, 0, []];
  });
  info.names = info.books.map((b) => b[0]);
  infoCache.set(t.id, info);
  if (t.id !== id) infoCache.set(id, info);
  return info;
}

export async function getBook(id, b) {
  const k = id + '/' + b;
  if (bookCache.has(k)) { const v = bookCache.get(k); bookCache.delete(k); bookCache.set(k, v); return v; }
  const info = await getInfo(id);
  let data;
  if (info.src === 'imported') data = await db.get('bibles', info.id + '/' + b);
  else data = await fetchJSON(info.dir + '/' + (b < 10 ? '0' : '') + b + '.json');
  data = Array.isArray(data) ? data.map((ch) => (Array.isArray(ch) ? ch : [])) : [];
  bookCache.set(k, data);
  while (bookCache.size > MAX_BOOKS) bookCache.delete(bookCache.keys().next().value);
  return data;
}

/** Expand parsed segments into verse objects [{b,c,v,text}] (clamped to real verse counts). */
export async function versesFor(id, book, segs, opts) {
  const info = await getInfo(id);
  const data = await getBook(info.id, book);
  const out = [];
  const counts = (info.books[book - 1] || [])[2] || [];
  // Psalm titles: Afrikaans (and other Bibles) number the heading as verse 1 (sometimes 2), English Bibles
  // do not. Topic and key-verse lists are written in English numbering, so `opts.english` shifts them.
  let kc = null;
  if (opts && opts.english && book === 19 && info.id !== 'kjv' && info.id !== 'web') {
    try { kc = ((await getInfo('kjv')).books[18] || [])[2] || null; } catch (e) { kc = null; }
  }
  for (const s of segs) {
    for (let c = s.c1; c <= s.c2; c++) {
      const n = counts[c - 1] || (data[c - 1] || []).length;
      if (!n) continue;
      const off = kc && kc[c - 1] && n - kc[c - 1] > 0 && n - kc[c - 1] <= 2 ? n - kc[c - 1] : 0;
      const from = c === s.c1 && s.v1 != null ? s.v1 + off : (off ? 1 + off : 1);
      const to = c === s.c2 && s.v2 != null ? Math.min(s.v2 + off, n) : n;
      for (let v = Math.max(1, from); v <= to; v++) out.push({ b: book, c, v, text: (data[c - 1] || [])[v - 1] || '' });
    }
  }
  return out;
}

/** Verse text to safe HTML. KJV: [supplied words] -> italics, ‹words of Christ› -> red letter. */
export function verseHtml(text, { redLetter = false, italics = false } = {}) {
  let s = esc(text || '');
  s = s.replace(/‹([^›]*)›?/g, redLetter ? '<span class="wj">$1</span>' : '$1').replace(/›/g, '');
  s = s.replace(/\[([^\]]*)\]/g, italics ? '<i>$1</i>' : '$1');
  return s;
}
export const verseText = (t) => String(t || '').replace(/[‹›]/g, '').replace(/[[\]]/g, '');

/** Full-text search, scanning one book at a time (yields to the UI between books). */
export async function search(id, query, { limit = 200, onProgress, signal } = {}) {
  const info = await getInfo(id);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (let b = 1; b <= 66 && out.length < limit; b++) {
    if (signal && signal.aborted) break;
    if (!info.books[b - 1] || !info.books[b - 1][1]) continue;
    const data = await getBook(info.id, b);
    data.forEach((ch, ci) => ch.forEach((t, vi) => {
      if (out.length >= limit) return;
      const lt = verseText(t).toLowerCase();
      if (words.every((w) => lt.includes(w))) out.push({ b, c: ci + 1, v: vi + 1, text: t });
    }));
    if (onProgress) onProgress(b / 66);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

// ---------------------------------------------------------------- import

const USFM = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');
// Book ids used by the multilingual Bible corpus (CES XML).
const CES = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SON ISA JER LAM EZE DAN HOS JOE AMO OBA JON MIC NAH HAB ZEP HAG ZEC MAL MAT MAR LUK JOH ACT ROM 1CO 2CO GAL EPH PHI COL 1TH 2TH 1TI 2TI TIT PHM HEB JAM 1PE 2PE 1JO 2JO 3JO JUD REV'.split(' ');
function langNames(lang) { return lang === 'af' ? AF : lang === 'xh' ? XH : EN; }

/** Parse any supported Bible file into {meta, books: Map(b -> chapters[][])} */
export async function parseBibleFile(file) {
  const text = await file.text();
  const books = new Map();
  const meta = {};
  const put = (b, c, v, t) => {
    if (!b || b < 1 || b > 66 || !c || !v) return;
    let bk = books.get(b); if (!bk) books.set(b, bk = []);
    const ch = bk[c - 1] || (bk[c - 1] = []);
    ch[v - 1] = String(t || '').replace(/¶/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  };
  const bookNo = (x) => (typeof x === 'number' ? x : /^\d+$/.test(String(x)) ? parseInt(x, 10) : resolveBook(String(x)));
  const trimmed = text.trimStart();
  if (trimmed[0] === '<') {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('This XML file could not be read.');
    const root = doc.documentElement;
    if (root.nodeName.toUpperCase() === 'XMLBIBLE') { // Zefania
      meta.name = root.getAttribute('biblename') || '';
      doc.querySelectorAll('BIBLEBOOK').forEach((bk) => {
        const b = parseInt(bk.getAttribute('bnumber'), 10);
        bk.querySelectorAll('CHAPTER').forEach((ch) => {
          const c = parseInt(ch.getAttribute('cnumber'), 10);
          ch.querySelectorAll('VERS').forEach((vs) => put(b, c, parseInt(vs.getAttribute('vnumber'), 10), vs.textContent));
        });
      });
    } else if (root.nodeName.toLowerCase() === 'osis' || doc.getElementsByTagName('osisText').length) { // OSIS
      const t = doc.getElementsByTagName('title')[0];
      if (t) meta.name = t.textContent.trim();
      const osisIdx = (id) => OSIS.indexOf(id) + 1;
      const verses = doc.getElementsByTagName('verse');
      // Container form <verse osisID="Gen.1.1">text</verse>
      let milestone = false;
      for (const v of verses) { if (v.getAttribute('sID') || v.getAttribute('eID')) { milestone = true; break; } }
      if (!milestone) {
        for (const v of verses) {
          const id = (v.getAttribute('osisID') || '').split(' ')[0].split('.');
          put(osisIdx(id[0]), parseInt(id[1], 10), parseInt(id[2], 10), v.textContent);
        }
      } else {
        // Milestone form: text between <verse sID/> and <verse eID/>. Walk the document in order.
        const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        const skipped = (n) => { for (let p = n.parentNode; p; p = p.parentNode) if (p.nodeName === 'note' || p.nodeName === 'title') return true; return false; };
        let cur = null, buf = '';
        while (walker.nextNode()) {
          const n = walker.currentNode;
          if (n.nodeType === 1 && n.nodeName === 'verse') {
            if (n.getAttribute('sID')) { cur = (n.getAttribute('osisID') || '').split(' ')[0].split('.'); buf = ''; }
            else if (n.getAttribute('eID') && cur) { put(osisIdx(cur[0]), parseInt(cur[1], 10), parseInt(cur[2], 10), buf); cur = null; }
          } else if (n.nodeType === 3 && cur && !skipped(n)) buf += n.nodeValue;
        }
      }
    } else if (root.nodeName === 'cesDoc' || doc.getElementsByTagName('seg').length) { // CES (christos-c/bible-corpus): <seg id="b.GEN.1.1">
      const t = doc.getElementsByTagName('h.title')[0];
      if (t) meta.name = t.textContent.trim();
      const lg = doc.querySelector('langUsage language');
      if (lg) meta.lang = lg.getAttribute('id') || lg.getAttribute('iso639') || '';
      for (const sg of doc.getElementsByTagName('seg')) {
        const id = (sg.getAttribute('id') || '').split('.');
        if (id.length < 4) continue;
        put(CES.indexOf(id[1].toUpperCase()) + 1, parseInt(id[2], 10), parseInt(id[3], 10), sg.textContent);
      }
    } else throw new Error('Unknown XML Bible format (supported: Zefania, OSIS, CES).');
  } else if (trimmed[0] === '{' || trimmed[0] === '[') {
    const j = JSON.parse(text);
    if (j && j.verses) { // flat (Joy in the Journey / bible-api style)
      Object.assign(meta, j.metadata || {});
      j.verses.forEach((x) => put(bookNo(x.book || x.book_name), x.chapter, x.verse, x.text));
    } else if (j && j.books && j.books[0] && j.books[0].chapters && j.books[0].chapters[0] && j.books[0].chapters[0].chapter && typeof j.books[0].chapters[0].chapter === 'object') {
      // bible.helloao.org complete.json: books[].chapters[].chapter.content[]. Books carry a USFM id (GEN, MAT …),
      // which is used first, so a New Testament only Bible lands on the right books.
      Object.assign(meta, { name: (j.translation && j.translation.englishName) || j.name, abbr: (j.translation && j.translation.shortName) || '', lang: (j.translation && j.translation.language) || '' });
      j.books.forEach((bk, i) => {
        const u = USFM.indexOf(String(bk.id || '').toUpperCase()) + 1;
        const b = u || bookNo(bk.name || bk.id) || (j.books.length === 66 ? i + 1 : 0);
        (bk.chapters || []).forEach((chWrap) => {
          const ch = chWrap.chapter || chWrap;
          const c = ch.number || 1;
          const walk = (items) => (items || []).forEach((item) => {
            if (item && item.type === 'verse' && item.number) {
              // complete.json: content[] of strings and {text}/{heading}/{lineBreak}/{noteId}; complete.simple.json: text
              const t = typeof item.text === 'string' ? item.text
                : Array.isArray(item.content) ? item.content.map((x) => (typeof x === 'string' ? x : x && typeof x.text === 'string' ? x.text : x && x.lineBreak ? ' ' : '')).join(' ')
                  : String(item.content || '');
              put(b, c, item.number, t);
            }
          });
          walk(ch.content);
        });
      });
    } else if (j && j.books) { // nested
      Object.assign(meta, { name: j.fullName || j.name, abbr: j.translation, lang: j.languageCode, license: j.license });
      j.books.forEach((bk, i) => {
        const b = bookNo(bk.nr || bk.number || bk.name) || i + 1;
        if (Array.isArray(bk.chapters) && Array.isArray(bk.chapters[0])) bk.chapters.forEach((ch, ci) => ch.forEach((t, vi) => put(b, ci + 1, vi + 1, t)));
        else (bk.chapters || []).forEach((ch) => (ch.verses || []).forEach((vs) => put(b, ch.chapter, vs.verse, vs.text)));
      });
    } else if (Array.isArray(j) && j[0] && j[0].chapters) { // thiagobodruk
      j.forEach((bk, i) => bk.chapters.forEach((ch, ci) => ch.forEach((t, vi) => put(i + 1, ci + 1, vi + 1, t))));
    } else if (Array.isArray(j) && j[0] && (j[0].book || j[0].book_name) && j[0].verse) {
      j.forEach((x) => put(bookNo(x.book || x.book_name), x.chapter, x.verse, x.text));
    } else if (j && !Array.isArray(j) && typeof j === 'object' && Object.keys(j).length >= 60 && Object.values(j).every((v) => v && typeof v === 'object')) {
      // { "Genesis": { "1": { "1": "In the beginning…" } } } (book name → chapter → verse), e.g. the Bible-json collections
      Object.keys(j).forEach((name, i) => {
        const b = bookNo(name) || i + 1;
        Object.keys(j[name]).forEach((c) => Object.keys(j[name][c]).forEach((v) => put(b, parseInt(c, 10), parseInt(v, 10), j[name][c][v])));
      });
    } else throw new Error('Unknown JSON Bible format.');
  } else { // CSV / TSV: book,chapter,verse,text
    const delim = text.indexOf('\t') >= 0 ? '\t' : ',';
    text.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const cells = line.split(delim);
      if (cells.length < 4 || !/^\d+$/.test(cells[1].trim())) return;
      put(bookNo(cells[0].trim()), parseInt(cells[1], 10), parseInt(cells[2], 10), cells.slice(3).join(delim).replace(/^"|"$/g, ''));
    });
  }
  let total = 0;
  books.forEach((bk) => bk.forEach((ch) => { if (ch) total += ch.length; }));
  if (total < 100) throw new Error('No verses found in this file.');
  return { meta, books, total };
}

/** Store a parsed Bible in IndexedDB under `id`. */
export async function saveImported({ id, abbr, name, lang, license }, parsed) {
  const names = langNames(lang);
  const entries = [];
  const books = [];
  for (let b = 1; b <= 66; b++) {
    const bk = parsed.books.get(b) || [];
    const chapters = [];
    for (let c = 0; c < bk.length; c++) {
      const ch = bk[c] || [];
      const arr = [];
      for (let v = 0; v < ch.length; v++) arr.push(ch[v] || '');
      chapters.push(arr);
    }
    books.push([names[b - 1], chapters.length, chapters.map((c) => c.length)]);
    if (chapters.length) entries.push([id + '/' + b, chapters]);
  }
  const info = { id, abbr, name, lang, license, year: '', books };
  entries.push(['info:' + id, info]);
  await db.putMany('bibles', entries);
  infoCache.delete(id); listCache = null;
  for (const k of Array.from(bookCache.keys())) if (k.startsWith(id + '/')) bookCache.delete(k);
  window.dispatchEvent(new CustomEvent('selah-bibles'));
  return info;
}

export async function deleteImported(id) {
  await db.delPrefix('bibles', id + '/');
  await db.del('bibles', 'info:' + id);
  infoCache.delete(id); listCache = null;
  window.dispatchEvent(new CustomEvent('selah-bibles'));
}

export function resetCaches() { infoCache.clear(); bookCache.clear(); listCache = null; }
