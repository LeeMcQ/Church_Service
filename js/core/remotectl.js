// Remote control through the companion: a Stream Deck, Bitfocus Companion or any program sends
// http://localhost:7777/api/control/next (or …/goto?q=John 3:16, …/black …) and the companion passes the
// command to this page over a WebSocket. This page reports back what is live, for /api/status (button feedback).
import { emitter } from './util.js';

export const remote = emitter({ state: 'off', last: null, count: 0 });

let ws = null, timer = null, wanted = null, tries = 0, statusFn = null, handler = null;

function setState(s) { if (remote.state !== s) { remote.state = s; remote.emit('state', s); } }

function connect() {
  clearTimeout(timer);
  if (!wanted) return;
  const u = new URL('ws', wanted.origin.replace(/^http/, 'ws') + '/');
  u.searchParams.set('role', 'operator');
  if (wanted.pin) u.searchParams.set('pin', wanted.pin);
  setState('connecting');
  try { ws = new WebSocket(u.href); } catch (e) { retry(); return; }
  ws.onopen = () => { tries = 0; setState('on'); sendStatus(); };
  ws.onmessage = async (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch (er) { return; }
    if (!m || m.t !== 'cmd' || typeof m.op !== 'string') return;
    remote.last = { op: m.op, q: m.q || m.n || m.i || '', at: Date.now() };
    remote.count++;
    remote.emit('cmd', remote.last);
    try { if (handler) await handler(m.op, m); } catch (er) { console.warn('remote command', m.op, er); }
    setTimeout(sendStatus, 120);
  };
  ws.onclose = () => { ws = null; setState(wanted ? 'waiting' : 'off'); retry(); };
  ws.onerror = () => { /* onclose follows */ };
}
function retry() {
  if (!wanted) return;
  tries++;
  timer = setTimeout(connect, Math.min(15000, 1000 * tries));
}

/** Report what is live (title, slide, black …) so Stream Deck buttons can show it. */
export function sendStatus() {
  if (!ws || ws.readyState !== 1 || !statusFn) return;
  try { ws.send(JSON.stringify(Object.assign({ t: 'status', at: Date.now() }, statusFn()))); } catch (e) { /* */ }
}

/** Start listening for remote commands from the companion at `origin` (this PC). */
export function startRemote({ origin, pin, onCommand, status }) {
  handler = onCommand; statusFn = status;
  wanted = { origin, pin };
  if (!ws) connect();
}
