// Boot for display.html. Works with three kinds of controller:
//   1. the control window that opened us (postMessage + direct calls for screen-share streams)
//   2. a phone/PC using the Presentation API (Chromecast / wireless displays)
//   3. the SDA Sabbath companion on the LAN (WebSocket), e.g. a smart-TV browser or second PC
import { createDisplay } from './display/display.js';
import { createDecoder, createEncoder } from './core/wire.js';
import { sanitizeSlideHtml } from './core/render.js';

// Slides that arrive over a network link (the companion on the church network, or Cast) are cleaned before
// they are drawn: only plain formatting survives, never scripts, frames, event handlers or odd links. The
// window opened by SDA Sabbath on this PC is the app itself and needs no cleaning.
function cleanFrame(f) {
  if (!f || typeof f !== 'object') return;
  if (typeof f.html === 'string') f.html = sanitizeSlideHtml(f.html);
  if (Array.isArray(f.cols)) f.cols.forEach((c) => { if (c && typeof c.html === 'string') c.html = sanitizeSlideHtml(c.html); });
}
function clean(m) {
  if (m && m.t === 'deck' && m.deck && typeof m.deck === 'object') {
    if (Array.isArray(m.deck.frames)) m.deck.frames.forEach(cleanFrame);
    cleanFrame(m.deck.frame);
  }
  return m;
}

const params = new URLSearchParams(location.search);
const root = document.getElementById('root');
const outs = new Set();
const post = (m) => outs.forEach((f) => { try { f(m); } catch (e) { /* closed */ } });
const disp = createDisplay(root, { post });
window.SelahDisplay = disp; // direct API used by the opener window (streams, snapshots)

// 1) Opener / any same-origin control window that messages us
const winOuts = new Map();
function addWin(w) {
  if (!w || w === window || winOuts.has(w)) return;
  const f = (m) => { if (w.closed) { outs.delete(f); winOuts.delete(w); return; } w.postMessage(m, location.origin); };
  winOuts.set(w, f); outs.add(f);
}
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || !e.data.t) return;
  addWin(e.source);
  if (e.data.t === 'fullscreen') { if (!isFull()) goFull(); reportFull(); return; }
  if (e.data.t === 'keepfull') { keepFull = e.data.on !== false; reportFull(); return; }
  if (e.data.t === 'hello?') setTimeout(reportFull, 0);
  disp.handle(e.data);
});
try { addWin(window.opener); } catch (e) { /* */ }
// Lets a reloaded control tab find this window again.
try {
  const bc = new BroadcastChannel('selah-display');
  bc.onmessage = (e) => {
    if (!e.data || e.data.t !== 'who') return;
    bc.postMessage({ t: 'here' });
    // The control page that opened this window was reloaded: tell it directly, so it takes this window over.
    try { if (window.opener && !window.opener.closed) window.opener.postMessage({ t: 'here-win' }, location.origin); } catch (er) { /* */ }
  };
  bc.postMessage({ t: 'here' });
} catch (e) { /* old browser */ }

// The app that opened this window was closed for good (not just reloaded): close this window too after a
// few seconds, so no old slide is left on the projector with no one able to change it.
if (!params.get('via') && window.opener) {
  let gone = 0;
  setInterval(() => {
    let closed = true;
    try { closed = !window.opener || window.opener.closed; } catch (e) { closed = true; }
    gone = closed ? gone + 1 : 0;
    if (gone >= 4) { try { window.close(); } catch (e) { /* */ } }
  }, 1500);
}

// 2) Presentation API receiver (Cast / wireless display)
if (navigator.presentation && navigator.presentation.receiver) {
  navigator.presentation.receiver.connectionList.then((list) => {
    const setup = (conn) => {
      conn.binaryType = 'arraybuffer';
      const dec = createDecoder((m) => disp.handle(clean(m)));
      const enc = createEncoder((s) => conn.send(s), (b) => conn.send(b));
      outs.add(enc);
      conn.onmessage = (e) => (typeof e.data === 'string' ? dec.text(e.data) : dec.binary(e.data));
      let gone = false;
      conn.onclose = conn.onterminate = () => { if (gone) return; gone = true; outs.delete(enc); live--; endSoon(); };
      live++; clearTimeout(endT);
      disp.sayHello();
    };
    // The controlling app went away. It may only be reloading (an accidental F5) and come back in a moment, so
    // the slide stays up for 20 s; if nobody takes the cast over by then, the TV goes black and the cast ends.
    let live = 0, endT = null;
    const endSoon = () => {
      clearTimeout(endT);
      if (live > 0) return;
      endT = setTimeout(() => {
        if (live > 0) return;
        try { disp.handle({ t: 'clear', mode: 'black' }); } catch (e) { /* */ }
        endT = setTimeout(() => { if (live <= 0) { try { window.close(); } catch (e) { /* */ } } }, 5000);
      }, 20000);
    };
    list.connections.forEach(setup);
    list.onconnectionavailable = (e) => setup(e.connection);
  });
}

// 3) Companion WebSocket
if (params.get('via') === 'ws') {
  let ws = null, enc = null, wait = 1000;
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws?role=display&room=' + encodeURIComponent(params.get('room') || 'main') + '&pin=' + encodeURIComponent(params.get('pin') || ''));
    ws.binaryType = 'arraybuffer';
    const dec = createDecoder((m) => disp.handle(clean(m)));
    ws.onopen = () => {
      wait = 1000;
      enc = createEncoder((s) => ws.send(s), (b) => ws.send(b));
      outs.add(enc);
      disp.sayHello();
    };
    ws.onmessage = (e) => (typeof e.data === 'string' ? dec.text(e.data) : dec.binary(e.data));
    ws.onclose = () => { if (enc) outs.delete(enc); enc = null; setTimeout(connect, wait); wait = Math.min(wait * 2, 10000); };
  };
  connect();
}

// ---------------------------------------------------------------- full screen, keys, wake lock
// The projector stays full screen: it never leaves full screen by itself (a double click or the F key
// only go INTO full screen), and if the browser takes it out (Esc, a clicker's slide-show button), the
// next key or click here, or on the control screen, puts it back.
function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
let keepFull = true;
let lastFull = null;
function reportFull() { const on = isFull(); lastFull = on; post({ t: 'fs', on }); }
async function goFull() {
  const el = document.documentElement;
  try {
    let screen;
    if ('getScreenDetails' in window) {
      try { const sd = await window.getScreenDetails(); screen = sd.currentScreen; } catch (e) { /* no permission */ }
    }
    if (el.requestFullscreen) await el.requestFullscreen(screen ? { screen, navigationUI: 'hide' } : { navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch (e) { /* user must click */ }
}
function toggleFull() { if (isFull()) { if (!keepFull) (document.exitFullscreen || document.webkitExitFullscreen).call(document); } else goFull(); }
// Any key or click on the projector itself is also allowed to put it back.
const backToFull = () => { if (keepFull && !isFull() && !params.get('via')) goFull(); };
document.addEventListener('pointerdown', backToFull, true);
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') backToFull(); }, true);

// A clicker in mouse mode: once the projector window is full screen, left click = next, right click = back,
// scroll = next / back (like a PowerPoint slide show). The first click makes it full screen.
root.addEventListener('click', () => {
  const wasFull = isFull();
  if (!wasFull) goFull(); else post({ t: 'key', key: '', sig: 'mouse:0' });
  disp.hint(false); disp.unlockAudio();
});
root.addEventListener('contextmenu', (e) => { e.preventDefault(); post({ t: 'key', key: '', sig: 'mouse:2' }); });
let wheelAt = 0;
root.addEventListener('wheel', (e) => {
  e.preventDefault();
  const now = Date.now();
  if (now - wheelAt < 450 || Math.abs(e.deltaY) < 4) return;
  wheelAt = now;
  post({ t: 'key', key: '', sig: e.deltaY > 0 ? 'wheel:down' : 'wheel:up' });
}, { passive: false });
document.addEventListener('mouseup', (e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); post({ t: 'key', key: '', sig: 'mouse:' + e.button }); } });
document.addEventListener('auxclick', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
root.addEventListener('dblclick', () => { if (!isFull()) goFull(); else if (!keepFull) toggleFull(); });
const onFsChange = () => { disp.hint(false); reportFull(); };
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

const FORWARD = new Set(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'Home', 'End',
  'b', 'B', '.', 'Escape', 'F5', 'Enter', 'c', 'C', 'l', 'L', 'w', 'W']);
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFull(); return; }
  if (e.key === 'F11') { e.preventDefault(); if (!isFull()) goFull(); return; } // F11 browser full screen would fight with ours
  // Every key goes to the control screen (it knows the clicker buttons taught in Clicker setup).
  if (/^(Shift|Control|Alt|AltGraph|Meta|CapsLock|F11|F12|Tab)$/.test(e.key)) return;
  if (FORWARD.has(e.key) || e.key.length > 1) { if (e.key !== 'Escape' || !isFull()) e.preventDefault(); }
  post({ t: 'key', key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
});

let wake = null;
async function keepAwake() {
  if (wake && !wake.released) return; // one lock is enough
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) { /* */ }
}
document.addEventListener('visibilitychange', keepAwake);
keepAwake();

if (!params.get('via') && !isFull()) {
  disp.hint(true);
  // Try to go full screen immediately when opened on the extended screen.
  setTimeout(() => { if (!isFull()) goFull(); }, 300);
}
disp.sayHello();
setTimeout(reportFull, 50);
