// Free slide elements on banners, Google Slides style: text boxes, shapes (with text), lines and
// arrows, and pictures. Drawn the same way on the display, the Next/Live monitors, thumbnails and
// in the editor. Positions are percentages of the screen, sizes of text in screen pixels (the screen
// is 1920 wide), so a slide looks the same on any projector.
//
// Element: {id, t:'text'|'shape'|'image'|'line', x, y, w, h (% of the screen), rot (deg), op (0..1),
//   lock, g (group id), an:{k:'fade'|'zoom'|'up'|'down'|'left'|'right', d (s), t (s)},
//   fill, grad:{c2, a}, bc (border colour), bw (px), bs:'solid'|'dashed'|'dotted', rad (px), sh (shadow),
//   shape, html, font, size (px), color, align, va:'top'|'middle'|'bottom', lh, ls (em), pad (px),
//   fit:'none'|'shrink', ts (text shadow), tsc (outline colour), tsw (outline px),
//   src (picture id; the frame carries the Blob as img), ifit:'cover'|'contain'|'fill', fx, fy (focus %),
//   zoom (%), flipH, flipV, bri, con, sat, gray, blur, mask (shape key),
//   x1, y1, x2, y2 (line ends, %), lc, lw, ld:'solid'|'dashed'|'dotted', a1, a2:'none'|'arrow'|'dot'|'bar'}
// Everything is validated here, so a saved banner can never inject its own markup or CSS.
import { esc } from './util.js';

export const FONTS = [
  ['Hyperlegible', '"Hyperlegible", system-ui, sans-serif', 'Atkinson Hyperlegible'],
  ['Selah Serif', '"Selah Serif", Georgia, serif', 'Source Serif'],
  ['Arial', 'Arial, Helvetica, sans-serif'],
  ['Helvetica', 'Helvetica, Arial, sans-serif'],
  ['Calibri', 'Calibri, Carlito, "Segoe UI", sans-serif'],
  ['Segoe UI', '"Segoe UI", Tahoma, sans-serif'],
  ['Verdana', 'Verdana, Geneva, sans-serif'],
  ['Tahoma', 'Tahoma, Verdana, sans-serif'],
  ['Trebuchet MS', '"Trebuchet MS", sans-serif'],
  ['Century Gothic', '"Century Gothic", "URW Gothic", sans-serif'],
  ['Georgia', 'Georgia, serif'],
  ['Times New Roman', '"Times New Roman", Times, serif'],
  ['Cambria', 'Cambria, Caladea, Georgia, serif'],
  ['Garamond', 'Garamond, "EB Garamond", Georgia, serif'],
  ['Palatino', '"Palatino Linotype", Palatino, "Book Antiqua", serif'],
  ['Book Antiqua', '"Book Antiqua", Palatino, serif'],
  ['Courier New', '"Courier New", Courier, monospace'],
  ['Impact', 'Impact, "Arial Black", sans-serif'],
  ['Arial Black', '"Arial Black", Impact, sans-serif'],
  ['Brush Script', '"Brush Script MT", "Segoe Script", cursive'],
  ['Lucida Handwriting', '"Lucida Handwriting", "Segoe Script", cursive'],
  ['Comic Sans MS', '"Comic Sans MS", "Comic Neue", cursive'],
];
const FONT_CSS = Object.fromEntries(FONTS.map(([k, css]) => [k, css]));
export const fontCss = (k) => FONT_CSS[k] || FONT_CSS.Hyperlegible;

function star(n, inner) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : 50, a = Math.PI * i / n - Math.PI / 2;
    pts.push((50 + r * Math.cos(a)).toFixed(1) + ',' + (50 + r * Math.sin(a)).toFixed(1));
  }
  return pts.join(' ');
}
// Shapes: CSS boxes (rect, round, ellipse) or polygons/paths in a 100 × 100 box stretched to the element.
export const SHAPES = {
  rect: { name: 'Rectangle', css: true },
  round: { name: 'Rounded rectangle', css: true },
  ellipse: { name: 'Oval', css: true },
  triangle: { name: 'Triangle', poly: '50,0 100,100 0,100' },
  rtriangle: { name: 'Right triangle', poly: '0,0 100,100 0,100' },
  diamond: { name: 'Diamond', poly: '50,0 100,50 50,100 0,50' },
  parallelogram: { name: 'Parallelogram', poly: '25,0 100,0 75,100 0,100' },
  trapezoid: { name: 'Trapezoid', poly: '20,0 80,0 100,100 0,100' },
  pentagon: { name: 'Pentagon', poly: '50,0 100,38 81,100 19,100 0,38' },
  hexagon: { name: 'Hexagon', poly: '25,0 75,0 100,50 75,100 25,100 0,50' },
  octagon: { name: 'Octagon', poly: '30,0 70,0 100,30 100,70 70,100 30,100 0,70 0,30' },
  star4: { name: '4-point star', poly: star(4, 18) },
  star5: { name: '5-point star', poly: star(5, 20) },
  star6: { name: '6-point star', poly: star(6, 26) },
  plus: { name: 'Cross', poly: '35,0 65,0 65,35 100,35 100,65 65,65 65,100 35,100 35,65 0,65 0,35 35,35' },
  arrowR: { name: 'Right arrow', poly: '0,30 60,30 60,0 100,50 60,100 60,70 0,70' },
  arrowL: { name: 'Left arrow', poly: '100,30 40,30 40,0 0,50 40,100 40,70 100,70' },
  arrowU: { name: 'Up arrow', poly: '30,100 30,40 0,40 50,0 100,40 70,40 70,100' },
  arrowD: { name: 'Down arrow', poly: '30,0 30,60 0,60 50,100 100,60 70,60 70,0' },
  chevron: { name: 'Chevron', poly: '0,0 75,0 100,50 75,100 0,100 25,50' },
  heart: { name: 'Heart', path: 'M50 96C22 74 0 56 0 30C0 12 13 0 28 0C39 0 47 7 50 15C53 7 61 0 72 0C87 0 100 12 100 30C100 56 78 74 50 96Z' },
  speech: { name: 'Speech bubble', path: 'M8 0H92Q100 0 100 8V62Q100 70 92 70H42L20 94L24 70H8Q0 70 0 62V8Q0 0 8 0Z' },
  cloud: { name: 'Cloud', path: 'M25 88C10 88 0 78 0 65C0 53 9 44 20 43C20 25 34 12 50 12C63 12 73 20 77 31C90 32 100 43 100 57C100 74 88 88 72 88Z' },
  ribbon: { name: 'Ribbon', poly: '0,0 100,0 88,50 100,100 0,100 12,50' },
  frame: { name: 'Frame', path: 'M0 0H100V100H0ZM10 10V90H90V10Z', evenodd: true },
  donut: { name: 'Ring', path: 'M50 0A50 50 0 1 0 50.01 0ZM50 22A28 28 0 1 1 49.99 22Z', evenodd: true },
};
// Clip paths for picture masks (polygons only, plus the CSS circle/rounded box).
export function maskCss(key) {
  const s = SHAPES[key];
  if (!s) return '';
  if (key === 'ellipse') return 'ellipse(50% 50% at 50% 50%)';
  if (s.poly) return 'polygon(' + s.poly.split(' ').map((p) => p.split(',').map((v) => v + '%').join(' ')).join(', ') + ')';
  if (s.path) return '';
  return '';
}

// ------------------------------------------------------------------ validation
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|transparent)$/i;
export const okColor = (c) => (typeof c === 'string' && COLOR.test(c.trim()) ? c.trim() : '');
const num = (v, lo, hi, d) => { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const pick = (v, list, d) => (list.includes(v) ? v : d);
const ANIMS = ['none', 'fade', 'zoom', 'up', 'down', 'left', 'right', 'spin'];
const ENDS = ['none', 'arrow', 'dot', 'bar'];
const DASH = ['solid', 'dashed', 'dotted'];

/** A clean copy of one element, or null when it can't be used. */
export function cleanEl(e) {
  if (!e || typeof e !== 'object' || !['text', 'shape', 'image', 'line'].includes(e.t)) return null;
  const o = { id: typeof e.id === 'string' && /^[\w-]{1,40}$/.test(e.id) ? e.id : 'e' + Math.random().toString(36).slice(2, 9), t: e.t };
  o.x = num(e.x, -200, 300, 10); o.y = num(e.y, -200, 300, 10); o.w = num(e.w, 0, 500, 30); o.h = num(e.h, 0, 500, 15);
  o.rot = num(e.rot, -360, 360, 0); o.op = num(e.op, 0, 1, 1);
  if (e.lock) o.lock = true;
  if (typeof e.g === 'string' && /^[\w-]{1,40}$/.test(e.g)) o.g = e.g;
  if (e.an && typeof e.an === 'object' && pick(e.an.k, ANIMS, 'none') !== 'none') o.an = { k: e.an.k, d: num(e.an.d, 0, 30, 0), t: num(e.an.t, 0.1, 10, 0.8) };
  if (e.t === 'line') {
    o.x1 = num(e.x1, -200, 300, 10); o.y1 = num(e.y1, -200, 300, 50); o.x2 = num(e.x2, -200, 300, 90); o.y2 = num(e.y2, -200, 300, 50);
    o.lc = okColor(e.lc) || '#ffffff'; o.lw = num(e.lw, 1, 60, 6); o.ld = pick(e.ld, DASH, 'solid');
    o.a1 = pick(e.a1, ENDS, 'none'); o.a2 = pick(e.a2, ENDS, 'none');
    if (e.sh) o.sh = true;
    return o;
  }
  o.fill = okColor(e.fill);
  if (e.grad && okColor(e.grad.c2)) o.grad = { c2: okColor(e.grad.c2), a: num(e.grad.a, 0, 360, 135) };
  o.bc = okColor(e.bc); o.bw = num(e.bw, 0, 60, 0); o.bs = pick(e.bs, DASH, 'solid'); o.rad = num(e.rad, 0, 2000, 0);
  if (e.sh) o.sh = true;
  if (e.t === 'image') {
    o.src = typeof e.src === 'string' ? e.src.slice(0, 80) : '';
    o.ifit = pick(e.ifit, ['cover', 'contain', 'fill'], 'cover');
    o.fx = num(e.fx, 0, 100, 50); o.fy = num(e.fy, 0, 100, 50); o.zoom = num(e.zoom, 100, 400, 100);
    if (e.flipH) o.flipH = true; if (e.flipV) o.flipV = true;
    o.bri = num(e.bri, 0, 300, 100); o.con = num(e.con, 0, 300, 100); o.sat = num(e.sat, 0, 300, 100); o.gray = num(e.gray, 0, 100, 0); o.blur = num(e.blur, 0, 40, 0);
    o.mask = SHAPES[e.mask] && maskCss(e.mask) ? e.mask : '';
    return o;
  }
  if (e.t === 'shape') o.shape = SHAPES[e.shape] ? e.shape : 'rect';
  o.html = cleanHtml(e.html || '');
  o.font = FONT_CSS[e.font] ? e.font : 'Hyperlegible';
  o.size = num(e.size, 8, 600, 64); o.color = okColor(e.color) || '#ffffff';
  o.align = pick(e.align, ['left', 'center', 'right', 'justify'], 'left'); o.va = pick(e.va, ['top', 'middle', 'bottom'], 'top');
  o.lh = num(e.lh, 0.7, 3, 1.15); o.ls = num(e.ls, -0.2, 1, 0); o.pad = num(e.pad, 0, 200, 16);
  o.fit = pick(e.fit, ['none', 'shrink', 'grow'], 'none');
  if (e.b) o.b = true; if (e.i) o.i = true; if (e.u) o.u = true; if (e.s) o.s = true;
  if (e.ts) o.ts = true;
  o.tsc = okColor(e.tsc); o.tsw = num(e.tsw, 0, 20, 0);
  return o;
}
export const cleanEls = (a) => (Array.isArray(a) ? a.map(cleanEl).filter(Boolean).slice(0, 200) : []);

// Rich text: only simple formatting survives. Font sizes are kept relative (em) to the box's size.
const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SUB', 'SUP', 'FONT']);
const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL']);
function cleanStyle(st, block) {
  const out = [];
  const c = okColor(st.color); if (c) out.push('color:' + c);
  const bg = okColor(st.backgroundColor); if (bg && bg !== 'transparent') out.push('background-color:' + bg);
  const fs = String(st.fontSize || '');
  let m = /^([\d.]+)em$/.exec(fs);
  if (m) out.push('font-size:' + num(m[1], 0.1, 8, 1) + 'em');
  const fam = String(st.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
  const fk = FONTS.find(([k, css]) => k === fam || css.split(',')[0].replace(/"/g, '').trim() === fam);
  if (fk) out.push('font-family:' + fk[1].replace(/"/g, "'"));
  if (/^(bold|[6-9]00)$/.test(st.fontWeight)) out.push('font-weight:700');
  else if (/^(normal|400)$/.test(st.fontWeight)) out.push('font-weight:400');
  if (st.fontStyle === 'italic') out.push('font-style:italic'); else if (st.fontStyle === 'normal') out.push('font-style:normal');
  const td = String(st.textDecorationLine || st.textDecoration || '');
  const dec = ['underline', 'line-through'].filter((x) => td.includes(x));
  if (dec.length) out.push('text-decoration:' + dec.join(' '));
  if (block) {
    if (['left', 'center', 'right', 'justify'].includes(st.textAlign)) out.push('text-align:' + st.textAlign);
    m = /^([\d.]+)(px|em)$/.exec(st.marginLeft || st.paddingLeft || '');
    if (m) out.push('margin-left:' + num(m[1], 0, m[2] === 'px' ? 600 : 20, 0) + m[2]);
    m = /^([\d.]+)$/.exec(st.lineHeight || '');
    if (m) out.push('line-height:' + num(m[1], 0.7, 3, 1.15));
  }
  return out.join(';');
}
const FONT_SIZES = { 1: 0.6, 2: 0.8, 3: 1, 4: 1.15, 5: 1.5, 6: 2, 7: 3 };
export function cleanHtml(html) {
  if (typeof document === 'undefined') return '';
  const t = document.createElement('template');
  t.innerHTML = String(html || '').slice(0, 40000);
  const walk = (node, out) => {
    for (const n of Array.from(node.childNodes)) {
      if (n.nodeType === 3) { out.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      let tag = n.tagName;
      if (!TAGS.has(tag)) { walk(n, out); continue; } // unknown tags keep only their text
      if (tag === 'FONT') tag = 'SPAN';
      if (tag === 'STRIKE') tag = 'S';
      const k = document.createElement(tag);
      const st = cleanStyle(n.style || {}, BLOCK.has(tag));
      let extra = '';
      if (n.tagName === 'FONT') {
        const fc = okColor(n.getAttribute('color') || ''); if (fc) extra += ';color:' + fc;
        const sz = FONT_SIZES[n.getAttribute('size')]; if (sz && !/font-size/.test(st)) extra += ';font-size:' + sz + 'em';
        const face = (n.getAttribute('face') || '').split(',')[0].replace(/["']/g, '').trim();
        const fk = FONTS.find(([key]) => key === face); if (fk) extra += ";font-family:" + fk[1].replace(/"/g, "'");
      }
      const all = (st + extra).replace(/^;/, '');
      if (all) k.setAttribute('style', all);
      out.appendChild(k);
      if (tag !== 'BR') walk(n, k);
    }
  };
  const box = document.createElement('div');
  walk(t.content, box);
  return box.innerHTML;
}
/** Plain text of a rich text box (for names and search). */
export function htmlText(html) {
  if (typeof document === 'undefined') return '';
  const d = document.createElement('div');
  d.innerHTML = cleanHtml(html).replace(/<br>/g, '\n').replace(/<\/(div|p|li)>/g, '\n');
  return d.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
export const textHtml = (s) => esc(String(s || '')).split('\n').map((l) => '<div>' + (l || '<br>') + '</div>').join('');

// ------------------------------------------------------------------ drawing
function fillCss(e) {
  if (!e.fill) return 'transparent';
  if (e.grad) return 'linear-gradient(' + e.grad.a + 'deg, ' + e.fill + ', ' + e.grad.c2 + ')';
  return e.fill;
}
let gradSeq = 0;
function shapeSvg(e) {
  const s = SHAPES[e.shape];
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'fe-svg');
  let fill = e.fill || 'none';
  if (e.fill && e.grad) {
    const id = 'feg' + (++gradSeq);
    const a = (e.grad.a - 90) * Math.PI / 180;
    const x = Math.cos(a) * 50, y = Math.sin(a) * 50;
    svg.innerHTML = '<defs><linearGradient id="' + id + '" x1="' + (50 - x) + '%" y1="' + (50 - y) + '%" x2="' + (50 + x) + '%" y2="' + (50 + y) + '%">' +
      '<stop offset="0" stop-color="' + e.fill + '"/><stop offset="1" stop-color="' + e.grad.c2 + '"/></linearGradient></defs>';
    fill = 'url(#' + id + ')';
  }
  const p = document.createElementNS(ns, s.poly ? 'polygon' : 'path');
  if (s.poly) p.setAttribute('points', s.poly); else p.setAttribute('d', s.path);
  if (s.evenodd) p.setAttribute('fill-rule', 'evenodd');
  p.setAttribute('fill', fill);
  if (e.bw && e.bc) {
    p.setAttribute('stroke', e.bc); p.setAttribute('stroke-width', e.bw); p.setAttribute('vector-effect', 'non-scaling-stroke');
    p.setAttribute('stroke-linejoin', 'round');
    if (e.bs === 'dashed') p.setAttribute('stroke-dasharray', e.bw * 3 + ' ' + e.bw * 2);
    if (e.bs === 'dotted') { p.setAttribute('stroke-dasharray', '0 ' + e.bw * 2); p.setAttribute('stroke-linecap', 'round'); }
  }
  svg.appendChild(p);
  return svg;
}

function textBox(e, root) {
  const tx = document.createElement('div');
  tx.className = 'fe-tx';
  const st = tx.style;
  st.fontFamily = fontCss(e.font); st.fontSize = e.size + 'px'; st.color = e.color;
  st.lineHeight = String(e.lh); st.letterSpacing = e.ls ? e.ls + 'em' : ''; st.textAlign = e.align;
  if (e.b) st.fontWeight = '700';
  if (e.i) st.fontStyle = 'italic';
  const dec = [e.u ? 'underline' : '', e.s ? 'line-through' : ''].filter(Boolean).join(' ');
  if (dec) st.textDecoration = dec;
  if (e.ts) st.textShadow = '0 3px 14px rgba(0,0,0,.6), 0 0 2px rgba(0,0,0,.6)';
  if (e.tsw && e.tsc) { st.webkitTextStroke = e.tsw + 'px ' + e.tsc; st.paintOrder = 'stroke fill'; }
  tx.innerHTML = cleanHtml(e.html);
  root.classList.add('va-' + e.va);
  root.style.padding = e.pad + 'px';
  return tx;
}

/** Draw a line element inside its node, in real screen pixels (W × H is the screen size). */
export function drawLine(node, e, W, H) {
  const ns = 'http://www.w3.org/2000/svg';
  node.textContent = '';
  const x1 = e.x1 / 100 * W, y1 = e.y1 / 100 * H, x2 = e.x2 / 100 * W, y2 = e.y2 / 100 * H;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'fe-line-svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const g = document.createElementNS(ns, 'g');
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const hs = Math.max(14, e.lw * 3.2); // arrow head size
  const inset = (end) => (end === 'arrow' ? hs * 0.8 : 0);
  const ax = x1 + ux * inset(e.a1), ay = y1 + uy * inset(e.a1), bx = x2 - ux * inset(e.a2), by = y2 - uy * inset(e.a2);
  const ln = document.createElementNS(ns, 'line');
  ln.setAttribute('x1', ax); ln.setAttribute('y1', ay); ln.setAttribute('x2', bx); ln.setAttribute('y2', by);
  ln.setAttribute('stroke', e.lc); ln.setAttribute('stroke-width', e.lw); ln.setAttribute('stroke-linecap', e.ld === 'dotted' ? 'round' : 'butt');
  if (e.ld === 'dashed') ln.setAttribute('stroke-dasharray', e.lw * 3 + ' ' + e.lw * 2);
  if (e.ld === 'dotted') ln.setAttribute('stroke-dasharray', '0 ' + e.lw * 2);
  g.appendChild(ln);
  const head = (end, px, py, dx, dy) => {
    if (end === 'arrow') {
      const p = document.createElementNS(ns, 'polygon');
      const bx2 = px - dx * hs, by2 = py - dy * hs, nx = -dy * hs * 0.55, ny = dx * hs * 0.55;
      p.setAttribute('points', px + ',' + py + ' ' + (bx2 + nx) + ',' + (by2 + ny) + ' ' + (bx2 - nx) + ',' + (by2 - ny));
      p.setAttribute('fill', e.lc); g.appendChild(p);
    } else if (end === 'dot') {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', px); c.setAttribute('cy', py); c.setAttribute('r', Math.max(6, e.lw * 1.6)); c.setAttribute('fill', e.lc); g.appendChild(c);
    } else if (end === 'bar') {
      const b = document.createElementNS(ns, 'line'), nx = -dy * hs * 0.6, ny = dx * hs * 0.6;
      b.setAttribute('x1', px + nx); b.setAttribute('y1', py + ny); b.setAttribute('x2', px - nx); b.setAttribute('y2', py - ny);
      b.setAttribute('stroke', e.lc); b.setAttribute('stroke-width', e.lw); g.appendChild(b);
    }
  };
  head(e.a1, x1, y1, -ux, -uy);
  head(e.a2, x2, y2, ux, uy);
  if (e.sh) svg.style.filter = 'drop-shadow(0 6px 10px rgba(0,0,0,.45))';
  svg.appendChild(g);
  node.appendChild(svg);
}

/** Put the box of one element on its node (position, size, rotation, opacity). */
export function placeEl(node, e) {
  const st = node.style;
  if (e.t === 'line') { st.left = '0'; st.top = '0'; st.width = '100%'; st.height = '100%'; st.opacity = String(e.op); return; }
  st.left = e.x + '%'; st.top = e.y + '%'; st.width = e.w + '%';
  if (e.fit === 'grow') { st.height = 'auto'; st.minHeight = e.h + '%'; } else { st.height = e.h + '%'; st.minHeight = ''; }
  st.transform = e.rot ? 'rotate(' + e.rot + 'deg)' : '';
  st.opacity = String(e.op);
}

/** One element's node. urlFor(blob) makes object URLs the caller revokes. */
export function elNode(e, urlFor, opts = {}) {
  const n = document.createElement('div');
  n.className = 'fe fe-' + e.t;
  n.dataset.el = e.id;
  placeEl(n, e);
  if (e.an && !opts.noAnim) {
    n.classList.add('fe-an', 'fe-an-' + e.an.k);
    n.style.animationDuration = e.an.t + 's';
    n.style.animationDelay = e.an.d + 's';
  }
  if (e.t === 'line') { n.dataset.line = '1'; return n; }
  const shadow = e.sh ? 'drop-shadow(0 8px 16px rgba(0,0,0,.45))' : '';
  if (e.t === 'image') {
    const box = document.createElement('div');
    box.className = 'fe-img';
    box.style.borderRadius = e.rad ? e.rad + 'px' : '';
    if (e.bw && e.bc) box.style.border = e.bw + 'px ' + e.bs + ' ' + e.bc;
    const mk = maskCss(e.mask);
    if (mk) box.style.clipPath = mk;
    if (shadow && !mk) box.style.filter = shadow;
    if (e.img) {
      const im = document.createElement('img');
      im.alt = ''; im.draggable = false;
      im.src = urlFor(e.img);
      im.style.objectFit = e.ifit;
      im.style.objectPosition = e.fx + '% ' + e.fy + '%';
      const tf = [];
      if (e.zoom !== 100) tf.push('scale(' + e.zoom / 100 + ')');
      if (e.flipH) tf.push('scaleX(-1)'); if (e.flipV) tf.push('scaleY(-1)');
      im.style.transform = tf.join(' ');
      im.style.transformOrigin = e.fx + '% ' + e.fy + '%';
      const fl = [];
      if (e.bri !== 100) fl.push('brightness(' + e.bri + '%)'); if (e.con !== 100) fl.push('contrast(' + e.con + '%)');
      if (e.sat !== 100) fl.push('saturate(' + e.sat + '%)'); if (e.gray) fl.push('grayscale(' + e.gray + '%)'); if (e.blur) fl.push('blur(' + e.blur + 'px)');
      im.style.filter = fl.join(' ');
      box.appendChild(im);
    } else box.classList.add('empty');
    n.appendChild(box);
    return n;
  }
  // text box or shape (both can hold text)
  const bg = document.createElement('div');
  bg.className = 'fe-bg';
  const sh = e.t === 'shape' ? SHAPES[e.shape] : null;
  if (sh && !sh.css) bg.appendChild(shapeSvg(e));
  else {
    bg.style.background = fillCss(e);
    if (e.bw && e.bc) bg.style.border = e.bw + 'px ' + e.bs + ' ' + e.bc;
    bg.style.borderRadius = e.shape === 'ellipse' ? '50%' : e.rad ? e.rad + 'px' : e.shape === 'round' ? '28px' : '';
  }
  if (shadow) bg.style.filter = shadow;
  n.appendChild(bg);
  const box = document.createElement('div');
  box.className = 'fe-box';
  box.appendChild(textBox(e, box));
  if (e.fit === 'shrink') box.dataset.shrink = '1';
  n.appendChild(box);
  return n;
}

/** Shrink-to-fit text and draw lines once the layer is on the page (sizes are known then). */
export function finishEls(layer) {
  const W = layer.clientWidth, H = layer.clientHeight;
  layer.querySelectorAll('.fe').forEach((n) => {
    const e = n._el;
    if (!e) return;
    if (e.t === 'line') { drawLine(n, e, W || 1920, H || 1080); return; }
    const box = n.querySelector('.fe-box[data-shrink]');
    if (box) shrinkText(box, e);
  });
}
export function shrinkText(box, e) {
  const tx = box.firstElementChild;
  if (!tx) return;
  let s = e.size;
  tx.style.fontSize = s + 'px';
  let guard = 40;
  while (guard-- > 0 && s > 8 && (tx.scrollHeight > box.clientHeight - 2 * e.pad + 1 || tx.scrollWidth > box.clientWidth - 2 * e.pad + 1)) {
    s = Math.max(8, Math.floor(s * 0.92));
    tx.style.fontSize = s + 'px';
  }
}

/** The element layer for a slide. Returns the layer element. */
export function elsLayer(els, urlFor, opts = {}) {
  const layer = document.createElement('div');
  layer.className = 'fe-layer';
  (els || []).forEach((e) => {
    const n = elNode(e, urlFor, opts);
    n._el = e;
    layer.appendChild(n);
  });
  return layer;
}
