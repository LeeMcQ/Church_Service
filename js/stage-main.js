// Stage screen (stage.html): what the people on the platform follow — the slide on screen and what
// comes next, the words in large type, speaker notes, the time, timers, messages from the media desk
// and the order of service. Nothing here is ever shown to the congregation.
//
// It connects to the operator's SDA Sabbath in one of four ways:
//   ?via=win     a window opened by the app on another screen (or the preview inside Tools → Stage)
//   ?via=cast    a Chromecast / Google TV started from the app (Presentation API)
//   ?via=lan     the SDA Sabbath companion on the church network (works without internet)
//   #c=CODE      phones, tablets and laptops anywhere: the room code (or QR code) from the media desk
import { h, clear, pad2, uid } from './core/util.js';
import { icon } from './core/icons.js';
import { createStage, fitBody, sanitizeSlideHtml } from './core/render.js';
import { createEncoder, createDecoder } from './core/wire.js';
import { normCode, fmtCode, joinStageRoom, relaysFrom, createFollower, forgetHost, canVerify } from './core/stagenet.js';

const params = new URLSearchParams(location.search);
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const VIA = params.get('via') || '';
const PREVIEW = params.get('preview') === '1';
const SID = uid();
// A random secret for the church-network connection: only the media desk ever sees it, so no other screen
// can send messages in this screen's name (stagehub.js).
const LAN_KEY = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const root = document.getElementById('ss');
if (PREVIEW) root.classList.add('preview');

// ------------------------------------------------------------ this device's own choices
const LKEY = 'selah.stage.local';
let local = {};
try { local = JSON.parse(localStorage.getItem(LKEY) || '{}') || {}; } catch (e) { local = {}; }
if (!local.pins || typeof local.pins !== 'object') local.pins = {};
const saveLocal = () => { if (PREVIEW) return; try { localStorage.setItem(LKEY, JSON.stringify(local)); } catch (e) { /* private mode */ } };
// The stage window and cast screen follow the media desk's choices; phones may make their own.
const OWN = !PREVIEW && VIA !== 'cast' && VIA !== 'win';
const LOCAL_KEYS = ['layout', 'textSize', 'showNext', 'showPlan', 'showNotes', 'showLive', 'mirror', 'clock24'];
const opt = (k) => (OWN && local[k] != null ? local[k] : S.cfg[k]);

// ------------------------------------------------------------ state
const S = {
  cfg: { layout: 'full', featured: 'speaker', warnSec: 120, clock24: true, showNext: true, showPlan: true, showNotes: true, showLive: true, textSize: 1, mirror: false, church: '', aspect: 16 / 9, talk: [] },
  style: null, live: null, index: 0, blank: null,
  next: null, nextIndex: 0, nextSame: false,
  timers: [], featured: 'speaker', warnSec: 120,
  offset: 0, msg: null, plan: null, media: null,
  control: false, conn: 'idle', lastHeard: 0, hostLeft: false,
};
const now = () => Date.now() + S.offset;

// ------------------------------------------------------------ layout
// label|short: phones show the short label under the icon ("Previous|Back").
const btn = (ic, label, onclick, cls = '') => {
  const [full, short] = String(label).split('|');
  return h('button.ss-btn' + (short ? '.has-s' : '') + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', title: full, 'aria-label': full, onclick },
    icon(ic), h('span.l', full), short ? h('span.s', short) : null);
};
const dot = h('span.ss-dot');
const statusTxt = h('span.ss-status-t', 'Connecting…');
const churchEl = h('span.ss-church', '');
const clockEl = h('div.ss-clock', { 'aria-label': 'Time' });
const timerBar = h('div.ss-timers');
const talkBtn = btn('msg', 'Talk to the media desk', () => openTalk(), 'ghost');
const menuBtn = btn('settings', 'Screen options', () => openMenu(), 'ghost icon-only');
const fsBtn = btn('fullscreen', 'Full screen', () => toggleFull(), 'ghost icon-only');
const top = h('header.ss-top',
  h('div.ss-who', dot, h('div.ss-who-t', churchEl, statusTxt)),
  clockEl, timerBar, h('div.ss-top-act', talkBtn, menuBtn, fsBtn));

const msgText = h('div.ss-msg-t');
const msgEl = h('div.ss-msg', { role: 'alert', hidden: true }, icon('msg'), msgText);

const nowLabel = h('span.ss-lab-t', '');
const nowPart = h('span.ss-lab-p', '');
const nowHost = h('div.ss-scr-in');
const nowEmpty = h('div.ss-scr-empty', 'Nothing on screen');
const nowScr = h('div.ss-scr.now', nowHost, nowEmpty);
const nowWordsIn = h('div.ss-words-in');
const nowWords = h('div.ss-words', nowWordsIn);
const notesEl = h('div.ss-notes', { hidden: true });
const mediaEl = h('div.ss-media', { hidden: true });
const nowSec = h('section.ss-now', h('div.ss-lab', h('span.ss-tag.live', 'Now'), nowLabel, nowPart), nowScr, mediaEl, nowWords, notesEl);

const nextLabel = h('span.ss-lab-t', '');
const nextPart = h('span.ss-lab-p', '');
const nextHost = h('div.ss-scr-in');
const nextEmpty = h('div.ss-scr-empty', 'Nothing picked yet');
const nextScr = h('div.ss-scr.next', nextHost, nextEmpty);
const nextWordsIn = h('div.ss-words-in');
const nextWords = h('div.ss-words.small', nextWordsIn);
const thenEl = h('div.ss-then', { hidden: true });
const nextSec = h('section.ss-next', h('div.ss-lab', h('span.ss-tag.next', 'Next'), nextLabel, nextPart), nextScr, nextWords, thenEl);

const planList = h('ol.ss-plan-l');
const planName = h('span.ss-lab-t', '');
const planSec = h('section.ss-plan', h('div.ss-lab', h('span.ss-tag', 'Order of service'), planName), planList);

const bigName = h('div.ss-big-n', '');
const bigTime = h('div.ss-big-t', '');
const bigClock = h('div.ss-big-c', '');
const bigSec = h('section.ss-big', bigName, bigTime, bigClock);

const main = h('main.ss-main', nowSec, nextSec, planSec, bigSec);

const ctrlTimerBtn = btn('play', 'Start timer', () => cmd('timer', { id: featuredId(), arg: 'toggle' }));
let ctrlTimerGroup = null;
const ctrl = h('footer.ss-ctrl', { hidden: true },
  h('div.ss-ctrl-g',
    btn('prev', 'Previous|Back', () => cmd('prev'), 'big'),
    btn('next', 'Next', () => cmd('next'), 'big primary'),
    btn('present', 'Show Next|Show', () => cmd('present')),
    btn('black', 'Black', () => cmd('black')),
    btn('logo', 'Logo', () => cmd('logo')),
    btn('clear', 'Clear', () => cmd('clear'))),
  ctrlTimerGroup = h('div.ss-ctrl-g',
    ctrlTimerBtn,
    btn('plus', '+1 min', () => cmd('timer', { id: featuredId(), arg: 'add', val: 60000 })),
    btn('minus', '−1 min', () => cmd('timer', { id: featuredId(), arg: 'add', val: -60000 })),
    btn('reload', 'Reset timer|Reset', () => cmd('timer', { id: featuredId(), arg: 'reset' }))));

const toastEl = h('div.ss-toast', { role: 'status', hidden: true });
root.append(top, msgEl, main, ctrl, toastEl);

let toastT = null;
function toast(text, ms = 2600) {
  root.style.setProperty('--ctrl-h', (ctrl.hidden ? 0 : ctrl.offsetHeight) + 'px');
  toastEl.textContent = text; toastEl.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, ms);
}

// Slide pictures use the projector's own renderer, so the stage sees exactly what the hall sees.
const nowStage = createStage(nowHost, { placeholderOnly: true });
const nextStage = createStage(nextHost, { placeholderOnly: true });

// ------------------------------------------------------------ helpers for slides
const frameOf = (cue, i) => {
  if (!cue || !cue.deck) return null;
  const d = cue.deck;
  if (d.frames && d.frames.length) return d.frames[Math.max(0, Math.min(i || 0, d.frames.length - 1))];
  return d.frame || null;
};
const countOf = (cue) => (cue && cue.deck && cue.deck.frames ? cue.deck.frames.length : cue ? 1 : 0);
function slideName(cue, i) {
  if (!cue || countOf(cue) < 2 || !cue.labels) return '';
  const lab = cue.labels[Math.max(0, Math.min(i || 0, cue.labels.length - 1))];
  if (!lab) return '';
  if (cue.tab === 'hymns') return lab === 'T' ? 'Title' : /^C[a-f]?$/.test(lab) ? 'Chorus' : 'Verse ' + lab;
  return cue.tab === 'bible' ? 'v. ' + lab : String(lab);
}
/** Words of a slide as plain lines (nothing from the slide is ever inserted as HTML here). */
function htmlLines(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html || '');
  t.content.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  // Hymn lines (span.ln), the hymn number (span.hn) and author line (span.ha) are separate on screen.
  t.content.querySelectorAll('.ln').forEach((b) => b.append('\n'));
  t.content.querySelectorAll('.hn').forEach((b) => b.append(' '));
  t.content.querySelectorAll('.ha').forEach((b) => b.prepend('\n'));
  // Verse numbers (sup / .vn) keep a space before and a no-break space after: "16 For God …".
  t.content.querySelectorAll('sup, .vn').forEach((s) => s.replaceWith(' ' + s.textContent.trim() + '\u00a0'));
  t.content.querySelectorAll('p,div,li,h1,h2,h3,h4').forEach((b) => b.append('\n'));
  return t.content.textContent.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function frameText(f) {
  if (!f) return '';
  if (f.kind === 'text') {
    const parts = [];
    if (f.cols && f.cols.length) f.cols.forEach((c) => parts.push(htmlLines(c.html)));
    else parts.push(htmlLines(f.html));
    return parts.filter(Boolean).join('\n\n');
  }
  if (f.kind === 'banner') return [f.kicker, f.title, f.text].filter(Boolean).join('\n');
  if (f.kind === 'html') return htmlLines(f.html).slice(0, 600);
  return '';
}
function frameRef(f) { return f && f.kind === 'text' ? [f.foot, f.footR].filter(Boolean).join(' · ') : ''; }
const KIND_LABEL = { video: 'Video', stream: 'Screen share', web: 'Web page', image: 'Picture', html: 'Slide', audio: 'Music' };
// Slide decks from a stage device (anyone with the room code) are cleaned like imported slides.
function cleanCue(cue) {
  if (!cue || VIA === 'win' || !cue.deck || !Array.isArray(cue.deck.frames)) return cue;
  cue.deck.frames.forEach((f) => {
    if (!f || typeof f !== 'object') return;
    if (typeof f.html === 'string') f.html = sanitizeSlideHtml(f.html);
    if (Array.isArray(f.cols)) f.cols.forEach((c) => { if (c && typeof c.html === 'string') c.html = sanitizeSlideHtml(c.html); });
  });
  return cue;
}

function fillWords(box, inner, text, ref, max) {
  clear(inner);
  const lines = h('div.ss-w');
  String(text || '').split('\n').forEach((l, i, a) => { lines.append(l); if (i < a.length - 1) lines.append(h('br')); });
  inner.append(lines);
  if (ref) inner.append(h('div.ss-w-ref', ref));
  requestAnimationFrame(() => fitBody(box, 14, max));
}

// ------------------------------------------------------------ painting
function paintLayout() {
  const lay = opt('layout') || 'full';
  root.className = root.className.replace(/\blay-\S+/g, '').trim() + ' lay-' + lay;
  root.classList.toggle('no-next', !opt('showNext'));
  root.classList.toggle('no-plan', !opt('showPlan') || !(S.plan && S.plan.items && S.plan.items.length));
  root.classList.toggle('no-notes', !opt('showNotes'));
  root.classList.toggle('no-live', !opt('showLive'));
  root.classList.toggle('mirror', !!opt('mirror'));
  root.style.setProperty('--ts', String(Math.max(0.6, Math.min(2, +opt('textSize') || 1))));
  churchEl.textContent = S.cfg.church || 'Stage';
  requestAnimationFrame(() => { nowStage.fit(); nextStage.fit(); paintWords(); });
}

function paintNow() {
  const c = S.live;
  const f = frameOf(c, S.index);
  nowLabel.textContent = c ? c.title : 'Nothing on screen';
  const n = countOf(c);
  let part = slideName(c, S.index);
  if (part === String(S.index + 1)) part = ''; // picture slides are labelled by number only: "3 / 7" says it
  nowPart.textContent = c ? [part, n > 1 ? (S.index + 1) + ' / ' + n : '', S.blank === 'black' ? 'Black screen' : S.blank === 'logo' ? 'Logo showing' : ''].filter(Boolean).join(' · ') : (S.blank === 'logo' ? 'Logo showing' : '');
  nowSec.classList.toggle('blanked', !!S.blank);
  nowEmpty.hidden = !!c || S.blank === 'logo';
  nowEmpty.textContent = S.blank === 'black' ? 'Black screen' : 'Nothing on screen';
  // A picture, PowerPoint, video or web page has no words to show large: the Words layout shows the picture.
  root.classList.toggle('nontext', !!f && f.kind !== 'text' && f.kind !== 'banner');
  nowStage.setBlank(S.blank);
  nowStage.show(c ? f : null);
  const notes = f && f.notes ? String(f.notes) : '';
  notesEl.textContent = notes; notesEl.hidden = !notes;
  paintWords();
  paintMedia();
  paintNext();
}

function nextInfo() {
  const c = S.live;
  // The operator picked a particular slide of the item on screen (e.g. the chorus again): that one.
  if (c && S.nextSame && S.nextIndex !== S.index && S.nextIndex < countOf(c)) return { cue: c, i: S.nextIndex, slide: true };
  // More slides in the item on screen: the next slide of it.
  if (c && S.index < countOf(c) - 1 && (S.nextSame || !S.next || S.next.id === c.id)) return { cue: c, i: S.index + 1, slide: true };
  if (c && S.index < countOf(c) - 1) return { cue: c, i: S.index + 1, slide: true, then: S.next };
  if (S.nextSame || (S.next && c && S.next.id === c.id)) return null; // end of the item, nothing else picked yet
  if (S.next) return { cue: S.next, i: S.nextIndex || 0, slide: false };
  return null;
}
function paintNext() {
  const ni = nextInfo();
  nextEmpty.hidden = !!ni;
  nextEmpty.textContent = S.live ? 'End of this item' : 'Nothing picked yet';
  if (!ni) {
    nextLabel.textContent = S.live ? 'End of “' + S.live.title + '”' : 'Nothing picked yet';
    nextPart.textContent = '';
    nextStage.show(null);
    thenEl.hidden = true;
  } else {
    const f = frameOf(ni.cue, ni.i);
    nextLabel.textContent = ni.slide ? 'Next slide' : ni.cue.title;
    let part = slideName(ni.cue, ni.i);
    if (part === String(ni.i + 1)) part = String(ni.i + 1) + ' / ' + countOf(ni.cue);
    nextPart.textContent = [part, !ni.slide && f && KIND_LABEL[f.kind] && f.kind !== 'text' ? KIND_LABEL[f.kind] : ''].filter(Boolean).join(' · ');
    nextStage.show(f);
    thenEl.hidden = !ni.then;
    if (ni.then) thenEl.textContent = 'Then: ' + ni.then.title;
  }
  paintWords();
}

function paintWords() {
  const c = S.live;
  const f = frameOf(c, S.index);
  let text = '', ref = '';
  if (!c) text = S.blank === 'logo' ? '' : '';
  else if (S.blank === 'black') text = '';
  else { text = frameText(f); ref = frameRef(f); if (!text && f && f.notes) text = String(f.notes); }
  nowWords.classList.toggle('is-black', !!c && S.blank === 'black');
  const ts = Math.max(0.6, Math.min(2, +opt('textSize') || 1));
  const lay = opt('layout');
  fillWords(nowWords, nowWordsIn, text, ref, (lay === 'words' ? 200 : 64) * ts);
  const ni = nextInfo();
  const nf = ni ? frameOf(ni.cue, ni.i) : null;
  fillWords(nextWords, nextWordsIn, nf ? frameText(nf) || '' : '', '', (lay === 'words' ? 80 : 40) * ts);
}

function paintMedia() {
  const m = S.media, f = frameOf(S.live, S.index);
  if (!m || !f || f.kind !== 'video' || !(m.dur > 0)) { mediaEl.hidden = true; return; }
  const played = m.time + (m.paused ? 0 : Math.max(0, (now() - m.now) / 1000));
  const left = Math.max(0, m.dur - played);
  mediaEl.hidden = false;
  mediaEl.textContent = (m.paused ? 'Video paused · ' : 'Video · ') + fmtClockDur(left * 1000) + ' left';
}

function paintPlan() {
  clear(planList);
  const p = S.plan;
  planName.textContent = p && p.name ? p.name : '';
  if (p && Array.isArray(p.items)) {
    let curEl = null;
    p.items.slice(0, 80).forEach((it) => {
      const li = h('li.ss-pi' + (it.st ? '.' + it.st : ''),
        h('span.ss-pi-t', it.t || ''),
        it.m ? h('span.ss-pi-m', it.m) : null,
        it.role ? h('span.ss-pi-r', it.role) : null,
        it.mins ? h('span.ss-pi-d', it.mins + ' min') : null);
      if (it.st === 'now' || (!curEl && it.st === 'next')) curEl = li;
      planList.append(li);
    });
    if (curEl) requestAnimationFrame(() => { try { curEl.scrollIntoView({ block: 'center' }); } catch (e) { /* */ } });
  }
  paintLayout();
}

function paintMsg() {
  const m = S.msg;
  const on = !!(m && m.text && (!m.until || now() < m.until));
  msgEl.hidden = !on;
  root.classList.toggle('has-msg', on);
  if (on) { msgText.textContent = m.text; msgEl.classList.toggle('flash', !!m.flash); }
}

// ------------------------------------------------------------ clock and timers
function fmtClockDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? hh + ':' + pad2(mm) + ':' + pad2(ss) : mm + ':' + pad2(ss);
}
function timerValue(t, n) {
  if (t.mode === 'down') return t.running ? t.endAt - n : (t.left != null ? t.left : t.dur || 0);
  if (t.mode === 'up') return t.running ? n - t.startAt : t.elapsed || 0;
  if (t.mode === 'to') { const m = /^(\d{1,2}):(\d{2})$/.exec(t.at || ''); if (!m) return 0; const d = new Date(n); d.setHours(+m[1], +m[2], 0, 0); return d.getTime() - n; }
  return 0;
}
/** Count-downs show whole seconds rounded up (30:00 at the start); past zero they show the overtime. */
function fmtTimer(t, n) {
  const v = timerValue(t, n);
  if (t.mode === 'up') return { text: fmtClockDur(v), state: '' };
  if (v > 0) {
    const s = Math.ceil(v / 1000);
    return { text: fmtClockDur(s * 1000), state: s <= (S.warnSec || 120) ? 'warn' : '' };
  }
  return { text: '+' + fmtClockDur(-v), state: 'over' };
}
const featuredId = () => (S.timers.find((t) => t.id === S.featured) ? S.featured : (S.timers[0] && S.timers[0].id) || '');
function fmtClock(d) {
  const h24 = opt('clock24') !== false;
  let hh = d.getHours();
  const ap = hh < 12 ? 'am' : 'pm';
  if (!h24) hh = hh % 12 || 12;
  return { hm: (h24 ? pad2(hh) : hh) + ':' + pad2(d.getMinutes()), s: pad2(d.getSeconds()), ap: h24 ? '' : ap };
}
let lastTimersKey = '';
function tick() {
  const n = now();
  const c = fmtClock(new Date(n));
  clockEl.replaceChildren(h('span.hm', c.hm), h('span.s', c.s), c.ap ? h('span.ap', c.ap) : '');
  bigClock.textContent = c.hm + (c.ap ? ' ' + c.ap : '');
  // Timers bar: the featured timer first, large.
  const fid = featuredId();
  const list = S.timers.slice().sort((a, b) => (a.id === fid ? -1 : b.id === fid ? 1 : 0));
  const key = list.map((t) => t.id + t.name + t.label + t.mode).join('|');
  if (key !== lastTimersKey) {
    lastTimersKey = key;
    clear(timerBar);
    list.forEach((t) => timerBar.append(h('div.ss-tm' + (t.id === fid ? '.feat' : ''), { 'data-id': t.id }, h('span.ss-tm-n', t.label || t.name), h('span.ss-tm-v', ''))));
  }
  list.forEach((t) => {
    const el = timerBar.querySelector('[data-id="' + CSS.escape(t.id) + '"]');
    if (!el) return;
    const f = fmtTimer(t, n);
    el.lastChild.textContent = f.text;
    // Not by colour alone: the name also says LOW / OVER.
    const nm = (t.label || t.name) + (f.state === 'warn' ? ' · low' : f.state === 'over' ? ' · over' : '');
    if (el.firstChild.textContent !== nm) el.firstChild.textContent = nm;
    el.classList.toggle('warn', f.state === 'warn');
    el.classList.toggle('over', f.state === 'over');
    el.classList.toggle('stopped', !t.running && t.mode !== 'to');
  });
  const ft = S.timers.find((t) => t.id === fid);
  if (ft) {
    const f = fmtTimer(ft, n);
    bigName.textContent = (ft.label || ft.name) + (f.state === 'warn' ? ' · little time left' : f.state === 'over' ? ' · over time' : '');
    // An "ends at" clock cannot be started, paused or changed by a minute.
    ctrlTimerGroup.hidden = ft.mode === 'to';
    bigTime.textContent = f.text;
    bigSec.classList.toggle('warn', f.state === 'warn');
    bigSec.classList.toggle('over', f.state === 'over');
    bigSec.classList.toggle('stopped', !ft.running && ft.mode !== 'to');
    const tl = (ft.running ? 'Pause ' : 'Start ') + (ft.label || ft.name).toLowerCase();
    if (ctrlTimerBtn.title !== tl) { ctrlTimerBtn.replaceChildren(icon(ft.running ? 'pause' : 'play'), h('span', ft.running ? 'Pause' : 'Start')); ctrlTimerBtn.title = tl; ctrlTimerBtn.setAttribute('aria-label', tl); }
  } else { bigName.textContent = ''; bigTime.textContent = ''; }
  if (S.msg && S.msg.until && n >= S.msg.until && !msgEl.hidden) paintMsg();
  paintMedia();
}
setInterval(tick, 250);

// ------------------------------------------------------------ connection status
function setConn(state, text) {
  S.conn = state;
  dot.className = 'ss-dot ' + state;
  dot.setAttribute('role', 'img');
  statusTxt.textContent = text || {
    idle: 'Not connected', connecting: 'Connecting…', waiting: 'Waiting for the media desk…', on: S.control ? 'Connected · controls on' : 'Connected',
    lost: 'Connection lost · reconnecting…', offline: 'No internet',
  }[state] || '';
  root.classList.toggle('is-on', state === 'on');
  dot.title = statusTxt.textContent; dot.setAttribute('aria-label', statusTxt.textContent);
}
setInterval(() => {
  if (S.conn === 'on' && Date.now() - S.lastHeard > 25000) setConn('lost');
}, 2000);

// ------------------------------------------------------------ messages from the media desk
function syncClock(t) { if (typeof t === 'number' && isFinite(t)) { const off = t - Date.now(); S.offset = Math.abs(off - S.offset) > 1500 || !S.synced ? off : S.offset * 0.7 + off * 0.3; S.synced = true; } }
function onMsg(m) {
  if (!m || typeof m !== 'object' || !m.t) return;
  if (m.to && m.to !== SID) return;
  if (left) return; // disconnected by the media desk: the join screen is up
  S.lastHeard = Date.now();
  if (S.conn !== 'on' && m.t !== 'kick') { setConn('on'); hideJoin(); }
  switch (m.t) {
    case 'hi': syncClock(m.now); break;
    case 'ping': syncClock(m.now); if (VIA === 'lan') send({ t: 'alive' }); break;
    case 'host': hello(); break;
    case 'you': {
      const had = S.control;
      S.control = !!m.control;
      ctrl.hidden = !S.control || PREVIEW;
      root.classList.toggle('can-control', S.control && !PREVIEW);
      const why = m.denied === 'pin' ? 'That PIN is not right.' : m.denied === 'wait' ? 'Too many tries. Wait a minute and try again.' : m.denied === 'control' ? 'This screen may only follow. Ask the media desk for control.' : '';
      if (why && pinErr && pinErr.isConnected) { pinErr.textContent = why; } else if (why) toast(why);
      if (S.control && !had && pendingPin) { local.pins[pinKey()] = pendingPin; saveLocal(); }
      if (S.control && !had && pinErr && pinErr.isConnected) closeSheet();
      if (S.control && !had && !PREVIEW && VIA !== 'win') toast('You can now change slides and timers from here.');
      if (!S.control && had && !m.denied) toast('Control was turned off by the media desk.');
      pendingPin = null;
      setConn('on');
      break;
    }
    case 'cfg': S.cfg = Object.assign({}, S.cfg, m.cfg || {}); if (m.cfg && m.cfg.aspect) { nowStage.setAspect(m.cfg.aspect); nextStage.setAspect(m.cfg.aspect); } paintLayout(); paintNow(); break;
    case 'style': S.style = m.style || {}; nowStage.applyStyle(S.style); nextStage.applyStyle(S.style); paintNow(); break;
    case 'live': S.live = cleanCue(m.cue); S.index = m.index || 0; S.blank = m.blank || null; S.media = null; paintNow(); break;
    case 'go': S.index = m.index || 0; if (S.blank === 'black') S.blank = null; paintNow(); break;
    case 'blank': S.blank = m.mode || null; paintNow(); break;
    case 'next':
      if (m.same) { S.nextSame = true; S.nextIndex = m.index || 0; }
      else if (m.keep) { S.nextSame = false; S.nextIndex = m.index || 0; }
      else { S.nextSame = false; S.next = cleanCue(m.cue); S.nextIndex = m.index || 0; }
      paintNext();
      break;
    case 'timers': syncClock(m.now); S.timers = Array.isArray(m.list) ? m.list : []; S.featured = m.featured || 'speaker'; S.warnSec = m.warnSec || 120; lastTimersKey = ''; tick(); break;
    case 'msg': S.msg = m.m || null; paintMsg(); if (S.msg && !PREVIEW) beep(); break;
    case 'plan': S.plan = m.plan || null; paintPlan(); break;
    case 'media': syncClock(m.now); S.media = m; paintMedia(); break;
    case 'talked': toast(m.slow ? 'Please wait a moment before sending another message.' : 'Sent to the media desk ✓'); break;
    case 'kick': leave('The media desk disconnected this screen.'); break;
    case 'note': if (m.text) toast(String(m.text).slice(0, 200), 5000); break;
    case 'bye': setConn('waiting', 'The media desk closed SDA Sabbath · waiting…'); break;
    default: break;
  }
}
// A soft two-tone chime when a new message arrives (phones in a pocket; quiet on purpose).
let actx = null;
function beep() {
  if (VIA === 'cast') return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') return;
    [880, 1320].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      const t0 = actx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o.start(t0); o.stop(t0 + 0.32);
    });
  } catch (e) { /* no audio */ }
  if (navigator.vibrate) { try { navigator.vibrate([60, 40, 60]); } catch (e) { /* */ } }
}
document.addEventListener('pointerdown', () => { try { if (actx && actx.state === 'suspended') actx.resume(); else if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* */ } }, { once: true });

// ------------------------------------------------------------ talking back
let tx = { send: () => {} };
let pendingPin = null, pinErr = null, left = false;
/** Where the accepted PIN is remembered: per room code, or per church-network address. */
const pinKey = () => (room ? room.code : VIA + '@' + location.host);
const kindName = () => (VIA === 'win' ? (PREVIEW ? 'preview' : 'window') : VIA === 'cast' ? 'cast' : VIA === 'lan' ? 'lan' : 'peer');
function devName() {
  const ua = navigator.userAgent;
  return /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet') : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux PC' : 'Device';
}
// A stable id for this device, so the media desk can keep control switched off for it after a reload.
if (!local.did) { local.did = uid(); saveLocal(); }
function helloMsg(nonce) {
  const pin = local.pins[pinKey()];
  return { t: 'hello', sid: SID, v: 1, kind: kindName(), name: PREVIEW ? 'Preview' : local.name || '', dev: devName(), did: local.did, pin: pin || undefined, nonce, w: innerWidth, h: innerHeight };
}
function hello() {
  if (follower) { const id = follower.hostId(); if (id) follower.join(id); return; }
  send(helloMsg());
}
function send(m) { try { tx.send(m); } catch (e) { /* not connected */ } }
function cmd(op, extra) {
  if (!S.control) { toast('This screen may only follow. Use “Unlock controls” in the options to enter the PIN.'); return; }
  send(Object.assign({ t: 'cmd', op }, extra || {}));
}

// ------------------------------------------------------------ sheets (talk-back, options)
let sheet = null;
let sheetReturn = null;
function closeSheet() {
  if (!sheet) return;
  sheet.remove(); sheet = null;
  root.classList.remove('sheet-open');
  if (sheetReturn && sheetReturn.isConnected) { try { sheetReturn.focus({ preventScroll: true }); } catch (e) { /* */ } }
  sheetReturn = null;
}
function openSheet(title, ...kids) {
  closeSheet();
  sheetReturn = document.activeElement;
  root.classList.add('sheet-open');
  sheet = h('div.ss-sheet-back', { onclick: (e) => { if (e.target === sheet) closeSheet(); },
    // Tab stays inside the sheet; Esc closes it.
    onkeydown: (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(sheet.querySelectorAll('button,input,textarea,select,[tabindex]:not([tabindex="-1"])')).filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    } },
    h('div.ss-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.ss-sheet-h', h('h2', title), h('button.ss-btn.ghost.icon-only', { type: 'button', 'aria-label': 'Close', onclick: closeSheet }, icon('x'))),
      ...kids));
  root.append(sheet);
  const f = sheet.querySelector('input,textarea');
  const first = (f && !matchMedia('(pointer: coarse)').matches) ? f : sheet.querySelector('.ss-sheet-h button');
  setTimeout(() => { if (first) first.focus(); }, 30);
}
function openTalk() {
  if (S.conn !== 'on') { toast('Not connected to the media desk yet.'); return; }
  const area = h('textarea.ss-field', { rows: 2, maxlength: 300, placeholder: 'Type a message for the media desk…' });
  const go = (text) => { text = String(text || '').trim(); if (!text) return; send({ t: 'talk', text, id: uid() }); closeSheet(); toast('Sending…', 1200); };
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(area.value); } });
  const presets = h('div.ss-chips', ...(S.cfg.talk && S.cfg.talk.length ? S.cfg.talk : ['Ready', 'Need 5 more minutes', 'Microphone problem']).map((p) => h('button.ss-chip', { type: 'button', onclick: () => go(p) }, p)));
  openSheet('Message to the media desk', h('p.ss-note', 'Only the media desk sees this. Tap a quick message or type your own.'), presets, area,
    h('div.ss-row', h('button.ss-btn.primary', { type: 'button', onclick: () => go(area.value) }, icon('send'), h('span', 'Send'))));
}
function seg(options, cur, on) {
  const w = h('div.ss-seg', { role: 'group' });
  const paint = (v) => { clear(w); options.forEach(([val, label]) => w.append(h('button', { type: 'button', 'aria-pressed': String(val === v), onclick: () => { paint(val); on(val); } }, label))); };
  paint(cur);
  return w;
}
function sw(label, key) {
  const inp = h('input', { type: 'checkbox', checked: !!opt(key), onchange: () => { local[key] = inp.checked; saveLocal(); paintLayout(); paintNow(); } });
  return h('label.ss-sw', inp, h('span', label));
}
function openMenu() {
  const kids = [];
  pinErr = null;
  if (!S.control && VIA !== 'win' && VIA !== 'cast') {
    const pin = h('input.ss-field', { inputmode: 'numeric', maxlength: 8, placeholder: 'PIN', autocomplete: 'off', style: 'max-width:140px' });
    pinErr = h('p.ss-err', { role: 'alert' });
    // The sheet stays open until the media desk answers: a wrong PIN is shown right here.
    const go = () => { const p = pin.value.trim(); if (!p) { pin.focus(); return; } pendingPin = p; pinErr.textContent = 'Checking…'; send({ t: 'auth', pin: p }); };
    pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    kids.push(h('div.ss-fl.ss-unlock', h('span', 'Unlock controls (slides and timers)'), h('div.ss-row', pin, h('button.ss-btn.primary', { type: 'button', onclick: go }, icon('unlock'), h('span', 'Unlock'))), pinErr, h('p.ss-note', 'The control PIN is shown at the media desk, in Tools → Stage.')));
  }
  if (OWN) {
    kids.push(h('div.ss-fl', h('span', 'Layout'), seg([['full', 'Full'], ['words', 'Words'], ['slides', 'Slides'], ['timer', 'Timer']], opt('layout'), (v) => { local.layout = v; saveLocal(); paintLayout(); paintNow(); })));
    const pct = h('span.ss-pct', Math.round((+opt('textSize') || 1) * 100) + ' %');
    const size = (d) => { local.textSize = Math.round(Math.max(0.6, Math.min(2, (+opt('textSize') || 1) + d)) * 10) / 10; saveLocal(); paintLayout(); pct.textContent = Math.round(local.textSize * 100) + ' %'; };
    kids.push(h('div.ss-fl', h('span', 'Text size'), h('div.ss-row',
      h('button.ss-btn', { type: 'button', 'aria-label': 'Smaller text', onclick: () => size(-0.1) }, 'A−'), pct,
      h('button.ss-btn', { type: 'button', 'aria-label': 'Larger text', onclick: () => size(0.1) }, 'A+'))));
    kids.push(h('div.ss-sws', sw('Show what comes next', 'showNext'), sw('Show the order of service', 'showPlan'), sw('Show speaker notes', 'showNotes'), sw('Show the slide picture', 'showLive'), sw('24-hour clock', 'clock24'), sw('Mirror (teleprompter glass)', 'mirror')));
    if (LOCAL_KEYS.some((k) => local[k] != null)) kids.push(h('button.ss-btn.ghost', { type: 'button', onclick: () => { LOCAL_KEYS.forEach((k) => delete local[k]); saveLocal(); paintLayout(); paintNow(); closeSheet(); } }, icon('reload'), h('span', 'Use the media desk’s layout')));
    const nm = h('input.ss-field', { value: local.name || '', maxlength: 40, placeholder: 'e.g. Pastor, Pulpit iPad, Choir' });
    kids.push(h('div.ss-fl', h('span', 'Name of this screen'), h('div.ss-row', nm, h('button.ss-btn', { type: 'button', onclick: () => { local.name = nm.value.trim(); saveLocal(); send({ t: 'name', name: local.name }); toast('Saved.'); } }, 'Save'))));
  } else {
    kids.push(h('p.ss-note', 'This screen follows the layout chosen at the media desk (Tools → Stage).'));
  }
  if (room) kids.push(h('div.ss-row', h('span.ss-note', 'Room code ' + fmtCode(room.code)), h('button.ss-btn.ghost', { type: 'button', onclick: () => { closeSheet(); leave(); } }, icon('x'), h('span', 'Leave'))));
  kids.push(h('p.ss-note', 'Keys: → / Page Down next · ← / Page Up back · B black · F full screen · T message the media desk.'));
  openSheet('Screen options', ...kids);
}

// ------------------------------------------------------------ full screen, wake lock, keys
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
async function goFull() {
  const el = document.documentElement;
  try { if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen(); } catch (e) { /* needs a tap */ }
}
function toggleFull() { if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else goFull(); }
if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) fsBtn.hidden = true;
let wake = null;
async function keepAwake() {
  if (wake && !wake.released) return;
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) { /* */ }
}
document.addEventListener('visibilitychange', keepAwake);
document.addEventListener('keydown', (e) => {
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { if (e.key === 'Escape') closeSheet(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === 'Escape') { closeSheet(); return; }
  if (k === 'f' || k === 'F') { toggleFull(); return; }
  if (k === 't' || k === 'T') { e.preventDefault(); openTalk(); return; }
  if (!S.control) return;
  if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); cmd('next'); }
  else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); cmd('prev'); }
  else if (k === 'b' || k === 'B' || k === '.') cmd('black');
  else if (k === 'F5') { e.preventDefault(); cmd('present'); }
});
root.addEventListener('dblclick', (e) => { if (!e.target.closest('button,input,textarea,.ss-sheet')) toggleFull(); });
window.addEventListener('resize', () => { requestAnimationFrame(paintWords); });

// ------------------------------------------------------------ join screen (room code)
let joinEl = null;
function hideJoin() { if (joinEl) { joinEl.remove(); joinEl = null; } }
function showJoin(err, lanAvailable) {
  hideJoin();
  setConn('idle');
  const code = h('input.ss-code', { value: fmtCode(local.code || ''), maxlength: 9, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text', placeholder: 'ABC 123', 'aria-label': 'Room code' });
  const name = h('input.ss-field', { value: local.name || '', maxlength: 40, placeholder: 'Your name or this screen’s name (optional)', 'aria-label': 'Name' });
  const errEl = h('p.ss-err', { role: 'alert' }, err || '');
  const go = () => {
    const c = normCode(code.value);
    if (!c) { errEl.textContent = 'The code has 6 letters and numbers, like K7F Q2M. It is shown at the media desk.'; code.focus(); return; }
    local.code = c; local.name = name.value.trim(); saveLocal();
    try { history.replaceState(null, '', location.pathname + location.search + '#c=' + c); } catch (e) { /* */ }
    joinCode(c);
  };
  code.addEventListener('input', () => { const v = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); code.value = v.length > 3 ? v.slice(0, 3) + ' ' + v.slice(3) : v; errEl.textContent = ''; });
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  joinEl = h('div.ss-join',
    h('div.ss-join-c',
      h('img', { src: 'icons/favicon.svg', alt: '', width: 56, height: 56 }),
      h('h1', 'Stage screen'),
      h('p', 'Follow the service on this device: what is on screen, what comes next, timers and messages from the media desk.'),
      h('label.ss-l', 'Room code'), code,
      h('label.ss-l', 'Name'), name,
      errEl,
      h('button.ss-btn.primary.wide', { type: 'button', onclick: go }, icon('link'), h('span', 'Join')),
      lanAvailable || VIA === 'lan' ? h('button.ss-btn.wide', { type: 'button', onclick: () => { hideJoin(); left = false; viaLan(); } }, icon('pc'), h('span', 'Connect on the church network')) : null,
      h('p.ss-note', 'The code and a QR code are in SDA Sabbath at the media desk: Tools → Stage → Phones & laptops.')));
  root.append(joinEl);
  if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => code.focus(), 50);
}
function leave(why) {
  const r = room; room = null;
  left = true;
  if (r) { try { send({ t: 'bye' }); } catch (e) { /* */ } r.close(); forgetHost(r.code); }
  follower = null;
  if (lanWs) { lanStop = true; try { lanWs.close(); } catch (e) { /* */ } lanWs = null; }
  tx = { send: () => {} };
  S.control = false; ctrl.hidden = true; root.classList.remove('can-control');
  local.code = ''; saveLocal();
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* */ }
  showJoin(why || '');
}

// ------------------------------------------------------------ transports
// 1) A window (or the preview frame) opened by SDA Sabbath on this computer.
function viaWindow() {
  let host = null;
  try { host = window.opener && !window.opener.closed ? window.opener : null; } catch (e) { host = null; }
  if (!host && window.parent !== window) host = window.parent;
  if (!host) return false;
  tx = { send: (m) => host.postMessage(Object.assign({ stage: 1 }, m), location.origin) };
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== host || !e.data || !e.data.t) return;
    if (e.data.stage === 1) { if (e.data.t === 'fullscreen') goFull(); return; }
    onMsg(e.data);
  });
  // The control page was reloaded: say hello again.
  try { const bc = new BroadcastChannel('selah-stage'); bc.onmessage = (e) => { if (e.data && e.data.t === 'who') hello(); }; } catch (e) { /* */ }
  // SDA Sabbath itself was closed (not just reloaded): close this window too after a few seconds.
  if (!PREVIEW && host === window.opener) {
    let gone = 0;
    setInterval(() => { let c = true; try { c = host.closed; } catch (e) { c = true; } gone = c ? gone + 1 : 0; if (gone >= 5) { try { window.close(); } catch (e) { /* */ } } }, 2000);
  }
  setConn('connecting');
  let tries = 0;
  const ask = () => { if (S.conn === 'on' || tries++ > 60) return; hello(); setTimeout(ask, 700); };
  ask();
  if (!PREVIEW) {
    const backToFull = () => { if (!isFull()) goFull(); };
    document.addEventListener('pointerdown', backToFull, { once: true });
  }
  return true;
}

// 2) Cast receiver.
function viaCast() {
  if (!navigator.presentation || !navigator.presentation.receiver) return false;
  setConn('connecting');
  navigator.presentation.receiver.connectionList.then((list) => {
    const setup = (conn) => {
      conn.binaryType = 'arraybuffer';
      const dec = createDecoder(onMsg);
      const enc = createEncoder((s) => conn.send(s), (b) => conn.send(b));
      tx = { send: (m) => enc(m) };
      conn.onmessage = (e) => (typeof e.data === 'string' ? dec.text(e.data) : dec.binary(e.data));
      conn.onclose = conn.onterminate = () => { setConn('lost'); setTimeout(() => { try { window.close(); } catch (e) { /* */ } }, 8000); };
      hello();
    };
    list.connections.forEach(setup);
    list.onconnectionavailable = (e) => setup(e.connection);
  });
  return true;
}

// 3) The SDA Sabbath companion on the church network.
let lanWs = null, lanStop = false;
function viaLan() {
  let wait = 1000;
  lanStop = false;
  setConn('connecting', 'Connecting on the church network…');
  const connect = () => {
    if (lanStop) return;
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws?role=display&room=stage');
    lanWs = ws;
    ws.binaryType = 'arraybuffer';
    const dec = createDecoder(onMsg);
    let enc = null;
    ws.onopen = () => {
      wait = 1000;
      enc = createEncoder((s) => ws.send(s), (b) => ws.send(b));
      tx = { send: (m) => enc && enc(Object.assign({ from: SID, key: LAN_KEY }, m)) };
      setConn('waiting');
      hello();
    };
    ws.onmessage = (e) => (typeof e.data === 'string' ? dec.text(e.data) : dec.binary(e.data));
    ws.onclose = () => { enc = null; if (lanStop) return; if (S.conn === 'on') setConn('lost'); setTimeout(connect, wait); wait = Math.min(wait * 2, 10000); };
  };
  connect();
  return true;
}

// 4) Room code over the internet (peer to peer).
let room = null, follower = null;
async function joinCode(code) {
  hideJoin();
  left = false;
  if (room) { room.close(); room = null; }
  if (!navigator.onLine) { showJoin('This device has no internet. Connect to Wi-Fi or mobile data and try again.'); return; }
  setConn('connecting', 'Joining ' + fmtCode(code) + '…');
  if (!canVerify()) { showJoin('This page must be opened over https (the address from the QR code) to join with a code.'); return; }
  const my = { code };
  room = my;
  let r = null;
  // Slides are accepted only from the media desk that proves its key (fingerprint from the QR code,
  // or remembered from the first time this code was used).
  const fp = hashParams.get('h') && normCode(hashParams.get('c') || '') === code ? hashParams.get('h') : '';
  const fol = createFollower({
    code, fp,
    hello: (peerId, nonce) => { if (r) r.send(peerId, helloMsg(nonce)); },
    onMsg,
    onHost: () => {},
    onLost: () => setConn('waiting', 'The media desk went away · waiting…'),
  });
  follower = fol;
  try {
    r = await joinStageRoom(code, {
      host: false,
      relays: relaysFrom(hashParams.get('r') || local.relays || ''),
      onMessage: (m, peerId) => fol.message(m, peerId),
      onJoin: (peerId) => fol.join(peerId),
      onLeave: (peerId) => fol.leave(peerId),
      onError: () => { if (S.conn !== 'on') setConn('waiting', 'Still looking for the media desk…'); },
    });
    if (room !== my) { r.close(); return; }
    Object.assign(my, r, { code, close: () => r.close() });
    tx = { send: (m) => { const id = fol.hostId(); if (id) r.send(id, m); } };
    setConn('waiting');
    // No media desk after a while: say what to check.
    setTimeout(() => { if (room === my && S.conn !== 'on') setConn('waiting', 'Waiting for the media desk… Is “Phones & laptops” turned on in Tools → Stage, and is the code ' + fmtCode(code) + '?'); }, 20000);
  } catch (e) {
    if (room === my) room = null;
    showJoin('Could not join: ' + ((e && e.message) || e) + '. Check the internet connection and try again.');
  }
}

async function companionHere() {
  if (location.protocol !== 'http:') return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch('api/info', { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const info = await r.json();
    return info && info.app === 'selah-companion';
  } catch (e) { return false; }
}

// ------------------------------------------------------------ start
paintLayout(); paintNow(); paintPlan(); tick(); keepAwake();
(async () => {
  if (VIA === 'win' && viaWindow()) return;
  if (VIA === 'cast' && viaCast()) return;
  if (VIA === 'lan') { viaLan(); return; }
  const fromLink = normCode(hashParams.get('c') || params.get('c') || '');
  if (hashParams.get('r') != null) { local.relays = relaysFrom(hashParams.get('r')) ? hashParams.get('r') : ''; saveLocal(); }
  if (fromLink) { local.code = fromLink; saveLocal(); joinCode(fromLink); return; }
  const lan = await companionHere();
  if (lan && !local.code) { viaLan(); return; }
  if (local.code) { joinCode(local.code); return; }
  showJoin('', lan);
})();
window.addEventListener('hashchange', () => {
  const c = normCode(new URLSearchParams(location.hash.replace(/^#/, '')).get('c') || '');
  if (c && (!room || room.code !== c)) { local.code = c; saveLocal(); joinCode(c); }
});
window.addEventListener('pagehide', () => { send({ t: 'bye' }); });
// Offline PWA: the stage page is stored with the rest of the app.
if ('serviceWorker' in navigator && window.isSecureContext && !PREVIEW) navigator.serviceWorker.register('sw.js').catch(() => {});
