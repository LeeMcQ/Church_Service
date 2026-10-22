// SDA Sabbath control app boot: tabs, Present button, display menu, shortcuts, service worker.
import { $, h, isTyping } from './core/util.js';
import { icon } from './core/icons.js';
import { settings } from './core/settings.js';
import { db, persistStorage } from './core/db.js';
import { link, listScreens } from './core/link.js';
import { live, slideName } from './core/live.js';
import { bgAudio } from './core/audio.js';
import * as ui from './core/ui.js';
import { createMonitors } from './monitors.js';
import { createControlBar } from './controlbar.js';
import { createQuick } from './quick.js';
import { createDisplay } from './display/display.js';
import { openPip, pipSupported } from './pip.js';
import { clicker, actionFor, sigOfKey, sigOfMouse } from './core/clicker.js';
import { openClickerSetup, builtinAction } from './clickerui.js';
import { hub as stageHub, timerValue } from './core/stagehub.js';
import { obs } from './core/obsctl.js';

export const VERSION = '1.4.0';
export const BUILD = 'ee6baa5';

const TABS = [
  { id: 'bible', label: 'Bible', icon: 'bible', file: 'bible.js', load: () => import('./tabs/bible.js') },
  { id: 'hymns', label: 'Hymns', icon: 'hymn', file: 'hymns.js', load: () => import('./tabs/hymns.js') },
  { id: 'ai', label: 'Banners & Music', short: 'Banners', icon: 'banner', file: 'ai.js', load: () => import('./tabs/ai.js') }, // id kept from the first version (plans and settings refer to it)
  { id: 'slides', label: 'Slides', icon: 'slides', file: 'slides.js', load: () => import('./tabs/slides.js') },
  { id: 'video', label: 'Video', icon: 'video', file: 'video.js', load: () => import('./tabs/video.js') },
  { id: 'web', label: 'Web & PC', icon: 'web', file: 'webpc.js', load: () => import('./tabs/webpc.js') }, // the web page and PC screen parts in one tab
  { id: 'plan', label: 'Plan', icon: 'plan', file: 'plan.js', load: () => import('./tabs/plan.js') },
  { id: 'tools', label: 'Tools', icon: 'grid', file: 'tools.js', load: () => import('./tabs/tools.js') },
  { id: 'stage', label: 'Stage', icon: 'stage', file: 'stage.js', load: () => import('./tabs/stage.js') }, // second screen for the platform (confidence monitor)
  { id: 'stream', label: 'Stream', icon: 'live', file: 'stream.js', load: () => import('./tabs/stream.js') }, // OBS: lower thirds, slides, scene switching
  null,
  { id: 'settings', label: 'Settings', icon: 'settings', file: 'settings.js', load: () => import('./tabs/settings.js') },
];

const appEl = $('#app');
const work = $('#work');
const rail = $('#rail');
const presentBtn = $('#presentBtn');
const dispBtn = $('#dispBtn');
const audioBtn = $('#audioBtn');
const tabs = new Map();      // id -> api (created lazily)
const loading = new Map();   // id -> promise
const stagedBy = new Map();  // id -> cue
const railBtns = new Map();
let current = null;

export const isMobile = () => matchMedia('(max-width: 760px)').matches;

// ------------------------------------------------------------ context passed to tabs
const ctx = {
  live, link, settings, db, bgAudio, ui, toast: ui.toast, isMobile, VERSION, BUILD,
  setStaged(id, cue, opts) {
    stagedBy.set(id, cue || null);
    if (id === current) live.stage(cue || null, opts);
  },
  showTab: (id) => showTab(id),
  tab: (id) => getTab(id),
  stagedOf: (id) => stagedBy.get(id) || null,
  companion: null,
  installPrompt: null,
  stage: stageHub,
  obs,
};
window.selah = ctx; // handy for debugging from the console (name kept for existing scripts)

// Old names still work (saved plans, links, the last tab used): PC view is now part of Web & PC.
const ALIAS = { screen: 'web' };
async function getTab(id) {
  if (ALIAS[id]) { const api = await getTab(ALIAS[id]); if (id === 'screen' && api.show) api.show('screen'); return api; }
  if (tabs.has(id)) return tabs.get(id);
  if (loading.has(id)) return loading.get(id);
  const def = TABS.find((t) => t && t.id === id);
  if (!def) throw new Error('No tab ' + id);
  // A part of the app that cannot load (offline and not stored yet, or a damaged download) is tried
  // once more with a fresh request; it never leaves the whole app stuck.
  const p = def.load().catch(() => import('./tabs/' + def.file + '?r=' + Date.now())).then((mod) => {
    const api = mod.default(ctx);
    api.el.classList.add('tabpanel');
    api.el.setAttribute('role', 'tabpanel');
    api.el.hidden = true;
    work.appendChild(api.el);
    tabs.set(id, api);
    return api;
  });
  loading.set(id, p);
  p.catch(() => loading.delete(id)); // try again next time instead of remembering the failure
  return p;
}
/** Shown instead of a tab that could not load: what happened and a way out, never a blank screen. */
function tabErrorPanel(id, err) {
  const def = TABS.find((t) => t && t.id === id);
  const offline = !navigator.onLine;
  const el = h('section.tab-error',
    h('div.card',
      h('h2', (def ? def.label : 'This part') + ' could not open'),
      h('p', offline
        ? 'This device is offline and this part of SDA Sabbath is not stored on it yet. The rest of the app still works. Connect to the internet once and open it again; after that it works offline.'
        : 'Something went wrong while opening it. The rest of the app still works.'),
      h('p.note', String((err && err.message) || err || '').slice(0, 200)),
      h('div.row.wrap',
        h('button.btn.primary', { type: 'button', onclick: () => { el.remove(); errPanels.delete(id); showTab(id); } }, 'Try again'),
        h('button.btn', { type: 'button', onclick: () => { checkOffline(true); ui.toast('Checking the files stored for offline use…', '', 3000); } }, 'Repair offline files'),
        h('button.btn', { type: 'button', onclick: () => location.reload() }, 'Reload'))));
  return el;
}
const errPanels = new Map();

async function showTab(id) {
  if (ALIAS[id]) { const api = await showTab(ALIAS[id]); if (id === 'screen' && api && api.show) api.show('screen'); return api; }
  // While the Plan tab opens an item in another tab, stay on the Plan.
  if (ctx.hold && id !== ctx.hold) return getTab(id);
  if (current === id && tabs.has(id)) return tabs.get(id);
  let api;
  try { api = await getTab(id); }
  catch (e) {
    console.error(e);
    // Show a calm message in place of the tab (the other tabs keep working).
    if (current && tabs.has(current)) { const prev = tabs.get(current); prev.el.hidden = true; if (prev.onHide) prev.onHide(); }
    errPanels.forEach((x) => x.remove()); errPanels.clear();
    const panel = tabErrorPanel(id, e);
    panel.classList.add('tabpanel');
    errPanels.set(id, panel); work.appendChild(panel);
    current = id;
    railBtns.forEach((b, k) => b.setAttribute('aria-selected', String(k === id)));
    return null;
  }
  errPanels.forEach((x) => x.remove()); errPanels.clear();
  if (current && tabs.has(current)) { const prev = tabs.get(current); prev.el.hidden = true; if (prev.onHide) prev.onHide(); }
  const switching = !!current;
  current = id;
  api.el.hidden = false;
  if (switching) ui.enter(api.el); // gentle fade-in of the new tab (not on first load)
  railBtns.forEach((b, k) => b.setAttribute('aria-selected', String(k === id)));
  appEl.className = appEl.className.replace(/\btab-\S+/g, '').trim() + ' tab-' + id; // lets phones hide the monitors on Settings
  moreBtn.classList.toggle('on', MORE_TABS.includes(id));
  moreBtn.setAttribute('aria-label', MORE_TABS.includes(id) ? 'More tabs (' + TABS.find((t) => t && t.id === id).label + ' open)' : 'More tabs');
  if (api.onShow) api.onShow();
  live.stage(stagedBy.get(id) || null);
  if (id !== 'settings') settings.set('app.lastTab', id);
  return api;
}

// ------------------------------------------------------------ rail
// On phones only five buttons fit comfortably: Bible, Hymns, Banners, Slides, Plan and More (the rest).
const MORE_TABS = ['video', 'web', 'tools', 'stage', 'stream', 'settings'];
const MORE_MENU = MORE_TABS; // Banners has its own button in the rail (never repeated in this menu)
TABS.forEach((t, i) => {
  if (!t) { rail.appendChild(h('div.rail-gap')); return; }
  const b = h('button' + (MORE_TABS.includes(t.id) ? '.more-tab' : ''), { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-tab': t.id, title: t.label + (i < 9 ? '  (Alt+' + (i + 1) + ')' : t.id === 'settings' ? '  (Alt+0)' : ''), onclick: () => showTab(t.id) },
    icon(t.icon), t.short ? h('span.lbl', h('span.lbl-long', t.label), h('span.lbl-short', t.short)) : h('span', t.label), h('span.tally'));
  railBtns.set(t.id, b);
  rail.appendChild(b);
});
const moreBtn = h('button.rail-more', { type: 'button', 'aria-label': 'More tabs', 'aria-haspopup': 'menu', onclick: () => ui.menu(moreBtn,
  MORE_MENU.map((id) => { const t = TABS.find((x) => x && x.id === id); return { label: t.label, icon: t.icon, hint: current === id ? 'Open' : '', onclick: () => showTab(id) }; })) },
icon('grid'), h('span', 'More'));
rail.parentNode.appendChild(moreBtn);
live.on('live', (cue) => {
  railBtns.forEach((b, k) => b.classList.toggle('is-live', !!cue && cue.tab === k));
  moreBtn.classList.toggle('is-live', !!cue && MORE_TABS.includes(cue.tab));
});

// ------------------------------------------------------------ layout settings
function applyLayout() {
  const a = settings.v.app;
  document.documentElement.setAttribute('data-theme', a.theme || 'dark');
  appEl.classList.toggle('rail-right', a.railSide === 'right');
  appEl.classList.toggle('no-monitors', a.monitors === false);
  document.documentElement.classList.toggle('no-mon', a.monitors === false);
  document.documentElement.classList.toggle('lp', settings.lowPower()); // low-power mode: no UI motion
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--sunk').trim() || '#161c28';
}
settings.on('change:app', applyLayout);
applyLayout();

// ------------------------------------------------------------ Present button
// When the staged item is the one already on screen, the button says "On screen" instead of
// inviting a second press (the Next monitor gets a "Same as Live" badge to match).
const presentKey = presentBtn.querySelector('.pk');
function updatePresent() {
  const c = live.staged;
  const same = live.sameAsLive();
  presentBtn.classList.toggle('empty', !c);
  presentBtn.classList.toggle('is-live', same);
  presentKey.textContent = same ? 'On screen' : 'Present';
  const part = c && !same ? slideName(c, c.index) : '';
  $('#presentNext').textContent = c ? (same ? '' : 'Next: ') + c.title + (part ? ' · ' + part : '') + (c.sub ? '  ' + c.sub : '') : 'Nothing selected';
  presentBtn.title = same ? 'This is already on screen. Press again (F5) to show it from the start.' : 'Present the selected item (F5 or Ctrl+Enter)';
}
live.on('staged', updatePresent);
live.on('live', updatePresent);
live.on('go', updatePresent);
// Phones: with nothing staged or live, the two empty monitors fold into one slim strip.
const syncIdle = () => document.documentElement.classList.toggle('mon-idle', !live.staged && !live.cue);
live.on('staged', syncIdle);
live.on('live', syncIdle);
presentBtn.addEventListener('click', () => doPresent());
async function doPresent() {
  persistStorage();
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT') && a !== document.body) a.blur();
  // Always present on the extended screen, full screen.
  if (!link.ready) {
    const opened = await link.openWindow({ prompt: true });
    if (!opened) return;
    // Wait briefly for the display window to be ready.
    await new Promise((r) => setTimeout(r, 400));
  }
  // Ask the display window to go full screen (this click or key press lets it).
  if (settings.v.display.keepFull !== false || link.displayFull !== true) link.fullscreenDisplay();
  const ok = await live.take();
  if (ok) { presentBtn.classList.add('flash'); setTimeout(() => presentBtn.classList.remove('flash'), 260); }
}

live.on('notice', (n) => ui.toast(n.text, n.code === 'nothing' || n.code === 'nologo' ? '' : 'err', n.code === 'autoplay' || n.code === 'nologo' ? 6000 : 3600));

// ------------------------------------------------------------ display menu
const SHORT_KIND = { window: 'Window', self: 'Here', cast: 'Cast', socket: 'TV' };
function updateDispBtn() {
  const isLive = !!live.cue && link.ready;
  dispBtn.classList.toggle('on', link.ready);
  dispBtn.classList.toggle('is-live', isLive);
  const full = link.kind ? (link.ready ? link.info.label || 'Display' : 'Connecting…') : 'No display';
  dispBtn.querySelector('.lbl').textContent = full;
  // Phones show a one-glance status: "No display", "Ready · TV" or "Live · TV".
  dispBtn.querySelector('.lbl-s').textContent = !link.kind ? 'No display' : !link.ready ? 'Connecting' : (isLive ? 'Live · ' : 'Ready · ') + (SHORT_KIND[link.kind] || 'Screen');
  dispBtn.setAttribute('aria-label', 'Display: ' + full + (isLive ? ', something is live' : '') + '. Choose where to present');
}
// A one-tap stop button beside the display button whenever something is connected (cast, window, TV …).
const dispStop = h('button.disp-stop', { type: 'button', hidden: true, onclick: () => { const was = link.kind; link.close(); ui.toast(was === 'cast' ? 'Casting stopped.' : 'Display closed.', 'ok', 2000); } }, icon('x'));
dispBtn.after(dispStop);
function updateDispStop() {
  dispStop.hidden = !link.kind;
  const t = link.stopLabel();
  dispStop.title = t; dispStop.setAttribute('aria-label', t);
}
link.on('state', updateDispBtn);
link.on('state', updateDispStop);
link.on('hello', updateDispBtn);
live.on('live', updateDispBtn);
link.on('blocked', () => ui.toast('The browser blocked the display window. Allow pop-ups for this site, then press Present again.', 'err', 7000));
link.on('pin-wrong', () => ui.toast('Wrong PIN for the SDA Sabbath companion.', 'err'));
link.on('found', () => { if (!link.kind) ui.toast('A display window is already open. Press Present to reconnect to it.'); });

async function chooseScreen() {
  const r = await listScreens();
  if (!r) { ui.toast('This browser cannot list screens. Drag the display window onto the projector screen and press F there.', '', 6000); return link.openWindow(); }
  return new Promise((resolve) => {
    const list = h('div.list');
    r.screens.forEach((s, i) => {
      list.appendChild(h('button', { type: 'button', onclick: async () => {
        settings.set('display.screenLabel', s.label || ''); ui.closeModal(); resolve(await link.openWindow({ prompt: true }));
      } }, icon('pc'), h('span.grow', (s.label || 'Screen ' + (i + 1)) + (s === r.current ? '  (this screen)' : '')), h('span.faint', s.width + ' × ' + s.height)));
    });
    ui.modal({ title: 'Present on which screen?', body: list, onclose: () => resolve(false) });
  });
}

function companionDialog() {
  return new Promise((resolve) => {
    const url = h('input.field', { value: settings.v.companion.url || (ctx.companion ? location.origin : 'http://192.168.1.10:7777'), style: { width: '100%' } });
    const pin = h('input.field', { value: settings.v.companion.pin || '', inputmode: 'numeric', style: { width: '120px' } });
    ui.modal({
      title: 'Present through the SDA Sabbath companion',
      body: h('div.col',
        h('p.note', 'Run the SDA Sabbath companion on the church PC. Open the address it shows on the TV or projector PC with “/display” at the end, then connect here.'),
        h('label.muted', 'Companion address'), url, h('label.muted', 'PIN shown by the companion'), pin),
      onclose: () => resolve(false),
      actions: [{ label: 'Cancel' }, { label: 'Connect', primary: true, onclick: () => {
        settings.set('companion.url', url.value.trim()); settings.set('companion.pin', pin.value.trim());
        link.connectSocket(url.value.trim(), pin.value.trim()); resolve(true);
      } }],
    });
  });
}

const onWindows = () => /Windows/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.userAgent);
const onAndroid = () => /Android/i.test(navigator.userAgent);

/** Cast through the browser (Chromecast, Google TV, Android TV). Explains the other ways when it fails. */
function startCast() {
  return link.openCast().catch((e) => {
    // The person closed the browser's cast picker: nothing to report.
    if (e && (e.name === 'AbortError' || e.name === 'NotAllowedError')) return false;
    castHelp(e);
    return false;
  });
}

function castHelp(e) {
  const asked = !e; // opened from “TV not found? Help…”
  const noDevice = !e || e.name === 'NoCastDevice' || e.name === 'NotFoundError' || /no screens|not available|not found/i.test((e && e.message) || '');
  const steps = h('div.col', { style: { gap: '10px' } });
  steps.appendChild(h('p', asked
    ? 'Browser casting only works with Chromecast, Google TV and Android TV. Most other TVs (Samsung, LG, Hisense and projectors with “Screen mirroring”) use Miracast instead, which a web page cannot reach directly. These ways work with them:'
    : noDevice
    ? 'The browser found no cast device. Browser casting only works with Chromecast, Google TV and Android TV. Most other TVs (Samsung, LG, Hisense and projectors with “Screen mirroring”) use Miracast instead, which a web page cannot reach directly.'
    : 'Casting failed: ' + ((e && e.message) || e) + '.'));
  const opt = (ic, title, desc, fn) => h('button', { type: 'button', onclick: () => { ui.closeModal(); fn(); } },
    icon(ic), h('div.grow', h('div', { style: { fontWeight: 700 } }, title), h('div.note', desc)));
  const list = h('div.list');
  if (onWindows()) list.appendChild(opt('pc', 'Connect to a wireless display (Windows)', 'Windows connects to Miracast TVs and projectors itself. The TV then becomes a second screen for SDA Sabbath. Recommended.', wirelessDialog));
  list.appendChild(opt('link', 'SDA Sabbath companion', 'Best for a smart TV with a web browser: the TV opens the companion address and this device controls it over Wi-Fi.', companionDialog));
  if (onAndroid()) list.appendChild(opt('phone', 'Use this phone as the screen, then mirror it', 'Open your phone’s Smart View / Screen Cast / Screen mirroring from the quick settings and pick the TV. The TV shows the phone screen.', () => link.openSelf(createDisplay)));
  else list.appendChild(opt('phone', 'Use this device as the screen', 'Full screen here, for an HDMI cable or the device’s own screen mirroring.', () => link.openSelf(createDisplay)));
  list.appendChild(opt('cast', 'Try casting again', 'Make sure the TV and this device are on the same Wi-Fi and the TV is on.', () => startCast()));
  steps.appendChild(list);
  ui.modal({ title: asked ? 'TV not found? Other ways to connect' : noDevice ? 'No cast device found' : 'Casting failed', body: steps, actions: [{ label: 'Close' }], wide: true });
}

/**
 * Windows' own "Connect to a wireless display" (Miracast): Windows connects to the TV or projector and treats it
 * as a second screen; SDA Sabbath then opens its display window there like on any extended screen.
 */
function wirelessDialog() {
  const status = h('p.note.wd-status', 'Waiting for the wireless display…');
  let before = null, sd = null;
  const watch = async () => {
    if (sd || !('getScreenDetails' in window)) return;
    try {
      sd = await window.getScreenDetails();
      before = sd.screens.length;
      status.textContent = 'Screens now: ' + before + '. Connect the TV in the Windows panel; it shows up here when it is ready.';
      sd.addEventListener('screenschange', () => {
        const n = sd.screens.length;
        if (n > before) {
          const s2 = sd.screens.find((x) => x !== sd.currentScreen);
          status.textContent = 'Found: ' + ((s2 && s2.label) || 'a new screen') + '. Make sure Windows is set to Extend, then press Present on it.';
          status.classList.add('ok');
          goBtn.classList.add('primary');
        } else status.textContent = 'Screens now: ' + n + '.';
        before = n;
      });
    } catch (err) { /* permission refused: the steps still work */ }
  };
  const castLink = h('a.btn.primary', { href: 'ms-settings-connectabledevices:devicediscovery', onclick: () => { watch(); } }, icon('cast'), h('span', 'Open Windows “Connect”'));
  const dispLink = h('a.btn', { href: 'ms-settings:display', onclick: () => { watch(); } }, icon('pc'), h('span', 'Open Display settings'));
  const goBtn = h('button.btn', { type: 'button', onclick: async () => {
    ui.closeModal();
    if ('getScreenDetails' in window) await chooseScreen(); else await link.openWindow();
  } }, icon('present'), h('span', 'Present on the wireless display'));
  ui.modal({
    title: 'Connect to a wireless display (Windows)', wide: true,
    body: h('div.col.wd', { style: { gap: '10px' } },
      h('p.note', 'Use this when casting from the browser does not find your TV or projector. Windows connects to it (Miracast) and uses it as a second screen.'),
      h('ol.wd-steps',
        h('li', h('b', 'Open the Windows Connect panel'), ' and pick the TV or projector from the list (or press ', h('kbd', 'Windows'), ' + ', h('kbd', 'K'), '). The browser may ask “Open Settings?”: allow it.',
          h('div.row.wrap', { style: { marginTop: '6px' } }, castLink, dispLink),
          h('div.note', 'Not listed? Turn on “Screen mirroring” (or open the Screen Mirroring app) on the TV, keep it close, and make sure Wi-Fi is on. In Display settings this is “Connect to a wireless display”.')),
        h('li', h('b', 'Choose Extend'), ', not Duplicate: in the Connect panel press “Change projection mode” → Extend, or press ', h('kbd', 'Windows'), ' + ', h('kbd', 'P'), ' → Extend. Then the TV shows only the slides, and this screen keeps the controls.'),
        h('li', h('b', 'Present on it'), '. SDA Sabbath opens its display on the TV. To stop, press the × next to the display button, then Disconnect in the Windows panel.',
          h('div.row.wrap', { style: { marginTop: '6px' } }, goBtn))),
      status),
    actions: [{ label: 'Close' }],
  });
  watch();
}

function displayMenu(anchor) {
  const items = [];
  // Connected: stopping and switching come first, so they are easy to find.
  if (link.kind) {
    items.push({ label: link.stopLabel() + (link.info.label ? ' (' + link.info.label + ')' : ''), icon: 'x', onclick: () => { link.close(); ui.toast('Display closed.', 'ok', 2000); } });
    if (link.kind === 'cast') items.push({ label: 'Cast to another device…', icon: 'cast', onclick: () => { link.close(); startCast(); } });
    items.push('-');
  }
  if (!isMobile() || innerWidth > 900) {
    items.push({ label: 'Open display on second screen', icon: 'present', onclick: () => link.openWindow() });
    if ('getScreenDetails' in window) items.push({ label: 'Choose screen…', icon: 'pc', onclick: () => chooseScreen() });
  }
  items.push({ label: 'Use this device as the screen', icon: 'phone', onclick: () => link.openSelf(createDisplay) });
  if (link.canCast() && link.kind !== 'cast') items.push({ label: 'Cast (Chromecast, Google TV, Android TV)', icon: 'cast', onclick: () => startCast() });
  if (onWindows()) items.push({ label: 'Connect to a wireless display (Windows)…', icon: 'pc', onclick: wirelessDialog });
  items.push({ label: 'SDA Sabbath companion on the network…', icon: 'link', onclick: companionDialog });
  if (link.canCast() || onWindows()) items.push({ label: 'TV not found? Help…', icon: 'info', onclick: () => castHelp(null) });
  items.push({ label: 'Clicker setup and test…', icon: 'settings', onclick: () => clickerSetup() });
  if (pipSupported()) items.push('-', { label: 'Mini controller (stays on top)', icon: 'pip', onclick: () => openPip().catch((e) => ui.toast('The mini controller could not open: ' + e.message, 'err')) });
  ui.menu(anchor, items);
}
dispBtn.addEventListener('click', () => displayMenu(dispBtn));

// ------------------------------------------------------------ stage screen (second screen for the platform)
// One button beside the display button: how many stage screens follow, the featured timer while it runs,
// and a yellow dot while a stage message is showing. Its menu opens the stage window, casts it, sends a
// message, and opens the Stage tab (phones & laptops, timers, layout).
const stageBtn = h('button.stage-btn', { type: 'button', title: 'Stage screen for the platform (timers, messages, phones & laptops)', onclick: () => stageMenu(stageBtn) },
  icon('stage'), h('span.lbl', 'Stage'), h('span.n', { hidden: true }), h('span.tm', { hidden: true }), h('span.msg-dot', { hidden: true }));
dispStop.after(stageBtn);
function paintStageBtn() {
  const n = stageHub.screens().length;
  const nEl = stageBtn.querySelector('.n');
  nEl.hidden = !n; nEl.textContent = String(n);
  stageBtn.classList.toggle('on', n > 0);
  stageBtn.querySelector('.msg-dot').hidden = !stageHub.msg;
  const fid = settings.v.stage.featured;
  const t = stageHub.timers().find((x) => x.id === fid) || stageHub.timers()[0];
  const tm = stageBtn.querySelector('.tm');
  if (t && t.running && t.mode !== 'to') {
    const v = timerValue(t);
    const s = Math.abs(t.mode === 'down' && v > 0 ? Math.ceil(v / 1000) : Math.floor(v / 1000));
    tm.textContent = (t.mode === 'down' && v <= 0 ? '+' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    tm.classList.toggle('over', t.mode === 'down' && v <= 0);
    tm.classList.toggle('warn', t.mode === 'down' && v > 0 && v <= (settings.v.stage.warnSec || 120) * 1000);
    tm.hidden = false;
  } else tm.hidden = true;
}
setInterval(paintStageBtn, 1000);
stageHub.on('outlets', paintStageBtn);
stageHub.on('msg', paintStageBtn);
stageHub.on('timers', paintStageBtn);
function stageMenu(anchor) {
  const fid = settings.v.stage.featured;
  const t = stageHub.timers().find((x) => x.id === fid) || stageHub.timers()[0];
  ui.menu(anchor, [
    { label: stageHub.windowOpen() ? 'Stage window is open (bring to front)' : 'Open stage screen (second monitor)', icon: 'present', onclick: () => stageHub.openWindow() },
    stageHub.canCast() ? { label: 'Cast the stage screen (Chromecast, Google TV)', icon: 'cast', onclick: () => stageHub.cast().catch((e) => { if (!e || (e.name !== 'AbortError' && e.name !== 'NotAllowedError')) ui.toast('Casting the stage failed: ' + ((e && e.message) || e), 'err'); }) } : null,
    { label: 'Phones & laptops (QR code)…', icon: 'qr', onclick: () => { if (!settings.v.stage.online) stageHub.goOnline(true); showTab('stage'); } },
    '-',
    { label: 'Message to the stage…', icon: 'msg', onclick: async () => { const tab = await showTab('stage'); if (tab && tab.focusMessage) tab.focusMessage(); } },
    stageHub.msg ? { label: 'Clear the stage message', icon: 'x', onclick: () => stageHub.clearMessage() } : null,
    t && t.mode !== 'to' ? { label: (t.running ? 'Pause ' : 'Start ') + (t.label || t.name).toLowerCase() + ' timer', icon: t.running ? 'pause' : 'play', onclick: () => stageHub.timer(t.id, 'toggle') } : null,
    '-',
    { label: 'Stage tab (layout, timers, who is connected)', icon: 'stage', onclick: () => showTab('stage') },
  ]);
}
// OBS: a red LIVE / REC mark in the top bar while OBS streams or records (click: Stream tab).
const obsPill = h('button.obs-pill', { type: 'button', hidden: true, title: 'OBS is live — open the Stream tab', onclick: () => showTab('stream') });
stageBtn.after(obsPill);
function paintObsPill() {
  const on = obs.state === 'on' && (obs.streaming || obs.recording);
  obsPill.hidden = !on;
  if (!on) return;
  const since = obs.streaming ? obs.streamSince : obs.recordSince;
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  obsPill.textContent = (obs.streaming ? '● LIVE ' : '● REC ') + Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
obs.on('change', paintObsPill); obs.on('state', paintObsPill);
setInterval(paintObsPill, 1000);
stageHub.on('blocked', () => ui.toast('The browser blocked the stage window. Allow pop-ups for this site, then try again.', 'err', 7000));
stageHub.on('talk', (t) => ui.toast(h('span', h('b', t.from + ': '), t.text, ' ', h('button.btn.sm', { type: 'button', onclick: () => showTab('stage') }, 'Reply')), 'ok', 12000));
stageHub.on('joined', (o) => { if (o.kind === 'peer' || o.kind === 'lan') ui.toast((o.name || 'A device') + ' is following on the stage screen.', '', 2600); });
stageHub.on('timer-over', (t) => ui.toast('Time is up: ' + (t.label || t.name) + ' timer.', 'err', 6000));
// Commands from stage screens that may control (the PIN, or allowed in the Stage tab).
stageHub.onCommand = (op, arg) => {
  if (op === 'next') clickerNext();
  else if (op === 'prev') live.prev();
  else if (op === 'black') live.setBlank('black');
  else if (op === 'logo') live.setBlank('logo');
  else if (op === 'clear') live.clear();
  else if (op === 'present') doPresent();
  else if (op === 'first') live.go(0);
  else if (op === 'last') live.go(live.count() - 1);
  else if (op === 'go' && Number.isFinite(+arg)) live.go(+arg);
};

// ------------------------------------------------------------ sound output device (desktop)
let audioSink = '';
async function listAudioDevices() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'audiooutput');
  } catch (e) { return []; }
}
async function paintAudioBtn() {
  if (!audioBtn || isMobile()) { if (audioBtn) audioBtn.hidden = true; return; }
  const devs = await listAudioDevices();
  if (!devs.length) { audioBtn.hidden = true; return; }
  audioBtn.hidden = false;
  const cur = devs.find((d) => d.deviceId === audioSink) || devs[0];
  const name = (cur && cur.label) ? cur.label.replace(/\s*\(.*\)$/, '') : 'Default';
  audioBtn.querySelector('.lbl').textContent = name;
  audioBtn.title = 'Sound output: ' + (cur ? cur.label : 'Default') + '. Click to switch.';
}
async function setAudioSink(id) {
  audioSink = id;
  try {
    if (bgAudio.el && bgAudio.el.setSinkId) await bgAudio.el.setSinkId(id);
    if (window.selah && window.selah.music && window.selah.music.el && window.selah.music.el.setSinkId) await window.selah.music.el.setSinkId(id);
  } catch (e) { /* device may be busy */ }
  paintAudioBtn();
}
audioBtn && audioBtn.addEventListener('click', async () => {
  const devs = await listAudioDevices();
  if (!devs.length) { ui.toast('No sound devices found.', 'err'); return; }
  const items = devs.map((d) => ({
    label: d.label || 'Speaker',
    icon: d.deviceId === audioSink ? 'check' : 'speaker',
    onclick: () => setAudioSink(d.deviceId),
  }));
  ui.menu(audioBtn, items);
});
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', paintAudioBtn);
}
paintAudioBtn();

live.ensureDisplay = () => new Promise((resolve) => {
  if (!isMobile() && !matchMedia('(pointer: coarse)').matches) { link.openWindow().then(resolve); return; }
  let done = false;
  const opt = (ic, title, desc, fn) => h('button', { type: 'button', onclick: async () => { done = true; ui.closeModal(); try { resolve(await fn()); } catch (e) { ui.toast(e.message, 'err'); resolve(false); } } },
    icon(ic), h('div.grow', h('div', { style: { fontWeight: 700 } }, title), h('div.note', desc)));
  const list = h('div.list',
    opt('phone', 'This device', 'Full screen here. Use with an HDMI adapter or screen mirroring.', () => link.openSelf(createDisplay)),
    link.canCast() ? opt('cast', 'Cast', 'Chromecast, Google TV or Android TV on the same Wi-Fi.', () => startCast()) : null,
    onAndroid() ? opt('info', 'My TV is not found', 'Smart View, Miracast and other ways to reach the TV.', () => { castHelp(null); return false; }) : null,
    opt('link', 'SDA Sabbath companion', 'Control a PC or TV on the church network from this phone.', companionDialog),
    innerWidth > 700 ? opt('present', 'Display window', 'A separate window you can move to a projector.', () => link.openWindow()) : null);
  ui.modal({ title: 'Where should SDA Sabbath present?', body: list, onclose: () => { if (!done) resolve(false); } });
});

// ------------------------------------------------------------ top icons
const topIcons = $('#topIcons');
const searchBtn = ui.btn('search', 'Go to (/)', () => quick.focus(), { cls: 'sm' });
searchBtn.classList.add('show-sm');
async function promptInstall() {
  const p = ctx.installPrompt;
  if (!p) return;
  ctx.installPrompt = null; installBtn.hidden = true; // a prompt can only be shown once
  try { p.prompt(); await p.userChoice; } catch (e) { /* dismissed */ }
}
ctx.promptInstall = promptInstall;
const installBtn = ui.btn('download', 'Install SDA Sabbath on this device', promptInstall, { cls: 'sm' });
installBtn.hidden = true;
const helpBtn = ui.btn('kbd', 'Keyboard shortcuts (?)', () => showHelp(), { cls: 'sm' });
topIcons.append(searchBtn, installBtn, helpBtn);

// Church logo in the top-right corner (replaces any browser cast icon visually).
const churchLogo = h('img.church-logo', { alt: 'Church logo', src: 'icons/favicon.svg' });
topIcons.appendChild(churchLogo);
// Only when the logo itself changes (colour changes must not make a new picture URL each time).
let logoShown = undefined, logoUrl = null;
async function refreshChurchLogo() {
  const id = settings.v.display.logo || null;
  if (id === logoShown) return;
  logoShown = id;
  let src = 'icons/favicon.svg', url = null;
  if (id) {
    try { const rec = await db.get('files', id); if (rec && rec.blob) src = url = URL.createObjectURL(rec.blob); } catch (e) { /* default icon */ }
  }
  if (logoShown !== id) { if (url) URL.revokeObjectURL(url); return; } // changed again meanwhile
  churchLogo.src = src;
  if (logoUrl) URL.revokeObjectURL(logoUrl);
  logoUrl = url;
}
refreshChurchLogo();
settings.on('change:display', (path) => { if (path === 'display.logo' || path === '*') refreshChurchLogo(); });
settings.on('change', (path) => { if (path === '*') refreshChurchLogo(); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ctx.installPrompt = e; installBtn.hidden = false; ui.enter(installBtn, 'pop'); });
window.addEventListener('appinstalled', () => { ctx.installPrompt = null; installBtn.hidden = true; ui.toast('SDA Sabbath is installed.', 'ok'); });
const mq = matchMedia('(max-width: 760px)');
const syncSearch = () => { searchBtn.hidden = !mq.matches; helpBtn.hidden = mq.matches; };
mq.addEventListener ? mq.addEventListener('change', syncSearch) : mq.addListener(syncSearch);
syncSearch();

// ------------------------------------------------------------ quick go-to
const quick = createQuick({ input: $('#quickInput'), pop: $('#quickPop'), wrap: $('#quick'), getTab, showTab });

// ------------------------------------------------------------ keyboard (also clickers & keys pressed on the display window)
function showHelp() {
  const rows = [
    ['F5  or  Ctrl+Enter', 'Present what is selected (Next → Live)'],
    ['→  ↓  Page Down  Space', 'Next verse / slide / stanza'],
    ['←  ↑  Page Up', 'Previous'], ['Home  End', 'First / last'],
    ['B  or  .', 'Black screen (press again to return)'], ['L', 'Show logo'], ['C  or  Esc twice', 'Clear the screen'],
    ['Esc', 'Close a menu or dialog, leave a text box (the screen stays as it is)'], ['M', 'Hymn music: play / pause'],
    ['/  or  Ctrl+K', 'Go to a Bible reference or hymn number (Enter selects it, Shift+Enter presents it now)'], ['Alt+1 … Alt+9, Alt+0', 'Switch tabs (Alt+0: Settings)'],
    ['1 … 9', 'Select that stanza (Hymns) or verse (Bible) as Next; type two digits quickly for verse 10 and up. Then F5 presents it'],
    ['Click  ·  Double-click  ·  Enter', 'On a verse or stanza: select it as Next  ·  present it now  ·  present it now'],
    ['Space (video live)', 'Play / pause'], ['F (on the display)', 'Toggle full screen'],
    ['Clicker', 'Page Down / Page Up work even while typing in a box; with nothing on screen, next shows the Next item'],
  ];
  ui.modal({ title: 'Keyboard and clicker shortcuts', body: h('div.col', h('div.form', rows.map(([k, d]) => [h('label', h('kbd', k)), h('span', d)])),
    h('div.row', h('button.btn', { type: 'button', onclick: () => { ui.closeModal(); clickerSetup(); } }, icon('settings'), h('span', 'Clicker setup and test…')))) });
}
function clickerSetup() { openClickerSetup({ version: VERSION });
}

// Presentation clickers are keyboards that send Page Down / Page Up (some send arrows, "." or B for black, F5 /
// Shift+F5 to start and Esc to end). They must work whatever has the keyboard focus, like in PowerPoint:
//  - Page Down / Page Up mean nothing in a one-line box or a list, so they always move the slides, even when a
//    search box or a dropdown has the focus, or a dialog is open (only a multi-line text box keeps them).
//  - A box the app focused by itself (Bible reference, hymn search) that is still empty also lets the other
//    clicker keys through: arrows, "." (black screen), Esc and Space. Letters still type normally.
const CLICK_NEXT = new Set(['PageDown']), CLICK_PREV = new Set(['PageUp']);
const QUIET_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', '.', 'Escape', ' ']);
let quietKey = false;
// Capture phase: see whether the box was focused by the app before the box's own handler clears that mark.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  quietKey = !!(t && t.classList && t.classList.contains('quiet-focus') && t.tagName === 'INPUT' && !t.value);
}, true);
const inBigText = (t) => !!(t && (t.isContentEditable || t.tagName === 'TEXTAREA'));
let endPressAt = 0;
let escAt = 0;
const quickInput = $('#quickInput');
// Boxes where "/" is part of what people type, so it does not jump to Go to there.
const slashTypes = (t) => {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
  if (t.tagName !== 'INPUT') return false;
  if (t.dataset && t.dataset.freeText != null) return true;
  return (t.type || 'text').toLowerCase() !== 'search'; // lookup boxes (Bible reference, Find a hymn …) are type=search
};

// Number keys go to the Bible or Hymns tab on show (or, from another tab, the one whose item is live).
let digits = '', digitsAt = 0;
function numberKey(k) {
  const id = current === 'bible' || current === 'hymns' ? current : live.cue && (live.cue.tab === 'bible' || live.cue.tab === 'hymns') ? live.cue.tab : null;
  if (!id || !tabs.has(id)) return false;
  const api = tabs.get(id);
  if (!api.numberKey) return false;
  digits = Date.now() - digitsAt < 800 && digits.length < 3 ? digits + k : k;
  digitsAt = Date.now();
  if (digits === '0') { digits = ''; return false; }
  return api.numberKey(+digits, digits.length > 1) !== false;
}

/** Clicker "next" with nothing more in the item on screen (or nothing on screen): show what is Next. */
function clickerNext() {
  if (!live.cue) {
    if (live.staged) { doPresent(); return; }
    ui.toast('Nothing is selected yet. Pick something in a tab; then the clicker’s next button shows it.', '', 4000);
    return;
  }
  const atEnd = live.cue.deck.kind !== 'video' && live.index >= live.count() - 1 && !live.cue.extend && !live.cue.autoLoop;
  if (atEnd && live.staged && !live.sameAsLive() && live.staged.id !== live.cue.id) {
    // Last slide: a second press within 4 seconds moves on to the item waiting on the Next screen.
    if (Date.now() - endPressAt < 4000) { endPressAt = 0; doPresent(); return; }
    endPressAt = Date.now();
    ui.toast('End of “' + live.cue.title + '”. Press next again to show: ' + live.staged.title, '', 4000);
    return;
  }
  live.next();
}

function doAction(act) {
  if (act === 'next') clickerNext();
  else if (act === 'prev') live.prev();
  else if (act === 'black') live.setBlank('black');
  else if (act === 'present') doPresent();
  else if (act === 'clear') live.clear();
}
// Keys a keyboard sends all the time: never worth a "clicker key not used" hint.
const PLAIN = /^(Shift|Control|Alt|AltGraph|Meta|OS|CapsLock|NumLock|ScrollLock|Tab|Enter|Backspace|Delete|Insert|ContextMenu|Dead|Compose|F(?:[1-9]|1[0-2])|Home|End|Arrow\w+|Page\w+|Escape|AudioVolume\w+|Print|PrintScreen|Pause)$/;
let hinted = false;

function handleKey(e, remote) {
  const k = e.key;
  const t = remote ? null : e.target;
  const sig = (remote && e.sig) || sigOfKey(e);
  if (clicker.testing) { if (remote) clicker.emit('event', { sig, from: 'projector window' }); return remote; }
  // A taught button, or one of the odd keys some clickers send (Browser Forward/Back, media keys, mouse on the projector).
  const taughtAct = actionFor(sig) || (remote && /^(mouse|wheel):/.test(sig) ? builtinAction(sig, true) : null);
  if (taughtAct && !inBigText(t)) { if (t && t.tagName === 'SELECT') t.blur(); doAction(taughtAct); return true; }
  const pager = (CLICK_NEXT.has(k) || CLICK_PREV.has(k)) && !inBigText(t) && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (pager) {
    if (t && t.tagName === 'SELECT') t.blur(); // otherwise the dropdown would also change
    if (CLICK_NEXT.has(k)) clickerNext(); else live.prev();
    return true;
  }
  if (!remote && ui.modalOpen() && k !== 'F5') { if (k === 'Escape') { ui.closeModal(); return true; } return false; }
  const quiet = !remote && quietKey && QUIET_KEYS.has(k);
  const typing = !remote && !quiet && isTyping(e);
  const ctrl = e.ctrlKey || e.metaKey;
  if (k === 'F5' || (ctrl && k === 'Enter')) { doPresent(); return true; }
  // Go to: Ctrl+K works everywhere; "/" too, except where a "/" is real text (notes, banner text, web addresses).
  if (!remote && t !== quickInput && ((ctrl && !e.altKey && (k === 'k' || k === 'K')) || (k === '/' && !ctrl && !e.altKey && !(typing && slashTypes(t))))) { quick.focus(); return true; }
  if (typing) { if (k === 'Escape' && t && t.blur && t !== quickInput && !e.defaultPrevented) t.blur(); return false; }
  if (quiet && t && t.blur) t.blur();
  if (e.altKey && /^[1-9]$/.test(k)) { const tb = TABS.filter(Boolean)[+k - 1]; if (tb) showTab(tb.id); return true; }
  if (e.altKey && k === '0') { showTab('settings'); return true; }
  if (ctrl || e.altKey) return false;
  // 1–9: stage that stanza (Hymns) or verse (Bible) as Next; F5 then presents it. Two digits quickly = verse 10+.
  if (!remote && /^[0-9]$/.test(k) && numberKey(k)) return true;
  const kind = live.cue && live.cue.deck.kind;
  switch (k) {
    case 'ArrowRight': case 'ArrowDown': live.next(); return true;
    case 'ArrowLeft': case 'ArrowUp': live.prev(); return true;
    case ' ': if (kind === 'video') live.mediaCmd('toggle'); else live.next(); return true;
    case 'Home': live.go(0); return true;
    case 'End': live.go(live.count() - 1); return true;
    case 'b': case 'B': case '.': live.setBlank('black'); return true;
    case 'w': case 'W': live.setBlank('black'); return true; // some clickers send W for a "white/blank" screen
    case 'l': case 'L': live.setBlank('logo'); return true;
    case 'c': case 'C': live.clear(); return true;
    case 'Escape': {
      // Esc alone never clears the screen (a stray press during a service): it closes menus and leaves boxes.
      // A second Esc within 600 ms clears, like C.
      if (!remote && ui.menuOpen()) { ui.closeMenu(); escAt = 0; return true; }
      if (!live.cue) { escAt = 0; return false; }
      if (Date.now() - escAt < 600) { escAt = 0; live.clear(); return true; }
      escAt = Date.now();
      ui.toast('Press Esc again to clear', '', 1400);
      return true;
    }
    case 'm': case 'M': getTab('hymns').then((tb) => tb.musicKey && tb.musicKey()); return true;
    case '?': showHelp(); return true;
  }
  if (!hinted && k && k.length > 1 && !PLAIN.test(k) && !isTyping(e)) {
    hinted = true;
    ui.toast(h('span', 'A button sent “' + k + '”, which SDA Sabbath does not use yet. ', h('button.btn.sm', { type: 'button', onclick: () => clickerSetup() }, 'Clicker setup')), '', 9000);
  }
  return false;
}
// Mouse “back / forward” side buttons (some clickers send these): change slides instead of leaving the app.
const onSideButton = (e) => {
  if (e.button !== 3 && e.button !== 4) return;
  e.preventDefault();
  if (clicker.testing) return;
  const act = actionFor(sigOfMouse(e.button));
  if (act) doAction(act);
};
document.addEventListener('mouseup', onSideButton);
document.addEventListener('auxclick', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
// The keyboard follows the mouse back out of an embedded web page, so the clicker works again.
document.addEventListener('pointermove', () => {
  const a = document.activeElement;
  if (a && a.tagName === 'IFRAME') { a.blur(); window.focus(); }
}, { passive: true });
document.addEventListener('keydown', (e) => { if (handleKey(e, false)) e.preventDefault(); });
// Keep the projector full screen: if it dropped out (Esc on the projector, a clicker's slide-show button,
// another window), the next click or key press on this control screen puts it back.
let fsAskAt = 0;
function keepDisplayFull(e) {
  if (settings.v.display.keepFull === false || link.kind !== 'window' || link.displayFull !== false) return;
  if (e.type === 'keydown' && (e.key === 'Escape' || /^(Shift|Control|Alt|Meta)$/.test(e.key))) return;
  const now = Date.now();
  if (now - fsAskAt < 800) return;
  fsAskAt = now;
  link.fullscreenDisplay();
}
document.addEventListener('pointerdown', keepDisplayFull, true);
document.addEventListener('keydown', keepDisplayFull, true);
live.on('remote-key', (m) => handleKey({ key: m.key, code: m.code, sig: m.sig, ctrlKey: m.ctrl, metaKey: false, altKey: m.alt, shiftKey: m.shift, target: null }, true));

// ------------------------------------------------------------ monitors & control bar
createMonitors($('#monitors'));
createControlBar($('#ctrlbar'), getTab);

// ------------------------------------------------------------ keep the control screen awake during a service (phones)
let wake = null;
async function keepAwake() {
  if (wake && !wake.released) return; // one lock is enough
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && (live.cue || link.kind)) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* */ }
}
document.addEventListener('visibilitychange', keepAwake);
live.on('live', keepAwake);

// ------------------------------------------------------------ storage problems
// Saving not possible at all (private window, storage blocked): say so once; the app still works.
window.addEventListener('selah-storage', () => ui.toast('This browser is not letting SDA Sabbath save (private window or storage turned off). Everything works, but changes are lost when it closes.', 'err', 10000));
// A full disk, or any other failure nobody waited for: tell the operator plainly instead of failing silently.
let fullShown = 0;
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  const name = r && r.name, msg = (r && r.message) || String(r || '');
  if (name === 'QuotaExceededError' || /quota|disk|space/i.test(msg)) {
    e.preventDefault();
    if (Date.now() - fullShown > 15000) { fullShown = Date.now(); ui.toast('This device is out of storage space, so the last change was not saved. Delete unused slides or videos (or free space on the device).', 'err', 10000); }
  }
});

// Anything else that fails without being caught (usually a lost internet connection) must never stop
// the service: it is logged, and a network failure gets one calm explanation instead of a broken screen.
const NET_ERR = /Failed to fetch|NetworkError|Load failed|network|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|offline|dynamically imported module|Importing a module script failed|AbortError|timed? ?out/i;
let netShown = 0;
function quietFailure(err) {
  const msg = (err && (err.message || err.name)) || String(err || '');
  if (NET_ERR.test(msg) || !navigator.onLine) {
    if (Date.now() - netShown > 20000) { netShown = Date.now(); ui.toast(navigator.onLine ? 'Could not reach the internet for that. Everything stored on this device keeps working.' : 'You are offline: that needs the internet. Everything stored on this device keeps working.', '', 6000); }
    return true;
  }
  return false;
}
window.addEventListener('unhandledrejection', (e) => { console.warn('Unhandled:', e.reason); if (quietFailure(e.reason)) e.preventDefault(); });
window.addEventListener('error', (e) => { if (e.error) console.warn('Error:', e.error); quietFailure(e.error || e.message); });

// ------------------------------------------------------------ offline readiness
// The app must always work without internet. The service worker stores every file; this checks now and
// then that nothing is missing and fetches what is (when there is internet), and shows an "Offline" mark.
const offMark = h('span.off-mark', { hidden: true, title: 'No internet. SDA Sabbath keeps working with everything stored on this device.' }, 'Offline');
document.querySelector('.brand') && document.querySelector('.brand').after(offMark);
function paintOnline() { offMark.hidden = navigator.onLine; }
window.addEventListener('online', () => { paintOnline(); checkOffline(true); });
window.addEventListener('offline', paintOnline);
paintOnline();
ctx.offlineHealth = null;
let healthWarned = false;
function checkOffline(repair) {
  const c = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!c) return false;
  c.postMessage({ t: 'check', repair: !!repair && navigator.onLine });
  return true;
}
ctx.checkOffline = checkOffline;
function onHealth(hh) {
  ctx.offlineHealth = hh;
  window.dispatchEvent(new CustomEvent('selah-health', { detail: hh }));
  if (hh.missingCount > 0 && !navigator.onLine && !healthWarned) {
    healthWarned = true;
    ui.toast('Some parts of SDA Sabbath are not stored on this device yet (' + hh.missingCount + ' files). Connect to the internet once with the app open to finish; everything else works.', 'err', 9000);
  }
}
setTimeout(() => checkOffline(true), 15000);
setInterval(() => { if (navigator.onLine) checkOffline(true); }, 30 * 60000);
// Ask the browser to keep the stored app and data even when the disk gets full.
setTimeout(() => { persistStorage(); }, 4000);

// Warn before closing while something is live.
window.addEventListener('beforeunload', (e) => { if (live.cue && link.kind === 'window') { e.preventDefault(); e.returnValue = ''; } });

// ------------------------------------------------------------ companion (LAN) detection
async function detectCompanion() {
  // The companion only serves plain http on the church network, so an https site (GitHub Pages)
  // or a file:// copy can never be it. Skipping the probe avoids a 404 in the console on every load.
  if (location.protocol !== 'http:') return;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1200);
    const r = await fetch('api/info', { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return;
    const info = await r.json();
    if (info.app !== 'selah-companion') return;
    ctx.companion = info;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    // Stage screens on the church network (no internet needed) follow this app through the companion.
    // Only the PC running the companion hosts them (a phone used as a remote must not answer as well).
    if (local) stageHub.connectLan(location.origin, settings.v.companion.pin);
    const params = new URLSearchParams(location.search);
    if (!local || params.get('remote') === '1') {
      // Opened from a phone on the church network: become a remote for the display there.
      const pin = params.get('pin') || settings.v.companion.pin || (await ui.promptBox('Connect to the church display', 'PIN shown by the SDA Sabbath companion'));
      if (pin != null) { settings.set('companion.pin', pin); link.connectSocket(location.origin, pin); }
    }
  } catch (e) { /* not served by the companion */ }
}

// ------------------------------------------------------------ service worker (offline + updates)
function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const ask = (w) => {
      const t = ui.toast(h('span', 'An SDA Sabbath update is ready. ', h('button.btn.sm', { type: 'button', onclick: () => { w.postMessage({ t: 'skip' }); } }, 'Update now')), 'ok', 15000);
      return t;
    };
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          if (live.cue) { const off = live.on('live', (c) => { if (!c) { off(); ask(w); } }); } // never interrupt a live item
          else ask(w);
        }
      });
    });
    // Reload only when an *update* takes over (not on the very first install).
    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading && !live.cue) { reloading = true; location.reload(); } });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.t === 'progress') ctx.cacheProgress = e.data;
      if (e.data && e.data.t === 'progress') window.dispatchEvent(new CustomEvent('selah-cache', { detail: e.data }));
      if (e.data && e.data.t === 'health' && e.data.total != null && e.data.have != null) onHealth(e.data);
    });
  }).catch((e) => console.warn('SW', e));
}

// ------------------------------------------------------------ boot
const qTab = new URLSearchParams(location.search).get('tab');
const firstTab = [qTab, settings.v.app.lastTab].map((id) => ALIAS[id] || id).find((id) => TABS.some((t) => t && t.id === id)) || 'bible';
showTab(firstTab).finally(() => { window.__selahBooted = true; const bg = document.getElementById('bootGuard'); if (bg) bg.remove(); });
// UI motion starts only after the first load has settled, so nothing animates during start-up.
const markBooted = () => setTimeout(() => document.documentElement.classList.add('booted'), 300);
if (document.readyState === 'complete') markBooted(); else window.addEventListener('load', markBooted, { once: true });
// Opening a PDF / PowerPoint file with SDA Sabbath (installed app on Chrome / Edge).
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    const files = await Promise.all(params.files.map((f) => f.getFile()));
    const slides = await showTab('slides');
    slides.importFiles(files);
  });
}
registerSW();
detectCompanion();
stageHub.start();
obs.start();
// Warm the Hymns tab in the background so "Go to 73" is instant.
setTimeout(() => getTab('hymns').catch(() => {}), 1500);
// The order of service also shows on the stage screens: load the Plan tab quietly too.
setTimeout(() => getTab('plan').catch(() => {}), 2500);
