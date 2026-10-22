// Presentation clickers. Most send Page Down / Page Up (handled in app.js), but models differ: some send
// arrows, Browser Forward/Back, media keys, unusual F-keys, or act as a mouse (left/right click, wheel, side
// buttons). Clicker setup lets the church press each button once so the app learns it; the buttons taught
// here work everywhere, also while the cursor is in a search box.
import { settings } from './settings.js';
import { emitter } from './util.js';

export const ACTIONS = [
  ['next', 'Next slide'], ['prev', 'Previous slide'], ['black', 'Black screen'], ['present', 'Present (start)'], ['clear', 'Clear the screen'],
];
// Keys some clickers send that would otherwise do nothing (or worse: Browser Back leaves the app).
const DEFAULTS = {
  'key:BrowserForward': 'next', 'key:BrowserBack': 'prev', 'key:MediaTrackNext': 'next', 'key:MediaTrackPrevious': 'prev',
  'mouse:4': 'next', 'mouse:3': 'prev',
};

export const clicker = emitter({ testing: false });

/** A short name for what a device sent: 'key:PageDown', 'code:F14', 'mouse:3', 'wheel:down'. */
export function sigOfKey(e) {
  if (!e) return '';
  if (e.key && e.key !== 'Unidentified' && e.key !== 'Process') return 'key:' + e.key;
  return e.code ? 'code:' + e.code : '';
}
export const sigOfMouse = (button) => 'mouse:' + button;

function mapOf() { const m = settings.v.clicker && settings.v.clicker.map; return m && typeof m === 'object' ? m : {}; }

/** The action taught for this button, or a built-in one; null when the button means nothing special. */
export function actionFor(sig, { builtin = true } = {}) {
  if (!sig) return null;
  const m = mapOf();
  for (const [act] of ACTIONS) if (Array.isArray(m[act]) && m[act].includes(sig)) return act;
  return builtin ? DEFAULTS[sig] || null : null;
}
/** Teach: this button now does `act` (it is removed from any other action). */
export function teach(act, sig) {
  if (!sig || !ACTIONS.some(([a]) => a === act)) return;
  const m = JSON.parse(JSON.stringify(mapOf()));
  ACTIONS.forEach(([a]) => { m[a] = (Array.isArray(m[a]) ? m[a] : []).filter((x) => x !== sig); });
  m[act].push(sig);
  m[act] = m[act].slice(-4);
  settings.set('clicker.map', m);
}
export function forget() { settings.set('clicker.map', {}); }
export function taught() { return mapOf(); }

/** Plain words for a signature, e.g. 'key:PageDown' -> 'Page Down key'. */
export function describe(sig) {
  const [t, v] = String(sig).split(/:(.*)/);
  if (t === 'mouse') return ({ 0: 'Left click', 1: 'Middle click', 2: 'Right click', 3: 'Mouse “back” button', 4: 'Mouse “forward” button' })[v] || 'Mouse button ' + v;
  if (t === 'wheel') return 'Scroll wheel ' + v;
  if (t === 'code') return 'Key code ' + v;
  const names = { ' ': 'Space', PageDown: 'Page Down', PageUp: 'Page Up', ArrowRight: 'Right arrow', ArrowLeft: 'Left arrow', ArrowUp: 'Up arrow', ArrowDown: 'Down arrow', '.': 'Full stop (.)', Escape: 'Esc' };
  return (names[v] || v) + ' key';
}
