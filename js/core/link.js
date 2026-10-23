// Connection from the control screen to the output display.
//   window  – a pop-up on the extended screen (PC). Fastest: direct object hand-over, no copies.
//   self    – this device becomes the screen (phone/tablet on HDMI or screen mirroring)
//   cast    – Presentation API (Chromecast / wireless display from Chrome)
//   socket  – SDA Sabbath companion on the LAN (TV browser or second PC shows display.html?via=ws)
import { emitter, h } from './util.js';
import { createEncoder, createDecoder } from './wire.js';
import { settings } from './settings.js';

const WIN_NAME = 'selah-display';
export const link = emitter({ kind: null, ready: false, info: { w: 1920, h: 1080, label: '' }, win: null, self: null });

let sendImpl = null;
let lastStream = null;
let pollT = null;
let ws = null, wsEnc = null, wsTimer = null;
let castConn = null, castEnc = null;
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('selah-display') : null;
let displayAlive = false;
if (bc) {
  bc.onmessage = (e) => { if (e.data && e.data.t === 'here') { displayAlive = true; link.emit('found'); } };
  bc.postMessage({ t: 'who' });
}

function setState(kind, ready, label) {
  link.kind = kind; link.ready = ready;
  if (label != null) link.info.label = label;
  link.emit('state');
}

// Each display page has a session id. A new one (page reloaded, TV reconnected) has none of the
// pictures sent before, so the encoders forget what they sent and send pictures again.
let displaySid = null;
function onDisplayMsg(m) {
  if (!m || !m.t) return;
  if (m.t === 'ack') { if (m.q > link.acked) link.acked = m.q; link.emit('ack'); return; }
  if (m.t === 'fs') { link.displayFull = !!m.on; link.emit('fs', link.displayFull); return; }
  if (m.t === 'hello') {
    if (!m.sid || m.sid !== displaySid) {
      displaySid = m.sid || null;
      if (wsEnc && wsEnc.reset) wsEnc.reset();
      if (castEnc && castEnc.reset) castEnc.reset();
    }
    link.info.w = m.w; link.info.h = m.h;
    if (m.full != null) link.displayFull = !!m.full;
    if (link.kind === 'window' && link.win) { try { link.win.postMessage({ t: 'keepfull', on: settings.v.display.keepFull !== false }, location.origin); } catch (e) { /* */ } }
    if (!link.ready) setState(link.kind, true);
    link.emit('hello', m);
  }
  link.emit('msg', m);
}

window.addEventListener('message', (e) => {
  // This page was reloaded (an accidental F5, or after a crash) while the projector window stayed open: the
  // window says it is there, and the app takes it over again — the projector never went blank.
  if (e.origin === location.origin && e.data && e.data.t === 'here-win' && e.source && !link.kind) {
    attachWindow(e.source, 'Display window');
    link.emit('reattached');
    return;
  }
  if (e.origin !== location.origin || !link.win || e.source !== link.win) return;
  onDisplayMsg(e.data);
});

// Messages that change the picture carry a number when the display is on the TV or another computer.
// The display answers {t:'ack', q} once it has drawn that change, so the Live monitor can follow the
// real screen instead of running ahead of it.
const PICTURE_MSGS = new Set(['deck', 'go', 'blank', 'clear']);
let seq = 0;
link.acked = 0; link.lastQ = 0;
link.remote = () => !!link.ready && (link.kind === 'cast' || link.kind === 'socket');
link.send = (msg) => {
  if (!sendImpl) return;
  if (PICTURE_MSGS.has(msg.t) && link.remote()) { msg = Object.assign({}, msg, { q: ++seq }); link.lastQ = seq; }
  sendImpl(msg);
};
/** Resolves when the display has drawn change number q (or after ms, so a lost answer never freezes the monitor). */
link.whenShown = (q, ms = 1500) => new Promise((res) => {
  if (!q || link.acked >= q) { res(); return; }
  let off = null;
  const done = () => { clearTimeout(t); if (off) off(); res(); };
  const t = setTimeout(done, ms);
  off = link.on('ack', () => { if (link.acked >= q) done(); });
});
link.aspect = () => {
  const a = settings.v.display.aspect;
  if (typeof a === 'string' && a !== 'auto') { const [x, y] = a.split(':').map(Number); if (x > 0 && y > 0) return x / y; }
  return link.info.w && link.info.h ? link.info.w / link.info.h : 16 / 9;
};

/** Direct (same-memory) access to the display, available for window and self links. */
link.direct = () => {
  if (link.kind === 'self' && link.self) return link.self.display;
  if (link.kind === 'window' && link.win && !link.win.closed) { try { return link.win.SelahDisplay || null; } catch (e) { return null; } }
  return null;
};

link.setStream = (stream) => {
  lastStream = stream || null;
  const d = link.direct();
  if (d) { d.setStream(lastStream); return true; }
  return false;
};
link.canStream = () => link.kind === 'window' || link.kind === 'self';

// ------------------------------------------------------------ window on an extended screen
async function pickScreen(allowPrompt) {
  if (!('getScreenDetails' in window)) return null;
  try {
    let state = 'prompt';
    try { state = (await navigator.permissions.query({ name: 'window-management' })).state; } catch (e) { /* older name */ }
    if (state === 'denied' || (state !== 'granted' && !allowPrompt)) return null;
    const sd = await window.getScreenDetails();
    const want = settings.v.display.screenLabel;
    const others = sd.screens.filter((s) => s !== sd.currentScreen);
    return (want && sd.screens.find((s) => s.label === want)) || others[0] || null;
  } catch (e) { return null; }
}

export async function listScreens() {
  if (!('getScreenDetails' in window)) return null;
  try { const sd = await window.getScreenDetails(); return { screens: sd.screens, current: sd.currentScreen }; }
  catch (e) { return null; }
}

/**
 * Ask the display window to go (back) to full screen. Browsers only allow full screen after a click or key
 * press; inside one on this control screen, the permission is handed to the display window
 * (capability delegation), so it works without anyone touching the projector.
 */
link.displayFull = null;
link.fullscreenDisplay = () => {
  const w = link.win;
  if (link.kind !== 'window' || !w || w.closed) return false;
  try { w.postMessage({ t: 'fullscreen' }, { targetOrigin: location.origin, delegate: 'fullscreen' }); return true; }
  catch (e) { try { w.postMessage({ t: 'fullscreen' }, location.origin); } catch (er) { /* closed */ } return false; }
};

link.openWindow = async ({ prompt = false } = {}) => {
  link.close(true);
  const url = new URL('display.html', location.href).href;
  // Reuse an already-open display window (e.g. after this control page was reloaded).
  let w = null;
  const scr = await pickScreen(true); // always prefer the extended screen
  let features = 'popup=yes';
  // 'fullscreen' opens the window straight in full screen on that screen (Chrome/Edge with Window management allowed).
  if (scr) features += ',left=' + scr.availLeft + ',top=' + scr.availTop + ',width=' + scr.availWidth + ',height=' + scr.availHeight + ',fullscreen';
  else features += ',width=1920,height=1080'
  if (displayAlive) {
    try { w = window.open('', WIN_NAME, features); } catch (e) { w = null; }
    if (w && !(() => { try { return w.SelahDisplay; } catch (e) { return null; } })()) { try { w.location.href = url; } catch (e) { /* */ } }
  }
  if (!w) w = window.open(url, WIN_NAME, features);
  if (!w) { link.emit('blocked'); return false; }
  attachWindow(w, scr ? scr.label || 'Second screen' : 'Display window');
  return true;
};
/** Use a display window: one just opened, or one still open from before this page was reloaded. */
function attachWindow(w, label) {
  link.win = w;
  sendImpl = (m) => { if (!w.closed) w.postMessage(m, location.origin); };
  setState('window', false, label);
  clearInterval(pollT);
  pollT = setInterval(() => { if (w.closed) { clearInterval(pollT); if (link.win === w) { link.win = null; sendImpl = null; setState(null, false, ''); } } }, 1000);
  // Handshake: ask until the display answers (its page may still be loading).
  let tries = 0;
  const ask = () => { if (link.win !== w || link.ready || tries++ > 40) return; sendImpl({ t: 'hello?' }); setTimeout(ask, 250); };
  ask();
  // Ask the display to go full screen once it is up.
  setTimeout(() => { try { if (!w.closed) w.postMessage({ t: 'fullscreen' }, location.origin); } catch (e) { /* */ } }, 500);
  if (lastStream) setTimeout(() => link.setStream(lastStream), 600);
}

// ------------------------------------------------------------ this device
link.openSelf = async (createDisplay) => {
  link.close(true);
  const wrap = h('div.self-display');
  const close = h('button.btn.self-close', { type: 'button', onclick: () => link.close() }, 'Exit display');
  wrap.appendChild(close);
  document.body.appendChild(wrap);
  const display = createDisplay(wrap, { post: (m) => setTimeout(() => onDisplayMsg(m), 0), self: true });
  link.self = { wrap, display };
  sendImpl = (m) => display.handle(m);
  setState('self', true, 'This device');
  try { await (wrap.requestFullscreen ? wrap.requestFullscreen({ navigationUI: 'hide' }) : wrap.webkitRequestFullscreen && wrap.webkitRequestFullscreen()); } catch (e) { /* */ }
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { /* */ }
  const onFs = () => { if (!document.fullscreenElement && link.kind === 'self') link.close(); };
  document.addEventListener('fullscreenchange', onFs);
  link.self.onFs = onFs;
  // Swipe left/right on the screen to move through slides. A long press (or two-finger tap) shows
  // "Exit display" for a few seconds; otherwise it never appears on the hall screen.
  let sx = null, sy = null, holdT = null, hideT = null;
  const reveal = () => { wrap.classList.add('reveal'); clearTimeout(hideT); hideT = setTimeout(() => wrap.classList.remove('reveal'), 2500); };
  wrap.addEventListener('touchstart', (e) => {
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    clearTimeout(holdT);
    if (e.touches.length >= 2) { reveal(); return; }
    holdT = setTimeout(reveal, 650);
  }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    if (sx != null && (Math.abs(e.touches[0].clientX - sx) > 12 || Math.abs(e.touches[0].clientY - sy) > 12)) clearTimeout(holdT);
  }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    clearTimeout(holdT);
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 50) link.emit('msg', { t: 'key', key: dx < 0 ? 'ArrowRight' : 'ArrowLeft' });
  });
  display.sayHello();
  if (lastStream) display.setStream(lastStream);
  return true;
};

// ------------------------------------------------------------ Cast / wireless display
let keepAliveTimer = null;
function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if ((link.kind === 'cast' || link.kind === 'socket') && sendImpl) {
      try { sendImpl({ t: 'ping' }); } catch (e) { /* ignore */ }
    }
  }, 12000); // every 12s so Chromecast and LAN sessions do not idle-timeout
}
function stopKeepAlive() {
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}

link.canCast = () => typeof window.PresentationRequest === 'function';
link.openCast = async () => {
  if (!link.canCast()) return false;
  link.close(true);
  const req = new PresentationRequest([new URL('display.html?via=cast', location.href).href]);
  // On Android, check availability first so we fail fast with a useful message
  // instead of hanging or saying "No screens found" with no context.
  try {
    const avail = await req.getAvailability();
    if (!avail.value) {
      const err = new Error('No cast device found.'); err.name = 'NoCastDevice'; throw err;
    }
  } catch (e) {
    if (e.name === 'NotSupportedError' || /not supported|not available/i.test(e.message)) { /* availability cannot be checked here: just try */ }
    else throw e;
  }
  const conn = await req.start();
  useCast(conn);
  return true;
};
function useCast(conn) {
  castConn = conn;
  conn.binaryType = 'arraybuffer';
  const dec = createDecoder(onDisplayMsg);
  castEnc = createEncoder((s) => conn.send(s), (b) => conn.send(b));
  conn.onmessage = (e) => (typeof e.data === 'string' ? dec.text(e.data) : dec.binary(e.data));
  conn.onclose = conn.onterminate = () => { if (castConn === conn) { castConn = null; sendImpl = null; setState(null, false, ''); } };
  sendImpl = (m) => castEnc(m);
  setState('cast', conn.state === 'connected', 'Cast display');
  conn.onconnect = () => { setState('cast', true); sendImpl({ t: 'hello?' }); startKeepAlive(); };
  if (conn.state === 'connected') { sendImpl({ t: 'hello?' }); startKeepAlive(); }
}

// ------------------------------------------------------------ LAN companion
link.connectSocket = (base, pin, room = 'main') => {
  link.close(true);
  const u = new URL(base || location.origin);
  const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = proto + '//' + u.host + '/ws?role=control&room=' + encodeURIComponent(room) + '&pin=' + encodeURIComponent(pin || '');
  let wait = 1000;
  const open = () => {
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const dec = createDecoder(onDisplayMsg);
    ws.onopen = () => {
      wait = 1000;
      wsEnc = createEncoder((s) => ws.send(s), (b) => ws.send(b));
      sendImpl = (m) => wsEnc && wsEnc(m);
      setState('socket', true, 'LAN display (' + u.host + ')'); startKeepAlive();
      sendImpl({ t: 'hello?' });
      link.emit('reconnected');
    };
    ws.onmessage = (e) => (typeof e.data === 'string' ? dec.text(e.data) : dec.binary(e.data));
    ws.onclose = (e) => {
      wsEnc = null;
      if (link.kind !== 'socket') return;
      if (e.code === 4001) { setState(null, false, ''); link.emit('pin-wrong'); return; }
      setState('socket', false);
      wsTimer = setTimeout(open, wait); wait = Math.min(wait * 2, 10000);
    };
  };
  setState('socket', false, 'LAN display (' + u.host + ')');
  open();
};

/** What the stop button says for the current display. */
link.stopLabel = () => ({ cast: 'Stop casting', window: 'Close the display window', socket: 'Disconnect from the companion', self: 'Exit display' }[link.kind] || 'Close display');

// Reloading the control page (an accidental F5, or after a crash) must never blank the projector: the display
// window and a cast stay as they are, and the reloaded page takes them over again (display window: it
// announces itself; cast: reconnect by its id). If the app is really closed, the display window closes itself
// a few seconds later (display-main.js) and a cast TV goes black after a short wait.
window.addEventListener('pagehide', () => {
  if (link.kind === 'cast' && castConn) { try { sessionStorage.setItem('selah.castId', castConn.id); } catch (e) { /* */ } }
});
// After a reload: take over the cast that was running.
(async () => {
  let id = null;
  try { id = sessionStorage.getItem('selah.castId'); sessionStorage.removeItem('selah.castId'); } catch (e) { /* */ }
  if (!id || !link.canCast()) return;
  try {
    const req = new PresentationRequest([new URL('display.html?via=cast', location.href).href]);
    const conn = await req.reconnect(id);
    if (!link.kind) { useCast(conn); link.emit('reattached'); }
  } catch (e) { /* the cast has ended meanwhile */ }
})();

link.close = (silent) => {
  clearInterval(pollT); clearTimeout(wsTimer);
  const kind = link.kind;
  if (kind === 'window' && link.win && !silent) { try { link.win.close(); } catch (e) { /* */ } }
  if (kind === 'self' && link.self) {
    document.removeEventListener('fullscreenchange', link.self.onFs);
    try { link.self.display.destroy(); } catch (e) { /* */ }
    link.self.wrap.remove(); link.self = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  if (kind === 'cast' && castConn) { try { castConn.terminate(); } catch (e) { /* */ } castConn = null; }
  stopKeepAlive();
  if (kind === 'socket' && ws) { link.kind = null; try { ws.close(); } catch (e) { /* */ } ws = null; }
  link.win = null;
  sendImpl = null;
  setState(null, false, '');
};
