// Finds Bible references and hymn numbers in spoken text, as a speech recogniser writes it down:
// "John chapter three verse sixteen", "Romans 8 28", "first Corinthians thirteen", "Psalm 23",
// "let us sing hymn number one hundred", "Johannes drie vers sestien", "lied nommer 73".
// Pure functions (no DOM), so they can be tested on their own.
import { EN, AF } from './books.js';

const UNITS = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  // Afrikaans
  nul: 0, een: 1, twee: 2, drie: 3, vier: 4, vyf: 5, ses: 6, sewe: 7, agt: 8, ag: 8, nege: 9, tien: 10,
  elf: 11, twaalf: 12, dertien: 13, veertien: 14, vyftien: 15, sestien: 16, sewentien: 17, agtien: 18, agttien: 18, negentien: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  twintig: 20, dertig: 30, veertig: 40, vyftig: 50, sestig: 60, sewentig: 70, tagtig: 80, negentig: 90,
};
const HUNDRED = new Set(['hundred', 'honderd']);
const ORDINAL = { first: '1', second: '2', third: '3', '1st': '1', '2nd': '2', '3rd': '3', eerste: '1', tweede: '2', derde: '3' };
const CHAPTER = new Set(['chapter', 'chapters', 'hoofstuk', 'hoofstukke']);
const VERSE = new Set(['verse', 'verses', 'vers', 'verse', 'versie', 'v']);
const RANGE = new Set(['to', 'through', 'thru', 'until', 'till', 'tot', 'and', 'en', '-']);
const HYMN = new Set(['hymn', 'hymns', 'hymne', 'lied', 'gesang']);
const NUMBER_WORD = new Set(['number', 'no', 'nommer', 'nr']);

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Book names as word lists, longest first: "song of solomon", "1 corinthians", "johannes", plus spoken forms. */
let BOOKS = null;
function bookList() {
  if (BOOKS) return BOOKS;
  const out = [];
  const add = (name, n) => { const w = fold(name).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); if (w.length) out.push({ w, n }); };
  EN.forEach((x, i) => add(x, i + 1));
  AF.forEach((x, i) => add(x, i + 1));
  [['psalm', 19], ['revelations', 66], ['song of songs', 22], ['songs', 22], ['philippians', 50], ['matthews', 40],
    ['esegiel', 26], ['daniel', 27], ['joel', 29], ['korintiers', 46], ['psalm', 19], ['psalms', 19], ['the psalms', 19]]
    .forEach(([x, n]) => add(x, n));
  // "1 corinthians" may also arrive as "corinthians 1"? No: only the usual order is accepted.
  out.sort((a, b) => b.w.length - a.w.length);
  BOOKS = out;
  return out;
}

/** Text to tokens: lower case, no accents, "3:16" split into 3 : 16, words and digits kept. */
function tokens(text) {
  return fold(text)
    .replace(/(\d)\s*[:.]\s*(\d)/g, '$1 : $2')
    .replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 - $2')
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/[^a-z0-9:\- ]+/g, ' ')
    .split(/\s+/).filter(Boolean);
}

/** A number spoken as words starting at t[i] ("twenty three", "one hundred and five", "een en twintig"). */
function wordNumber(t, i) {
  const under100 = (j) => {
    const a = t[j];
    if (a in TENS) {
      let v = TENS[a], k = j + 1;
      if (t[k] in UNITS && UNITS[t[k]] > 0 && UNITS[t[k]] < 10) { v += UNITS[t[k]]; k++; }
      return { v, k };
    }
    if (a in UNITS) {
      let v = UNITS[a], k = j + 1;
      // Afrikaans: "een en twintig" = 21
      if (v > 0 && v < 10 && t[k] === 'en' && t[k + 1] in TENS) { v += TENS[t[k + 1]]; k += 2; }
      return { v, k };
    }
    return null;
  };
  let first = under100(i), v, k;
  if (first && HUNDRED.has(t[first.k])) { v = first.v * 100; k = first.k + 1; }
  else if (HUNDRED.has(t[i]) || (t[i] === 'a' && HUNDRED.has(t[i + 1]))) { v = 100; k = i + (t[i] === 'a' ? 2 : 1); }
  else return first;
  if ((t[k] === 'and' || t[k] === 'en') && under100(k + 1)) k++;
  const rest = under100(k);
  if (rest) { v += rest.v; k = rest.k; }
  return { v, k };
}

/** Spoken words to digits: ["john","three","sixteen"] -> ["john","3","16"]. Ordinals before a book become 1/2/3. */
export function normalizeSpoken(text) {
  const t = tokens(text);
  const out = [];
  for (let i = 0; i < t.length;) {
    if (t[i] in ORDINAL) { out.push(ORDINAL[t[i]]); i++; continue; }
    const n = /^\d+$/.test(t[i]) ? null : wordNumber(t, i);
    if (n) { out.push(String(n.v)); i = n.k; continue; }
    out.push(t[i]); i++;
  }
  return out;
}

const isNum = (x) => /^\d{1,3}$/.test(x || '');

/**
 * Every Bible reference and hymn number in the text, in the order spoken.
 * Bible: { kind: 'bible', book, c, v, v2, ref }  (v null = whole chapter; ref uses English names: "John 3:16-18")
 * Hymn:  { kind: 'hymn', n }
 */
export function findRefs(text) {
  const t = normalizeSpoken(text);
  const out = [];
  const books = bookList();
  for (let i = 0; i < t.length; i++) {
    // Hymn: "hymn 100", "hymn number 100", "lied nommer 73"
    if (HYMN.has(t[i])) {
      let j = i + 1;
      if (NUMBER_WORD.has(t[j])) j++;
      if (isNum(t[j]) && +t[j] > 0) { out.push({ kind: 'hymn', n: +t[j] }); i = j; }
      continue;
    }
    // Bible: a book name followed by a chapter number.
    let hit = null;
    for (const b of books) {
      if (b.w.every((w, k) => t[i + k] === w)) { hit = b; break; }
    }
    if (!hit) continue;
    let j = i + hit.w.length;
    if (CHAPTER.has(t[j])) j++;
    if (!isNum(t[j]) || +t[j] === 0) continue;
    const c = +t[j]; j++;
    let v = null, v2 = null;
    // ":" / "verse" / "and verse" / a bare second number
    let k = j;
    if (t[k] === 'and' && VERSE.has(t[k + 1])) k++;
    if (t[k] === ':' || VERSE.has(t[k])) k++;
    if (isNum(t[k]) && +t[k] > 0) { v = +t[k]; j = k + 1; }
    if (v != null) {
      let r = j;
      if (RANGE.has(t[r])) r++;
      if (VERSE.has(t[r])) r++;
      if (r > j && isNum(t[r]) && +t[r] > v) { v2 = +t[r]; j = r + 1; }
    }
    const n = hit.n;
    const one = n === 31 || n === 57 || n === 63 || n === 64 || n === 65; // one-chapter books: "Jude 3" is a verse
    let ref;
    if (one && v == null) ref = EN[n - 1] + ' ' + c;
    else ref = EN[n - 1] + ' ' + c + (v != null ? ':' + v + (v2 ? '-' + v2 : '') : '');
    out.push({ kind: 'bible', book: n, c: one && v == null ? 1 : c, v: one && v == null ? c : v, v2, ref });
    i = j - 1;
  }
  return out;
}
