// Clicker setup: shows exactly what the clicker sends, and lets each button be taught once.
import { h, clear } from './core/util.js';
import { icon } from './core/icons.js';
import * as ui from './core/ui.js';
import { clicker, ACTIONS, actionFor, teach, forget, taught, describe, sigOfKey, sigOfMouse } from './core/clicker.js';

/** What a button does when nothing was taught for it (mirrors app.js handleKey). */
export function builtinAction(sig, fromDisplay) {
  const v = String(sig).replace(/^key:/, '');
  if (/^key:/.test(sig)) {
    if (['PageDown', 'ArrowRight', 'ArrowDown', ' '].includes(v)) return 'next';
    if (['PageUp', 'ArrowLeft', 'ArrowUp'].includes(v)) return 'prev';
    if (['b', 'B', '.', 'w', 'W'].includes(v)) return 'black';
    if (v === 'F5') return 'present';
    if (['c', 'C'].includes(v)) return 'clear'; // Esc clears only when pressed twice quickly
  }
  if (fromDisplay) return { 'mouse:0': 'next', 'mouse:2': 'prev', 'wheel:down': 'next', 'wheel:up': 'prev' }[sig] || null;
  return null;
}
const actName = (a) => (ACTIONS.find(([x]) => x === a) || [0, 'nothing'])[1];

export function openClickerSetup({ version, onClose } = {}) {
  let learning = null;
  const status = h('div.ck-status', h('b', 'Press any button on the clicker.'), h('div.note', 'What the app receives appears here, so you can see that the clicker reaches it.'));
  const log = h('div.ck-log');
  const rows = h('div.ck-rows');
  const build = h('span.note', 'App ' + (version || ''));
  fetch('asset-manifest.json').then((r) => r.json()).then((j) => { build.textContent = 'App ' + (version || '') + ' · build ' + (j.version || '?'); }).catch(() => {});

  function paintRows() {
    clear(rows);
    const m = taught();
    ACTIONS.forEach(([act, label]) => {
      const chips = (Array.isArray(m[act]) ? m[act] : []).map((sig) => h('span.chip.ck-chip', describe(sig)));
      rows.appendChild(h('div.ck-row', h('b', label), h('div.row.wrap.grow', chips.length ? chips : h('span.note', 'built-in keys')),
        h('button.btn.sm' + (learning === act ? '.primary' : ''), { type: 'button', onclick: () => { learning = learning === act ? null : act; paintRows(); showLearn(); } },
          icon('edit'), h('span', learning === act ? 'Press the button now…' : 'Teach'))));
    });
  }
  function showLearn() {
    if (!learning) return;
    clear(status);
    status.append(h('b', 'Press the clicker button for “' + actName(learning) + '” now.'), h('div.note', 'Press Teach again to cancel.'));
  }
  function got(sig, from) {
    if (!sig) return;
    if (learning) {
      const act = learning; learning = null;
      teach(act, sig);
      clear(status);
      status.append(h('b', describe(sig) + ' now does: ' + actName(act)), h('div.note', /^mouse:[02]$|^wheel:/.test(sig) ? 'Mouse clicks and scrolling only act on the projector window (so normal clicking here keeps working).' : 'Works everywhere, also while typing in a search box.'));
      paintRows();
    } else {
      const act = actionFor(sig, { builtin: false }) || actionFor(sig) || builtinAction(sig, from === 'projector window');
      clear(status);
      status.append(h('b', describe(sig) + (act ? ' → ' + actName(act) : ' → not used yet')), h('div.note', 'From ' + from + '. ' + (act ? 'This button works.' : 'Press Teach next to what it should do, then press this button again.')));
    }
    log.prepend(h('div.ck-line', describe(sig), h('span.note', ' · ' + from)));
    while (log.childNodes.length > 6) log.lastChild.remove();
  }
  // Everything this window receives while the dialog is open (before the app acts on it).
  const onKey = (e) => {
    if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return;
    if (e.key === 'Escape' && !learning) { got(sigOfKey(e), 'this window'); return; } // still closes the dialog
    e.preventDefault(); e.stopPropagation();
    got(sigOfKey(e), 'this window');
  };
  const onMouse = (e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); got(sigOfMouse(e.button), 'this window'); } };
  const onRemote = (ev) => got(ev.sig, ev.from || 'projector window');
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('mouseup', onMouse, true);
  const offRemote = clicker.on('event', onRemote);
  clicker.testing = true;

  paintRows();
  ui.modal({
    title: 'Clicker setup', wide: true,
    body: h('div.col', { style: { gap: '10px' } },
      status, log,
      h('h4', 'Teach a button'),
      h('p.note', 'Most clickers work without this. If a button does nothing, press Teach next to what it should do, then press that button on the clicker.'),
      rows,
      h('div.row.wrap', h('button.btn.sm', { type: 'button', onclick: () => { forget(); paintRows(); ui.toast('Taught buttons forgotten. The built-in keys still work.', 'ok', 2500); } }, icon('reload'), h('span', 'Forget taught buttons')), h('div.grow'), build),
      h('details.ck-help', h('summary', 'Nothing appears when I press a button'),
        h('ul',
          h('li', 'The clicker types into the window that is active. Click once on the SDA Sabbath window (or on the projector window), then try again.'),
          h('li', 'Make sure you have the newest version: close and reopen the app, or press Update now when it is offered. The build number above changes with each update.'),
          h('li', 'Check the clicker: batteries, the USB receiver plugged in, and its on/off switch. Many clickers have a mode switch (for example PowerPoint / Keynote / mouse mode); try another mode.'),
          h('li', 'A clicker in mouse mode (left / right click or scrolling) works on the projector window: click it once so it goes full screen, then the clicker moves the slides.'),
          h('li', 'Volume and media buttons are often used by Windows itself and never reach the browser; use another button or mode for those.')))),
    actions: [{ label: 'Done', primary: true }],
    onclose: () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mouseup', onMouse, true);
      offRemote && offRemote();
      clicker.testing = false;
      if (onClose) onClose();
    },
  });
}
