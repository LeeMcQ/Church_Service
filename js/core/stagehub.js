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
import { emitter, uid, debounce, throttle, isBlob, APP_SCOPE } from './util.js';
import { live } from './live.js';
import { link } from './link.js';
import { settings } from './settings.js';
import { createEncoder, createDecoder } from './wire.js';
import { joinStageRoom, newCode, newPin, turnFrom, relaysFrom, loadHostKey, signChallenge, canVerify } from './stagenet.js';

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
const thumbCache = new Map(); // max width -> WeakMap(blob -> Promise<blob>)
function thumb(blob, maxW = MAX_W) {
  let thumbs = thumbCache.get(maxW);
  if (!thumbs) { thumbs = new WeakMap(); thumbCache.set(maxW, thumbs); }
  let p = thumbs.get(blob);
  if (p) return p;
  p = (async () => {
    const t = blob.type || '';
    if (!/^image\//.test(t)) return null;
    if (blob.size <= 160 * 1024 || /svg|gif/.test(t)) return blob;
    try {
      const bmp = await createImageBitmap(blob);
      const sc = Math.min(1, maxW / bmp.width);
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
// Three sizes of copy: 'thumb' (stage screens, 1280 px), 'big' (OBS full slides, 1920 px) and 'text'
// (OBS lower thirds: words only, no pictures except the logo).
const SIZES = { thumb: { maxW: 1280 }, big: { maxW: 1920 }, text: { maxW: 512, keep: new Set(['logoBlob']) } };
const deckCopies = { thumb: new WeakMap(), big: new WeakMap(), text: new WeakMap() }; // a deck is copied once
function slim(v, size, depth = 0, key = '') {
  if (v == null) return v;
  if (typeof v === 'function') return undefined;
  if (typeof v !== 'object') return v;
  const sz = SIZES[size];
  if (isBlob(v)) return sz.keep && !sz.keep.has(key) ? null : thumb(v, sz.maxW);
  if (isStream(v) || depth > 14) return null;
  if (Array.isArray(v)) return Promise.all(v.map((x) => slim(x, size, depth + 1, key)));
  if (Array.isArray(v.frames)) {
    let p = deckCopies[size].get(v);
    if (!p) { p = slimObj(v, size, depth); deckCopies[size].set(v, p); }
    return p;
  }
  return slimObj(v, size, depth);
}
async function slimObj(v, size, depth) {
  const out = {};
  const keys = Object.keys(v);
  const vals = await Promise.all(keys.map((k) => slim(v[k], size, depth + 1, k)));
  keys.forEach((k, i) => { if (vals[i] !== undefined) out[k] = vals[i]; });
  return out;
}
const slimmed = { thumb: new WeakMap(), big: new WeakMap(), text: new WeakMap() };
const remoteCopy = (msg, size = 'thumb') => { let p = slimmed[size].get(msg); if (!p) { p = slim(msg, size); slimmed[size].set(msg, p); } return p; };

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
    const p = remoteCopy(msg, o.size || 'thumb');
    o.q = o.q.then(() => p).then((m) => { if (hub.outlets.get(o.id) === o) o.send(m); }).catch((e) => console.warn('stage send', e));
  } else {
    try { o.send(msg); }
    catch (e) { remoteCopy(msg).then((m) => { try { o.send(m); } catch (er) { /* closed */ } }); }
  }
}
function broadcast(msg) { hub.outlets.forEach((o) => { if (o.ready) sendTo(o, msg); }); }
hub.count = (pred) => { let n = 0; hub.outlets.forEach((o) => { if (o.ready && (!pred || pred(o))) n++; }); return n; };
/** Stage screens people can see in the list (the preview inside the Stage tab is not one). */
hub.screens = () => Array.from(hub.outlets.values()).filter((o) => o.ready && o.kind !== 'preview' && o.role !== 'obs');
/** OBS browser sources that are connected (lower third / presentation). */
hub.obsOutputs = () => Array.from(hub.outlets.values()).filter((o) => o.ready && o.kind !== 'preview' && o.role === 'obs');

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
// (A rebuilt cue — the same hymn with other options — is a new object, so it is sent again.)
let lastNextRef = null;
function nextMsg(full) {
  const s = live.staged, c = live.cue;
  if (!s) { lastNextRef = null; return { t: 'next', cue: null }; }
  if (c && s.id && s.id === c.id) { lastNextRef = null; return { t: 'next', same: true, index: s.index || 0 }; }
  if (!full && s === lastNextRef && s.deck === lastNextRef.deckRef) return { t: 'next', keep: true, index: s.index || 0 };
  lastNextRef = s; s.deckRef = s.deck;
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
  sendTo(o, cfgMsg());
  const st = live.style;
  if (st) sendTo(o, { t: 'style', style: st });
  else live.buildStyle().then((s) => sendTo(o, { t: 'style', style: s })).catch(() => {});
  sendTo(o, liveMsg());
  sendTo(o, nextMsg(full));
  sendTo(o, timersMsg());
  sendTo(o, { t: 'msg', m: hub.msg });
  sendTo(o, { t: 'plan', plan: hub.plan });
  sendTo(o, obsMsg());
  if (live.media) sendTo(o, mediaMsg(live.media));
}

// ------------------------------------------------------------ live stream (OBS) overlays
// What the OBS browser sources show besides the slides: lower thirds (a name, an announcement, or —
// automatically — the Bible verse or hymn words on screen), a scrolling ticker and the church logo.
// Like stage messages, none of this goes to the projector.
hub.lower = null;        // {id, title, text, kind, until}
hub.ticker = null;       // {id, text}
hub.overlaysOn = true;   // the "Hide all overlays" switch
function streamCfg() {
  const s = settings.v.stream;
  return { autoBible: s.autoBible, autoHymns: s.autoHymns, hymnMode: s.hymnMode, autoOther: s.autoOther, theme: s.theme, pos: s.pos, size: s.size,
    bug: s.bug, fullBg: s.fullBg, accent: s.accent || '', presScene: s.presScene || '', church: ((settings.v.church && settings.v.church.name) || '').trim() };
}
function obsMsg() { return { t: 'obs', cfg: streamCfg(), lower: hub.lower, ticker: hub.ticker, on: hub.overlaysOn, pres: hub.obsOnPres, now: Date.now() }; }
/** Set by obsctl.js: the scene on air in OBS. While the presentation scene is on air the lower third leaves out
 *  the automatic words (the slide already shows them); names and the ticker stay. */
hub.obsOnPres = false;
hub.setObsProgram = (program, presScene) => { const on = !!program && program === presScene; if (on !== hub.obsOnPres) { hub.obsOnPres = on; pushObs(); } };
const pushObs = debounce(() => { broadcast(obsMsg()); hub.emit('overlay'); }, 40);
settings.on('change:stream', (p) => { if (!/^stream\.(obs|names|autoScene|camScene|presScene|mediaScene|studioPreview)/.test(p)) pushObs(); });
let lowerT = null;
/** Show a lower third: {title, text, kind: 'name'|'text'}; sec 0 = until hidden. */
hub.showLower = (item, sec) => {
  clearTimeout(lowerT);
  const title = String((item && item.title) || '').trim().slice(0, 120), text = String((item && item.text) || '').trim().slice(0, 400);
  if (!title && !text) { hub.hideLower(); return; }
  sec = sec != null ? +sec : +settings.v.stream.lowerSec || 0;
  hub.lower = { id: uid(), title, text, kind: (item && item.kind) || 'name', until: sec > 0 ? Date.now() + sec * 1000 : 0 };
  if (sec > 0) { const id = hub.lower.id; lowerT = setTimeout(() => { if (hub.lower && hub.lower.id === id) hub.hideLower(); }, sec * 1000); }
  pushObs();
};
hub.hideLower = () => { clearTimeout(lowerT); hub.lower = null; pushObs(); };
hub.setTicker = (text) => { text = String(text || '').trim().slice(0, 600); hub.ticker = text ? { id: uid(), text } : null; pushObs(); };
hub.setOverlays = (on) => { hub.overlaysOn = !!on; pushObs(); };
const mediaMsg = (m) => ({ t: 'media', time: m.time || 0, dur: m.dur || 0, paused: !!m.paused, now: Date.now() });

live.on('live', () => { lastNextRef = null; broadcast(liveMsg()); pushNext(); });
live.on('go', (i) => { broadcast({ t: 'go', index: i }); pushNext(); });
live.on('blank', (mode) => broadcast({ t: 'blank', mode }));
live.on('style', (s) => broadcast({ t: 'style', style: s }));
live.on('media', throttle((m) => broadcast(mediaMsg(m)), 1000));
const pushNext = debounce(() => broadcast(nextMsg(false)), 60);
live.on('staged', pushNext);
settings.on('change:stage', (p) => {
  if (p === 'stage.timers' || p === 'stage.presets' || p === 'stage.hostKey') return;
  pushCfg();
  // The featured timer and the amber warning are part of the timers message.
  if (p === 'stage.featured' || p === 'stage.warnSec') broadcast(timersMsg());
  // Control for the stage window changes at once (not only when it next connects).
  if (p === 'stage.allowWinControl') hub.outlets.forEach((o) => { if (o.kind === 'window' && o.ready) { o.control = settings.v.stage.allowWinControl !== false; you(o); } });
  if (p === 'stage.allowWinControl') hub.emit('outlets');
});
settings.on('change:church', () => pushCfg());
settings.on('change:display', (p) => { if (p === 'display.aspect') pushCfg(); });
link.on('hello', () => pushCfg());
const pushCfg = debounce(() => broadcast(cfgMsg()), 120);

// Keep-alive (also lets the stage notice a lost connection and keep its clock in step).
setInterval(() => {
  if (!hub.outlets.size) return;
  broadcast({ t: 'ping', now: Date.now() });
  // Screens on the church network answer every ping; one that has been silent for 35 s is gone
  // (the companion does not report closed connections).
  const now = Date.now();
  hub.outlets.forEach((o) => { if (o.kind === 'lan' && o.ready && now - (o.lastSeen || 0) > 35000) { o.close = null; removeOutlet(o.id); } });
}, 10000);

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
  hub.emit('plan', p);
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
      if (t.mode === 'down') { if (t.running) t.endAt += ms; else t.left = ms < 0 ? Math.max(Math.min(val, 0), val + ms) : val + ms; if (val + ms > 0) overNotified.delete(t.id); }
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
// One lock for the whole hub: five wrong PINs (from any screen, in a hello or by Unlock) lock PIN entry for a
// minute. Per screen it could be dodged by reloading or by joining again under a new name.
const ATTEMPTS = 5;
const pinLock = { fails: 0, until: 0 };
function pinCheck(pin) {
  if (pin == null || pin === '') return false;
  if (Date.now() < pinLock.until) return 'wait';
  if (settings.v.stage.pin && String(pin) === settings.v.stage.pin) { pinLock.fails = 0; return true; }
  if (++pinLock.fails >= ATTEMPTS) { pinLock.fails = 0; pinLock.until = Date.now() + 60000; }
  return false;
}
// Devices whose control the operator switched off: a saved PIN does not give it back (until New PIN).
const revoked = new Set();
function you(o, extra) { sendTo(o, Object.assign({ t: 'you', id: o.id, control: !!o.control, name: o.name || '' }, extra || {})); }
async function welcome(o, m) {
  // OBS browser sources: larger pictures for the full-slide output, words only for the lower third.
  if (m.kind === 'obs') { o.role = 'obs'; o.mode = m.mode === 'full' ? 'full' : 'lower'; if (o.remote) o.size = o.mode === 'full' ? 'big' : 'text'; }
  else o.role = 'stage';
  o.dev = String(m.dev || '').slice(0, 60);
  o.did = String(m.did || '').slice(0, 40);
  o.name = String(m.name || '').trim().slice(0, 40) || o.name || (o.role !== 'obs' && (o.kind === 'peer' || o.kind === 'lan') ? o.dev : '') || defaultName(o);
  if (o.kind === 'preview') o.control = true;
  else if (o.kind === 'window') o.control = settings.v.stage.allowWinControl !== false;
  else if (o.granted != null) o.control = o.granted;
  else if (o.did && revoked.has(o.did)) o.control = false;
  else { o.control = pinCheck(m.pin) === true; if (o.control) o.via = 'pin'; }
  // Over the internet the screen checks that this really is the media desk: sign its challenge first.
  let hi = { t: 'hi', v: PROTOCOL, now: Date.now() };
  if (o.kind === 'peer' && m.nonce && hub.key) {
    try { hi = Object.assign(hi, { pub: hub.key.pub, sig: await signChallenge(hub.key, String(m.nonce).slice(0, 64)) }); } catch (e) { /* */ }
  }
  if (!hub.outlets.has(o.id)) return; // left meanwhile
  o.ready = true;
  o.lastSeen = Date.now();
  sendTo(o, hi);
  you(o);
  snapshot(o, true);
  hub.emit('outlets');
  if (o.kind !== 'preview') hub.emit('joined', o);
}
function defaultName(o) { if (o.role === 'obs') return 'OBS · ' + (o.mode === 'full' ? 'presentation' : 'lower third'); return { window: 'Stage window', cast: 'Cast screen', lan: 'Church network screen', peer: 'Phone / laptop' }[o.kind] || 'Stage screen'; }

function incoming(o, m) {
  if (!m || typeof m !== 'object' || !m.t) return;
  o.lastSeen = Date.now();
  switch (m.t) {
    case 'hello': welcome(o, m); return;
    case 'auth': {
      const r = pinCheck(m.pin);
      if (r === true) { o.control = true; o.granted = null; o.via = 'pin'; if (o.did) revoked.delete(o.did); }
      you(o, r === true ? null : { denied: r === 'wait' ? 'wait' : 'pin' });
      hub.emit('outlets');
      return;
    }
    case 'name': o.name = String(m.name || '').trim().slice(0, 40) || o.name; hub.emit('outlets'); return;
    case 'pong': return;
    case 'talk': {
      const text = String(m.text || '').trim().slice(0, 300);
      if (!text) return;
      // At most one message every 3 seconds per screen (nobody can flood the media desk).
      if (o.lastTalk && Date.now() - o.lastTalk < 3000) { sendTo(o, { t: 'talked', id: m.id || '', slow: true }); return; }
      o.lastTalk = Date.now();
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
  o.control = !!on; o.granted = !!on; o.via = on ? 'hand' : null;
  if (o.did) { if (on) revoked.delete(o.did); else revoked.add(o.did); }
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
const WIN_NAME = 'selah-stage:' + APP_SCOPE;
// Up to two stage windows on this PC (e.g. one for the preacher, one for the singers / band).
const stageWins = { 1: null, 2: null };
const winName = (slot) => WIN_NAME + (slot > 1 ? ':' + slot : '');
function windowOutlet(w, kind, slot = 1) {
  for (const o of hub.outlets.values()) if (o.w === w) return o;
  return addOutlet({
    id: kind === 'preview' ? 'preview:' + uid() : kind === 'hdmi' ? 'hdmi:' + uid() : slot > 1 ? 'win' + slot : 'win', kind, remote: false, w, slot,
    label: kind === 'preview' ? 'Preview' : kind === 'hdmi' ? 'HDMI output' : slot > 1 ? 'Stage window ' + slot : 'Stage window',
    send: (m) => { if (w.closed) throw new Error('closed'); w.postMessage(m, location.origin); },
    close: () => { if ((kind === 'window' || kind === 'hdmi') && !w.closed) { try { w.close(); } catch (e) { /* */ } } },
  });
}
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.stage !== 1 || !e.source) return;
  const m = e.data;
  let o = null;
  for (const x of hub.outlets.values()) if (x.w === e.source) { o = x; break; }
  if (!o) {
    if (m.t !== 'hello') return;
    const slot = m.slot === 2 ? 2 : 1;
    o = windowOutlet(e.source, m.kind === 'preview' || m.preview ? 'preview' : m.kind === 'obs' ? 'hdmi' : 'window', slot);
    if (o.kind === 'window') stageWins[slot] = e.source;
  }
  incoming(o, m);
});
setInterval(() => {
  hub.outlets.forEach((o) => { if (o.w && o.w.closed) removeOutlet(o.id); });
}, 1500);
// A reloaded control page finds a stage window that is still open.
try {
  const bc = new BroadcastChannel('selah-stage:' + APP_SCOPE);
  bc.postMessage({ t: 'who' });
  hub.bc = bc;
} catch (e) { /* old browser */ }

async function pickStageScreen(slot = 1) {
  if (!('getScreenDetails' in window)) return null;
  try {
    let state = 'prompt';
    try { state = (await navigator.permissions.query({ name: 'window-management' })).state; } catch (e) { /* */ }
    if (state === 'denied') return null;
    const sd = await window.getScreenDetails();
    const want = slot > 1 ? settings.v.stage.screenLabel2 : settings.v.stage.screenLabel;
    const proj = settings.v.display.screenLabel;
    if (slot > 1) {
      const used = new Set([proj, settings.v.display.screenLabel2, settings.v.stage.screenLabel].filter(Boolean));
      const others2 = sd.screens.filter((s) => s !== sd.currentScreen && !used.has(s.label));
      return (want && sd.screens.find((s) => s.label === want)) || others2[0] || null;
    }
    const others = sd.screens.filter((s) => s !== sd.currentScreen);
    // Prefer the screen chosen for the stage, then a screen that is neither this one nor the projector.
    return (want && sd.screens.find((s) => s.label === want)) || others.find((s) => s.label !== proj && s.label !== settings.v.display.screenLabel2) || null;
  } catch (e) { return null; }
}
hub.listScreens = async () => {
  if (!('getScreenDetails' in window)) return null;
  try { const sd = await window.getScreenDetails(); return { screens: sd.screens, current: sd.currentScreen }; } catch (e) { return null; }
};
/** Open (or bring back) the stage window, on another screen when there is one. */
hub.openWindow = async (slot = 1) => {
  slot = slot === 2 ? 2 : 1;
  const cur = stageWins[slot];
  if (cur && !cur.closed) { try { cur.focus(); } catch (e) { /* */ } return true; }
  const url = new URL('stage.html?via=win' + (slot > 1 ? '&slot=2' : ''), location.href).href;
  const scr = await pickStageScreen(slot);
  let features = 'popup=yes';
  if (scr) features += ',left=' + scr.availLeft + ',top=' + scr.availTop + ',width=' + scr.availWidth + ',height=' + scr.availHeight + ',fullscreen';
  else features += ',width=1280,height=760';
  const w = window.open(url, winName(slot), features);
  if (!w) { hub.emit('blocked'); return false; }
  stageWins[slot] = w;
  // Ask the window to go full screen on its screen once it is up (this click allows it).
  setTimeout(() => { try { if (!w.closed) w.postMessage({ stage: 1, t: 'fullscreen' }, { targetOrigin: location.origin, delegate: 'fullscreen' }); } catch (e) { try { w.postMessage({ stage: 1, t: 'fullscreen' }, location.origin); } catch (er) { /* */ } } }, 700);
  return true;
};
hub.windowOpen = (slot = 1) => !!(stageWins[slot === 2 ? 2 : 1] && !stageWins[slot === 2 ? 2 : 1].closed);

// ------------------------------------------------------------ 1b. stream picture on a screen (HDMI into OBS)
// For OBS on another PC with a USB HDMI capture card: the lower third (on green, for OBS's Chroma Key) or the
// slides, full screen on the screen whose cable goes to that capture card.
const hdmiWins = {};
hub.openHdmi = async (mode, bg, screen) => {
  mode = mode === 'full' ? 'full' : 'lower';
  const name = 'selah-hdmi-' + mode + ':' + APP_SCOPE;
  const url = new URL('obs.html?via=win&mode=' + mode + '&bg=' + encodeURIComponent(bg || (mode === 'full' ? 'black' : 'green')), location.href).href;
  let features = 'popup=yes';
  if (screen) features += ',left=' + screen.availLeft + ',top=' + screen.availTop + ',width=' + screen.availWidth + ',height=' + screen.availHeight + ',fullscreen';
  else features += ',width=960,height=540';
  const old = hdmiWins[mode];
  if (old && !old.closed) { try { old.close(); } catch (e) { /* */ } }
  const w = window.open(url, name, features);
  if (!w) { hub.emit('blocked'); return false; }
  hdmiWins[mode] = w;
  setTimeout(() => { try { if (!w.closed) w.postMessage({ stage: 1, t: 'fullscreen' }, { targetOrigin: location.origin, delegate: 'fullscreen' }); } catch (e) { try { w.postMessage({ stage: 1, t: 'fullscreen' }, location.origin); } catch (er) { /* */ } } }, 800);
  return true;
};
hub.hdmiOpen = (mode) => !!(hdmiWins[mode] && !hdmiWins[mode].closed);
hub.closeHdmi = (mode) => { const w = hdmiWins[mode]; if (w && !w.closed) { try { w.close(); } catch (e) { /* */ } } hdmiWins[mode] = null; hub.emit('outlets'); };
hub.closeWindow = (slot = 1) => { slot = slot === 2 ? 2 : 1; for (const o of hub.outlets.values()) if (o.kind === 'window' && (o.slot || 1) === slot) removeOutlet(o.id); stageWins[slot] = null; };
// The stage window stays open when this page reloads (it finds the new page again); it closes itself if
// the app is really closed (stage-main.js).

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
      // Every screen on the church network sends a secret key of its own with each message. The companion
      // passes screens' messages only to the media desk, so no other screen can learn it — and no other
      // screen can act in its name (for example use the control it was given).
      const key = typeof m.key === 'string' ? m.key.slice(0, 64) : '';
      if (o && (!key || key !== o.key)) return;
      if (m.t === 'hello') {
        if (!o) {
          if (!key || hub.count((x) => x.kind === 'lan') >= 60) return;
          o = addOutlet({ id, kind: 'lan', remote: true, label: 'Church network', key, send: (x) => { if (lanEnc) lanEnc(Object.assign({ to: m.from }, x)); }, close: null });
        }
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
/** The media desk's signing key (its fingerprint goes into the QR code and the OBS addresses). */
hub.keyReady = (async () => {
  if (!canVerify()) return null;
  try { hub.key = await loadHostKey({ get: () => settings.v.stage.hostKey, set: (v) => settings.set('stage.hostKey', v) }); hub.emit('net', hub.net); return hub.key; }
  catch (e) { console.warn('stage key', e); return null; }
})();
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
  await hub.keyReady;
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
  // Only control that came from the old PIN ends; screens the operator allowed by hand keep it.
  revoked.clear(); pinLock.fails = 0; pinLock.until = 0;
  hub.outlets.forEach((o) => { if ((o.kind === 'peer' || o.kind === 'lan' || o.kind === 'cast') && o.control && o.via === 'pin') { o.control = false; o.granted = null; you(o); } });
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
  u.search = ''; u.hash = 'c=' + (code || settings.v.stage.code) + (hub.key ? '&h=' + hub.key.fp : '') + (r ? '&r=' + encodeURIComponent(r.join(',')) : '');
  return u.href;
};
/**
 * Address of an OBS browser source (mode 'lower' or 'full'). With the companion running, OBS loads it from the
 * church PC (works without internet); otherwise it follows by room code like a phone does.
 */
hub.obsUrl = (mode, ctx) => {
  const comp = ctx && ctx.companion;
  if (comp) {
    let obsHost = '';
    try { obsHost = new URL(settings.v.stream.obsUrl.replace(/^ws/, 'http')).hostname; } catch (e) { /* */ }
    const onThisPc = !obsHost || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(obsHost);
    const base = onThisPc ? location.protocol + '//localhost:' + (location.port || '80') : ((comp.urls && comp.urls[0]) || location.origin);
    return base + '/obs.html?via=lan&mode=' + mode;
  }
  const r = relaysFrom(settings.v.stage.relays);
  const u = new URL('obs.html', joinBase());
  u.search = ''; u.hash = 'c=' + hub.ensureCode() + '&mode=' + mode + (hub.key ? '&h=' + hub.key.fp : '') + (r ? '&r=' + encodeURIComponent(r.join(',')) : '');
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
