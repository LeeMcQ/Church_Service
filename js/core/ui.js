// Modal, toast, menu and small control factories shared by every tab.
import { h, clear } from './util.js';
import { icon } from './icons.js';

// ------------------------------------------------------------ motion
// Small, calm UI motion for the operator screen only (never the congregation display).
// Off when the device asks for reduced motion, in low-power mode, and during the first load.
const reduceMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export function motionOK() {
  const r = document.documentElement.classList;
  return r.contains('booted') && !r.contains('lp') && !(reduceMQ && reduceMQ.matches);
}
/** Play a one-off CSS entrance (class `cls`) on el, then remove the class again. */
export function enter(el, cls = 'enter', ms = 600) {
  if (!el || !motionOK()) return el;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation if it is already running
  el.classList.add(cls);
  clearTimeout(el._enterT);
  el._enterT = setTimeout(() => el.classList.remove(cls), ms);
  return el;
}

/**
 * Scroll the nearest scrolling box (not the page) so `el` is in view, without moving the keyboard focus.
 * Smooth only when UI motion is allowed (never with reduced motion). Does nothing when el is already visible.
 */
export function keepInView(el, { pad = 8 } = {}) {
  if (!el || !el.isConnected || !el.getClientRects().length) return;
  let box = el.parentElement;
  while (box && box !== document.body) {
    const cs = getComputedStyle(box);
    if (/(auto|scroll)/.test(cs.overflowY) && box.scrollHeight > box.clientHeight + 1) break;
    box = box.parentElement;
  }
  if (!box || box === document.body) return;
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  const top = r.top - b.top, bottom = r.bottom - b.top;
  if (top >= pad && bottom <= box.clientHeight - pad) return;
  // Out of view: bring it to about a third from the top, so the verses that follow are visible too.
  const to = Math.max(0, box.scrollTop + top - Math.max(pad, Math.round((box.clientHeight - r.height) / 3)));
  box.scrollTo({ top: to, behavior: motionOK() ? 'smooth' : 'auto' });
}

let toastHost;
export function toast(msg, kind = '', ms = 3200) {
  if (!toastHost) { toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastHost); }
  // Same message already showing: keep one toast, just restart its timer.
  const text = typeof msg === 'string' ? msg : (msg && msg.textContent) || '';
  for (const old of Array.from(toastHost.children)) if (old.dataset.msg === text && !old.classList.contains('out')) old.remove();
  // Plain messages stay as long as it takes to read them (about 15 letters a second), not a fixed long time;
  // errors and messages with a button keep their time. A tap on a plain message closes it.
  if (typeof msg === 'string' && kind !== 'err') ms = Math.min(ms, Math.max(2200, Math.min(7000, 1800 + text.length * 65)));
  const t = h('div.toast' + (kind ? '.' + kind : ''), msg);
  t.dataset.msg = text;
  if (typeof msg === 'string') t.addEventListener('click', () => t.remove());
  toastHost.appendChild(t);
  setTimeout(() => {
    if (!motionOK()) { t.remove(); return; }
    t.classList.add('out'); // fade and drop away, then remove
    setTimeout(() => t.remove(), 180);
  }, ms);
  return t;
}

/** "Removed — Undo": the change is shown at once; onUndo puts it back. Calls onCommit (the real deletion) when the
 *  message has gone without Undo. Faster than "Are you sure?" and just as safe. */
export function undoToast(text, { onUndo, onCommit, ms = 7000 } = {}) {
  let undone = false;
  const b = h('button.btn.sm', { type: 'button', onclick: () => { if (undone) return; undone = true; t.remove(); if (onUndo) onUndo(); } }, 'Undo');
  const t = toast(h('span', text + ' ', b), 'ok', ms);
  t.dataset.keep = '1';
  setTimeout(() => { if (!undone && onCommit) onCommit(); }, ms + 300);
  return t;
}

/** Icon button. btn('play', 'Play', onclick, {cls:'sm', label:true}) */
export function btn(ic, title, onclick, opt = {}) {
  const b = h('button.btn' + (opt.cls ? '.' + opt.cls.split(' ').join('.') : '') + (opt.label ? '' : '.icon'),
    { type: 'button', title: title + (opt.key ? '  (' + opt.key + ')' : ''), 'aria-label': title, onclick });
  if (ic) b.appendChild(icon(ic));
  if (opt.label) b.appendChild(h('span', typeof opt.label === 'string' ? opt.label : title));
  if (opt.pressed != null) b.setAttribute('aria-pressed', String(!!opt.pressed));
  return b;
}

export function setPressed(b, on) { b.setAttribute('aria-pressed', String(!!on)); return b; }

/** Segmented control. seg([[value,label],...], current, onchange) */
export function seg(options, current, onchange) {
  const wrap = h('div.seg', { role: 'group' });
  const render = (val) => {
    clear(wrap);
    options.forEach(([v, label, title]) => {
      wrap.appendChild(h('button', { type: 'button', title: title || label, 'aria-pressed': String(v === val),
        onclick: () => { render(v); onchange(v); } }, label));
    });
  };
  render(current);
  wrap.set = render;
  return wrap;
}

export function toggle(label, checked, onchange, title) {
  const inp = h('input', { type: 'checkbox', checked: !!checked, onchange: () => onchange(inp.checked) });
  return h('label.switch', { title: title || label }, inp, h('span', label));
}

export function select(options, current, onchange, cls = 'field') {
  const s = h('select.' + cls, { onchange: () => onchange(s.value) });
  options.forEach(([v, label]) => s.appendChild(h('option', { value: v, selected: v === current }, label)));
  return s;
}

let openModal = null;
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** modal({title, body: Node, actions:[{label, primary, danger, onclick -> false keeps open}], wide}) */
export function modal({ title, body, actions = [], wide = false, onclose }) {
  const returnTo = openModal ? openModal.returnTo : document.activeElement;
  closeModal(true);
  const back = h('div.modal-back', { onmousedown: (e) => { if (e.target === back) closeModal(); } });
  const foot = h('div.modal-f');
  actions.forEach((a) => {
    foot.appendChild(h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), {
      type: 'button',
      onclick: async () => { const r = a.onclick ? await a.onclick() : undefined; if (r !== false) closeModal(); },
    }, a.label));
  });
  const m = h('div.modal' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-h', h('h2.grow', title), btn('x', 'Close', () => closeModal(), { cls: 'sm' })),
    h('div.modal-b', body),
    actions.length ? foot : null);
  back.appendChild(m);
  // Esc closes the dialog; Tab stays inside it (keyboard and screen-reader users).
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.prototype.filter.call(m.querySelectorAll(FOCUSABLE), (x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !m.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !m.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  });
  document.body.appendChild(back);
  openModal = { back, onclose, returnTo };
  const f = m.querySelector('input,select,textarea,button.primary') || m.querySelector('.modal-h button');
  if (f) setTimeout(() => f.focus(), 30);
  return m;
}
export function closeModal(replacing) {
  if (!openModal) return;
  const o = openModal; openModal = null;
  o.back.remove();
  // The dialog itself goes at once (focus and screen readers stay simple); only the dim fades out.
  if (replacing !== true && motionOK()) {
    const dim = h('div.modal-dim', { 'aria-hidden': 'true' });
    document.body.appendChild(dim);
    setTimeout(() => dim.remove(), 200);
  }
  if (o.onclose) o.onclose();
  // Give focus back to whatever opened the dialog (unless another dialog opened meanwhile).
  if (!openModal && o.returnTo && o.returnTo.isConnected && typeof o.returnTo.focus === 'function') {
    try { o.returnTo.focus({ preventScroll: true }); } catch (e) { /* */ }
  }
}
export const modalOpen = () => !!openModal;

export function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    modal({ title, body: h('p', text), onclose: () => { if (!done) resolve(false); },
      actions: [{ label: 'Cancel', onclick: () => { done = true; resolve(false); } },
        { label: okLabel, primary: !danger, danger, onclick: () => { done = true; resolve(true); } }] });
  });
}

export function promptBox(title, label, value = '', placeholder = '') {
  return new Promise((resolve) => {
    let done = false;
    const inp = h('input.field', { value, placeholder, style: { width: '100%' },
      onkeydown: (e) => { if (e.key === 'Enter') { done = true; resolve(inp.value); closeModal(); } } });
    modal({ title, body: h('div.col', h('label.muted', label), inp), onclose: () => { if (!done) resolve(null); },
      actions: [{ label: 'Cancel', onclick: () => { done = true; resolve(null); } },
        { label: 'OK', primary: true, onclick: () => { done = true; resolve(inp.value); } }] });
  });
}

let openMenu = null;
/** Pop-up menu anchored to an element. items: [{label, icon, onclick} | '-'] */
export function menu(anchor, items) {
  closeMenu();
  const m = h('div.menu', { role: 'menu' });
  items.forEach((it) => {
    if (it === '-') { m.appendChild(h('hr')); return; }
    if (!it) return;
    const b = h('button', { type: 'button', role: 'menuitem', disabled: !!it.disabled, onclick: () => { closeMenu(); it.onclick && it.onclick(); } },
      it.icon ? icon(it.icon) : null, h('span.grow', it.label), it.hint ? h('span.faint', it.hint) : null);
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = Math.min(r.left, innerWidth - mw - 8), y = r.bottom + 4;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 4);
  m.style.left = Math.max(8, x) + 'px'; m.style.top = y + 'px';
  m.style.transformOrigin = (y < r.top ? 'bottom ' : 'top ') + (x < r.left - 4 ? 'right' : 'left');
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  function outside(e) { if (!m.contains(e.target)) closeMenu(); }
  // Keyboard: Esc closes, ↑/↓ move between items.
  m.addEventListener('keydown', (e) => {
    const its = Array.prototype.filter.call(m.querySelectorAll('button'), (b) => !b.disabled);
    const i = its.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); (its[i + 1] || its[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); (its[i - 1] || its[its.length - 1]).focus(); }
    else if (e.key === 'Tab') closeMenu();
  });
  openMenu = { m, outside, anchor };
  if (anchor && anchor.matches && anchor.matches(':focus-visible')) { const fb = m.querySelector('button:not([disabled])'); if (fb) fb.focus(); }
  return m;
}
export const menuOpen = () => !!openMenu;
export function closeMenu() {
  if (!openMenu) return;
  const o = openMenu; openMenu = null;
  document.removeEventListener('pointerdown', o.outside, true);
  const hadFocus = o.m.contains(document.activeElement);
  o.m.remove();
  if (hadFocus && o.anchor && o.anchor.isConnected) { try { o.anchor.focus({ preventScroll: true }); } catch (e) { /* */ } }
}

/** One empty / no-results pattern everywhere: icon, short title, one muted line, at most one action.
 *  emptyState('search', 'No hymn matches “x”', 'Try a number like 73.', {label, onclick, icon, primary}) */
export function emptyState(ic, title, text, action, attrs) {
  return h('div.empty-state', attrs || null, ic ? icon(ic) : null, h('p.es-t', title), text ? h('p.es-d', text) : null,
    action ? h('button.btn' + (action.primary ? '.primary' : ''), { type: 'button', onclick: action.onclick }, action.icon ? icon(action.icon) : null, h('span', action.label)) : null);
}

/** Make a clickable non-button element (verse row, plan item) usable from the keyboard. */
export function activatable(el, label) {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  if (label) el.setAttribute('aria-label', label);
  el.addEventListener('keydown', (e) => {
    if (e.target !== el || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: e.shiftKey })); }
  });
  return el;
}

/** Drag-and-drop + click file zone. */
export function dropzone(text, accept, onfiles) {
  const inp = h('input', { type: 'file', multiple: true, accept, style: { display: 'none' },
    onchange: () => { onfiles(Array.from(inp.files)); inp.value = ''; } });
  const z = h('div.dropzone', { tabindex: 0, role: 'button', onclick: () => inp.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } } },
  icon('upload'), h('div', text), inp);
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('over'); onfiles(Array.from(e.dataTransfer.files || [])); });
  return z;
}
