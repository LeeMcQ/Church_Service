// OBS output (obs.html): a Browser Source for the live stream. Two modes:
//   #mode=full    the slides exactly as on the projector (optionally with a transparent background, so
//                 Bible and hymn text sit over the camera picture)
//   #mode=lower   a transparent overlay with lower thirds: the Bible verse or hymn words on screen
//                 (automatically), names and announcements sent from Tools → Stream, a scrolling
//                 ticker and the church logo in the corner.
// It follows the operator's SDA Sabbath like a stage screen does: by room code over the internet
// (#c=CODE), on the church network through the companion (?via=lan), or as the preview in the app.
// Nothing about the connection is ever drawn on the stream once it is connected.
import { h, clear, uid, APP_SCOPE } from './core/util.js';
import { createStage, fitBody, sanitizeSlideHtml } from './core/render.js';
import { createEncoder, createDecoder } from './core/wire.js';
import { normCode, joinStageRoom, relaysFrom, createFollower, canVerify } from './core/stagenet.js';

const qs = new URLSearchParams(location.search);
const hs = new URLSearchParams(location.hash.replace(/^#/, ''));
const get = (k) => hs.get(k) || qs.get(k) || '';
const MODE = get('mode') === 'full' ? 'full' : 'lower';
const VIA = get('via');
const PREVIEW = get('preview') === '1';
const SID = uid();
const LAN_KEY = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const W = 1920, H = 1080;

const root = document.getElementById('obs');
root.classList.add('mode-' + MODE);
// On a screen whose HDMI cable goes to a capture card: a solid background instead of see-through
// (green for OBS's Chroma Key filter, or black), full screen, no mouse pointer.
const BGS = { green: '#00b140', blue: '#0047bb', black: '#000000', magenta: '#ff00ff' };
const BG = BGS[get('bg')] || '';
if (BG) {
  root.classList.add('hdmi');
  document.documentElement.style.setProperty('background', BG, 'important');
  document.body.style.setProperty('background', BG, 'important');
  document.body.style.cursor = 'none';
  document.title = 'SDA Sabbath · ' + (MODE === 'full' ? 'slides' : 'lower third') + ' (HDMI)';
  const goFull = () => { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {}); };
  addEventListener('dblclick', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else goFull(); });
  addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F' || e.key === 'F11') { e.preventDefault(); goFull(); } });
  addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.stage === 1 && e.data.t === 'fullscreen') goFull(); });
}
if (PREVIEW) root.classList.add('preview');
// Everything is laid out on a 1920 × 1080 canvas and scaled to the source size OBS gives the page.
const canvas = h('div.obs-canvas');
root.append(canvas);
function fit() {
  const sc = Math.min(innerWidth / W, innerHeight / H) || 1;
  canvas.style.transform = 'translate(' + Math.round((innerWidth - W * sc) / 2) + 'px,' + Math.round((innerHeight - H * sc) / 2) + 'px) scale(' + sc + ')';
}
addEventListener('resize', fit);
fit();

const S = { style: null, live: null, index: 0, blank: null, cfg: {}, lower: null, ticker: null, on: true, offset: 0, conn: 'idle', pres: false, obsScene: '' };

// ------------------------------------------------------------ full slides
let stage = null;
if (MODE === 'full') {
  const host = h('div.obs-full');
  canvas.append(host);
  stage = createStage(host, { placeholderOnly: true, observe: false });
  stage.el.style.transform = 'none';
}

// ------------------------------------------------------------ lower third, ticker, logo
const ltKick = h('div.lt-kick');
const ltTitle = h('div.lt-title');
const ltTextIn = h('div.lt-text-in');
const ltText = h('div.lt-text', ltTextIn);
const lt = h('div.lt', h('div.lt-box', h('div.lt-bar'), h('div.lt-body', ltKick, ltTitle, ltText)));
const tkIn = h('div.tk-in');
const tk = h('div.tk', h('div.tk-label', 'News'), h('div.tk-run', tkIn));
const bug = h('div.bug');
const pill = h('div.obs-pill', { hidden: true });
canvas.append(lt, tk, bug, pill);

// ------------------------------------------------------------ helpers
const frameOf = (cue, i) => {
  if (!cue || !cue.deck) return null;
  const d = cue.deck;
  if (d.frames && d.frames.length) return d.frames[Math.max(0, Math.min(i || 0, d.frames.length - 1))];
  return d.frame || null;
};
function htmlLines(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html || '');
  t.content.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  t.content.querySelectorAll('.ln').forEach((b) => b.append('\n'));
  t.content.querySelectorAll('.hn, .ha').forEach((b) => b.remove());
  t.content.querySelectorAll('sup, .vn').forEach((s) => s.replaceWith(' ' + s.textContent + ' '));
  t.content.querySelectorAll('p,div,li').forEach((b) => b.append('\n'));
  return t.content.textContent.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
function cleanCue(cue) {
  if (!cue || VIA === 'win' || !cue.deck || !Array.isArray(cue.deck.frames)) return cue;
  cue.deck.frames.forEach((f) => {
    if (!f || typeof f !== 'object') return;
    if (typeof f.html === 'string') f.html = sanitizeSlideHtml(f.html);
    if (Array.isArray(f.cols)) f.cols.forEach((c) => { if (c && typeof c.html === 'string') c.html = sanitizeSlideHtml(c.html); });
  });
  return cue;
}

/** What the lower third shows now: a name/announcement sent by hand wins; otherwise the words on screen. */
function lowerContent() {
  if (!S.on) return null;
  const m = S.lower;
  if (m && (!m.until || Date.now() + S.offset < m.until)) return { key: 'm' + m.id, kick: m.kind === 'text' ? '' : '', title: m.title, text: m.text, kind: m.kind || 'name' };
  const c = S.live, cfg = S.cfg;
  if (!c || S.blank) return null;
  // The presentation scene is on air: the slide already shows the words (names and the ticker still show).
  if (S.pres || (S.obsScene && cfg.presScene && S.obsScene === cfg.presScene)) return null;
  const f = frameOf(c, S.index);
  if (!f || f.kind !== 'text') return null;
  if (c.tab === 'bible' && cfg.autoBible) {
    const txt = f.cols && f.cols.length ? htmlLines(f.cols[0].html) : htmlLines(f.html);
    const ref = f.foot || (f.cols && f.cols[0] && f.cols[0].ref) || c.title;
    return { key: 'b' + c.id + ':' + S.index, kick: 'Scripture', title: ref, text: txt.replace(/\n+/g, ' '), kind: 'scripture' };
  }
  if (c.tab === 'hymns' && cfg.autoHymns) {
    const title = String(c.title || '');
    if (f.variant === 'title' || cfg.hymnMode === 'title') return { key: 'h' + c.id + (cfg.hymnMode === 'title' ? '' : ':' + S.index), kick: 'Hymn', title, text: '', kind: 'song' };
    return { key: 'h' + c.id + ':' + S.index, kick: title, title: '', text: htmlLines(f.html), kind: 'lyrics' };
  }
  if (cfg.autoOther && c.tab !== 'bible' && c.tab !== 'hymns') {
    return { key: 'o' + c.id + ':' + S.index, kick: c.title || '', title: '', text: htmlLines(f.html).replace(/\n+/g, ' '), kind: 'text' };
  }
  return null;
}

let shownKey = null, swapT = null;
function paintLower() {
  const want = lowerContent();
  const key = want ? want.key + '|' + want.title + '|' + want.text : null;
  if (key === shownKey) return;
  const wasShown = shownKey != null;
  shownKey = key;
  clearTimeout(swapT);
  if (!want) { lt.classList.remove('in'); return; }
  const fill = () => {
    ltKick.textContent = want.kick || ''; ltKick.hidden = !want.kick;
    ltTitle.textContent = want.title || ''; ltTitle.hidden = !want.title;
    clear(ltTextIn);
    const lines = String(want.text || '').split('\n');
    lines.forEach((l, i) => { ltTextIn.append(l); if (i < lines.length - 1) ltTextIn.append(h('br')); });
    ltText.hidden = !want.text;
    lt.dataset.kind = want.kind;
    lt.classList.remove('clamp', 'four');
    ltText.style.fontSize = ''; // measure from the CSS size, not from the previous verse
    if (want.text && want.kind !== 'name') {
      // As large as fits in three lines; a long passage gets a fourth line and a smaller size, and only
      // then is it cut off with "…".
      fitBody(ltText, 30, want.kind === 'lyrics' ? 52 : 46);
      if (ltText.dataset.fits !== '1') {
        lt.classList.add('four'); ltText.style.fontSize = '';
        const fs = fitBody(ltText, 26, 34);
        if (ltText.dataset.fits !== '1') { ltText.style.fontSize = fs + 'px'; lt.classList.add('clamp'); }
      }
    }
    lt.classList.add('in');
  };
  // Same kind of lower third already up (the next verse): change the words in place; otherwise slide in.
  const go = (f) => (document.fonts && document.fonts.status !== 'loaded' ? document.fonts.ready.then(f) : f()); // fit with the real font
  if (wasShown && lt.classList.contains('in') && lt.dataset.kind === want.kind) { lt.classList.add('swap'); swapT = setTimeout(() => go(() => { fill(); lt.classList.remove('swap'); }), 180); }
  else if (wasShown && lt.classList.contains('in')) { lt.classList.remove('in'); swapT = setTimeout(() => go(fill), 380); }
  else go(fill);
}

let tickerKey = null;
function paintTicker() {
  const t = S.on && S.ticker && S.ticker.text ? S.ticker : null;
  const key = t ? t.id : null;
  if (key === tickerKey) return;
  tickerKey = key;
  root.classList.toggle('has-ticker', !!t);
  if (!t) { tk.classList.remove('in'); return; }
  // Seamless loop: enough copies to fill the strip twice; the animation moves by exactly one copy.
  clear(tkIn);
  const one = h('span.tk-one', t.text + '\u2003•\u2003');
  tkIn.append(one);
  tk.classList.add('in');
  requestAnimationFrame(() => {
    const w = one.getBoundingClientRect().width / (canvas.getBoundingClientRect().width / W || 1);
    const strip = tkIn.parentNode.clientWidth || 1800;
    const n = Math.max(2, Math.ceil((strip * 2) / Math.max(1, w)));
    for (let i = 1; i < n; i++) tkIn.append(one.cloneNode(true));
    tkIn.style.setProperty('--tk-w', w + 'px');
    tkIn.style.animationDuration = Math.max(4, w / 110) + 's'; // ~110 px per second at 1080p
  });
}

let bugUrl = null, bugFor;
function paintBug() {
  const on = S.on && S.cfg.bug && MODE === 'lower';
  bug.classList.toggle('in', !!on);
  const blob = S.style && S.style.logoBlob;
  const key = blob ? blob : 'n:' + (S.cfg.church || '');
  if (key === bugFor) return; // unchanged: never rebuild (no blink on air)
  bugFor = key;
  if (bugUrl) { URL.revokeObjectURL(bugUrl); bugUrl = null; }
  clear(bug);
  if (blob) { bugUrl = URL.createObjectURL(blob); bug.append(h('img', { src: bugUrl, alt: '' })); }
  else if (S.cfg.church) bug.append(h('span', S.cfg.church));
}

function paintCfg() {
  const c = S.cfg;
  root.dataset.theme = c.theme || 'classic';
  root.dataset.pos = c.pos || 'left';
  root.style.setProperty('--lt-size', String(Math.max(0.7, Math.min(1.5, +c.size || 1))));
  const accent = /^#[0-9a-f]{3,8}$/i.test(c.accent || '') ? c.accent : (S.style && S.style.accent) || '#c9a44c';
  root.style.setProperty('--lt-accent', accent);
  root.classList.toggle('clear-bg', c.fullBg === 'transparent');
  paintBug();
}

function paintFull() {
  if (!stage) return;
  stage.setBlank(S.blank === 'logo' ? 'logo' : null);
  root.classList.toggle('is-black', S.blank === 'black');
  const f = S.live ? frameOf(S.live, S.index) : null;
  root.classList.toggle('media-frame', !!f && /^(video|stream|web|audio)$/.test(f.kind));
  stage.show(f);
}

setInterval(() => { paintLower(); }, 500);

// ------------------------------------------------------------ messages from SDA Sabbath
function onMsg(m) {
  if (!m || typeof m !== 'object' || !m.t) return;
  if (m.to && m.to !== SID) return;
  if (S.conn !== 'on' && m.t !== 'kick') setConn('on');
  switch (m.t) {
    case 'hi': if (typeof m.now === 'number') S.offset = m.now - Date.now(); break;
    case 'ping': if (typeof m.now === 'number') S.offset = m.now - Date.now(); try { tx.send({ t: 'pong' }); } catch (e) { /* */ } break;
    case 'host': hello(); break;
    case 'style':
      S.style = m.style || {};
      if (stage) { stage.applyStyle(S.style); paintFull(); }
      paintCfg();
      break;
    case 'cfg': if (stage && m.cfg && m.cfg.aspect) { stage.setAspect(m.cfg.aspect); paintFull(); } break;
    case 'live': S.live = cleanCue(m.cue); S.index = m.index || 0; S.blank = m.blank || null; paintFull(); paintLower(); break;
    case 'go': S.index = m.index || 0; if (S.blank === 'black') S.blank = null; paintFull(); paintLower(); break;
    case 'blank': S.blank = m.mode || null; paintFull(); paintLower(); break;
    case 'obs':
      if (typeof m.now === 'number') S.offset = m.now - Date.now();
      S.cfg = m.cfg || {}; S.lower = m.lower || null; S.ticker = m.ticker || null; S.on = m.on !== false; S.pres = !!m.pres;
      paintCfg(); paintLower(); paintTicker();
      root.classList.toggle('overlays-off', !S.on);
      break;
    case 'kick': setConn('idle'); break;
    default: break;
  }
}

// ------------------------------------------------------------ connection (never visible on air once connected)
const started = Date.now();
function setConn(state, text) {
  S.conn = state;
  if (state === 'on') { pill.hidden = true; return; }
  // Only shown while setting up (the first minute), never while OBS is streaming or recording.
  if (PREVIEW || Date.now() - started > 60000 || obsLive) { pill.hidden = true; return; }
  pill.hidden = false;
  pill.textContent = text || 'SDA Sabbath: connecting…';
}
setInterval(() => { if (S.conn !== 'on' && !pill.hidden && Date.now() - started > 60000) pill.hidden = true; }, 2000);

// Inside OBS: know which scene is on air, and whether OBS is live (then nothing but the overlay is ever drawn).
let obsLive = false;
const ob = window.obsstudio;
if (ob) {
  try { if (ob.getStatus) ob.getStatus((st) => { obsLive = !!(st && (st.streaming || st.recording)); if (obsLive) pill.hidden = true; }); } catch (e) { /* not allowed */ }
  try { if (ob.getCurrentScene) ob.getCurrentScene((sc) => { S.obsScene = (sc && sc.name) || ''; paintLower(); }); } catch (e) { /* */ }
  window.addEventListener('obsSceneChanged', (e) => { S.obsScene = (e.detail && e.detail.name) || ''; paintLower(); });
  ['obsStreamingStarted', 'obsRecordingStarted'].forEach((ev) => window.addEventListener(ev, () => { obsLive = true; pill.hidden = true; }));
}

let tx = { send: () => {} };
function helloMsg(nonce) { return { t: 'hello', sid: SID, v: 1, kind: 'obs', mode: MODE, preview: PREVIEW || undefined, name: get('name') || '', nonce }; }
let follower = null, room = null;
function hello() {
  if (follower) { const id = follower.hostId(); if (id) follower.join(id); return; }
  try { tx.send(helloMsg()); } catch (e) { /* */ }
}

function viaWindow() {
  let host = null;
  try { host = window.opener && !window.opener.closed ? window.opener : null; } catch (e) { host = null; }
  if (!host && window.parent !== window) host = window.parent;
  if (!host) return false;
  tx = { send: (m) => host.postMessage(Object.assign({ stage: 1 }, m), location.origin) };
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== host || !e.data || !e.data.t || e.data.stage === 1) return;
    onMsg(e.data);
  });
  let tries = 0;
  const ask = () => { if (S.conn === 'on' || tries++ > 60) return; hello(); setTimeout(ask, 700); };
  ask();
  // The app was reloaded: it asks open windows to say hello again.
  try { const bc = new BroadcastChannel('selah-stage:' + APP_SCOPE); bc.onmessage = (e) => { if (e.data && e.data.t === 'who') hello(); }; } catch (e) { /* */ }
  return true;
}
function viaLan() {
  let wait = 1000;
  setConn('connecting', 'SDA Sabbath: connecting on the church network…');
  const connect = () => {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws?role=display&room=stage');
    ws.binaryType = 'arraybuffer';
    const dec = createDecoder(onMsg);
    let enc = null;
    ws.onopen = () => { wait = 1000; enc = createEncoder((s) => ws.send(s), (b) => ws.send(b)); tx = { send: (m) => enc && enc(Object.assign({ from: SID, key: LAN_KEY }, m)) }; hello(); };
    ws.onmessage = (e) => (typeof e.data === 'string' ? dec.text(e.data) : dec.binary(e.data));
    ws.onclose = () => { enc = null; setTimeout(connect, wait); wait = Math.min(wait * 2, 10000); };
  };
  connect();
}
async function viaCode(code) {
  setConn('connecting', 'SDA Sabbath: connecting to the media desk…');
  if (!canVerify()) { setConn('idle', 'SDA Sabbath: this address must start with https://'); return; }
  // Only the media desk whose key matches the address (#h=…) is followed; anyone else with the room code is ignored.
  follower = createFollower({
    code, fp: get('h'),
    hello: (peerId, nonce) => { if (room) room.send(peerId, helloMsg(nonce)); },
    onMsg,
    onLost: () => setConn('waiting', 'SDA Sabbath: waiting for the media desk…'),
  });
  const go = async () => {
    try {
      room = await joinStageRoom(code, {
        host: false,
        relays: relaysFrom(get('r')),
        onMessage: (m, peerId) => follower.message(m, peerId),
        onJoin: (peerId) => follower.join(peerId),
        onLeave: (peerId) => follower.leave(peerId),
      });
      tx = { send: (m) => { const id = follower.hostId(); if (id) room.send(id, m); } };
      setConn('waiting', 'SDA Sabbath: waiting for the media desk…');
    } catch (e) {
      setConn('idle', 'SDA Sabbath: could not connect (' + ((e && e.message) || e) + '). Retrying…');
      setTimeout(go, 5000);
    }
  };
  go();
}

(() => {
  if (VIA === 'win' && viaWindow()) return;
  if (VIA === 'lan') { viaLan(); return; }
  const code = normCode(get('c'));
  if (code) { viaCode(code); return; }
  setConn('idle', 'SDA Sabbath for OBS: this address needs a room code. Copy it from SDA Sabbath → Tools → Stream.');
})();
