// Verse suggestions while the preacher speaks (Advanced mode).
// The browser's speech recogniser turns the sermon into text; references to Bible verses and hymns are offered
// to the operator as cards ("John 3:16 — Put on Next / Present"). Nothing ever goes on screen by itself.
// Chrome and Edge send the audio to their own speech service, so this needs the internet; it is off by default.
import { h, clear } from './core/util.js';
import { icon } from './core/icons.js';
import { settings } from './core/settings.js';
import { findRefs } from './core/spokenref.js';
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

  const head = h('div.ls-head');
  const list = h('div.ls-list', { 'aria-live': 'polite' });
  const box = h('div.listen-box', { 'aria-label': 'Verse suggestions' }, head, list);

  const lang = () => (settings.v.bible.primary === 'afr53' ? 'af-ZA' : 'en-ZA');
  const afr = () => lang() === 'af-ZA';

  function paintHead() {
    clear(head);
    box.classList.toggle('on', on);
    if (!on) {
      head.append(h('button.btn.ls-start', { type: 'button', title: 'Listen to the sermon and suggest the Bible verses and hymns that are mentioned', onclick: () => start() },
        icon('mic'), h('span', 'Listen for verses')));
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
      ui.toast('This browser cannot listen for verses. Use Chrome or Edge on a PC or Android phone.', 'err', 6000);
      return;
    }
    if (!settings.v.app.listenOk) { explain(); return; }
    on = true; problem = '';
    begin();
    paintHead();
  }
  function explain() {
    ui.modal({
      title: 'Listen for verses',
      body: h('div.col', { style: { gap: '10px' } },
        h('p', 'Church Service listens through the microphone and, when the preacher mentions a Bible verse or a hymn, offers it here. You choose whether to put it on Next or present it. Nothing goes on the screen by itself.'),
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
    clearTimeout(restartT);
    if (rec) { try { rec.onend = null; rec.abort(); } catch (e) { /* already stopped */ } rec = null; }
    paintHead();
  }

  // ------------------------------------------------------------ suggestions
  function heard(text, final) {
    const found = findRefs(text);
    found.forEach((r) => offer(r, text, final));
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
    const m = hy.lookup(r.n)[0];
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
    hear(text) { testing = true; heard(text, true); },
  };
}
