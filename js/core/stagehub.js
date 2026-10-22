// Stage screen hub (control side). One source of truth for what the people on the platform see — the
// slide on screen and what comes next, speaker notes, timers, messages from the media desk and the order
// of service — fed to any number of stage screens at once, each through its own outlet:
//   window   a stage window on another screen of this PC (also the preview in the Stage tab)
//   cast     a Chromecast / Google TV / Android TV through the browser's Presentation API
//   lan      screens and phones on the church network through the SDA Sabbath companion (no internet)
//   peer     phones, tablets and laptops that joined with the room code or QR code (stagenet.js)
// Nothing here ever reaches the projector: stage messages and timers are for the platform only.
//
// Stage screens may also send back: a talk-back message to the media desk, and — only when allowed
// (the control PIN, or the operator allowing that device) — slide and timer commands.
import { emitter, uid, debounce, throttle, isBlob } from './util.js';
import { live } from './live.js';
import { link } from './link.js';
import { settings } from './settings.js';
import { createEncoder, createDecoder } from './wire.js';
import { joinStageRoom, newCode, newPin, turnFrom, relaysFrom } from './stagenet.js';

export const PROTOCOL = 1;
const MIN = 60000;

export const DEFAULT_PRESETS = [
  '5 minutes left', '2 minutes left', 'Please wrap up', 'Time is up',
  'Louder, please', 'Slow down a little', 'Your microphone is off', 'Please come to the media desk',
];
export const TALK_PRESETS = ['Ready', 'Need 5 more minutes', 'Microphone problem', 'Next slide, please', 'Previous slide, please', 'Please come to the stage'];

export const hub = emitter({
  outlets: new Map(),  // id -> outlet
  msg: null,           // the stage message showing now {id, text, flash, at, until}
  history: [],         // messages sent this session (newest first)
  talk: [],            // talk-back from the stage (newest first)
  plan: null,          // order of service as the stage shows it
  net: { state: 'off', error: '', since: 0 },
  lan: { state: 'off' },
  onCommand: null,     // set by app.js: (op, arg) => …  (next, prev, black, logo, clear, present, go)
});

// ------------------------------------------------------------ pictures for remote screens
// Phones and TVs get pictures at most 1280 px wide (a 12-megapixel photo slide becomes ~150 KB);
// videos and other large files never travel to the stage. Each picture is shrunk once.
const MAX_W = 1280;
const thumbs = new WeakMap();
function thumb(blob) {
  let p = thumbs.get(blob);
  if (p) return p;
  p = (async () => {
    const t = blob.type || '';
    if (!/^image\//.test(t)) return null;
    if (blob.size <= 160 * 1024 || /svg|gif/.test(t)) return blob;
    try {
      const bmp = await createImageBitmap(blob);
      const sc = Math.min(1, MAX_W / bmp.width);
      const w = Math.max(1, Math.round(bmp.width * sc)), hh = Math.max(1, Math.round(bmp.height * sc));
      const c = document.createElement('canvas');
      c.width = w; c.height = hh;
      c.getContext('2d').drawImage(bmp, 0, 0, w, hh);
      if (bmp.close) bmp.close();
      const out = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
      return out && out.size < blob.size ? out : blob;
    } catch (e) { return blob.size < 2 * 1048576 ? blob : null; }
  })();
  thumbs.set(blob, p);
  return p;
}
const isStream = (v) => typeof MediaStream !== 'undefined' && v instanceof MediaStream;
const deckCopies = new WeakMap(); // a deck is copied once, however often it is sent
function slim(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === 'function') return undefined;
  if (typeof v !== 'object') return v;
  if (isBlob(v)) return thumb(v);
  if (isStream(v) || depth > 14) return null;
  if (Array.isArray(v)) return Promise.all(v.map((x) => slim(x, depth + 1)));
  if (Array.isArray(v.frames)) {
    let p = deckCopies.get(v);
    if (!p) { p = slimObj(v, depth); deckCopies.set(v, p); }
    return p;
  }
  return slimObj(v, depth);
}
async function slimObj(v, depth) {
  const out = {};
  const keys = Object.keys(v);
  const vals = await Promise.all(keys.map((k) => slim(v[k], depth + 1)));
  keys.forEach((k, i) => { if (vals[i] !== undefined) out[k] = vals[i]; });
  return out;
}
const slimmed = new WeakMap();
const remoteCopy = (msg) => { let p = slimmed.get(msg); if (!p) { p = slim(msg); slimmed.set(msg, p); } return p; };

// ------------------------------------------------------------ outlets
function addOutlet(o) {
  const old = hub.outlets.get(o.id);
  if (old && old.close && old !== o) { try { old.close(); } catch (e) { /* */ } }
  Object.assign(o, { q: Promise.resolve(), ready: false, control: !!o.control, since: Date.now(), name: o.name || '', fails: 0 });
  hub.outlets.set(o.id, o);
  hub.emit('outlets');
  return o;
}
function removeOutlet(id) {
  const o = hub.outlets.get(id);
  if (!o) return;
  hub.outlets.delete(id);
  if (o.close) { try { o.close(); } catch (e) { /* */ } }
  hub.emit('outlets');
}
function sendTo(o, msg) {
  if (!o || !msg) return;
  if (o.remote) {
    const p = remoteCopy(msg);
    o.q = o.q.then(() => p).then((m) => { if (hub.outlets.get(o.id) === o) o.send(m); }).catch((e) => console.warn('stage send', e));
  } else {
    try { o.send(msg); }
    catch (e) { remoteCopy(msg).then((m) => { try { o.send(m); } catch (er) { /* closed */ } }); }
  }
}
function broadcast(msg) { hub.outlets.forEach((o) => { if (o.ready) sendTo(o, msg); }); }
hub.count = (pred) => { let n = 0; hub.outlets.forEach((o) => { if (o.ready && (!pred || pred(o))) n++; }); return n; };
/** Stage screens people can see in the list (the preview inside the Stage tab is not one). */
hub.screens = () => Array.from(hub.outlets.values()).filter((o) => o.ready && o.kind !== 'preview');

// ------------------------------------------------------------ what the stage shows
function deckFor(cue) {
  const d = cue && cue.deck;
  if (!d) return null;
  if (d.kind === 'stream') return { kind: 'stream', frames: [{ kind: 'stream', title: cue.title || 'Screen share' }] };
  return d;
}
function cueInfo(cue) {
  if (!cue) return null;
  return { id: cue.id || '', title: cue.title || '', sub: cue.sub || '', tab: cue.tab || '', labels: cue.labels || null, deck: deckFor(cue) };
}
let liveCue = { ref: undefined, info: null };
function liveMsg() {
  if (liveCue.ref !== live.cue) liveCue = { ref: live.cue, info: cueInfo(live.cue) };
  return { t: 'live', cue: liveCue.info, index: live.index, blank: live.blank };
}
// What comes next. When the staged item is the one on screen (Next follows Live), only its slide number
// travels: the stage already has that item.
let lastNextId = null;
function nextMsg(full) {
  const s = live.staged, c = live.cue;
  if (!s) { lastNextId = null; return { t: 'next', cue: null }; }
  if (c && s.id && s.id === c.id) { lastNextId = null; return { t: 'next', same: true, index: s.index || 0 }; }
  if (!full && s.id && s.id === lastNextId) return { t: 'next', keep: true, index: s.index || 0 };
  lastNextId = s.id || null;
  return { t: 'next', cue: cueInfo(s), index: s.index || 0 };
}
function cfgMsg() {
  const s = settings.v.stage;
  return {
    t: 'cfg', cfg: {
      layout: s.layout, featured: s.featured, warnSec: s.warnSec, clock24: s.clock24, showNext: s.showNext,
      showPlan: s.showPlan, showNotes: s.showNotes, showLive: s.showLive, textSize: s.textSize, mirror: s.mirror,
      church: ((settings.v.church && settings.v.church.name) || '').trim(), aspect: link.aspect(), talk: TALK_PRESETS,
    },
  };
}
const timersMsg = () => ({ t: 'timers', list: timers.list, featured: settings.v.stage.featured, warnSec: settings.v.stage.warnSec, now: Date.now() });

function snapshot(o, full = true) {
  sendTo(o, { t: 'hi', v: PROTOCOL, now: Date.now() });
  sendTo(o, cfgMsg());
  const st = live.style;
  if (st) sendTo(o, { t: 'style', style: st });
  else live.buildStyle().then((s) => sendTo(o, { t: 'style', style: s })).catch(() => {});
  sendTo(o, liveMsg());
  sendTo(o, nextMsg(full));
  sendTo(o, timersMsg());
  sendTo(o, { t: 'msg', m: hub.msg });
  sendTo(o, { t: 'plan', plan: hub.plan });
  if (live.media) sendTo(o, mediaMsg(live.media));
}
const mediaMsg = (m) => ({ t: 'media', time: m.time || 0, dur: m.dur || 0, paused: !!m.paused, now: Date.now() });

live.on('live', () => { lastNextId = null; broadcast(liveMsg()); pushNext(); });
live.on('go', (i) => { broadcast({ t: 'go', index: i }); pushNext(); });
live.on('blank', (mode) => broadcast({ t: 'blank', mode }));
live.on('style', (s) => broadcast({ t: 'style', style: s }));
live.on('media', throttle((m) => broadcast(mediaMsg(m)), 1000));
const pushNext = debounce(() => broadcast(nextMsg(false)), 60);
live.on('staged', pushNext);
settings.on('change:stage', (p) => { if (p !== 'stage.timers' && p !== 'stage.presets') pushCfg(); });
settings.on('change:church', () => pushCfg());
settings.on('change:display', (p) => { if (p === 'display.aspect') pushCfg(); });
link.on('hello', () => pushCfg());
const pushCfg = debounce(() => broadcast(cfgMsg()), 120);

// Keep-alive (also lets the stage notice a lost connection and keep its clock in step).
setInterval(() => { if (hub.outlets.size) broadcast({ t: 'ping', now: Date.now() }); }, 10000);

// ------------------------------------------------------------ messages to the stage
let msgT = null;
hub.sendMessage = (text, opts = {}) => {
  text = String(text || '').trim().slice(0, 400);
  clearTimeout(msgT);
  if (!text) { hub.clearMessage(); return; }
  const sec = opts.sec != null ? +opts.sec : +settings.v.stage.msgSec || 0;
  hub.msg = { id: uid(), text, flash: !!opts.flash, at: Date.now(), until: sec > 0 ? Date.now() + sec * 1000 : 0 };
  hub.history = [hub.msg].concat(hub.history.filter((m) => m.text !== text)).slice(0, 20);
  broadcast({ t: 'msg', m: hub.msg });
  hub.emit('msg', hub.msg);
  if (sec > 0) { const id = hub.msg.id; msgT = setTimeout(() => { if (hub.msg && hub.msg.id === id) hub.clearMessage(); }, sec * 1000); }
};
hub.clearMessage = () => {
  clearTimeout(msgT);
  hub.msg = null;
  broadcast({ t: 'msg', m: null });
  hub.emit('msg', null);
};
hub.presets = () => { const p = settings.v.stage.presets; return Array.isArray(p) && p.length ? p.slice(0, 24) : DEFAULT_PRESETS.slice(); };

// ------------------------------------------------------------ order of service (from the Plan tab)
const pushPlan = debounce(() => broadcast({ t: 'plan', plan: hub.plan }), 150);
hub.setPlan = (p) => {
  const key = JSON.stringify(p);
  if (key === hub.planKey) return;
  hub.planKey = key;
  hub.plan = p;
  pushPlan();
};
/** A plan part with a planned time went on screen: the featured timer counts down from it. */
hub.planPartLive = (title, mins) => {
  if (!settings.v.stage.autoPlanTimer || !(mins > 0)) return;
  const id = settings.v.stage.featured || 'speaker';
  const t = timers.list.find((x) => x.id === id && x.mode === 'down') || timers.list.find((x) => x.mode === 'down');
  if (!t) return;
  hub.timer(t.id, 'set', { ms: mins * MIN, label: title, start: true });
};

// ------------------------------------------------------------ timers
// Times travel as absolute moments (endAt / startAt), so every screen counts by itself and a reloaded
// app or a sleeping phone shows the right time again. A count-down past zero keeps going (overtime).
const DEFAULT_TIMERS = () => [
  { id: 'speaker', name: 'Speaker', mode: 'down', dur: 30 * MIN, left: 30 * MIN, running: false, label: '' },
  { id: 'service', name: 'Service', mode: 'up', elapsed: 0, running: false, label: '' },
];
const timers = { list: [] };
function loadTimers() {
  const saved = settings.v.stage.timers;
  const ok = Array.isArray(saved) && saved.length ? saved.filter((t) => t && t.id && /^(down|up|to)$/.test(t.mode)).slice(0, 8) : [];
  timers.list = ok.length ? ok.map((t) => Object.assign({}, t)) : DEFAULT_TIMERS();
}
loadTimers();
hub.timers = () => timers.list;
export function timerValue(t, now = Date.now()) {
  if (!t) return 0;
  if (t.mode === 'down') return t.running ? t.endAt - now : (t.left != null ? t.left : t.dur || 0);
  if (t.mode === 'up') return t.running ? now - t.startAt : t.elapsed || 0;
  if (t.mode === 'to') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.at || '');
    if (!m) return 0;
    const d = new Date(now); d.setHours(+m[1], +m[2], 0, 0);
    return d.getTime() - now;
  }
  return 0;
}
const saveTimers = debounce(() => settings.set('stage.timers', timers.list.map((t) => Object.assign({}, t))), 300);
const pushTimers = () => { broadcast(timersMsg()); hub.emit('timers', timers.list); saveTimers(); };
const overNotified = new Set();
/** op: start | pause | toggle | reset | set {ms, label, start} | add (ms) | rename | at ('HH:MM') | remove */
hub.timer = (id, op, arg) => {
  const t = timers.list.find((x) => x.id === id);
  if (!t) return;
  const now = Date.now();
  const val = timerValue(t, now);
  switch (op) {
    case 'start':
      if (t.running || t.mode === 'to') break;
      if (t.mode === 'down') t.endAt = now + val; else t.startAt = now - val;
      t.running = true; break;
    case 'pause':
      if (!t.running || t.mode === 'to') break;
      if (t.mode === 'down') t.left = val; else t.elapsed = val;
      t.running = false; break;
    case 'toggle': return hub.timer(id, t.running ? 'pause' : 'start');
    case 'reset':
      t.running = false; overNotified.delete(t.id);
      if (t.mode === 'down') t.left = t.dur; else if (t.mode === 'up') t.elapsed = 0;
      break;
    case 'set': {
      const ms = Math.max(0, Math.min(24 * 60 * MIN, +(arg && arg.ms) || 0));
      overNotified.delete(t.id);
      t.dur = ms; t.left = ms; t.running = false;
      if (arg && arg.label != null) t.label = String(arg.label).slice(0, 80);
      if (arg && arg.start) { t.endAt = now + ms; t.running = true; }
      break;
    }
    case 'add': {
      const ms = +arg || 0;
      if (t.mode === 'down') { if (t.running) t.endAt += ms; else t.left = val + ms; if (val + ms > 0) overNotified.delete(t.id); }
      else if (t.mode === 'up') { if (t.running) t.startAt -= ms; else t.elapsed = Math.max(0, val + ms); }
      break;
    }
    case 'rename': t.name = String(arg || '').trim().slice(0, 40) || t.name; break;
    case 'label': t.label = String(arg || '').slice(0, 80); break;
    case 'at': if (/^\d{1,2}:\d{2}$/.test(arg || '')) t.at = arg; break;
    case 'remove': timers.list = timers.list.filter((x) => x !== t); break;
    default: return;
  }
  pushTimers();
};
hub.addTimer = (mode, name, opt = {}) => {
  if (timers.list.length >= 8) return null;
  const t = { id: uid(), name: name || (mode === 'up' ? 'Stopwatch' : mode === 'to' ? 'Ends at' : 'Countdown'), mode, running: false, label: '' };
  if (mode === 'down') { t.dur = opt.ms || 10 * MIN; t.left = t.dur; }
  if (mode === 'up') t.elapsed = 0;
  if (mode === 'to') t.at = opt.at || '12:00';
  timers.list.push(t);
  pushTimers();
  return t;
};
hub.resetTimers = () => { timers.list = DEFAULT_TIMERS(); pushTimers(); };
// Tell the media desk once when the featured count-down runs out.
setInterval(() => {
  const now = Date.now();
  timers.list.forEach((t) => {
    if (t.mode === 'down' && t.running && timerValue(t, now) <= 0 && !overNotified.has(t.id)) {
      overNotified.add(t.id);
      hub.emit('timer-over', t);
    }
  });
}, 1000);

// ------------------------------------------------------------ messages from stage screens
const ATTEMPTS = 5;
function you(o, extra) { sendTo(o, Object.assign({ t: 'you', id: o.id, control: !!o.control, name: o.name || '' }, extra || {})); }
function welcome(o, m) {
  o.dev = String(m.dev || '').slice(0, 60);
  o.name = String(m.name || '').trim().slice(0, 40) || o.name || (o.kind === 'peer' || o.kind === 'lan' ? o.dev : '') || defaultName(o);
  if (o.kind === 'preview') o.control = true;
  else if (o.kind === 'window') o.control = settings.v.stage.allowWinControl !== false;
  else if (o.granted != null) o.control = o.granted;
  else o.control = !!(m.pin && settings.v.stage.pin && String(m.pin) === settings.v.stage.pin);
  o.ready = true;
  o.lastSeen = Date.now();
  you(o);
  snapshot(o, true);
  hub.emit('outlets');
  if (o.kind !== 'preview') hub.emit('joined', o);
}
function defaultName(o) { return { window: 'Stage window', cast: 'Cast screen', lan: 'Church network screen', peer: 'Phone / laptop' }[o.kind] || 'Stage screen'; }

function incoming(o, m) {
  if (!m || typeof m !== 'object' || !m.t) return;
  o.lastSeen = Date.now();
  switch (m.t) {
    case 'hello': welcome(o, m); return;
    case 'auth': {
      if (o.lockUntil && Date.now() < o.lockUntil) { you(o, { denied: 'wait' }); return; }
      const ok = !!(settings.v.stage.pin && String(m.pin || '') === settings.v.stage.pin);
      if (ok) { o.control = true; o.granted = true; o.fails = 0; }
      else if (++o.fails >= ATTEMPTS) { o.lockUntil = Date.now() + 60000; o.fails = 0; }
      you(o, ok ? null : { denied: 'pin' });
      hub.emit('outlets');
      return;
    }
    case 'name': o.name = String(m.name || '').trim().slice(0, 40) || o.name; hub.emit('outlets'); return;
    case 'talk': {
      const text = String(m.text || '').trim().slice(0, 300);
      if (!text) return;
      const item = { id: uid(), from: o.name || defaultName(o), text, at: Date.now() };
      hub.talk = [item].concat(hub.talk).slice(0, 30);
      hub.emit('talk', item);
      sendTo(o, { t: 'talked', id: m.id || '' });
      return;
    }
    case 'cmd': {
      if (!o.control) { you(o, { denied: 'control' }); return; }
      const op = String(m.op || '');
      if (op === 'timer') { hub.timer(String(m.id || ''), String(m.arg || ''), m.val); return; }
      if (op === 'msgclear') { hub.clearMessage(); return; }
      if (hub.onCommand && /^(next|prev|black|logo|clear|present|go|first|last)$/.test(op)) hub.onCommand(op, m.arg);
      return;
    }
    case 'bye': removeOutlet(o.id); return;
    default: return;
  }
}

/** The operator allows or stops a screen's control (slides and timers). */
hub.setControl = (id, on) => {
  const o = hub.outlets.get(id);
  if (!o) return;
  o.control = !!on; o.granted = !!on;
  you(o);
  hub.emit('outlets');
};
hub.disconnect = (id) => {
  const o = hub.outlets.get(id);
  if (!o) return;
  sendTo(o, { t: 'kick' });
  setTimeout(() => removeOutlet(id), 300);
};

// ------------------------------------------------------------ 1. window on another screen / preview
const WIN_NAME = 'selah-stage';
let stageWin = null;
function windowOutlet(w, kind) {
  for (const o of hub.outlets.values()) if (o.w === w) return o;
  return addOutlet({
    id: kind === 'preview' ? 'preview:' + uid() : 'win', kind, remote: false, w,
    label: kind === 'preview' ? 'Preview' : 'Stage window',
    send: (m) => { if (w.closed) throw new Error('closed'); w.postMessage(m, location.origin); },
    close: () => { if (kind === 'window' && !w.closed) { try { w.close(); } catch (e) { /* */ } } },
  });
}
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.stage !== 1 || !e.source) return;
  const m = e.data;
  let o = null;
  for (const x of hub.outlets.values()) if (x.w === e.source) { o = x; break; }
  if (!o) {
    if (m.t !== 'hello') return;
    o = windowOutlet(e.source, m.kind === 'preview' ? 'preview' : 'window');
    if (o.kind === 'window') stageWin = e.source;
  }
  incoming(o, m);
});
setInterval(() => {
  hub.outlets.forEach((o) => { if (o.w && o.w.closed) removeOutlet(o.id); });
}, 1500);
// A reloaded control page finds a stage window that is still open.
try {
  const bc = new BroadcastChannel('selah-stage');
  bc.postMessage({ t: 'who' });
  hub.bc = bc;
} catch (e) { /* old browser */ }

async function pickStageScreen() {
  if (!('getScreenDetails' in window)) return null;
  try {
    let state = 'prompt';
    try { state = (await navigator.permissions.query({ name: 'window-management' })).state; } catch (e) { /* */ }
    if (state === 'denied') return null;
    const sd = await window.getScreenDetails();
    const want = settings.v.stage.screenLabel;
    const proj = settings.v.display.screenLabel;
    const others = sd.screens.filter((s) => s !== sd.currentScreen);
    // Prefer the screen chosen for the stage, then a screen that is neither this one nor the projector.
    return (want && sd.screens.find((s) => s.label === want)) || others.find((s) => s.label !== proj) || null;
  } catch (e) { return null; }
}
hub.listScreens = async () => {
  if (!('getScreenDetails' in window)) return null;
  try { const sd = await window.getScreenDetails(); return { screens: sd.screens, current: sd.currentScreen }; } catch (e) { return null; }
};
/** Open (or bring back) the stage window, on another screen when there is one. */
hub.openWindow = async () => {
  if (stageWin && !stageWin.closed) { try { stageWin.focus(); } catch (e) { /* */ } return true; }
  const url = new URL('stage.html?via=win', location.href).href;
  const scr = await pickStageScreen();
  let features = 'popup=yes';
  if (scr) features += ',left=' + scr.availLeft + ',top=' + scr.availTop + ',width=' + scr.availWidth + ',height=' + scr.availHeight + ',fullscreen';
  else features += ',width=1280,height=760';
  const w = window.open(url, WIN_NAME, features);
  if (!w) { hub.emit('blocked'); return false; }
  stageWin = w;
  // Ask the window to go full screen on its screen once it is up (this click allows it).
  setTimeout(() => { try { if (!w.closed) w.postMessage({ stage: 1, t: 'fullscreen' }, { targetOrigin: location.origin, delegate: 'fullscreen' }); } catch (e) { try { w.postMessage({ stage: 1, t: 'fullscreen' }, location.origin); } catch (er) { /* */ } } }, 700);
  return true;
};
hub.windowOpen = () => !!(stageWin && !stageWin.closed);
hub.closeWindow = () => { for (const o of hub.outlets.values()) if (o.kind === 'window') removeOutlet(o.id); stageWin = null; };
window.addEventListener('pagehide', () => { if (stageWin && !stageWin.closed) { try { stageWin.close(); } catch (e) { /* */ } } });

// ------------------------------------------------------------ 2. Cast (Chromecast, Google TV …)
hub.canCast = () => typeof window.PresentationRequest === 'function';
hub.cast = async () => {
  const req = new PresentationRequest([new URL('stage.html?via=cast', location.href).href]);
  const conn = await req.start();
  conn.binaryType = 'arraybuffer';
  const id = 'cast:' + uid();
  const enc = createEncoder((s) => conn.send(s), (b) => conn.send(b));
  const o = addOutlet({ id, kind: 'cast', remote: true, label: 'Cast screen', send: (m) => enc(m), close: () => { try { conn.terminate(); } catch (e) { /* */ } } });
  const dec = createDecoder((m) => { if (m && m.t === 'hello') enc.reset(); incoming(o, m); });
  conn.onmessage = (e) => (typeof e.data === 'string' ? dec.text(e.data) : dec.binary(e.data));
  conn.onclose = conn.onterminate = () => { if (hub.outlets.get(id) === o) { o.close = null; removeOutlet(id); } };
  return true;
};
window.addEventListener('pagehide', () => { hub.outlets.forEach((o) => { if (o.kind === 'cast' && o.close) o.close(); }); });

// ------------------------------------------------------------ 3. church network (companion)
let lanWs = null, lanEnc = null, lanTimer = null, lanWait = 1000, lanWant = null;
function setLan(state) { hub.lan = Object.assign({}, hub.lan, { state }); hub.emit('lan', hub.lan); }
function dropLanOutlets() { Array.from(hub.outlets.values()).filter((o) => o.kind === 'lan').forEach((o) => { o.close = null; removeOutlet(o.id); }); }
/** Connect to the companion's "stage" room (base: the companion address; local operators need no PIN). */
hub.connectLan = (base, pin) => {
  hub.disconnectLan();
  const u = new URL(base || location.origin);
  lanWant = { base: u.origin, pin: pin || '' };
  hub.lan = { state: 'connecting', base: u.origin };
  const url = (u.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + u.host + '/ws?role=control&room=stage&pin=' + encodeURIComponent(pin || '');
  const open = () => {
    const ws = new WebSocket(url);
    lanWs = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      lanWait = 1000;
      lanEnc = createEncoder((s) => ws.send(s), (b) => ws.send(b));
      setLan('on');
      // Screens already waiting say hello again when they hear this.
      lanEnc({ t: 'host' });
    };
    const dec = createDecoder((m) => {
      if (!m || !m.from) return;
      const id = 'lan:' + String(m.from).slice(0, 40);
      let o = hub.outlets.get(id);
      if (m.t === 'hello') {
        if (!o) o = addOutlet({ id, kind: 'lan', remote: true, label: 'Church network', send: (x) => { if (lanEnc) lanEnc(Object.assign({ to: m.from }, x)); }, close: null });
        // The pictures are shared by every screen on this connection: a new screen needs them all again.
        if (lanEnc) lanEnc.reset();
      }
      if (o) incoming(o, m);
    });
    ws.onmessage = (e) => (typeof e.data === 'string' ? dec.text(e.data) : dec.binary(e.data));
    ws.onclose = (e) => {
      if (lanWs !== ws) return;
      lanEnc = null; dropLanOutlets();
      if (e.code === 4001) { setLan('pin'); lanWant = null; return; }
      if (!lanWant) { setLan('off'); return; }
      setLan('connecting');
      lanTimer = setTimeout(open, lanWait); lanWait = Math.min(lanWait * 2, 10000);
    };
  };
  open();
};
hub.disconnectLan = () => {
  lanWant = null; clearTimeout(lanTimer);
  const ws = lanWs; lanWs = null; lanEnc = null;
  if (ws) { try { ws.close(); } catch (e) { /* */ } }
  dropLanOutlets();
  setLan('off');
};

// ------------------------------------------------------------ 4. phones and laptops over the internet
let net = null, netToken = 0;
function setNet(state, error) { hub.net = { state, error: error || '', since: Date.now() }; hub.emit('net', hub.net); }
/** Make sure there is a room code and a control PIN. */
hub.ensureCode = () => {
  if (!settings.v.stage.code) settings.set('stage.code', newCode());
  if (!settings.v.stage.pin) settings.set('stage.pin', newPin());
  return settings.v.stage.code;
};
hub.goOnline = async (on) => {
  const tok = ++netToken;
  if (net) { const n = net; net = null; Array.from(hub.outlets.values()).filter((o) => o.kind === 'peer').forEach((o) => { o.close = null; removeOutlet(o.id); }); try { await n.close(); } catch (e) { /* */ } }
  if (settings.v.stage.online !== !!on) settings.set('stage.online', !!on);
  if (!on) { setNet('off'); return; }
  const code = hub.ensureCode();
  if (!navigator.onLine) { setNet('offline'); return; }
  setNet('starting');
  try {
    const room = await joinStageRoom(code, {
      host: true,
      turn: turnFrom(settings.v.stage),
      relays: relaysFrom(settings.v.stage.relays),
      onMessage: (m, peerId) => {
        const id = 'p:' + peerId;
        let o = hub.outlets.get(id);
        if (m && m.t === 'hello') {
          if (!o) o = addOutlet({ id, kind: 'peer', remote: true, label: 'Phone / laptop', peerId, send: (x) => room.send(peerId, x), close: null });
          if (o.sid && o.sid !== m.sid) room.reset(peerId);
          o.sid = m.sid;
        }
        if (o) incoming(o, m);
      },
      onJoin: (peerId) => { room.send(peerId, { t: 'host', v: PROTOCOL }); },
      onLeave: (peerId) => { const o = hub.outlets.get('p:' + peerId); if (o) { o.close = null; removeOutlet(o.id); } },
      onError: (e) => { console.warn('stage link', e); hub.emit('net-error', e); },
    });
    if (tok !== netToken) { room.close(); return; }
    net = room;
    setNet('on');
  } catch (e) {
    if (tok !== netToken) return;
    console.warn('stage link', e);
    setNet('error', (e && e.message) || String(e));
  }
};
/** A new code: everyone who joined with the old one is disconnected. */
hub.newCode = async () => {
  settings.set('stage.code', newCode());
  if (net || settings.v.stage.online) await hub.goOnline(true);
};
hub.newPin = () => {
  settings.set('stage.pin', newPin());
  // Devices that had control through the old PIN keep it only if the operator allowed them by hand.
  hub.outlets.forEach((o) => { if (o.kind === 'peer' || o.kind === 'lan' || o.kind === 'cast') { if (o.control) { o.control = false; o.granted = false; you(o); } } });
  hub.emit('outlets');
};
// Phones need a secure (https) page for the encrypted link. When this app runs from the companion
// (http://localhost or the church PC's address), the QR code points to the published site instead.
export const PUBLIC_BASE = 'https://leemcq.github.io/Church_Service/';
const joinBase = () => (location.protocol === 'https:' ? location.href : PUBLIC_BASE);
/** Address phones open (the QR code): the code travels after #, so it never reaches any web server. */
hub.joinUrl = (code) => {
  const u = new URL('stage.html', joinBase());
  const r = relaysFrom(settings.v.stage.relays);
  u.search = ''; u.hash = 'c=' + (code || settings.v.stage.code) + (r ? '&r=' + encodeURIComponent(r.join(',')) : '');
  return u.href;
};
/** Short address to type: …/stage (the page asks for the code). */
hub.shortUrl = () => new URL('stage', joinBase()).href.replace(/^https?:\/\//, '');
window.addEventListener('online', () => { if (settings.v.stage.online && hub.net.state !== 'on') hub.goOnline(true); });
window.addEventListener('offline', () => { if (hub.net.state === 'on' || hub.net.state === 'starting') setNet('offline'); });
window.addEventListener('pagehide', () => { if (net) { hub.outlets.forEach((o) => { if (o.kind === 'peer') sendTo(o, { t: 'bye' }); }); } });

/** Start what was on last time (the online link), a moment after the app has loaded. */
hub.start = () => {
  if (hub.started) return;
  hub.started = true;
  // A control PIN always exists: stage screens on any connection unlock control with it.
  if (!settings.v.stage.pin) settings.set('stage.pin', newPin());
  if (settings.v.stage.online) setTimeout(() => hub.goOnline(true), 1200);
};
