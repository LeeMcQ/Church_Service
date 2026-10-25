// "Screens" panel (Settings → Displays and the first-start setup): choose the layout — projector only,
// two projectors, projector + stage screen, two stage screens … — put each output on a screen, and open them.
import { h, clear } from '../core/util.js';
import { icon } from '../core/icons.js';
import { seg, toast } from '../core/ui.js';
import { settings } from '../core/settings.js';
import { link, listScreens } from '../core/link.js';
import { hub } from '../core/stagehub.js';
import { ROLES, LAYOUTS, enabled, currentLayout, setLayout, isOpen, openRole, closeRole, openNext, missing, roleName } from '../core/screens.js';

const get = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), settings.v);

export function screensPanel({ intro = true } = {}) {
  const box = h('div.col.scr-panel', { style: { gap: '12px' } });
  let detected = null;

  async function detect(ask) {
    if (!('getScreenDetails' in window)) { detected = null; return; }
    if (!ask) {
      try { const st = (await navigator.permissions.query({ name: 'window-management' })).state; if (st !== 'granted') return; } catch (e) { return; }
    }
    const r = await listScreens();
    detected = r;
    paint();
  }

  function screenPicker(role) {
    const key = role.key;
    const cur = get(key) || '';
    if (!detected) {
      return h('span.note', 'getScreenDetails' in window ? 'Automatic — press “Detect screens” to choose' : 'Opens a window: drag it onto the screen and press F');
    }
    const opts = [['', 'Automatic']].concat(detected.screens.map((s, i) => [s.label || 'Screen ' + (i + 1),
      (s.label || 'Screen ' + (i + 1)) + ' · ' + s.width + '×' + s.height + (s === detected.current ? ' (this screen)' : '')]));
    const sel = h('select.field', { 'aria-label': role.name + ' screen', onchange: () => settings.set(key, sel.value) },
      ...opts.map(([v, lab]) => h('option', { value: v, selected: v === cur }, lab)));
    return sel;
  }

  function paint() {
    clear(box);
    const n = detected ? detected.screens.length : 0;
    if (intro) box.append(h('p.note', 'Each projector and stage screen is a window on one of this PC’s screens (connect them with HDMI and set Windows to “Extend”: Win + P). Choose what you have:'));
    box.append(h('div', seg(LAYOUTS.map(([id, label]) => [id, label]), currentLayout(), (v) => { setLayout(v); paint(); })));
    if (detected) {
      const need = 1 + ROLES.filter((r) => enabled(r.id)).length;
      box.append(h('p.note', n + ' screen' + (n === 1 ? '' : 's') + ' found on this PC' + (n < need ? ' — this layout needs ' + need + ' (this one for you, plus one for each output). Connect more screens, or choose fewer outputs.' : '.')));
    }
    const list = h('div.col.scr-list', { style: { gap: '8px' } });
    ROLES.filter((r) => enabled(r.id)).forEach((r) => {
      const open = isOpen(r.id);
      list.append(h('div.scr-row' + (open ? '.on' : ''),
        h('div.scr-ic', icon(r.id.startsWith('stage') ? 'stage' : 'present')),
        h('div.grow', h('b', r.name), open ? h('span.scr-on', ' ● open') : null, h('div.note', r.note)),
        screenPicker(r),
        open ? h('button.btn.sm', { type: 'button', onclick: () => { closeRole(r.id); setTimeout(paint, 300); } }, icon('x'), h('span', 'Close'))
          : h('button.btn.sm', { type: 'button', onclick: async () => { const ok = await openRole(r.id); if (!ok) toast('The window was blocked. Allow pop-ups for this site, then try again.', 'err', 6000); setTimeout(paint, 800); } }, icon('present'), h('span', 'Open'))));
    });
    box.append(list);
    const todo = missing();
    box.append(h('div.row.wrap', { style: { gap: '8px' } },
      todo.length ? h('button.btn.primary', { type: 'button', onclick: openAllStep }, icon('present'), h('span', todo.length > 1 ? 'Open all screens (' + todo.length + ')' : 'Open ' + roleName(todo[0]))) : h('span.note', 'All screens of this layout are open.'),
      'getScreenDetails' in window ? h('button.btn', { type: 'button', onclick: () => detect(true) }, icon('pc'), h('span', detected ? 'Detect again' : 'Detect screens')) : null));
    box.append(h('p.note', 'Chrome and Edge open each window straight onto its screen once you allow “Window management”. Browsers open one new window per click, so with several screens press the button once for each.'));
  }

  async function openAllStep() {
    const r = await openNext();
    if (r.blocked) { toast('The window was blocked. Allow pop-ups for this site, then press again.', 'err', 6000); return; }
    if (r.next) toast(roleName(r.opened) + ' is open. Press again to open ' + roleName(r.next) + '.', 'ok', 5000);
    setTimeout(paint, 800);
  }

  link.on('state', () => box.isConnected && paint());
  link.on('mirror', () => box.isConnected && paint());
  hub.on('outlets', () => box.isConnected && paint());
  paint();
  detect(false);
  return box;
}
