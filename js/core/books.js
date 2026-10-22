// Book names (English, Afrikaans, isiXhosa) and a forgiving reference parser:
//   "John 3:16", "jn 3 16-18", "1 Cor 13:4-7", "1co13.4", "Ps 23", "Joh 3:16",
//   "Openbaring 14:6-12", "Gen 1:1-2:3", "Rom 8:28,31-39", "Jude 3".
import { normalize } from './util.js';

export const EN = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'];
export const AF = ['Genesis','Exodus','Levitikus','Numeri','Deuteronomium','Josua','Rigters','Rut','1 Samuel','2 Samuel','1 Konings','2 Konings','1 Kronieke','2 Kronieke','Esra','Nehemia','Ester','Job','Psalms','Spreuke','Prediker','Hooglied','Jesaja','Jeremia','Klaagliedere','Esegiël','Daniël','Hosea','Joël','Amos','Obadja','Jona','Miga','Nahum','Habakuk','Sefanja','Haggai','Sagaria','Maleagi','Matteus','Markus','Lukas','Johannes','Handelinge','Romeine','1 Korintiërs','2 Korintiërs','Galasiërs','Efesiërs','Filippense','Kolossense','1 Tessalonisense','2 Tessalonisense','1 Timoteus','2 Timoteus','Titus','Filemon','Hebreërs','Jakobus','1 Petrus','2 Petrus','1 Johannes','2 Johannes','3 Johannes','Judas','Openbaring'];
export const XH = ['Genesis','Eksodus','Levitikus','Numeri','Duteronomi','Yoshuwa','Abagwebi','Rute','1 Samuweli','2 Samuweli','1 Kumkani','2 Kumkani','1 Kronike','2 Kronike','Ezra','Nehemiya','Estere','Yobhi','Iindumiso','IMizekeliso','INtshumayeli','IsiHlabelelo','Isaya','Yeremiya','IZililo','Hezekile','Daniyeli','Hoseya','Yoweli','Amosi','Obhadiya','Yona','Mika','Nahum','Habhakuki','Zefaniya','Hagayi','Zekariya','Malaki','Mateyu','Marko','Luka','Yohane','IZenzo','KwabaseRoma','1 KwabaseKorinte','2 KwabaseKorinte','KwabaseGalati','KwabaseEfese','KwabaseFilipi','KwabaseKolose','1 KwabaseTesalonika','2 KwabaseTesalonika','1 kuTimoti','2 kuTimoti','kuTito','kuFilemon','KumaHebhere','ElikaYakobi','1 kaPetros','2 kaPetros','1 kaYohane','2 kaYohane','3 kaYohane','ElikaYuda','ISityhilelo'];
export const SHORT = ['Gen','Exod','Lev','Num','Deut','Josh','Judg','Ruth','1 Sam','2 Sam','1 Kgs','2 Kgs','1 Chr','2 Chr','Ezra','Neh','Esth','Job','Ps','Prov','Eccl','Song','Isa','Jer','Lam','Ezek','Dan','Hos','Joel','Amos','Obad','Jonah','Mic','Nah','Hab','Zeph','Hag','Zech','Mal','Matt','Mark','Luke','John','Acts','Rom','1 Cor','2 Cor','Gal','Eph','Phil','Col','1 Thess','2 Thess','1 Tim','2 Tim','Titus','Phlm','Heb','Jas','1 Pet','2 Pet','1 John','2 John','3 John','Jude','Rev'];
// OSIS ids, used by the OSIS importer.
export const OSIS = ['Gen','Exod','Lev','Num','Deut','Josh','Judg','Ruth','1Sam','2Sam','1Kgs','2Kgs','1Chr','2Chr','Ezra','Neh','Esth','Job','Ps','Prov','Eccl','Song','Isa','Jer','Lam','Ezek','Dan','Hos','Joel','Amos','Obad','Jonah','Mic','Nah','Hab','Zeph','Hag','Zech','Mal','Matt','Mark','Luke','John','Acts','Rom','1Cor','2Cor','Gal','Eph','Phil','Col','1Thess','2Thess','1Tim','2Tim','Titus','Phlm','Heb','Jas','1Pet','2Pet','1John','2John','3John','Jude','Rev'];
export const SINGLE_CHAPTER = new Set([31, 57, 63, 64, 65]); // Obadiah, Philemon, 2 John, 3 John, Jude

// Common abbreviations that plain prefix-matching would get wrong.
const ALIASES = {
  gn: 1, ge: 1, ex: 2, exo: 2, lv: 3, nm: 4, dt: 5, jos: 6, josh: 6, jdg: 7, jg: 7, judg: 7, rt: 8,
  '1sa': 9, '2sa': 10, '1ki': 11, '2ki': 12, '1kgs': 11, '2kgs': 12, '1ch': 13, '2ch': 14,
  ne: 16, es: 17, est: 17, jb: 18, ps: 19, psa: 19, psalm: 19, pss: 19, pr: 20, prv: 20, ec: 21, eccl: 21, qoh: 21,
  so: 22, sos: 22, song: 22, ss: 22, canticles: 22, is: 23, jr: 24, la: 25, eze: 26, ezk: 26, dn: 27,
  ho: 28, jl: 29, am: 30, ob: 31, jon: 32, mi: 33, na: 34, hb: 35, zep: 36, zp: 36, hg: 37, zec: 38, zc: 38, ml: 39,
  mt: 40, matt: 40, mk: 41, mr: 41, lk: 42, jn: 43, jhn: 43, joh: 43, ac: 44, act: 44, rm: 45, ro: 45,
  '1co': 46, '2co': 47, ga: 48, ep: 49, php: 50, phil: 50, pp: 50, cl: 51, '1th': 52, '2th': 53, '1ti': 54, '2ti': 55,
  ti: 56, tit: 56, phm: 57, phlm: 57, philem: 57, he: 58, heb: 58, jas: 59, jm: 59, '1pe': 60, '2pe': 61, '1pt': 60, '2pt': 61,
  '1jn': 62, '2jn': 63, '3jn': 64, '1jo': 62, '2jo': 63, '3jo': 64, '1joh': 62, '2joh': 63, '3joh': 64, jud: 65, jd: 65, re: 66, rv: 66, rev: 66, apoc: 66,
  // Afrikaans
  eks: 2, num: 4, deut: 5, rig: 7, kon: 11, '1kon': 11, '2kon': 12, '1kron': 13, '2kron': 14, spr: 20, pred: 21, hoogl: 22, hl: 22,
  jes: 23, klaagl: 25, eseg: 26, esg: 26, sag: 38, mal: 39, matt2: 40, mat: 40, mark: 41, luk: 42, hand: 44, hnd: 44,
  '1kor': 46, '2kor': 47, gal: 48, ef: 49, fil: 50, kol: 51, '1tes': 52, '2tes': 53, '1tess': 52, '2tess': 53,
  '1tim': 54, '2tim': 55, filem: 57, hebr: 58, jak: 59, '1pet': 60, '2pet': 61, '1petr': 60, '2petr': 61,
  '1johannes': 62, judas: 65, op: 66, openb: 66,
  // isiXhosa
  iindumiso: 19, ind: 19, imiz: 20, mizekeliso: 20, izenzo: 44, zenzo: 44, isityhilelo: 66, sityhilelo: 66, mateyu: 40, yohane: 43, luka: 42, marko: 41,
};

const key = (s) => normalize(s).replace(/[\s.]+/g, '');
let NAMEKEYS = null;
function nameKeys() {
  if (!NAMEKEYS) {
    NAMEKEYS = [];
    [EN, AF, XH].forEach((list) => list.forEach((n, i) => NAMEKEYS.push([key(n), i + 1])));
  }
  return NAMEKEYS;
}

/** Resolve a book token ("1 cor", "Joh", "Openbaring") to 1..66, or 0. */
export function resolveBook(token) {
  const k = key(token);
  if (!k) return 0;
  if (ALIASES[k]) return ALIASES[k];
  const keys = nameKeys();
  for (const [nk, n] of keys) if (nk === k) return n;
  if (k.length < 2 && !/^\d/.test(k)) return 0;
  // Prefix match (canonical order, English first then Afrikaans then Xhosa).
  for (const [nk, n] of keys) if (nk.startsWith(k)) return n;
  return 0;
}

/**
 * Parse a reference. Returns {book, segs:[{c1,v1,c2,v2}]} where v1/v2 may be null (= whole chapter),
 * or null when nothing sensible was found.
 */
export function parseRef(input) {
  if (!input) return null;
  const s = String(input).trim().replace(/[–—]/g, '-');
  const m = /^\s*([1-3]\s*)?([^\d]+?)\s*(\d.*)?$/.exec(s.replace(/^([1-3])(?=[^\d\s])/, '$1 '));
  if (!m) return null;
  const book = resolveBook((m[1] || '') + m[2]);
  if (!book) return null;
  const rest = (m[3] || '').trim();
  if (!rest) return { book, segs: [{ c1: 1, v1: null, c2: 1, v2: null }], chapterOnly: true };

  // Tokenise into numbers and separators.
  const toks = rest.match(/\d+|[:.,;\-]|\s+/g) || [];
  const t = toks.map((x) => (/^\s+$/.test(x) ? ' ' : x)).filter((x, i, a) => !(x === ' ' && (a[i - 1] === ' ')));
  let i = 0;
  const num = () => (i < t.length && /^\d+$/.test(t[i]) ? parseInt(t[i++], 10) : null);
  const sep = () => { while (t[i] === ' ' && /^[:.,;\-]$/.test(t[i + 1] || '')) i++; const x = t[i]; return x; };
  const segs = [];
  let chap = num();
  if (chap == null) return null;
  const single = SINGLE_CHAPTER.has(book);
  let x = sep();
  if (single && (x == null || x === '-' || x === ',' || x === ';')) {
    // "Jude 3" / "Jude 3-5": the number is a verse.
    let v1 = chap, v2 = chap;
    if (x === '-') { i++; while (t[i] === ' ') i++; const e = num(); if (e) v2 = e; }
    return { book, segs: [{ c1: 1, v1, c2: 1, v2 }] };
  }
  if (x == null) return { book, segs: [{ c1: chap, v1: null, c2: chap, v2: null }], chapterOnly: true };
  if (x === '-') { // "Ps 23-24" chapter range
    i++; while (t[i] === ' ') i++;
    const c2 = num();
    return { book, segs: [{ c1: chap, v1: null, c2: c2 || chap, v2: null }], chapterOnly: true };
  }
  // chapter:verse ...
  if (x === ':' || x === '.' || x === ' ') i++;
  while (t[i] === ' ') i++;
  let v = num();
  if (v == null) return { book, segs: [{ c1: chap, v1: null, c2: chap, v2: null }], chapterOnly: true };
  for (;;) {
    let seg = { c1: chap, v1: v, c2: chap, v2: v };
    x = sep();
    if (x === '-') {
      i++; while (t[i] === ' ') i++;
      const a = num();
      if (a != null) {
        const y = t[i];
        if (y === ':' || y === '.') { i++; const b = num(); if (b != null) { seg.c2 = a; seg.v2 = b; chap = a; } }
        else seg.v2 = a;
      }
      x = sep();
    }
    segs.push(seg);
    if (x === ',' || x === ';') {
      i++; while (t[i] === ' ') i++;
      const a = num();
      if (a == null) break;
      const y = t[i];
      if (y === ':' || y === '.') { i++; chap = a; v = num(); if (v == null) break; }
      else v = a;
      continue;
    }
    break;
  }
  return { book, segs };
}

/** Human reference text, e.g. "John 3:16–18", using the translation's book names. */
export function refText(names, book, segs) {
  const name = (names && names[book - 1]) || EN[book - 1];
  const parts = [];
  let lastC = null;
  segs.forEach((s) => {
    let p;
    if (s.v1 == null) p = s.c1 === s.c2 ? String(s.c1) : s.c1 + '–' + s.c2;
    else if (s.c1 !== s.c2) p = s.c1 + ':' + s.v1 + '–' + s.c2 + ':' + s.v2;
    else {
      const vv = s.v2 == null ? s.v1 + 'ff' : s.v1 === s.v2 ? String(s.v1) : s.v1 + '–' + s.v2;
      p = lastC === s.c1 ? vv : s.c1 + ':' + vv;
    }
    if (SINGLE_CHAPTER.has(book) && s.v1 != null && s.c1 === s.c2) p = s.v1 === s.v2 ? String(s.v1) : s.v1 + '–' + s.v2;
    lastC = s.c2;
    parts.push(p);
  });
  return name + ' ' + parts.join(', ');
}
