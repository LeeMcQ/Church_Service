// The banner canvas editor, Google Slides style: click to select, drag to move, handles to resize and
// rotate, double-click to type. Text boxes, shapes, lines/arrows and pictures; rich text (font, size,
// colour, highlight, bold/italic/underline/strike, lists, alignment, line spacing); fill, border,
// shadow, opacity, entry animation; arrange (order, align, distribute, group, lock, flip, rotate);
// snapping guides, multi-select, copy/paste, keyboard shortcuts and a right-click menu.
//
// The editor never draws the slide itself: the preview stage renders the slide (exactly as the
// display will), and the editor lays a transparent overlay over it for selection and handles.
import { h, clear, uid } from '../core/util.js';
import { lsKey } from '../core/storens.js';
import { icon } from '../core/icons.js';
import { menu, closeMenu, toast } from '../core/ui.js';
import { FONTS, SHAPES, cleanEl, cleanHtml, placeEl, drawLine, shrinkText, textHtml, htmlText, okColor } from '../core/slideels.js';

const SW = 1920; // the stage is always 1920 px wide
const CLIP_KEY = lsKey('slide-clipboard');
const PALETTE = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
  ['#1f4068', '#0b1729', '#245a40', '#432a6e', '#6a4422', '#a8461f', '#f2cf7a', '#ecd88f', '#f5eddc', '#2b2216'],
];
const SIZES = [12, 14, 18, 24, 28, 32, 36, 44, 54, 64, 72, 88, 100, 120, 150, 180, 220, 280];
const ANIMS = [['none', 'None'], ['fade', 'Fade in'], ['zoom', 'Zoom in'], ['up', 'Fly in from bottom'], ['down', 'Fly in from top'], ['left', 'Fly in from right'], ['right', 'Fly in from left'], ['spin', 'Spin in']];
const r1 = (v) => Math.round(v * 100) / 100;
const isText = (e) => e && (e.t === 'text' || e.t === 'shape');

let recent = [];
try { recent = JSON.parse(localStorage.getItem(lsKey('recent-colours')) || '[]').filter(okColor).slice(0, 10); } catch (e) { recent = []; }
function addRecent(c) {
  if (!okColor(c) || c === 'transparent') return;
  recent = [c].concat(recent.filter((x) => x !== c)).slice(0, 10);
  try { localStorage.setItem(lsKey('recent-colours'), JSON.stringify(recent)); } catch (e) { /* */ }
}

/** A colour popover: palette, recent colours, transparent and a custom picker. */
export function colorPop(anchor, value, onPick, opts = {}) {
  closeMenu();
  document.querySelectorAll('.se-pop').forEach((p) => p.remove());
  const pop = h('div.se-pop', { role: 'dialog', 'aria-label': opts.title || 'Colour' });
  const pickC = (c) => { addRecent(c); onPick(c); close(); };
  if (opts.none !== false) pop.appendChild(h('button.btn.sm.se-none', { type: 'button', onclick: () => { onPick(''); close(); } }, h('span.se-sw.none'), opts.noneLabel || 'Transparent'));
  PALETTE.forEach((row) => pop.appendChild(h('div.se-sw-row', row.map((c) => h('button.se-sw', { type: 'button', title: c, 'aria-label': c, 'aria-pressed': String(c === value), style: { background: c }, onclick: () => pickC(c) })))));
  if (recent.length) pop.append(h('div.note', 'Recent'), h('div.se-sw-row', recent.map((c) => h('button.se-sw', { type: 'button', title: c, style: { background: c }, onclick: () => pickC(c) }))));
  const cust = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff', 'aria-label': 'Custom colour', oninput: () => onPick(cust.value), onchange: () => { addRecent(cust.value); } });
  pop.append(h('label.row.se-custom', icon('plus'), h('span.grow', 'Custom…'), cust));
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + 'px';
  pop.style.top = (r.bottom + ph + 8 > innerHeight ? Math.max(8, r.top - ph - 4) : r.bottom + 4) + 'px';
  const outside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  pop.addEventListener('keydown', key);
  function close() { document.removeEventListener('pointerdown', outside, true); pop.remove(); }
  return pop;
}

/**
 * opts: { screen, stageEl(), slide(), commit({typing?, render?, panel?}), rerender(), storeImage(blob,name)->id,
 *         pictures()->[{id,name,thumb}], undo(), redo(), canUndo(), canRedo(), convertParts(list), canConvert(),
 *         tokens:[[token,label]], onSelect(sel) }
 */
export function createSlideEditor(opts) {
  const { screen } = opts;
  let sel = [];            // selected element ids ('part:title' for template text)
  let editing = null;      // {id, tx, node, isNew}
  let tool = null;         // insert tool: {t:'text'|'shape'|'line', shape?, a2?}
  let keepRatio = false;
  let savedRange = null;
  let drag = null;
  const ov = h('div.se-ov', { tabindex: '0', role: 'group', 'aria-roledescription': 'slide canvas', 'aria-label': 'Slide canvas. Click an item to select it, double-click text to edit it.' });
  const guides = h('div.se-guides');
  ov.appendChild(guides);
  screen.appendChild(ov);
  screen.classList.add('se-screen');

  const els = () => { const s = opts.slide(); if (!Array.isArray(s.els)) s.els = []; return s.els; };
  const byId = (id) => els().find((e) => e.id === id);
  const selEls = () => sel.map(byId).filter(Boolean);
  const stage = () => opts.stageEl();
  const nodeOf = (id) => { const st = stage(); return st && st.querySelector('.layer:not(.hide) [data-el="' + id + '"]') || (st && st.querySelector('[data-el="' + id + '"]')); };
  const partNode = (p) => { const st = stage(); return st && (st.querySelector('.layer:not(.hide) [data-part="' + p + '"]') || st.querySelector('[data-part="' + p + '"]')); };

  // ---------------------------------------------------------------- geometry
  /** The stage on screen: position inside the overlay's parent, its size, and the scale. */
  function geo() {
    const st = stage();
    const sr = screen.getBoundingClientRect();
    if (!st) return { L: 0, T: 0, W: sr.width, H: sr.height, k: sr.width / SW, sh: 1080 };
    const r = st.getBoundingClientRect();
    return { L: r.left - sr.left - screen.clientLeft, T: r.top - sr.top - screen.clientTop, W: r.width, H: r.height, k: r.width / SW, sh: r.height / (r.width / SW) };
  }
  function layoutOverlay() {
    const g = geo();
    Object.assign(ov.style, { left: g.L + 'px', top: g.T + 'px', width: g.W + 'px', height: g.H + 'px' });
    return g;
  }
  /** Box of an element in overlay pixels (unrotated), from the drawn node when there is one. */
  function boxOf(e, g = geo()) {
    if (e.t === 'line') {
      const x1 = e.x1 / 100 * g.W, y1 = e.y1 / 100 * g.H, x2 = e.x2 / 100 * g.W, y2 = e.y2 / 100 * g.H;
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), rot: 0, line: { x1, y1, x2, y2 } };
    }
    const n = nodeOf(e.id);
    const w = n ? n.offsetWidth * g.k : e.w / 100 * g.W;
    const hh = n ? n.offsetHeight * g.k : e.h / 100 * g.H;
    return { x: e.x / 100 * g.W, y: e.y / 100 * g.H, w, h: hh, rot: e.rot || 0 };
  }
  function partBox(p) {
    const n = partNode(p), st = stage();
    if (!n || !st) return null;
    const r = n.getBoundingClientRect(), sr = st.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height, rot: 0 };
  }
  const aabb = (b) => {
    if (!b.rot) return { x: b.x, y: b.y, w: b.w, h: b.h };
    const a = b.rot * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const W = b.w * c + b.h * s, H = b.w * s + b.h * c;
    return { x: b.x + b.w / 2 - W / 2, y: b.y + b.h / 2 - H / 2, w: W, h: H };
  };
  function inBox(px, py, b) {
    if (b.line) {
      const { x1, y1, x2, y2 } = b.line;
      const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / L2));
      return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1))) < 8;
    }
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = -(b.rot || 0) * Math.PI / 180;
    const dx = px - cx, dy = py - cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) <= b.w / 2 + 2 && Math.abs(ly) <= b.h / 2 + 2;
  }
  const PARTS = ['kicker', 'title', 'text', 'foot', 'count'];
  function hit(px, py) {
    const g = geo();
    const list = els();
    for (let i = list.length - 1; i >= 0; i--) if (inBox(px, py, boxOf(list[i], g))) return list[i].id;
    for (const p of PARTS) { const b = partBox(p); if (b && inBox(px, py, b)) return 'part:' + p; }
    return null;
  }
  const local = (ev) => { const r = ov.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  /** Expand a selection to whole groups. */
  function withGroups(ids) {
    const out = new Set(ids);
    ids.forEach((id) => { const e = byId(id); if (e && e.g) els().forEach((x) => { if (x.g === e.g) out.add(x.id); }); });
    return [...out];
  }

  // ---------------------------------------------------------------- drawing the overlay
  function draw() {
    if (!ov.isConnected) return;
    const g = layoutOverlay();
    ov.querySelectorAll('.se-box, .se-hov, .se-ghost').forEach((n) => n.remove());
    // Faint outlines for empty text boxes (they show nothing on the screen).
    els().forEach((e) => {
      if (e.t === 'text' && !htmlText(e.html) && !(editing && editing.id === e.id) && !sel.includes(e.id)) {
        const b = boxOf(e, g);
        ov.appendChild(h('div.se-ghost', { style: boxStyle(b) }, h('span', 'Click to add text')));
      }
    });
    const items = sel.map((id) => (id.startsWith('part:') ? { id, b: partBox(id.slice(5)), part: true } : (byId(id) ? { id, e: byId(id), b: boxOf(byId(id), g) } : null))).filter((x) => x && x.b);
    if (!items.length) { ov.classList.toggle('editing', !!editing); return; }
    const single = items.length === 1;
    items.forEach((it) => {
      if (it.e && it.e.t === 'line') {
        const { x1, y1, x2, y2 } = it.b.line;
        const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
        const box = h('div.se-box.se-linebox', { style: { left: x1 + 'px', top: y1 + 'px', width: len + 'px', transform: 'rotate(' + ang + 'deg)' } });
        ov.appendChild(box);
        if (single && !it.e.lock) {
          ov.appendChild(h('div.se-box.se-pt', { 'data-p': '1', style: { left: x1 + 'px', top: y1 + 'px' }, title: 'Drag the start of the line' }));
          ov.appendChild(h('div.se-box.se-pt', { 'data-p': '2', style: { left: x2 + 'px', top: y2 + 'px' }, title: 'Drag the end of the line' }));
        }
        return;
      }
      const box = h('div.se-box' + (it.part ? '.se-part' : '') + (it.e && it.e.lock ? '.se-locked' : '') + (editing && editing.id === it.id ? '.se-edit' : ''), { style: boxStyle(it.b) });
      if (single && !(it.e && it.e.lock) && !(editing && editing.id === it.id)) {
        ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((k) => box.appendChild(h('div.se-h.se-h-' + k, { 'data-h': k })));
        if (!it.part) box.appendChild(h('div.se-rot', { 'data-h': 'rot', title: 'Drag to rotate (Shift: steps of 15°)' }));
      }
      if (it.e && it.e.lock) box.appendChild(h('div.se-lockic', icon('lock')));
      if (it.part) box.appendChild(h('div.se-tag', 'Template text · double-click to edit on the slide'));
      ov.appendChild(box);
    });
    if (!single) {
      const bb = unionBox(items.map((it) => aabb(it.b)));
      const box = h('div.se-box.se-multi', { style: boxStyle(bb) });
      if (!items.some((it) => it.part || (it.e && it.e.lock))) ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((k) => box.appendChild(h('div.se-h.se-h-' + k, { 'data-h': k })));
      ov.appendChild(box);
    }
    ov.classList.toggle('editing', !!editing);
  }
  const boxStyle = (b) => ({ left: b.x + 'px', top: b.y + 'px', width: Math.max(1, b.w) + 'px', height: Math.max(1, b.h) + 'px', transform: b.rot ? 'rotate(' + b.rot + 'deg)' : '' });
  function unionBox(bs) {
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    const X = Math.max(...bs.map((b) => b.x + b.w)), Y = Math.max(...bs.map((b) => b.y + b.h));
    return { x, y, w: X - x, h: Y - y };
  }

  // ---------------------------------------------------------------- selection
  function select(ids, opt = {}) {
    if (editing && !opt.keepEdit) finishEdit();
    sel = withGroups((ids || []).filter((id) => id.startsWith('part:') || byId(id)));
    draw();
    renderToolbar();
    renderPanel();
    if (opts.onSelect) opts.onSelect(sel.slice());
  }
  /** Change elements: fn(e) for each selected element, then redraw it in place and save. */
  function change(fn, how = {}) {
    const list = how.list || selEls();
    if (!list.length) return;
    list.forEach((e) => { fn(e); Object.assign(e, cleanEl(e)); });
    redrawNodes(list);
    opts.commit({ render: how.render !== false ? 'soon' : false, panel: false });
    draw();
    if (how.panel) renderPanel();
    if (how.toolbar !== false) renderToolbar();
  }
  /** Quick in-place update of drawn nodes (no full re-render). */
  function redrawNodes(list) {
    const g = geo();
    list.forEach((e) => {
      const n = nodeOf(e.id);
      if (!n) return;
      if (e.t === 'line') { drawLine(n, e, SW, g.sh); placeEl(n, e); return; }
      placeEl(n, e);
      const box = n.querySelector('.fe-box[data-shrink]');
      if (box) shrinkText(box, e);
    });
  }

  // ---------------------------------------------------------------- inserting
  function centerSpot(w, hgt) { return { x: r1(50 - w / 2), y: r1(50 - hgt / 2) }; }
  function addEl(e, startEdit) {
    const c = cleanEl(Object.assign({ id: 'e' + uid() }, e));
    els().push(c);
    opts.commit({ render: 'now' }).then(() => { select([c.id]); if (startEdit) setTimeout(() => beginEdit(c.id, null, true), 30); });
    return c;
  }
  const ratio = () => { const g = geo(); return g.W / g.H || 16 / 9; };
  function newText(box) {
    const b = box || Object.assign(centerSpot(40, 14), { w: 40, h: 14 });
    return addEl({ t: 'text', ...b, html: '', size: 64, color: '#ffffff', align: 'left', va: 'top', fit: 'grow' }, true);
  }
  function newShape(shape, box) {
    const w = 20, hh = 20 * ratio();
    const b = box || Object.assign(centerSpot(w, hh), { w, h: hh });
    return addEl({ t: 'shape', shape, ...b, fill: '#4a86e8', bc: '', bw: 0, html: '', size: 56, color: '#ffffff', align: 'center', va: 'middle', fit: 'none' });
  }
  function newLine(a2, pts, a1) {
    const p = pts || { x1: 30, y1: 50, x2: 70, y2: 50 };
    return addEl({ t: 'line', ...p, lc: '#ffffff', lw: 8, ld: 'solid', a1: a1 || 'none', a2: a2 || 'none' });
  }
  async function newImage(file, at) {
    if (!file || !/^image\//.test(file.type)) { toast('That is not a picture.', 'err'); return null; }
    let wpx = 1600, hpx = 900;
    try { const bmp = await createImageBitmap(file); wpx = bmp.width; hpx = bmp.height; if (bmp.close) bmp.close(); } catch (e) { /* use 16:9 */ }
    const id = await opts.storeImage(file, file.name || 'Picture');
    const g = geo();
    let w = 45, hh = 45 / 100 * g.W * (hpx / wpx) / g.H * 100;
    if (hh > 70) { hh = 70; w = 70 / 100 * g.H * (wpx / hpx) / g.W * 100; }
    const pos = at ? { x: r1(at.x / g.W * 100 - w / 2), y: r1(at.y / g.H * 100 - hh / 2) } : centerSpot(w, hh);
    return addEl({ t: 'image', src: id, ...pos, w: r1(w), h: r1(hh), ifit: 'cover' });
  }
  function pickImage(replace) {
    const inp = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) return;
      if (replace) { const id = await opts.storeImage(f, f.name); change((e) => { e.src = id; }, { render: true }); opts.commit({ render: 'now' }); }
      else newImage(f);
    } });
    document.body.appendChild(inp); inp.click();
  }
  async function galleryImage(btnEl) {
    const pics = await opts.pictures();
    if (!pics.length) { pickImage(false); return; }
    menu(btnEl, [{ label: 'Upload from this device…', icon: 'upload', onclick: () => pickImage(false) }, '-',
      ...pics.slice(0, 14).map((p) => ({ label: p.name || 'Picture', icon: 'image', onclick: () => addPictureId(p.id, p) }))]);
  }
  async function addPictureId(id, p) {
    const g = geo();
    let w = 45, hh = 45 * ratio() * 9 / 16;
    if (p && p.w && p.h) hh = 45 / 100 * g.W * (p.h / p.w) / g.H * 100;
    addEl({ t: 'image', src: id, ...centerSpot(w, hh), w, h: r1(hh), ifit: 'cover' });
  }

  // ---------------------------------------------------------------- text editing
  function beginEdit(id, ev, isNew) {
    const e = byId(id);
    if (!isText(e) || e.lock) return;
    if (editing && editing.id === id) return;
    if (editing) finishEdit();
    const node = nodeOf(id);
    const tx = node && node.querySelector('.fe-tx');
    if (!tx) return;
    sel = [id];
    editing = { id, tx, node, isNew: !!isNew, before: e.html };
    node.classList.add('se-editing');
    tx.contentEditable = 'true';
    tx.spellcheck = true;
    tx.addEventListener('input', onTyping);
    tx.addEventListener('keydown', onEditKey);
    tx.addEventListener('paste', onPastePlain);
    tx.focus({ preventScroll: true });
    try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch (er) { /* */ }
    const s = window.getSelection();
    let placed = false;
    if (ev && document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(ev.clientX, ev.clientY);
      if (r && tx.contains(r.startContainer)) { s.removeAllRanges(); s.addRange(r); placed = true; }
    }
    if (!placed) { const r = document.createRange(); r.selectNodeContents(tx); if (!isNew) r.collapse(false); s.removeAllRanges(); s.addRange(r); }
    document.addEventListener('pointerdown', outsideEdit, true);
    draw(); renderToolbar(); renderPanel();
  }
  function onTyping() {
    if (!editing) return;
    const e = byId(editing.id);
    if (!e) return;
    e.html = editing.tx.innerHTML;
    opts.commit({ typing: true, render: false });
    draw();
  }
  function onPastePlain(ev) {
    // Pasted text keeps line breaks but drops outside formatting (web pages, Word).
    const t = ev.clipboardData && ev.clipboardData.getData('text/plain');
    const html = ev.clipboardData && ev.clipboardData.getData('text/html');
    ev.preventDefault();
    if (html) document.execCommand('insertHTML', false, cleanHtml(html));
    else if (t != null) document.execCommand('insertText', false, t);
  }
  function onEditKey(ev) {
    ev.stopPropagation(); // typing never reaches the app's presenter keys
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Escape') { ev.preventDefault(); const id = editing.id; finishEdit(); select([id]); ov.focus({ preventScroll: true }); }
    else if (ctrl && (ev.key === 'z' || ev.key === 'Z' || ev.key === 'y')) { /* native undo inside the text */ }
    else if (ctrl && ev.shiftKey && (ev.key === '>' || ev.key === '.')) { ev.preventDefault(); stepSize(1); }
    else if (ctrl && ev.shiftKey && (ev.key === '<' || ev.key === ',')) { ev.preventDefault(); stepSize(-1); }
    else if (ctrl && ev.shiftKey && (ev.key === '7' || ev.key === '&')) { ev.preventDefault(); exec('insertOrderedList'); }
    else if (ctrl && ev.shiftKey && (ev.key === '8' || ev.key === '*')) { ev.preventDefault(); exec('insertUnorderedList'); }
    else if (ctrl && ev.shiftKey && /^[lerj]$/i.test(ev.key)) { ev.preventDefault(); setAlign({ l: 'left', e: 'center', r: 'right', j: 'justify' }[ev.key.toLowerCase()]); }
    else if (ctrl && ev.key === '\\') { ev.preventDefault(); exec('removeFormat'); }
    else if (ev.key === 'Tab') { ev.preventDefault(); exec(ev.shiftKey ? 'outdent' : 'indent'); }
  }
  function outsideEdit(ev) {
    if (!editing) return;
    if (editing.node.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest('.se-toolbar, .se-pop, .menu, .se-panel, .modal')) return;
    finishEdit();
  }
  function finishEdit() {
    if (!editing) return;
    const ed = editing; editing = null;
    document.removeEventListener('pointerdown', outsideEdit, true);
    ed.tx.removeEventListener('input', onTyping);
    ed.tx.removeEventListener('keydown', onEditKey);
    ed.tx.removeEventListener('paste', onPastePlain);
    ed.tx.contentEditable = 'false';
    ed.node.classList.remove('se-editing');
    const e = byId(ed.id);
    if (e) {
      e.html = cleanHtml(ed.tx.innerHTML);
      // A brand-new text box left empty disappears, like in Google Slides.
      if (ed.isNew && e.t === 'text' && !htmlText(e.html)) { const i = els().indexOf(e); els().splice(i, 1); sel = sel.filter((x) => x !== e.id); }
    }
    savedRange = null;
    opts.commit({ render: 'now' });
    draw(); renderToolbar(); renderPanel();
  }
  document.addEventListener('selectionchange', () => {
    if (!editing) return;
    const s = window.getSelection();
    if (s.rangeCount && editing.tx.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  });
  function restoreRange() {
    if (!editing) return;
    editing.tx.focus({ preventScroll: true });
    if (savedRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
  }
  const hasRange = () => !!(editing && savedRange && !savedRange.collapsed && editing.tx.contains(savedRange.startContainer));
  /** Run a rich-text command on the selected text, or on all of the selected boxes' text. */
  function exec(cmd, val) {
    if (editing) {
      restoreRange();
      document.execCommand('styleWithCSS', false, cmd === 'hiliteColor' || cmd === 'backColor');
      document.execCommand(cmd === 'hiliteColor' ? 'backColor' : cmd, false, val);
      onTyping();
      return;
    }
    const list = selEls().filter(isText);
    if (!list.length) return;
    opts.commit({ render: false });
    list.forEach((e) => {
      const tmp = h('div', { contenteditable: 'true', style: { position: 'fixed', left: '-9999px', top: '0' } });
      tmp.innerHTML = e.html || '';
      document.body.appendChild(tmp);
      tmp.focus();
      const r = document.createRange(); r.selectNodeContents(tmp);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      document.execCommand('styleWithCSS', false, cmd === 'hiliteColor');
      document.execCommand(cmd === 'hiliteColor' ? 'backColor' : cmd, false, val);
      e.html = cleanHtml(tmp.innerHTML);
      tmp.remove();
    });
    opts.commit({ render: 'now' });
    renderToolbar();
  }
  /** Bold / italic / underline / strike: on selected text while typing, otherwise on the whole box. */
  function toggleStyle(k) {
    const cmd = { b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough' }[k];
    if (editing && hasRange()) { exec(cmd); renderToolbar(); return; }
    if (editing) { restoreRange(); document.execCommand(cmd); onTyping(); renderToolbar(); return; }
    const list = selEls().filter(isText);
    const on = !list.every((e) => e[k]);
    change((e) => { if (on) e[k] = true; else delete e[k]; e.html = stripInline(e.html, k); }, { list, render: true });
    opts.commit({ render: 'now' });
  }
  /** Remove inline formatting that a whole-box setting replaces. */
  function stripInline(html, what) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    const unwrap = (sel2) => d.querySelectorAll(sel2).forEach((n) => { n.replaceWith(...n.childNodes); });
    d.querySelectorAll('[style]').forEach((n) => {
      if (what === 'size') n.style.fontSize = '';
      if (what === 'font') n.style.fontFamily = '';
      if (what === 'color') n.style.color = '';
      if (what === 'b') n.style.fontWeight = '';
      if (what === 'i') n.style.fontStyle = '';
      if (what === 'u' || what === 's') n.style.textDecoration = '';
      if (what === 'align' || what === 'lh') { n.style.textAlign = ''; if (what === 'lh') n.style.lineHeight = ''; }
      if (!n.getAttribute('style')) n.removeAttribute('style');
    });
    if (what === 'b') unwrap('b, strong');
    if (what === 'i') unwrap('i, em');
    if (what === 'u') unwrap('u');
    if (what === 's') unwrap('s, strike');
    d.querySelectorAll('span:not([style])').forEach((n) => n.replaceWith(...n.childNodes));
    return cleanHtml(d.innerHTML);
  }
  /** Font size: on selected text (kept relative to the box) or the whole box. */
  function setSize(px) {
    px = Math.max(8, Math.min(600, Math.round(px)));
    if (editing && hasRange()) {
      const e = byId(editing.id);
      restoreRange();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      editing.tx.querySelectorAll('font[size="7"]').forEach((f) => {
        const sp = document.createElement('span');
        sp.style.fontSize = r1(px / e.size) + 'em';
        sp.append(...f.childNodes); f.replaceWith(sp);
        sp.querySelectorAll('[style]').forEach((x) => { x.style.fontSize = ''; });
      });
      onTyping(); renderToolbar();
      return;
    }
    const list = editing ? [byId(editing.id)] : selEls().filter(isText);
    list.forEach((e) => { e.size = px; e.html = stripInline(editing && editing.id === e.id ? editing.tx.innerHTML : e.html, 'size'); });
    if (editing) { editing.tx.style.fontSize = px + 'px'; editing.tx.innerHTML = byId(editing.id).html; opts.commit({ render: false }); draw(); renderToolbar(); return; }
    change(() => {}, { list, render: true }); opts.commit({ render: 'now' });
  }
  function curSize() {
    const e = editing ? byId(editing.id) : selEls().find(isText);
    if (!e) return 0;
    if (editing && savedRange) {
      let n = savedRange.startContainer; if (n.nodeType === 3) n = n.parentElement;
      if (n && editing.tx.contains(n)) return Math.round(parseFloat(getComputedStyle(n).fontSize) || e.size);
    }
    return e.size;
  }
  function stepSize(dir) {
    const s = curSize() || 64;
    const next = dir > 0 ? (SIZES.find((x) => x > s) || s + 20) : ([...SIZES].reverse().find((x) => x < s) || Math.max(8, s - 4));
    setSize(next);
  }
  function setFont(k) {
    if (editing && hasRange()) { exec('fontName', k); return; }
    const list = editing ? [byId(editing.id)] : selEls().filter(isText);
    list.forEach((e) => { e.font = k; e.html = stripInline(editing && editing.id === e.id ? editing.tx.innerHTML : e.html, 'font'); });
    if (editing) { editing.tx.innerHTML = byId(editing.id).html; editing.tx.style.fontFamily = ''; opts.commit({ render: false }); finishEdit(); select(list.map((e) => e.id)); return; }
    change(() => {}, { list }); opts.commit({ render: 'now' });
  }
  function setTextColor(c) {
    if (editing && hasRange()) { exec('foreColor', c || '#ffffff'); return; }
    const list = editing ? [byId(editing.id)] : selEls().filter(isText);
    list.forEach((e) => { e.color = c || '#ffffff'; e.html = stripInline(editing && editing.id === e.id ? editing.tx.innerHTML : e.html, 'color'); });
    if (editing) { const id = editing.id; editing.tx.innerHTML = byId(id).html; opts.commit({ render: false }); finishEdit(); select([id]); return; }
    change(() => {}, { list }); opts.commit({ render: 'now' });
  }
  function setAlign(a) {
    const list = editing ? [byId(editing.id)] : selEls().filter(isText);
    if (editing) { exec({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[a]); return; }
    list.forEach((e) => { e.align = a; e.html = stripInline(e.html, 'align'); });
    change(() => {}, { list }); opts.commit({ render: 'now' });
  }

  // ---------------------------------------------------------------- arrange
  function order(kind) {
    const list = els(), ids = new Set(sel);
    const picked = list.filter((e) => ids.has(e.id));
    if (!picked.length) return;
    const rest = list.filter((e) => !ids.has(e.id));
    let out;
    if (kind === 'front') out = rest.concat(picked);
    else if (kind === 'back') out = picked.concat(rest);
    else {
      out = list.slice();
      const step = kind === 'forward' ? 1 : -1;
      const idx = picked.map((e) => out.indexOf(e)).sort((a, b) => (step > 0 ? b - a : a - b));
      idx.forEach((i) => { const j = i + step; if (j >= 0 && j < out.length && !ids.has(out[j].id)) { const t = out[j]; out[j] = out[i]; out[i] = t; } });
    }
    list.length = 0; out.forEach((e) => list.push(e));
    opts.commit({ render: 'now' }).then(() => draw());
  }
  /** Align selected items to each other (several) or to the slide (one). */
  function alignObjs(kind) {
    const g = geo();
    const list = selEls().filter((e) => !e.lock);
    if (!list.length) return;
    const boxes = list.map((e) => aabb(boxOf(e, g)));
    const ref = list.length > 1 ? unionBox(boxes) : { x: 0, y: 0, w: g.W, h: g.H };
    list.forEach((e, i) => {
      const b = boxes[i];
      let dx = 0, dy = 0;
      if (kind === 'left') dx = ref.x - b.x; if (kind === 'center') dx = ref.x + ref.w / 2 - (b.x + b.w / 2); if (kind === 'right') dx = ref.x + ref.w - (b.x + b.w);
      if (kind === 'top') dy = ref.y - b.y; if (kind === 'middle') dy = ref.y + ref.h / 2 - (b.y + b.h / 2); if (kind === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
      shift(e, dx / g.W * 100, dy / g.H * 100);
    });
    change(() => {}, { list, panel: true });
  }
  function distribute(axis) {
    const g = geo();
    const list = selEls().filter((e) => !e.lock);
    if (list.length < 3) { toast('Select three or more items to space them evenly.', '', 3000); return; }
    const items = list.map((e) => ({ e, b: aabb(boxOf(e, g)) })).sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = items[0].b, last = items[items.length - 1].b;
    const total = items.reduce((s, it) => s + (axis === 'h' ? it.b.w : it.b.h), 0);
    const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - total) / (items.length - 1);
    let pos = axis === 'h' ? first.x : first.y;
    items.forEach((it) => {
      const d = pos - (axis === 'h' ? it.b.x : it.b.y);
      shift(it.e, axis === 'h' ? d / g.W * 100 : 0, axis === 'v' ? d / g.H * 100 : 0);
      pos += (axis === 'h' ? it.b.w : it.b.h) + gap;
    });
    change(() => {}, { list, panel: true });
  }
  function shift(e, dx, dy) {
    if (e.t === 'line') { e.x1 += dx; e.x2 += dx; e.y1 += dy; e.y2 += dy; }
    else { e.x += dx; e.y += dy; }
  }
  function group() {
    const list = selEls();
    if (list.length < 2) { toast('Select two or more items to group them.', '', 2500); return; }
    const gid = 'g' + uid();
    change((e) => { e.g = gid; }, { list, render: false });
  }
  function ungroup() { change((e) => { delete e.g; }, { render: false }); }
  function toggleLock() { const lock = !selEls().every((e) => e.lock); change((e) => { if (lock) e.lock = true; else delete e.lock; }, { render: false, panel: true }); }
  function remove() {
    const parts = sel.filter((id) => id.startsWith('part:'));
    if (parts.length && !convert()) return;
    const ids = new Set(sel.map((id) => (id.startsWith('part:') ? convertedId(id) : id)));
    const list = els();
    const keep = list.filter((e) => !ids.has(e.id) || e.lock);
    if (keep.length === list.length) return;
    list.length = 0; keep.forEach((e) => list.push(e));
    sel = [];
    opts.commit({ render: 'now' }).then(() => select([]));
  }
  function duplicate(off = 2) {
    const list = selEls();
    if (!list.length) return;
    const gmap = {};
    const copies = list.map((e) => {
      const c = JSON.parse(JSON.stringify(e));
      c.id = 'e' + uid(); delete c.lock;
      if (c.g) c.g = gmap[c.g] || (gmap[c.g] = 'g' + uid());
      shift(c, off, off);
      return cleanEl(c);
    });
    copies.forEach((c) => els().push(c));
    opts.commit({ render: 'now' }).then(() => select(copies.map((c) => c.id)));
  }
  function copy(cut) {
    const list = selEls();
    if (!list.length) return false;
    try { localStorage.setItem(CLIP_KEY, JSON.stringify({ at: Date.now(), els: list })); } catch (e) { /* */ }
    if (cut) remove();
    return true;
  }
  function paste() {
    let clip = null;
    try { clip = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); } catch (e) { clip = null; }
    if (!clip || !Array.isArray(clip.els) || !clip.els.length) return false;
    const gmap = {};
    const copies = clip.els.map((e) => {
      const c = cleanEl(Object.assign({}, e, { id: 'e' + uid() }));
      if (!c) return null;
      if (c.g) c.g = gmap[c.g] || (gmap[c.g] = 'g' + uid());
      if (els().some((x) => x.x === c.x && x.y === c.y)) shift(c, 2, 2);
      return c;
    }).filter(Boolean);
    copies.forEach((c) => els().push(c));
    opts.commit({ render: 'now' }).then(() => select(copies.map((c) => c.id)));
    return true;
  }
  function rotateBy(d) { change((e) => { if (e.t !== 'line') e.rot = ((e.rot || 0) + d + 540) % 360 - 180; else rotLine(e, d); }, { panel: true }); }
  function rotLine(e, d) {
    const g = geo();
    const cx = (e.x1 + e.x2) / 2 / 100 * g.W, cy = (e.y1 + e.y2) / 2 / 100 * g.H, a = d * Math.PI / 180;
    const rp = (x, y) => { const px = x / 100 * g.W - cx, py = y / 100 * g.H - cy; return [(cx + px * Math.cos(a) - py * Math.sin(a)) / g.W * 100, (cy + px * Math.sin(a) + py * Math.cos(a)) / g.H * 100]; };
    [e.x1, e.y1] = rp(e.x1, e.y1); [e.x2, e.y2] = rp(e.x2, e.y2);
  }
  function flip(axis) {
    change((e) => {
      if (e.t === 'image') { if (axis === 'h') e.flipH = !e.flipH; else e.flipV = !e.flipV; }
      else if (e.t === 'line') { if (axis === 'h') { const t = e.x1; e.x1 = e.x2; e.x2 = t; } else { const t = e.y1; e.y1 = e.y2; e.y2 = t; } }
      else if (e.t === 'shape') {
        const fl = { h: { arrowR: 'arrowL', arrowL: 'arrowR', rtriangle: 'rtriangle' }, v: { arrowU: 'arrowD', arrowD: 'arrowU', triangle: 'triangle' } }[axis];
        if (fl[e.shape] && fl[e.shape] !== e.shape) e.shape = fl[e.shape];
        else e.rot = ((axis === 'h' ? -e.rot : 180 - e.rot) + 540) % 360 - 180;
      }
    }, { render: true });
    opts.commit({ render: 'now' });
  }

  // ---------------------------------------------------------------- template text → text boxes
  let lastConverted = {};
  const convertedId = (pid) => lastConverted[pid.slice(5)] || pid;
  /** Turn the template's own lines into free text boxes (once per slide). Returns true when done. */
  function convert() {
    if (opts.canConvert && !opts.canConvert()) return false;
    const st = stage();
    if (!st) return false;
    const g = geo();
    const list = [];
    ['kicker', 'title', 'text', 'foot'].forEach((p) => {
      const n = partNode(p);
      let b = partBox(p);
      if (!n || !b) return;
      // Fit the box to the words themselves, so the lines break where they did before.
      try {
        const rg = document.createRange(); rg.selectNodeContents(n);
        const rr = rg.getBoundingClientRect(), sr = stage().getBoundingClientRect();
        if (rr.width > 4 && rr.width < b.w) {
          const pad = Math.min(b.w - rr.width, g.W * 0.02);
          b = { x: rr.left - sr.left - pad / 2, y: b.y, w: rr.width + pad, h: b.h, rot: 0 };
        }
      } catch (er) { /* keep the line's own box */ }
      const cs = getComputedStyle(n);
      const scale = parseFloat(getComputedStyle(n.closest('.f-banner')).getPropertyValue('--bn-size')) || 1;
      const font = /Selah Serif|serif/i.test(cs.fontFamily) && !/Hyperlegible/.test(cs.fontFamily.split(',')[0]) ? 'Selah Serif' : 'Hyperlegible';
      const fs = parseFloat(cs.fontSize) * (p === 'title' || p === 'text' ? scale : 1);
      const text = n.innerText || n.textContent || '';
      const banner = n.closest('.f-banner');
      const shade = banner && banner.classList.contains('has-img') && banner.classList.contains('dark');
      const lhPx = parseFloat(cs.lineHeight);
      const e = cleanEl({ id: 'e' + uid(), t: 'text', x: r1(b.x / g.W * 100), y: r1(b.y / g.H * 100), w: r1(Math.min(100, b.w / g.W * 100)), h: r1(b.h / g.H * 100 + 0.5),
        html: textHtml(text), font, size: Math.round(fs), color: rgbHex(cs.color), align: cs.textAlign === 'start' ? 'left' : cs.textAlign,
        va: 'middle', lh: isFinite(lhPx) && fs ? r1(lhPx / parseFloat(cs.fontSize)) : 1.15, pad: 0, fit: 'grow',
        b: parseInt(cs.fontWeight, 10) >= 600, i: cs.fontStyle === 'italic', ts: shade, op: parseFloat(cs.opacity) || 1 });
      list.push({ part: p, el: e, text });
    });
    if (!list.length) return false;
    lastConverted = {};
    list.forEach((x) => { lastConverted[x.part] = x.el.id; });
    // The new boxes go below any free items already on the slide (the template text was underneath).
    const cur = els();
    const rest = cur.splice(0, cur.length);
    list.forEach((x) => cur.push(x.el)); rest.forEach((e) => cur.push(e));
    opts.convertParts(list);
    toast('The banner’s text is now in text boxes: move, resize and format them freely. Ctrl+Z undoes this.', 'ok', 5000);
    return true;
  }
  function rgbHex(c) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
    if (!m) return okColor(c) || '#ffffff';
    return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('');
  }
  /** Make template text editable and carry on with the same gesture on its new text box. */
  async function partToEl(pid) {
    if (!convert()) { toast('This kind of banner keeps its own layout (the countdown clock). Edit it in the panel.', '', 4000); return null; }
    await opts.commit({ render: 'now', typing: true, force: true });
    return convertedId(pid);
  }

  // ---------------------------------------------------------------- pointer: select, move, resize, rotate, draw
  ov.addEventListener('pointerdown', async (ev) => {
    if (ev.button !== 0 && ev.button !== 2) return;
    if (editing) return;
    closeMenu();
    ov.focus({ preventScroll: true });
    const p = local(ev);
    const handle = ev.target.closest && (ev.target.closest('[data-h]') || ev.target.closest('[data-p]'));
    if (ev.button === 2) {
      const id = hit(p.x, p.y);
      if (id && !sel.includes(id)) select([id]);
      if (!id) select([]);
      return; // the context menu opens on 'contextmenu'
    }
    if (tool) { startDraw(ev, p); return; }
    if (handle && handle.dataset.p) { startLineEnd(ev, handle.dataset.p); return; }
    if (handle && handle.dataset.h) {
      if (sel.some((id) => id.startsWith('part:'))) { const nid = await partToEl(sel.find((id) => id.startsWith('part:'))); if (!nid) return; select([nid]); }
      if (handle.dataset.h === 'rot') startRotate(ev); else startResize(ev, handle.dataset.h);
      return;
    }
    const id = hit(p.x, p.y);
    if (!id) { startMarquee(ev, p); return; }
    const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    if (additive) { const set = new Set(sel); const grp = withGroups([id]); if (set.has(id)) grp.forEach((x) => set.delete(x)); else grp.forEach((x) => set.add(x)); select([...set]); return; }
    if (!sel.includes(id)) select([id]);
    startMove(ev, p);
  });
  ov.addEventListener('dblclick', async (ev) => {
    const p = local(ev);
    let id = hit(p.x, p.y);
    if (!id) return;
    if (id.startsWith('part:')) { id = await partToEl(id); if (!id) return; select([id]); await new Promise((r) => setTimeout(r, 40)); }
    const e = byId(id);
    if (e && e.g && sel.length > 1) select([id]);
    if (isText(e)) beginEdit(id, ev);
    else if (e && e.t === 'image') pickImage(true);
  });
  ov.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    contextMenu(ev.clientX, ev.clientY);
  });
  ov.addEventListener('pointermove', (ev) => {
    if (drag || editing) return;
    const p = local(ev);
    const id = tool ? null : hit(p.x, p.y);
    ov.style.cursor = tool ? 'crosshair' : id ? (byId(id) && byId(id).lock ? 'default' : 'move') : 'default';
  });

  function track(ev, onMove, onUp) {
    const target = ev.target;
    try { ov.setPointerCapture(ev.pointerId); } catch (e) { /* */ }
    const mv = (e) => onMove(e);
    const up = (e) => { ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up); drag = null; guides.textContent = ''; onUp(e); };
    ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    return target;
  }

  /** Snap lines: slide edges and centre, and the other items' edges and centres. */
  function snapTargets(exclude) {
    const g = geo();
    const xs = [0, g.W / 2, g.W], ys = [0, g.H / 2, g.H];
    els().forEach((e) => { if (exclude.has(e.id)) return; const b = aabb(boxOf(e, g)); xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); });
    PARTS.forEach((pp) => { if (exclude.has('part:' + pp)) return; const b = partBox(pp); if (b) { xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); } });
    return { xs, ys };
  }
  function snap1(vals, targets, tol) {
    let best = null;
    vals.forEach((v) => targets.forEach((t) => { const d = t - v; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t }; }));
    return best;
  }
  function showGuides(gx, gy) {
    guides.textContent = '';
    if (gx) guides.appendChild(h('div.se-gl.v', { style: { left: gx.at + 'px' } }));
    if (gy) guides.appendChild(h('div.se-gl.hz', { style: { top: gy.at + 'px' } }));
  }

  async function startMove(ev, p0) {
    let ids = sel.slice();
    if (ids.some((id) => byId(id) && byId(id).lock) && ids.length === 1) return;
    const g = geo();
    let started = false;
    let orig = null, tg = null, bb0 = null;
    const prepare = async () => {
      if (ids.some((id) => id.startsWith('part:'))) {
        const nid = await partToEl(ids.find((id) => id.startsWith('part:')));
        if (!nid) return false;
        ids = [nid]; sel = [nid];
      }
      const list = ids.map(byId).filter((e) => e && !e.lock);
      orig = list.map((e) => ({ e, s: JSON.parse(JSON.stringify(e)) }));
      tg = snapTargets(new Set(ids));
      bb0 = unionBox(list.map((e) => aabb(boxOf(e, g))));
      return true;
    };
    drag = { kind: 'move' };
    let pending = null;
    track(ev, async (e) => {
      const p = local(e);
      let dx = p.x - p0.x, dy = p.y - p0.y;
      if (!started) {
        if (Math.hypot(dx, dy) < 3) return;
        started = true;
        pending = prepare();
      }
      if (!(await pending)) return;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      let gx = null, gy = null;
      if (!e.altKey) {
        const tol = 6;
        gx = snap1([bb0.x + dx, bb0.x + bb0.w / 2 + dx, bb0.x + bb0.w + dx], tg.xs, tol);
        gy = snap1([bb0.y + dy, bb0.y + bb0.h / 2 + dy, bb0.y + bb0.h + dy], tg.ys, tol);
        if (gx) dx += gx.d; if (gy) dy += gy.d;
      }
      showGuides(gx, gy);
      orig.forEach(({ e: el, s }) => {
        Object.assign(el, s);
        shift(el, dx / g.W * 100, dy / g.H * 100);
        el.x = r1(el.x); el.y = r1(el.y);
      });
      redrawNodes(orig.map((o) => o.e));
      draw();
    }, async () => {
      if (!started) return;
      await pending;
      if (orig && orig.length) { opts.commit({ render: 'now' }); renderPanel(); }
    });
  }

  function startResize(ev, hd) {
    const g = geo();
    const multi = sel.length > 1;
    const list = selEls().filter((e) => !e.lock);
    if (!list.length) return;
    const p0 = local(ev);
    const orig = list.map((e) => ({ e, s: JSON.parse(JSON.stringify(e)), b: boxOf(e, g) }));
    const sx = hd.includes('e') ? 1 : hd.includes('w') ? -1 : 0;
    const sy = hd.includes('s') ? 1 : hd.includes('n') ? -1 : 0;
    const tg = snapTargets(new Set(sel));
    drag = { kind: 'resize' };
    track(ev, (e) => {
      const p = local(e);
      const ratioLock = e.shiftKey || keepRatio;
      if (!multi) {
        const { e: el, s, b } = orig[0];
        const a = (b.rot || 0) * Math.PI / 180;
        const dxg = p.x - p0.x, dyg = p.y - p0.y;
        let lx = dxg * Math.cos(-a) - dyg * Math.sin(-a), ly = dxg * Math.sin(-a) + dyg * Math.cos(-a);
        let w = b.w + sx * lx, hh = b.h + sy * ly;
        if (!b.rot && !e.altKey) {
          // Snap the moving edges.
          if (sx) { const edge = sx > 0 ? b.x + w : b.x + b.w - w; const sn = snap1([edge], tg.xs, 6); if (sn) { w += sx * sn.d; showGuides(sn, null); } }
          if (sy) { const edge = sy > 0 ? b.y + hh : b.y + b.h - hh; const sn = snap1([edge], tg.ys, 6); if (sn) { hh += sy * sn.d; showGuides(null, sn); } }
        }
        if (ratioLock && sx && sy) { const k = Math.max(w / b.w, hh / b.h); w = b.w * k; hh = b.h * k; }
        w = Math.max(8, w); hh = Math.max(8, hh);
        const shx = sx * (w - b.w) / 2, shy = sy * (hh - b.h) / 2;
        const cx = b.x + b.w / 2 + shx * Math.cos(a) - shy * Math.sin(a), cy = b.y + b.h / 2 + shx * Math.sin(a) + shy * Math.cos(a);
        Object.assign(el, s);
        el.w = r1(w / g.W * 100); el.h = r1(hh / g.H * 100);
        el.x = r1((cx - w / 2) / g.W * 100); el.y = r1((cy - hh / 2) / g.H * 100);
        redrawNodes([el]);
      } else {
        const bb = unionBox(orig.map((o) => aabb(o.b)));
        const ax = sx > 0 ? bb.x : bb.x + bb.w, ay = sy > 0 ? bb.y : bb.y + bb.h;
        let kx = sx ? Math.max(0.05, (bb.w + sx * (p.x - p0.x)) / bb.w) : 1, ky = sy ? Math.max(0.05, (bb.h + sy * (p.y - p0.y)) / bb.h) : 1;
        if (ratioLock && sx && sy) kx = ky = Math.max(kx, ky);
        orig.forEach(({ e: el, s, b }) => {
          Object.assign(el, s);
          if (el.t === 'line') {
            const tx = (v) => (ax + (v / 100 * g.W - ax) * kx) / g.W * 100, ty = (v) => (ay + (v / 100 * g.H - ay) * ky) / g.H * 100;
            el.x1 = tx(s.x1); el.x2 = tx(s.x2); el.y1 = ty(s.y1); el.y2 = ty(s.y2);
          } else {
            el.x = r1((ax + (b.x - ax) * kx) / g.W * 100); el.y = r1((ay + (b.y - ay) * ky) / g.H * 100);
            el.w = r1(b.w * kx / g.W * 100); el.h = r1(b.h * ky / g.H * 100);
          }
        });
        redrawNodes(orig.map((o) => o.e));
      }
      draw();
    }, () => { opts.commit({ render: 'now' }); renderPanel(); });
  }

  function startRotate(ev) {
    const g = geo();
    const e = selEls()[0];
    if (!e || e.lock) return;
    const b = boxOf(e, g);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    drag = { kind: 'rotate' };
    track(ev, (m) => {
      const p = local(m);
      let ang = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
      if (m.shiftKey) ang = Math.round(ang / 15) * 15;
      else { const near = Math.round(ang / 90) * 90; if (Math.abs(ang - near) < 3) ang = near; }
      e.rot = Math.round(((ang + 540) % 360 - 180) * 10) / 10;
      redrawNodes([e]); draw();
      guides.textContent = ''; guides.appendChild(h('div.se-angle', { style: { left: cx + 'px', top: (b.y - 46) + 'px' } }, Math.round(e.rot) + '°'));
    }, () => { opts.commit({ render: 'now' }); renderPanel(); });
  }

  function startLineEnd(ev, which) {
    const g = geo();
    const e = selEls()[0];
    if (!e || e.t !== 'line') return;
    const ox = which === '1' ? e.x2 : e.x1, oy = which === '1' ? e.y2 : e.y1;
    const tg = snapTargets(new Set([e.id]));
    drag = { kind: 'line' };
    track(ev, (m) => {
      const p = local(m);
      let x = p.x, y = p.y;
      if (m.shiftKey) {
        const bx = ox / 100 * g.W, by = oy / 100 * g.H;
        const ang = Math.round(Math.atan2(y - by, x - bx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(x - bx, y - by);
        x = bx + len * Math.cos(ang); y = by + len * Math.sin(ang);
      } else if (!m.altKey) {
        const sx = snap1([x], tg.xs, 6), sy = snap1([y], tg.ys, 6);
        if (sx) x += sx.d; if (sy) y += sy.d; showGuides(sx, sy);
      }
      if (which === '1') { e.x1 = r1(x / g.W * 100); e.y1 = r1(y / g.H * 100); } else { e.x2 = r1(x / g.W * 100); e.y2 = r1(y / g.H * 100); }
      redrawNodes([e]); draw();
    }, () => { opts.commit({ render: 'now' }); renderPanel(); });
  }

  function startMarquee(ev, p0) {
    const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    const before = additive ? sel.slice() : [];
    const rect = h('div.se-marquee');
    let moved = false;
    drag = { kind: 'marquee' };
    track(ev, (m) => {
      const p = local(m);
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 4) return;
      if (!moved) { moved = true; ov.appendChild(rect); }
      const r = { x: Math.min(p.x, p0.x), y: Math.min(p.y, p0.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      Object.assign(rect.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      const g = geo();
      const inside = els().filter((e) => { const b = aabb(boxOf(e, g)); return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y; }).map((e) => e.id);
      sel = withGroups(before.concat(inside));
      draw();
    }, () => {
      rect.remove();
      select(moved ? sel : before);
    });
  }

  /** Draw a new item with the chosen tool: drag to size it, or click for the usual size. */
  function startDraw(ev, p0) {
    const t = tool;
    const g = geo();
    const ghost = h('div.se-marquee.se-drawbox');
    ov.appendChild(ghost);
    drag = { kind: 'draw' };
    track(ev, (m) => {
      const p = local(m);
      if (t.t === 'line') {
        const len = Math.hypot(p.x - p0.x, p.y - p0.y), ang = Math.atan2(p.y - p0.y, p.x - p0.x) * 180 / Math.PI;
        Object.assign(ghost.style, { left: p0.x + 'px', top: p0.y + 'px', width: len + 'px', height: '0', transform: 'rotate(' + ang + 'deg)', transformOrigin: '0 0' });
        return;
      }
      let w = p.x - p0.x, hh = p.y - p0.y;
      if (m.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * s; hh = Math.sign(hh || 1) * s; }
      Object.assign(ghost.style, { left: Math.min(p0.x, p0.x + w) + 'px', top: Math.min(p0.y, p0.y + hh) + 'px', width: Math.abs(w) + 'px', height: Math.abs(hh) + 'px' });
    }, (m) => {
      ghost.remove();
      const p = local(m);
      const big = Math.hypot(p.x - p0.x, p.y - p0.y) > 8;
      setTool(null);
      if (t.t === 'line') {
        const pts = big ? { x1: r1(p0.x / g.W * 100), y1: r1(p0.y / g.H * 100), x2: r1(p.x / g.W * 100), y2: r1(p.y / g.H * 100) }
          : { x1: r1(p0.x / g.W * 100), y1: r1(p0.y / g.H * 100), x2: r1(p0.x / g.W * 100 + 25), y2: r1(p0.y / g.H * 100) };
        newLine(t.a2, pts, t.a1);
        return;
      }
      let box;
      if (big) {
        let w = p.x - p0.x, hh = p.y - p0.y;
        if (m.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * s; hh = Math.sign(hh || 1) * s; }
        box = { x: r1(Math.min(p0.x, p0.x + w) / g.W * 100), y: r1(Math.min(p0.y, p0.y + hh) / g.H * 100), w: r1(Math.abs(w) / g.W * 100), h: r1(Math.abs(hh) / g.H * 100) };
      } else {
        const w = t.t === 'text' ? 40 : 18, hh = t.t === 'text' ? 12 : 18 * ratio();
        box = { x: r1(p0.x / g.W * 100), y: r1(p0.y / g.H * 100), w, h: r1(hh) };
      }
      if (t.t === 'text') newText(box); else newShape(t.shape, box);
    });
  }
  function setTool(t) {
    tool = t;
    ov.classList.toggle('se-drawing', !!t);
    renderToolbar();
    if (t) { if (editing) finishEdit(); toast(t.t === 'line' ? 'Drag on the slide to draw the line.' : 'Drag on the slide to draw it, or click for the usual size.', '', 2500); }
  }

  // ---------------------------------------------------------------- keyboard, paste and drop
  ov.addEventListener('keydown', (ev) => {
    if (editing) return;
    const ctrl = ev.ctrlKey || ev.metaKey, k = ev.key;
    let done = true;
    const g = geo();
    if (ctrl && (k === 'z' || k === 'Z') && !ev.shiftKey) opts.undo();
    else if (ctrl && (k === 'y' || ((k === 'z' || k === 'Z') && ev.shiftKey))) opts.redo();
    else if (ctrl && (k === 'a' || k === 'A')) select(els().map((e) => e.id));
    else if (ctrl && (k === 'c' || k === 'C')) copy(false);
    else if (ctrl && (k === 'x' || k === 'X')) copy(true);
    else if (ctrl && (k === 'v' || k === 'V')) { if (!paste()) done = false; }
    else if (ctrl && (k === 'd' || k === 'D')) duplicate();
    else if (ctrl && (k === 'g' || k === 'G')) { if (ev.shiftKey || ev.altKey) ungroup(); else group(); }
    else if (ctrl && (k === 'b' || k === 'B')) toggleStyle('b');
    else if (ctrl && (k === 'i' || k === 'I')) toggleStyle('i');
    else if (ctrl && (k === 'u' || k === 'U')) toggleStyle('u');
    else if (ctrl && ev.shiftKey && (k === '>' || k === '.')) stepSize(1);
    else if (ctrl && ev.shiftKey && (k === '<' || k === ',')) stepSize(-1);
    else if (ctrl && ev.shiftKey && /^[lerj]$/i.test(k)) setAlign({ l: 'left', e: 'center', r: 'right', j: 'justify' }[k.toLowerCase()]);
    else if (ctrl && k === 'ArrowUp') order(ev.shiftKey ? 'front' : 'forward');
    else if (ctrl && k === 'ArrowDown') order(ev.shiftKey ? 'back' : 'backward');
    else if (k === 'Delete' || k === 'Backspace') remove();
    else if (k === 'Escape') { if (tool) setTool(null); else select([]); }
    else if (k === 'Enter' && sel.length === 1) { if (sel[0].startsWith('part:')) { partToEl(sel[0]).then((id) => { if (id) { select([id]); setTimeout(() => beginEdit(id), 40); } }); } else if (isText(byId(sel[0]))) beginEdit(sel[0]); }
    else if (k === 'Tab') { const list = els(); if (list.length) { const i = list.findIndex((e) => e.id === sel[0]); const n = list[(i + (ev.shiftKey ? -1 : 1) + list.length) % list.length]; select([n.id]); } }
    else if (k.startsWith('Arrow') && sel.length) {
      const step = ev.shiftKey ? 20 : 2;
      const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      const list = selEls().filter((e) => !e.lock);
      list.forEach((e) => { shift(e, dx / SW * 100, dy / g.sh * 100); if (e.t !== 'line') { e.x = r1(e.x); e.y = r1(e.y); } });
      change(() => {}, { list, render: false });
    } else done = false;
    if (done) { ev.preventDefault(); ev.stopPropagation(); }
    else if (k.startsWith('Arrow') || k === ' ' || k === 'Home' || k === 'End') ev.stopPropagation(); // never step the live screen from the canvas
  });
  ov.addEventListener('paste', (ev) => {
    if (editing) return;
    const items = ev.clipboardData ? Array.from(ev.clipboardData.items) : [];
    const img = items.find((i) => i.kind === 'file' && /^image\//.test(i.type));
    if (img) { ev.preventDefault(); newImage(img.getAsFile()); return; }
    const t = ev.clipboardData && ev.clipboardData.getData('text/plain');
    if (t && !paste()) { ev.preventDefault(); const e = newText(); setTimeout(() => { const n = byId(e.id); if (n) { n.html = textHtml(t); opts.commit({ render: 'now' }); } }, 60); }
  });
  screen.addEventListener('dragover', (ev) => { if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files')) { ev.preventDefault(); screen.classList.add('se-drop'); } });
  screen.addEventListener('dragleave', () => screen.classList.remove('se-drop'));
  screen.addEventListener('drop', (ev) => {
    screen.classList.remove('se-drop');
    const f = ev.dataTransfer && Array.from(ev.dataTransfer.files || []).find((x) => /^image\//.test(x.type));
    if (!f) return;
    ev.preventDefault();
    newImage(f, local(ev));
  });

  // ---------------------------------------------------------------- context menu
  function contextMenu(x, y) {
    const anchor = h('div', { style: { position: 'fixed', left: x + 'px', top: y + 'px', width: '1px', height: '1px' } });
    document.body.appendChild(anchor);
    const one = selEls();
    const has = sel.length > 0;
    const parts = sel.some((id) => id.startsWith('part:'));
    const items = has ? [
      { label: 'Cut', icon: 'clear', hint: 'Ctrl+X', disabled: parts, onclick: () => copy(true) },
      { label: 'Copy', icon: 'copy', hint: 'Ctrl+C', disabled: parts, onclick: () => copy(false) },
      { label: 'Paste', icon: 'dup', hint: 'Ctrl+V', onclick: () => paste() },
      { label: 'Duplicate', icon: 'dup', hint: 'Ctrl+D', disabled: parts, onclick: () => duplicate() },
      { label: 'Delete', icon: 'trash', hint: 'Del', onclick: () => remove() },
      '-',
      parts ? { label: 'Edit this text on the slide', icon: 'textbox', onclick: () => { const pid = sel.find((id) => id.startsWith('part:')); partToEl(pid).then((id) => { if (id) { select([id]); setTimeout(() => beginEdit(id), 40); } }); } } : null,
      one.length === 1 && isText(one[0]) ? { label: 'Edit text', icon: 'edit', hint: 'Enter', onclick: () => beginEdit(one[0].id) } : null,
      one.length === 1 && one[0].t === 'image' ? { label: 'Replace picture…', icon: 'image', onclick: () => pickImage(true) } : null,
      { label: 'Bring to front', icon: 'front', hint: 'Ctrl+Shift+↑', disabled: parts, onclick: () => order('front') },
      { label: 'Bring forward', icon: 'up', hint: 'Ctrl+↑', disabled: parts, onclick: () => order('forward') },
      { label: 'Send backward', icon: 'down', hint: 'Ctrl+↓', disabled: parts, onclick: () => order('backward') },
      { label: 'Send to back', icon: 'back', hint: 'Ctrl+Shift+↓', disabled: parts, onclick: () => order('back') },
      '-',
      { label: one.length > 1 ? 'Align left edges' : 'Align left on the slide', icon: 'oleft', disabled: parts, onclick: () => alignObjs('left') },
      { label: one.length > 1 ? 'Align centres' : 'Centre on the slide (across)', icon: 'ocenter', disabled: parts, onclick: () => alignObjs('center') },
      { label: one.length > 1 ? 'Align middles' : 'Centre on the slide (up/down)', icon: 'omid', disabled: parts, onclick: () => alignObjs('middle') },
      one.length > 2 ? { label: 'Space evenly across', icon: 'disth', onclick: () => distribute('h') } : null,
      one.length > 2 ? { label: 'Space evenly up and down', icon: 'distv', onclick: () => distribute('v') } : null,
      '-',
      one.length > 1 && !one.every((e) => e.g && e.g === one[0].g) ? { label: 'Group', icon: 'group', hint: 'Ctrl+G', onclick: () => group() } : null,
      one.some((e) => e.g) ? { label: 'Ungroup', icon: 'group', hint: 'Ctrl+Shift+G', onclick: () => ungroup() } : null,
      { label: one.every((e) => e.lock) && one.length ? 'Unlock' : 'Lock position', icon: one.every((e) => e.lock) && one.length ? 'unlock' : 'lock', disabled: parts, onclick: () => toggleLock() },
    ] : [
      { label: 'Paste', icon: 'dup', hint: 'Ctrl+V', onclick: () => paste() },
      { label: 'Select all', icon: 'grid', hint: 'Ctrl+A', onclick: () => select(els().map((e) => e.id)) },
      '-',
      { label: 'Text box', icon: 'textbox', onclick: () => newText() },
      { label: 'Picture…', icon: 'image', onclick: () => pickImage(false) },
      { label: 'Rectangle', icon: 'shape', onclick: () => newShape('rect') },
      { label: 'Line', icon: 'line', onclick: () => newLine('none') },
    ];
    menu(anchor, items);
    setTimeout(() => anchor.remove(), 0);
  }

  // ---------------------------------------------------------------- toolbar
  const toolbar = h('div.se-toolbar', { role: 'toolbar', 'aria-label': 'Slide editing' });
  // Toolbar buttons keep the text selection while typing.
  toolbar.addEventListener('mousedown', (ev) => { if (ev.target.closest('button') && !ev.target.closest('select,input')) ev.preventDefault(); });
  const tb = (ic, title, onclick, o = {}) => {
    const b = h('button.se-tb' + (o.cls ? '.' + o.cls : ''), { type: 'button', title, 'aria-label': title, 'aria-pressed': o.on != null ? String(!!o.on) : null, disabled: !!o.disabled, onclick: (ev) => onclick(ev.currentTarget) },
      ic ? icon(ic) : null, o.text ? h('span', o.text) : null, o.drop ? h('span.se-caret', '▾') : null);
    if (o.style) Object.assign(b.style, o.style);
    return b;
  };
  const sep = () => h('span.se-sep');
  function textState() {
    // What the toolbar shows for the text: the caret's formatting while typing, else the box's.
    const e = editing ? byId(editing.id) : selEls().find(isText);
    if (!e) return null;
    const st = { font: e.font, size: e.size, b: !!e.b, i: !!e.i, u: !!e.u, s: !!e.s, align: e.align, color: e.color };
    if (editing) {
      try { st.b = document.queryCommandState('bold'); st.i = document.queryCommandState('italic'); st.u = document.queryCommandState('underline'); st.s = document.queryCommandState('strikeThrough'); } catch (er) { /* */ }
      st.size = curSize();
    }
    return st;
  }
  let tbMax = 0;
  function renderToolbar() {
    renderToolbarNow();
    // Grow only: the slide must not jump up and down while you click between items.
    const hh = toolbar.offsetHeight;
    if (hh > tbMax) { tbMax = hh; toolbar.style.minHeight = hh + 'px'; }
  }
  function renderToolbarNow() {
    // A focused field in the toolbar would fire its change handler while being removed.
    if (toolbar.contains(document.activeElement)) document.activeElement.blur();
    clear(toolbar);
    const list = selEls(), one = list[0];
    const parts = sel.some((id) => id.startsWith('part:'));
    toolbar.append(
      tb('undo', 'Undo (Ctrl+Z)', () => opts.undo(), { disabled: !opts.canUndo() }),
      tb('redo', 'Redo (Ctrl+Y)', () => opts.redo(), { disabled: !opts.canRedo() }),
      sep(),
      tb('pointer', 'Select (Esc)', () => setTool(null), { on: !tool }),
      tb('textbox', 'Text box: drag on the slide', () => setTool({ t: 'text' }), { on: tool && tool.t === 'text' }),
      tb('image', 'Insert picture', (b) => galleryImage(b)),
      tb('shape', 'Shape', (b) => shapeMenu(b), { drop: true, on: tool && tool.t === 'shape' }),
      tb('line', 'Line or arrow', (b) => menu(b, [
        { label: 'Line', icon: 'line', onclick: () => setTool({ t: 'line', a2: 'none' }) },
        { label: 'Arrow', icon: 'arrow', onclick: () => setTool({ t: 'line', a2: 'arrow' }) },
        { label: 'Double arrow', icon: 'arrow', onclick: () => setTool({ t: 'line', a2: 'arrow', a1: 'arrow' }) },
      ]), { drop: true, on: tool && tool.t === 'line' }),
      opts.tokens && opts.tokens.length ? tb('field', 'Insert a field that fills itself in (date, sunset, church name)', (b) => menu(b, opts.tokens.map(([tok, label]) => ({ label, hint: tok, onclick: () => insertToken(tok) }))), { drop: true }) : null);
    if (!list.length && !parts) {
      toolbar.append(sep(), h('span.se-hint.hide-sm', 'Click an item to edit it · double-click text to type · right-click for more'));
      return;
    }
    toolbar.append(sep());
    const ts = textState();
    if (list.some((e) => e.t !== 'line' && e.t !== 'image' && e.t !== 'text') || list.some((e) => e.t === 'text')) {
      const fe = list.find((e) => e.t !== 'line' && e.t !== 'image');
      if (fe) {
        toolbar.append(colorBtn('fill', 'Fill colour', fe.fill, (c) => change((e) => { if (e.t !== 'line' && e.t !== 'image') { e.fill = c; if (!c) delete e.grad; } }), { noneLabel: 'Transparent' }));
      }
    }
    const be = list.find((e) => e.t !== 'line');
    if (be) {
      toolbar.append(
        colorBtn('pen', 'Border colour', be.bc, (c) => change((e) => { if (e.t === 'line') return; e.bc = c; if (c && !e.bw) e.bw = 4; })),
        tb('weight', 'Border weight', (b) => menu(b, [0, 1, 2, 4, 6, 8, 12, 16, 24].map((w) => ({ label: w ? w + ' px' : 'None', icon: be.bw === w ? 'check' : '', onclick: () => change((e) => { if (e.t === 'line') return; e.bw = w; if (w && !e.bc) e.bc = '#ffffff'; }) }))), { drop: true }),
        tb('dash', 'Border dash', (b) => menu(b, [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']].map(([k, l]) => ({ label: l, icon: be.bs === k ? 'check' : '', onclick: () => change((e) => { e.bs = k; }) }))), { drop: true }));
    }
    const le = list.find((e) => e.t === 'line');
    if (le) {
      toolbar.append(
        colorBtn('pen', 'Line colour', le.lc, (c) => change((e) => { if (e.t === 'line') e.lc = c || '#ffffff'; }), { none: false }),
        tb('weight', 'Line weight', (b) => menu(b, [2, 4, 6, 8, 12, 16, 24, 32].map((w) => ({ label: w + ' px', icon: le.lw === w ? 'check' : '', onclick: () => change((e) => { if (e.t === 'line') e.lw = w; }) }))), { drop: true }),
        tb('dash', 'Line dash', (b) => menu(b, [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']].map(([k, l]) => ({ label: l, icon: le.ld === k ? 'check' : '', onclick: () => change((e) => { if (e.t === 'line') e.ld = k; }) }))), { drop: true }),
        tb('arrow', 'Line ends', (b) => menu(b, [
          ['none', 'none', 'Plain line'], ['none', 'arrow', 'Arrow at the end'], ['arrow', 'none', 'Arrow at the start'], ['arrow', 'arrow', 'Arrows at both ends'],
          ['dot', 'dot', 'Dots at both ends'], ['none', 'dot', 'Dot at the end'], ['bar', 'bar', 'Bars at both ends']].map(([a1, a2, l]) => ({ label: l, icon: le.a1 === a1 && le.a2 === a2 ? 'check' : '', onclick: () => change((e) => { if (e.t === 'line') { e.a1 = a1; e.a2 = a2; } }) }))), { drop: true }));
    }
    if (ts || parts) {
      const t = ts || { font: 'Hyperlegible', size: 64 };
      const fontSel = h('select.se-font', { 'aria-label': 'Font', title: 'Font', disabled: parts, onchange: () => setFont(fontSel.value) },
        FONTS.map(([k, css, label]) => h('option', { value: k, selected: k === t.font, style: { fontFamily: css } }, label || k)));
      const sizeIn = h('input.se-size', { type: 'number', min: 8, max: 600, value: t.size || 64, 'aria-label': 'Font size', title: 'Font size (px on a 1920-wide screen)', disabled: parts,
        onkeydown: (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); sizeIn.dataset.v = sizeIn.value; setSize(+sizeIn.value); } },
        onchange: () => { if (sizeIn.dataset.v !== sizeIn.value) { sizeIn.dataset.v = sizeIn.value; setSize(+sizeIn.value); } } });
      toolbar.append(sep(), fontSel,
        tb('minus', 'Smaller text (Ctrl+Shift+<)', () => stepSize(-1), { disabled: parts }), sizeIn, tb('plus', 'Bigger text (Ctrl+Shift+>)', () => stepSize(1), { disabled: parts }),
        tb(null, 'Bold (Ctrl+B)', () => toggleStyle('b'), { text: 'B', cls: 'se-b', on: t.b, disabled: parts }),
        tb(null, 'Italic (Ctrl+I)', () => toggleStyle('i'), { text: 'I', cls: 'se-i', on: t.i, disabled: parts }),
        tb(null, 'Underline (Ctrl+U)', () => toggleStyle('u'), { text: 'U', cls: 'se-u', on: t.u, disabled: parts }),
        tb(null, 'Strikethrough', () => toggleStyle('s'), { text: 'S', cls: 'se-s', on: t.s, disabled: parts }),
        colorBtn(null, 'Text colour', t.color, (c) => setTextColor(c), { none: false, text: 'A', disabled: parts }),
        colorBtn('hl', 'Highlight colour', '', (c) => exec('hiliteColor', c || 'transparent'), { noneLabel: 'None', disabled: parts }),
        sep(),
        tb({ left: 'aleft', center: 'acenter', right: 'aright', justify: 'ajust' }[t.align] || 'aleft', 'Align text', (b) => menu(b, [
          ['left', 'aleft', 'Left', 'Ctrl+Shift+L'], ['center', 'acenter', 'Centre', 'Ctrl+Shift+E'], ['right', 'aright', 'Right', 'Ctrl+Shift+R'], ['justify', 'ajust', 'Justified', 'Ctrl+Shift+J']]
          .map(([k, ic, l, hint]) => ({ label: l, icon: ic, hint, onclick: () => setAlign(k) }))), { drop: true, disabled: parts }),
        tb('vmid', 'Vertical align', (b) => menu(b, [['top', 'vtop', 'Top'], ['middle', 'vmid', 'Middle'], ['bottom', 'vbot', 'Bottom']]
          .map(([k, ic, l]) => ({ label: l, icon: ic, onclick: () => change((e) => { if (isText(e)) e.va = k; }, { render: true }) }))), { drop: true, disabled: parts }),
        tb('lh', 'Line spacing', (b) => menu(b, [[1, 'Single'], [1.15, '1.15'], [1.3, '1.3'], [1.5, '1.5'], [2, 'Double']]
          .map(([v, l]) => ({ label: l, onclick: () => change((e) => { if (isText(e)) { e.lh = v; e.html = stripInline(e.html, 'lh'); } }, { render: true }) }))), { drop: true, disabled: parts }),
        tb('ul', 'Bulleted list (Ctrl+Shift+8)', () => exec('insertUnorderedList'), { disabled: parts }),
        tb('ol', 'Numbered list (Ctrl+Shift+7)', () => exec('insertOrderedList'), { disabled: parts }),
        tb('outdent', 'Decrease indent', () => exec('outdent'), { disabled: parts }),
        tb('indent', 'Increase indent', () => exec('indent'), { disabled: parts }),
        tb('clearf', 'Clear formatting (Ctrl+\\)', () => clearFormat(), { disabled: parts }));
    }
    if (one && one.t === 'image') {
      toolbar.append(sep(),
        tb('image', 'Replace picture', () => pickImage(true), { text: 'Replace' }),
        tb('shape', 'Mask the picture with a shape', (b) => menu(b, [{ label: 'No mask', onclick: () => change((e) => { e.mask = ''; }) }].concat(
          Object.keys(SHAPES).filter((k) => k === 'ellipse' || SHAPES[k].poly).map((k) => ({ label: SHAPES[k].name, onclick: () => change((e) => { if (e.t === 'image') e.mask = k; }, { render: true }) })))), { drop: true, text: 'Mask' }));
    }
    toolbar.append(sep(),
      tb('front', 'Arrange', (b) => arrangeMenu(b), { drop: true, text: 'Arrange', disabled: parts }),
      tb('dup', 'Duplicate (Ctrl+D)', () => duplicate(), { disabled: parts }),
      tb('trash', 'Delete (Del)', () => remove()));
  }
  function colorBtn(ic, title, value, onPick, o = {}) {
    const b = h('button.se-tb.se-colbtn', { type: 'button', title, 'aria-label': title, disabled: !!o.disabled, onclick: () => colorPop(b, value, onPick, o) },
      ic ? icon(ic) : h('span.se-a', o.text || 'A'), h('span.se-bar', { style: { background: value || 'transparent' } }));
    return b;
  }
  function shapeMenu(anchor) {
    document.querySelectorAll('.se-pop').forEach((p) => p.remove());
    const pop = h('div.se-pop.se-shapes', { role: 'dialog', 'aria-label': 'Shapes' });
    Object.keys(SHAPES).forEach((k) => {
      const prev = h('span.se-shp');
      const tmp = { t: 'shape', shape: k, fill: 'currentColor', w: 10, h: 10 };
      const s = SHAPES[k];
      if (s.css) prev.style.cssText = 'background:currentColor;border-radius:' + (k === 'ellipse' ? '50%' : k === 'round' ? '5px' : '1px');
      else prev.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><' + (s.poly ? 'polygon points="' + s.poly + '"' : 'path d="' + s.path + '"') + (s.evenodd ? ' fill-rule="evenodd"' : '') + ' fill="currentColor"/></svg>';
      void tmp;
      pop.appendChild(h('button.se-shpb', { type: 'button', title: s.name, 'aria-label': s.name, onclick: () => { pop.remove(); document.removeEventListener('pointerdown', out, true); setTool({ t: 'shape', shape: k }); } }, prev));
    });
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = (r.bottom + 4) + 'px';
    const out = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', out, true); } };
    setTimeout(() => document.addEventListener('pointerdown', out, true), 0);
  }
  function arrangeMenu(anchor) {
    const many = selEls().length > 1;
    menu(anchor, [
      { label: 'Bring to front', icon: 'front', hint: 'Ctrl+Shift+↑', onclick: () => order('front') },
      { label: 'Bring forward', icon: 'up', hint: 'Ctrl+↑', onclick: () => order('forward') },
      { label: 'Send backward', icon: 'down', hint: 'Ctrl+↓', onclick: () => order('backward') },
      { label: 'Send to back', icon: 'back', hint: 'Ctrl+Shift+↓', onclick: () => order('back') },
      '-',
      { label: many ? 'Align left' : 'Left of the slide', icon: 'oleft', onclick: () => alignObjs('left') },
      { label: many ? 'Align centre' : 'Centre across the slide', icon: 'ocenter', onclick: () => alignObjs('center') },
      { label: many ? 'Align right' : 'Right of the slide', icon: 'oright', onclick: () => alignObjs('right') },
      { label: many ? 'Align top' : 'Top of the slide', icon: 'otop', onclick: () => alignObjs('top') },
      { label: many ? 'Align middle' : 'Middle of the slide (up/down)', icon: 'omid', onclick: () => alignObjs('middle') },
      { label: many ? 'Align bottom' : 'Bottom of the slide', icon: 'obot', onclick: () => alignObjs('bottom') },
      { label: 'Space evenly across', icon: 'disth', disabled: selEls().length < 3, onclick: () => distribute('h') },
      { label: 'Space evenly up and down', icon: 'distv', disabled: selEls().length < 3, onclick: () => distribute('v') },
      '-',
      { label: 'Rotate 90° clockwise', icon: 'rot', onclick: () => rotateBy(90) },
      { label: 'Rotate 90° anticlockwise', icon: 'rot', onclick: () => rotateBy(-90) },
      { label: 'Flip horizontally', icon: 'fliph', onclick: () => flip('h') },
      { label: 'Flip vertically', icon: 'flipv', onclick: () => flip('v') },
      '-',
      { label: 'Group', icon: 'group', hint: 'Ctrl+G', disabled: !many, onclick: () => group() },
      { label: 'Ungroup', icon: 'group', hint: 'Ctrl+Shift+G', disabled: !selEls().some((e) => e.g), onclick: () => ungroup() },
      { label: selEls().every((e) => e.lock) ? 'Unlock' : 'Lock position', icon: 'lock', onclick: () => toggleLock() },
    ]);
  }
  function insertToken(tok) {
    if (editing) { restoreRange(); document.execCommand('insertText', false, tok); onTyping(); return; }
    const one = selEls().find(isText);
    if (one) { one.html = (one.html || '') + '<div>' + tok + '</div>'; opts.commit({ render: 'now' }); return; }
    const e = newText({ x: 30, y: 80, w: 40, h: 10 });
    setTimeout(() => { const n = byId(e.id); if (n) { n.html = '<div>' + tok + '</div>'; n.align = 'center'; finishEdit(); opts.commit({ render: 'now' }).then(() => select([n.id])); } }, 80);
  }
  function clearFormat() {
    if (editing) { exec('removeFormat'); return; }
    change((e) => { if (!isText(e)) return; e.html = cleanHtml(textHtml(htmlText(e.html))); delete e.b; delete e.i; delete e.u; delete e.s; }, { render: true });
    opts.commit({ render: 'now' });
  }

  // ---------------------------------------------------------------- format panel (the side panel)
  const panel = h('div.se-panel');
  function renderPanel() {
    if (panel.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON' && drag == null && !panel._force) return;
    clear(panel);
    const list = selEls();
    const parts = sel.filter((id) => id.startsWith('part:'));
    if (parts.length && !list.length) {
      panel.append(h('div.card.se-card',
        h('h4', 'Template text'),
        h('p.note', 'This line comes from the banner’s fields (the Slide panel). To move, resize or format it freely, turn the slide’s text into text boxes.'),
        h('button.btn.sm.primary', { type: 'button', onclick: () => { const pid = parts[0]; partToEl(pid).then((id) => { if (id) select([id]); }); } }, icon('textbox'), h('span', 'Edit text on the slide'))));
      return;
    }
    if (!list.length) return;
    const one = list.length === 1 ? list[0] : null;
    const g = geo();
    const sh = g.sh;
    const title = one ? ({ text: 'Text box', shape: (SHAPES[one.shape] || {}).name || 'Shape', image: 'Picture', line: 'Line' }[one.t]) : list.length + ' items';
    panel.appendChild(h('div.row.se-ph', h('b.grow', title), one && one.lock ? h('span.note', icon('lock'), ' Locked') : null,
      h('button.btn.sm', { type: 'button', onclick: () => select([]) }, 'Done')));
    const sec = (name, ...kids) => panel.appendChild(h('details.se-sec', { open: true }, h('summary', name), h('div.se-grid', ...kids)));
    const numIn = (label, val, onv, o = {}) => {
      const inp = h('input.field.sm', { type: 'number', value: Math.round(val * (o.k || 1) * 10) / 10, step: o.step || 1, min: o.min, max: o.max, 'aria-label': label,
        onkeydown: (ev) => ev.stopPropagation(), onchange: () => onv(+inp.value / (o.k || 1)) });
      return [h('label', label), h('div.row', inp, o.unit ? h('span.note', o.unit) : null)];
    };
    const rng = (label, val, min, max, step, onv, fmt) => {
      const out = h('span.note.se-val', fmt ? fmt(val) : String(val));
      const r = h('input', { type: 'range', min, max, step, 'aria-label': label, oninput: () => { out.textContent = fmt ? fmt(+r.value) : r.value; onv(+r.value, true); }, onchange: () => onv(+r.value, false) });
      r.value = val;
      return [h('label', label), h('div.row', r, out)];
    };
    const chk = (label, on, onv) => [h('span'), h('label.row.se-chk', h('input', { type: 'checkbox', checked: !!on, onchange: (ev) => onv(ev.target.checked) }), h('span', label))];
    const selIn = (label, val, options, onv) => [h('label', label), h('select.field.sm', { 'aria-label': label, onchange: (ev) => onv(ev.target.value) }, options.map(([k, l]) => h('option', { value: k, selected: String(k) === String(val) }, l)))];
    const live = (fn) => (v, dragging) => { list.forEach((e) => fn(e, v)); list.forEach((e) => Object.assign(e, cleanEl(e))); redrawNodes(list); draw(); if (!dragging) opts.commit({ render: 'now' }); else opts.commit({ render: false, typing: true }); };
    const set = (fn, render = true) => (v) => { change((e) => fn(e, v), { render }); if (render) opts.commit({ render: 'now' }); };

    if (one && one.t !== 'line') {
      sec('Size & position',
        ...numIn('Width', one.w / 100 * SW, set((e, v) => { e.w = r1(v / SW * 100); }), { unit: 'px' }),
        ...numIn('Height', one.h / 100 * sh, set((e, v) => { e.h = r1(v / sh * 100); }), { unit: 'px' }),
        ...numIn('From left', one.x / 100 * SW, set((e, v) => { e.x = r1(v / SW * 100); }), { unit: 'px' }),
        ...numIn('From top', one.y / 100 * sh, set((e, v) => { e.y = r1(v / sh * 100); }), { unit: 'px' }),
        ...numIn('Rotation', one.rot || 0, set((e, v) => { e.rot = ((v + 540) % 360) - 180; }), { unit: '°' }),
        ...chk('Keep proportions when resizing', keepRatio, (v) => { keepRatio = v; }));
    }
    if (one && one.t === 'line') {
      sec('Line',
        ...rng('Weight', one.lw, 1, 60, 1, live((e, v) => { e.lw = v; }), (v) => v + ' px'),
        ...selIn('Dash', one.ld, [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], set((e, v) => { e.ld = v; })),
        ...selIn('Start', one.a1, [['none', 'None'], ['arrow', 'Arrow'], ['dot', 'Dot'], ['bar', 'Bar']], set((e, v) => { e.a1 = v; })),
        ...selIn('End', one.a2, [['none', 'None'], ['arrow', 'Arrow'], ['dot', 'Dot'], ['bar', 'Bar']], set((e, v) => { e.a2 = v; })));
    }
    const filled = list.filter((e) => e.t === 'text' || e.t === 'shape');
    if (filled.length) {
      const f0 = filled[0];
      const kind = !f0.fill ? 'none' : f0.grad ? 'grad' : 'solid';
      const c1 = h('button.btn.sm.se-cb', { type: 'button', onclick: () => colorPop(c1, f0.fill, (c) => { change((e) => { if (isText(e)) { e.fill = c; if (!c) delete e.grad; } }); renderPanelForce(); }) }, h('span.se-sw', { style: { background: f0.fill || 'transparent' } }), 'Colour');
      const c2 = h('button.btn.sm.se-cb', { type: 'button', onclick: () => colorPop(c2, f0.grad && f0.grad.c2, (c) => { change((e) => { if (isText(e)) { if (!e.fill) e.fill = '#1f4068'; e.grad = { c2: c || '#000000', a: (e.grad && e.grad.a) || 135 }; } }); renderPanelForce(); }, { none: false }) },
        h('span.se-sw', { style: { background: (f0.grad && f0.grad.c2) || '#000' } }), 'Second colour');
      sec('Fill',
        ...selIn('Fill', kind, [['none', 'No fill'], ['solid', 'Solid colour'], ['grad', 'Gradient']], (v) => {
          change((e) => { if (!isText(e)) return; if (v === 'none') { e.fill = ''; delete e.grad; } else { if (!e.fill) e.fill = '#4a86e8'; if (v === 'grad') e.grad = e.grad || { c2: '#0b1729', a: 135 }; else delete e.grad; } }); renderPanelForce();
        }),
        ...(kind !== 'none' ? [h('label', 'Colours'), h('div.row.wrap', c1, kind === 'grad' ? c2 : null)] : []),
        ...(kind === 'grad' ? rng('Angle', (f0.grad && f0.grad.a) || 135, 0, 360, 5, live((e, v) => { if (e.grad) e.grad.a = v; }), (v) => v + '°') : []),
        ...rng('Corner rounding', f0.rad || 0, 0, 300, 2, live((e, v) => { e.rad = v; }), (v) => v + ' px'),
        ...rng('Border', f0.bw || 0, 0, 60, 1, live((e, v) => { e.bw = v; if (v && !e.bc) e.bc = '#ffffff'; }), (v) => v + ' px'));
    }
    const texts = list.filter(isText);
    if (texts.length) {
      const t0 = texts[0];
      sec('Text',
        ...selIn('Autofit', t0.fit, [['none', 'Do not autofit'], ['shrink', 'Shrink text on overflow'], ['grow', 'Resize box to fit text']], set((e, v) => { if (isText(e)) e.fit = v; })),
        ...rng('Padding', t0.pad, 0, 160, 2, live((e, v) => { if (isText(e)) { e.pad = v; const n = nodeOf(e.id); if (n) n.querySelector('.fe-box').style.padding = v + 'px'; } }), (v) => v + ' px'),
        ...rng('Line spacing', t0.lh, 0.8, 3, 0.05, live((e, v) => { if (isText(e)) { e.lh = v; const n = nodeOf(e.id); if (n) n.querySelector('.fe-tx').style.lineHeight = v; } }), (v) => v.toFixed(2)),
        ...rng('Letter spacing', t0.ls, -0.1, 0.6, 0.01, live((e, v) => { if (isText(e)) { e.ls = v; const n = nodeOf(e.id); if (n) n.querySelector('.fe-tx').style.letterSpacing = v + 'em'; } }), (v) => v.toFixed(2) + ' em'),
        ...chk('Text shadow (easier to read over pictures)', t0.ts, set((e, v) => { if (isText(e)) { if (v) e.ts = true; else delete e.ts; } })),
        ...rng('Text outline', t0.tsw || 0, 0, 16, 1, live((e, v) => { if (isText(e)) { e.tsw = v; if (v && !e.tsc) e.tsc = '#000000'; } }), (v) => v + ' px'),
        ...(t0.tsw ? [h('label', 'Outline colour'), (() => { const b = h('button.btn.sm.se-cb', { type: 'button', onclick: () => colorPop(b, t0.tsc, (c) => { change((e) => { if (isText(e)) e.tsc = c || '#000000'; }); renderPanelForce(); }, { none: false }) }, h('span.se-sw', { style: { background: t0.tsc || '#000' } }), 'Colour'); return b; })()] : []));
    }
    if (one && one.t === 'image') {
      sec('Picture',
        ...selIn('Fit', one.ifit, [['cover', 'Fill the box (crop)'], ['contain', 'Show the whole picture'], ['fill', 'Stretch']], set((e, v) => { e.ifit = v; })),
        ...rng('Crop zoom', one.zoom, 100, 400, 5, live((e, v) => { e.zoom = v; }), (v) => v + '%'),
        ...rng('Focus across', one.fx, 0, 100, 1, live((e, v) => { e.fx = v; }), (v) => v + '%'),
        ...rng('Focus up/down', one.fy, 0, 100, 1, live((e, v) => { e.fy = v; }), (v) => v + '%'),
        ...selIn('Mask', one.mask || '', [['', 'No mask']].concat(Object.keys(SHAPES).filter((k) => k === 'ellipse' || SHAPES[k].poly).map((k) => [k, SHAPES[k].name])), set((e, v) => { e.mask = v; })),
        ...rng('Corner rounding', one.rad || 0, 0, 400, 2, live((e, v) => { e.rad = v; }), (v) => v + ' px'),
        ...rng('Border', one.bw || 0, 0, 40, 1, live((e, v) => { e.bw = v; if (v && !e.bc) e.bc = '#ffffff'; }), (v) => v + ' px'),
        h('label', ''), h('div.row.wrap', h('button.btn.sm', { type: 'button', onclick: () => pickImage(true) }, icon('image'), h('span', 'Replace')),
          h('button.btn.sm', { type: 'button', onclick: () => flip('h') }, icon('fliph'), h('span', 'Flip')),
          h('button.btn.sm', { type: 'button', onclick: () => flip('v') }, icon('flipv'), h('span', 'Flip up/down'))));
      sec('Adjustments',
        ...rng('Brightness', one.bri, 0, 200, 1, live((e, v) => { e.bri = v; }), (v) => v + '%'),
        ...rng('Contrast', one.con, 0, 200, 1, live((e, v) => { e.con = v; }), (v) => v + '%'),
        ...rng('Saturation', one.sat, 0, 200, 1, live((e, v) => { e.sat = v; }), (v) => v + '%'),
        ...rng('Black & white', one.gray, 0, 100, 1, live((e, v) => { e.gray = v; }), (v) => v + '%'),
        ...rng('Blur', one.blur, 0, 30, 1, live((e, v) => { e.blur = v; }), (v) => v + ' px'),
        h('label', ''), h('button.btn.sm', { type: 'button', onclick: () => { change((e) => { if (e.t === 'image') Object.assign(e, { bri: 100, con: 100, sat: 100, gray: 0, blur: 0 }); }); renderPanelForce(); } }, 'Reset adjustments'));
    }
    sec('Effects',
      ...rng('Transparency', Math.round((1 - list[0].op) * 100), 0, 95, 1, live((e, v) => { e.op = r1(1 - v / 100); }), (v) => v + '%'),
      ...chk('Drop shadow', list[0].sh, set((e, v) => { if (v) e.sh = true; else delete e.sh; })));
    const an = list[0].an || { k: 'none', d: 0, t: 0.8 };
    sec('Animation (when the slide appears)',
      ...selIn('Entrance', an.k, ANIMS, set((e, v) => { if (v === 'none') delete e.an; else e.an = { k: v, d: (e.an && e.an.d) || 0, t: (e.an && e.an.t) || 0.8 }; })),
      ...(an.k !== 'none' ? [
        ...rng('Duration', an.t, 0.2, 4, 0.1, (v, dragging) => { list.forEach((e) => { if (e.an) e.an.t = v; }); if (!dragging) opts.commit({ render: 'now' }); }, (v) => v.toFixed(1) + ' s'),
        ...rng('Delay', an.d, 0, 10, 0.1, (v, dragging) => { list.forEach((e) => { if (e.an) e.an.d = v; }); if (!dragging) opts.commit({ render: 'now' }); }, (v) => v.toFixed(1) + ' s'),
        h('label', ''), h('button.btn.sm', { type: 'button', onclick: () => opts.preview && opts.preview() }, icon('play'), h('span', 'Play'))] : []));
    sec('Arrange',
      h('label', 'Order'), h('div.row.wrap', tb('front', 'Bring to front', () => order('front')), tb('up', 'Bring forward', () => order('forward')), tb('down', 'Send backward', () => order('backward')), tb('back', 'Send to back', () => order('back'))),
      h('label', list.length > 1 ? 'Align' : 'On the slide'), h('div.row.wrap', ...[['left', 'oleft'], ['center', 'ocenter'], ['right', 'oright'], ['top', 'otop'], ['middle', 'omid'], ['bottom', 'obot']].map(([k, ic]) => tb(ic, 'Align ' + k, () => alignObjs(k)))),
      ...(list.length > 2 ? [h('label', 'Space evenly'), h('div.row', tb('disth', 'Space evenly across', () => distribute('h')), tb('distv', 'Space evenly up and down', () => distribute('v')))] : []),
      h('label', 'More'), h('div.row.wrap', tb('rot', 'Rotate 90°', () => rotateBy(90)), tb('fliph', 'Flip horizontally', () => flip('h')), tb('flipv', 'Flip vertically', () => flip('v')),
        list.length > 1 ? tb('group', 'Group (Ctrl+G)', () => group()) : null, list.some((e) => e.g) ? tb('group', 'Ungroup', () => ungroup(), { text: 'Ungroup' }) : null,
        tb(list.every((e) => e.lock) ? 'unlock' : 'lock', list.every((e) => e.lock) ? 'Unlock' : 'Lock position', () => toggleLock())));
  }
  function renderPanelForce() { panel._force = true; try { renderPanel(); } finally { panel._force = false; } }

  // ---------------------------------------------------------------- life cycle
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;
  if (ro) ro.observe(screen);
  renderToolbar();
  return {
    toolbar, panel,
    /** Call after the preview has drawn the slide again. */
    afterRender() {
      if (editing) return;
      sel = sel.filter((id) => (id.startsWith('part:') ? !!partNode(id.slice(5)) : !!byId(id)));
      draw(); renderToolbar();
    },
    isEditing: () => !!editing || !!drag,
    selection: () => sel.slice(),
    select,
    deselect() { if (editing) finishEdit(); const had = sel.length; sel = []; tool = null; draw(); renderToolbar(); renderPanel(); if (had && opts.onSelect) opts.onSelect([]); },
    refreshPanel: renderPanelForce,
    refreshToolbar: renderToolbar,
    insertText: () => newText(), insertShape: (k) => newShape(k), insertLine: (a) => newLine(a), insertImage: () => pickImage(false),
    focus() { ov.focus({ preventScroll: true }); },
  };
}
