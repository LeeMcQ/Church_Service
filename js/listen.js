// Verse and hymn suggestions while the service runs (Advanced mode).
// The browser's speech recogniser turns what is said into text. Bible verses and hymns (by number or by name:
// "let us sing Great Is Thy Faithfulness") are offered to the operator as cards ("John 3:16 — Put on Next /
// Present"). While a hymn is on screen it also follows the singing and offers the stanza being sung.
// Nothing ever goes on screen by itself.
// Chrome and Edge send the audio to their own speech service, so this needs the internet; it is off by default.
import { h, clear } from './core/util.js';
import { icon } from './core/icons.js';
import { settings } from './core/settings.js';
import { findRefs, findHymnTitle, stanzaScores } from './core/spokenref.js';
import { live } from './core/live.js';
import { parseRef, refText, EN, AF } from './core/books.js';
import { versesFor, verseText } from './core/bibledata.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const KEEP_MS = 3 * 60 * 1000;   // a suggestion disappears after three minutes
const REPEAT_MS = 90 * 1000;     // the same reference is not offered again within 90 seconds
const MAX_CARDS = 3;

export function createListener({ ctx, getTab, present, ui }) {
  let on = false, rec = null, restartT = null, problem = '', testing = false;
  const seen = new Map(); // key -> time offered
  const cards = [];       // { key, el, t }
  let hyApi = null;       // the Hymns tab, once loaded (its hymn list is used to find hymns announced by name)
  let music = null;       // hymn music: while it plays, the slides already follow the music
  let sung = '';          // what was heard while the hymn on screen was sung (for following the singing)
  let follow = null;      // { el, i } the "being sung now" card
  const loadHelpers = () => {
    if (!hyApi) getTab('hymns').then(async (t) => { await t.whenReady(); hyApi = t; }).catch(() => {});
    if (!music) import('./core/hymnmusic.js').then((m) => { music = m.music; }).catch(() => {});
  };

  const head = h('div.ls-head');
  const list = h('div.ls-list', { 'aria-live': 'polite' });
  const box = h('div.listen-box', { 'aria-label': 'Verse and hymn suggestions' }, head, list);

  const lang = () => (settings.v.bible.primary === 'afr53' ? 'af-ZA' : 'en-ZA');
  const afr = () => lang() === 'af-ZA';

  function paintHead() {
    clear(head);
    box.classList.toggle('on', on);
    if (!on) {
      head.append(h('button.btn.ls-start', { type: 'button', title: 'Listen to the service: suggests the Bible verses and hymns that are mentioned, and follows the singing', onclick: () => start() },
        icon('mic'), h('span', 'Listen for verses & hymns')));
      return;
    }
    head.append(
      h('span.ls-dot', { 'aria-hidden': 'true' }),
      h('span.ls-state', problem || (cards.length ? 'Listening' : 'Listening for verses and hymns…')),
      h('button.btn.sm.ls-stop', { type: 'button', title: 'Stop listening', onclick: () => stop() }, icon('x'), h('span', 'Stop')));
  }

  // ------------------------------------------------------------ speech
  function start() {
    if (on) return;
    if (!SR) {
      ui.toast('This browser cannot listen. Use Chrome or Edge on a PC or Android phone.', 'err', 6000);
      return;
    }
    if (!settings.v.app.listenOk) { explain(); return; }
    on = true; problem = '';
    loadHelpers();
    begin();
    paintHead();
  }
  function explain() {
    ui.modal({
      title: 'Listen for verses and hymns',
      body: h('div.col', { style: { gap: '10px' } },
        h('p', 'Church Service listens through the microphone. When a Bible verse or a hymn is mentioned (by number, “hymn 100”, or by name, “let us sing Great Is Thy Faithfulness”), it is offered here. While a hymn is on the screen it also follows the singing and offers the stanza being sung.'),
        h('p', 'You choose whether to put it on Next or show it. Nothing goes on the screen by itself.'),
        h('p.note', 'The browser turns speech into text with its own online speech service (Google for Chrome, Microsoft for Edge), so it needs the internet while it listens. It only listens while “Listening” shows, and you can stop it at any time.'),
        h('p.note', 'Language: ' + (afr() ? 'Afrikaans' : 'English') + ' (follows your main Bible in Settings).')),
      actions: [{ label: 'Cancel' }, { label: 'Start listening', primary: true, onclick: () => { settings.set('app.listenOk', true); start(); } }],
    });
  }
  function begin() {
    try {
      rec = new SR();
      rec.lang = lang();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          heard(r[0].transcript, r.isFinal);
        }
        if (problem) { problem = ''; paintHead(); }
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          stop();
          ui.toast('The microphone is blocked for Church Service. Allow it with the lock icon in the address bar, then try again.', 'err', 8000);
        } else if (e.error === 'network') { problem = 'No internet: listening paused'; paintHead(); }
        else if (e.error === 'audio-capture') { problem = 'No microphone found'; paintHead(); }
      };
      // Chrome stops after a pause in speech: start again while listening is on.
      rec.onend = () => { rec = null; if (on) { clearTimeout(restartT); restartT = setTimeout(() => { if (on && !rec) begin(); }, problem ? 4000 : 300); } };
      rec.start();
    } catch (err) {
      rec = null;
      if (on) { clearTimeout(restartT); restartT = setTimeout(() => { if (on && !rec) begin(); }, 2000); }
    }
  }
  function stop() {
    on = false; problem = '';
    sung = ''; clearFollow();
    clearTimeout(restartT);
    if (rec) { try { rec.onend = null; rec.abort(); } catch (e) { /* already stopped */ } rec = null; }
    paintHead();
  }

  // ------------------------------------------------------------ suggestions
  function heard(text, final) {
    const found = findRefs(text);
    found.forEach((r) => offer(r, text, final));
    // A hymn announced by name ("our closing hymn is Blessed Assurance"): only on the finished sentence.
    if (final && hyApi && !found.some((r) => r.kind === 'hymn')) {
      const c = hyApi.catalog();
      const m = findHymnTitle(text, c.list);
      if (m) offer({ kind: 'hymn', n: m.n, book: c.id }, text, final);
    }
    followSinging(text, final);
  }

  // ------------------------------------------------------------ following the singing
  const slideLabel = (lab) => (lab === 'T' ? 'Title' : /^C/.test(lab) ? 'Chorus' : 'Verse ' + String(lab || '').replace(/a$/, ''));
  function clearFollow() { if (follow) { follow.el.remove(); follow = null; } }
  live.on('live', () => { sung = ''; clearFollow(); }); // another item on screen: start listening afresh
  live.on('go', () => { if (follow && follow.i === live.index) clearFollow(); });

  function followSinging(text, final) {
    const cue = live.cue;
    if (!cue || cue.tab !== 'hymns' || !cue.cards || !(on || testing)) return;
    if (music && music.isPlaying() && music.hymnKey === cue.hymnKey) return; // the music already moves the slides
    const recent = (sung + ' ' + text).slice(-400);
    if (final) sung = recent;
    const slides = cue.cards.map((c) => (c.p && c.p.kind === 'title' ? null : c.lines));
    const { scores, best } = stanzaScores(recent, slides);
    if (best < 2) return;
    const tops = scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    if (tops.includes(live.index)) { clearFollow(); return; } // already showing what is sung
    const i = tops.find((x) => x > live.index) ?? tops[0]; // a chorus sung again: the next one
    if (follow && follow.i === i) return;
    clearFollow();
    const name = slideLabel(cue.labels && cue.labels[i]);
    const first = (cue.cards[i].lines || [])[0] || '';
    const el = h('article.ls-card.ls-follow',
      h('div.ls-k', icon('music'), h('span', 'Being sung now')),
      h('div.ls-ref', name),
      first ? h('div.ls-peek', first) : null,
      h('div.ls-act',
        h('button.btn.primary', { type: 'button', onclick: () => { if (live.cue === cue) live.go(i); clearFollow(); } }, icon('next'), h('span', 'Show ' + name.toLowerCase())),
        h('button.btn.icon', { type: 'button', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => clearFollow() }, icon('x'))));
    follow = { el, i };
    list.prepend(el);
    paintHead();
  }

  async function offer(r, text, final) {
    const key = r.kind === 'hymn' ? 'h' + r.n : 'b' + r.ref;
    const now = Date.now();
    if (seen.has(key) && now - seen.get(key) < REPEAT_MS) return;
    // Wait for the finished sentence before offering a whole chapter: "John 3" usually becomes "John 3:16".
    if (r.kind === 'bible' && r.v == null && !final) return;
    seen.set(key, now);
    let card = null;
    if (r.kind === 'bible') card = await bibleCard(r, text);
    else card = await hymnCard(r, text);
    if (!card || !(on || testing)) return;
    // A verse replaces the bare chapter offered a moment ago ("John 3" -> "John 3:16").
    if (r.kind === 'bible' && r.v != null) {
      const ch = 'b' + EN[r.book - 1] + ' ' + r.c;
      const old = cards.find((c) => c.key === ch && now - c.t < 20000);
      if (old) drop(old);
    }
    const entry = { key, el: card, t: now };
    entry.timer = setTimeout(() => drop(entry), KEEP_MS);
    cards.unshift(entry);
    list.prepend(card);
    while (cards.length > MAX_CARDS) drop(cards[cards.length - 1]);
    paintHead();
  }
  function drop(entry) {
    const i = cards.indexOf(entry);
    if (i >= 0) cards.splice(i, 1);
    clearTimeout(entry.timer);
    entry.el.remove();
    paintHead();
  }
  const quote = (text) => {
    const t = String(text || '').trim().replace(/\s+/g, ' ');
    return '“…' + (t.length > 70 ? t.slice(t.length - 70).replace(/^\S*\s/, '') : t) + '”';
  };

  function cardEl(kind, label, peek, text, stageIt) {
    const entry = () => cards.find((c) => c.el === el);
    const run = async (andShow) => {
      try {
        const c = await stageIt();
        if (!c) return;
        if (andShow) await present(); else ui.toast(label + ' is on Next. Press Present (F5) to show it.', 'ok', 2600);
        const e = entry(); if (e) drop(e);
      } catch (err) { ui.toast('Could not open ' + label + ': ' + err.message, 'err'); }
    };
    const el = h('article.ls-card',
      h('div.ls-k', icon(kind === 'hymn' ? 'hymn' : 'bible'), h('span', kind === 'hymn' ? 'Hymn' : 'Bible'), h('span.ls-heard', quote(text))),
      h('div.ls-ref', label),
      peek ? h('div.ls-peek', peek) : null,
      h('div.ls-act',
        h('button.btn.primary', { type: 'button', onclick: () => run(false) }, h('span', 'Put on Next')),
        h('button.btn', { type: 'button', onclick: () => run(true) }, icon('present'), h('span', 'Present')),
        h('button.btn.icon', { type: 'button', title: 'Dismiss', 'aria-label': 'Dismiss ' + label, onclick: () => { const e = entry(); if (e) drop(e); } }, icon('x'))));
    return el;
  }

  async function bibleCard(r, text) {
    const pr = parseRef(r.ref);
    if (!pr) return null;
    const tr = settings.v.bible.primary;
    let vs = [];
    try { vs = await versesFor(tr, pr.book, pr.segs); } catch (e) { vs = []; }
    if (!vs.length) return null; // no such chapter or verse: probably misheard
    const label = refText(afr() ? AF : EN, pr.book, pr.segs);
    const t = verseText(vs[0].text);
    const peek = r.v == null ? 'Whole chapter' : t.length > 120 ? t.slice(0, t.lastIndexOf(' ', 120)) + '…' : t;
    return cardEl('bible', label, peek, text, async () => (await getTab('bible')).open({ ref: r.ref }));
  }

  async function hymnCard(r, text) {
    let hy;
    try { hy = await getTab('hymns'); await hy.whenReady(); } catch (e) { return null; }
    const all = hy.lookup(r.n);
    const m = (r.book && all.find((x) => x.bookId === r.book)) || all[0];
    if (!m) return null;
    return cardEl('hymn', 'Hymn ' + m.n + ' · ' + m.t, m.book, text, async () => hy.open({ n: m.n, book: m.bookId }));
  }

  paintHead();
  return {
    el: box,
    get on() { return on; },
    supported: !!SR,
    start, stop,
    toggle() { if (on) stop(); else start(); },
    /** For tests: offer what a sentence mentions, as if it had been heard. */
    hear(text) { testing = true; loadHelpers(); heard(text, true); },
    /** For tests: load what hymns by name and following the singing need. */
    ready: async () => { loadHelpers(); const t = await getTab('hymns'); await t.whenReady(); hyApi = t; },
  };
}
