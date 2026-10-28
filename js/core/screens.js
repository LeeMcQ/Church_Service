// The church's screen layout: which outputs this PC drives, and on which screen each one goes.
//   projector    the main projector (display window; has the sound of videos)
//   projector2   a second projector or TV showing the same picture (silent mirror)
//   stage        the stage (presenter / confidence) screen for the preacher
//   stage2       a second stage screen (e.g. singers or band)
// Layouts are chosen in Settings → Displays or in the first-start setup.
import { settings } from './settings.js';
import { link, listScreens } from './link.js';
import { hub } from './stagehub.js';

export const ROLES = [
  { id: 'projector', name: 'Projector', note: 'What the congregation sees. Plays the sound of videos.', key: 'display.screenLabel' },
  { id: 'projector2', name: 'Projector 2', note: 'A second projector or TV with the same picture (silent).', key: 'display.screenLabel2', flag: 'display.mirror' },
  { id: 'stage', name: 'Stage screen', note: 'For the preacher: this slide, the next one, notes, timers, messages.', key: 'stage.screenLabel', flag: 'stage.useWindow' },
  { id: 'stage2', name: 'Stage screen 2', note: 'A second stage screen, e.g. for the singers or the band.', key: 'stage.screenLabel2', flag: 'stage.second' },
];

export const LAYOUTS = [
  ['p', 'Projector only', { mirror: false, useWindow: false, second: false }],
  ['ps', 'Projector + stage screen', { mirror: false, useWindow: true, second: false }],
  ['pp', 'Two projectors', { mirror: true, useWindow: false, second: false }],
  ['pps', 'Two projectors + stage screen', { mirror: true, useWindow: true, second: false }],
  ['pss', 'Projector + two stage screens', { mirror: false, useWindow: true, second: true }],
  ['ppss', 'Two projectors + two stage screens', { mirror: true, useWindow: true, second: true }],
];

const get = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), settings.v);
export const enabled = (role) => {
  const r = ROLES.find((x) => x.id === role);
  return !!r && (!r.flag || get(r.flag) === true);
};
export function currentLayout() {
  const m = !!get('display.mirror'), s = !!get('stage.useWindow'), s2 = !!get('stage.second');
  const hit = LAYOUTS.find(([, , v]) => v.mirror === m && v.useWindow === s && v.second === (s && s2));
  return hit ? hit[0] : 'p';
}
export function setLayout(id) {
  const l = LAYOUTS.find((x) => x[0] === id);
  if (!l) return;
  settings.set('display.mirror', l[2].mirror);
  settings.set('stage.useWindow', l[2].useWindow);
  settings.set('stage.second', l[2].second);
  if (!l[2].mirror) link.closeMirror();
  if (!l[2].second && hub.windowOpen(2)) hub.closeWindow(2);
}

export function isOpen(role) {
  if (role === 'projector') return !!link.kind;
  if (role === 'projector2') return link.hasMirror();
  if (role === 'stage') return hub.windowOpen(1);
  if (role === 'stage2') return hub.windowOpen(2);
  return false;
}

async function screenFor(role) {
  const r = await listScreens();
  if (!r) return null;
  const want = get(ROLES.find((x) => x.id === role).key);
  return (want && r.screens.find((s) => s.label === want)) || null;
}

/** Open one output on its screen. Browsers allow one new window per click, so the caller opens one at a time. */
export async function openRole(role) {
  if (role === 'projector') return link.openWindow();
  if (role === 'projector2') return link.openMirror(await screenFor('projector2'));
  if (role === 'stage') return hub.openWindow(1);
  if (role === 'stage2') return hub.openWindow(2);
  return false;
}
export function closeRole(role) {
  if (role === 'projector') link.close();
  else if (role === 'projector2') link.closeMirror();
  else if (role === 'stage') hub.closeWindow(1);
  else if (role === 'stage2') hub.closeWindow(2);
}

/** The outputs of the chosen layout that are not open yet, in the order they should open. */
export const missing = () => ROLES.map((r) => r.id).filter((id) => enabled(id) && !isOpen(id));

/** Open the next missing output (one per click). Returns {opened, next} — next is the role still to open. */
export async function openNext() {
  const todo = missing();
  if (!todo.length) return { opened: null, next: null };
  const ok = await openRole(todo[0]);
  const rest = missing().filter((x) => x !== todo[0]);
  return { opened: ok ? todo[0] : null, next: rest[0] || null, blocked: !ok };
}
export const roleName = (id) => (ROLES.find((r) => r.id === id) || {}).name || id;
