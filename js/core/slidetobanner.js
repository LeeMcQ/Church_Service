// Turns an imported PowerPoint slide (the HTML frame that js/lib/pptx.js makes) into free slide
// elements, so a banner made from a slide can be edited with the slide editor: text boxes you can
// retype, shapes, pictures you can move and crop, and the slide's own background colour or picture.
//
// slideToBanner(frame) -> { els, bg:{color,color2,angle,blob}, pics:Blob[] , count }
//   Each picture element carries its Blob as `_blob`; the caller stores it and swaps in an id.
import { FONTS, okColor } from './slideels.js';

const SW = 1920, SH = 1080; // the logical screen every banner is laid out on
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

let probe = null;
/** Any CSS colour as #rrggbb / rgba(...), or '' when it is not a colour. */
function canon(c) {
  c = String(c || '').trim();
  if (!c) return '';
  try {
    probe = probe || document.createElement('canvas').getContext('2d');
    probe.fillStyle = '#010203';
    probe.fillStyle = c;
    const v = probe.fillStyle;
    if (v === '#010203' && !/^#?010203$/i.test(c)) return '';
    return okColor(v);
  } catch (e) { return ''; }
}
const colourIn = (st, prop) => canon(st.getPropertyValue(prop));

function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') d++;
    if (ch === ')') d--;
    if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** The slide background: a colour, or a two-colour gradient ("linear-gradient(a,b)"). */
function bgOf(bg) {
  bg = String(bg || '').trim();
  const m = /^linear-gradient\((.*)\)$/i.exec(bg);
  if (m) {
    const parts = splitTop(m[1]).filter((p) => !/^-?[\d.]+deg$/i.test(p));
    const c1 = canon(parts[0]), c2 = canon(parts[parts.length - 1]);
    if (c1) return { color: c1, color2: c2 && c2 !== c1 ? c2 : '', angle: 180 };
  }
  return { color: canon(bg) || '#ffffff', color2: '', angle: 180 };
}

const FONT_KEYS = new Set(FONTS.map((f) => f[0]));
function fontKey(fam) {
  const f = String(fam || '').split(',')[0].replace(/["']/g, '').trim();
  return FONT_KEYS.has(f) ? f : '';
}

/** The text of one box as simple rich text (sizes relative to the box's own size). */
function richText(sp, k) {
  const paras = Array.from(sp.children).filter((c) => c.tagName === 'P');
  if (!paras.length) return null;
  const rows = paras.map((p) => {
    const spans = Array.from(p.querySelectorAll('span')).map((s) => ({
      text: s.textContent.replace(/ /g, ' '),
      size: num(s.style.fontSize) * k,
      color: canon(s.style.color),
      bold: /^(bold|[6-9]00)$/.test(s.style.fontWeight),
      italic: s.style.fontStyle === 'italic',
      under: /underline/.test(s.style.textDecorationLine || s.style.textDecoration || ''),
      font: fontKey(s.style.fontFamily),
    }));
    const br = p.querySelectorAll('br').length;
    return { p, spans, br, align: p.style.textAlign || 'left', indent: num(p.style.marginLeft) * k, blank: !spans.some((s) => s.text.trim()) };
  });
  while (rows.length && rows[rows.length - 1].blank) rows.pop();
  while (rows.length && rows[0].blank) rows.shift();
  if (!rows.length) return null;
  const first = rows.flatMap((r) => r.spans).find((s) => s.text.trim()) || {};
  const base = clamp(first.size || 40, 8, 600);
  const color = first.color || '';
  const font = first.font || '';
  const d = document.createElement('div');
  rows.forEach((r) => {
    const line = document.createElement('div');
    if (r.align !== 'left') line.style.textAlign = ['center', 'right', 'justify'].includes(r.align) ? r.align : 'left';
    if (r.indent > 2) line.style.marginLeft = Math.round(r.indent) + 'px';
    if (r.blank) { line.innerHTML = '<br>'; d.appendChild(line); return; }
    r.spans.forEach((s) => {
      if (!s.text) return;
      const sp2 = document.createElement('span');
      const rel = s.size ? s.size / base : 1;
      if (Math.abs(rel - 1) > 0.03) sp2.style.fontSize = r1(clamp(rel, 0.2, 6)) + 'em';
      if (s.color && s.color !== color) sp2.style.color = s.color;
      if (s.bold && !first.bold) sp2.style.fontWeight = '700';
      if (!s.bold && first.bold) sp2.style.fontWeight = '400';
      if (s.italic && !first.italic) sp2.style.fontStyle = 'italic';
      if (!s.italic && first.italic) sp2.style.fontStyle = 'normal';
      if (s.under) sp2.style.textDecoration = 'underline';
      if (s.font && s.font !== font) sp2.style.fontFamily = (FONTS.find((f) => f[0] === s.font) || [])[1] || '';
      sp2.textContent = s.text;
      line.appendChild(sp2);
    });
    d.appendChild(line);
  });
  return { html: d.innerHTML, size: Math.round(base), color, font, bold: !!first.bold, italic: !!first.italic, align: rows[0].align };
}

export function slideToBanner(frame) {
  const W = frame.w || 960, H = frame.h || 540;
  const k = Math.min(SW / W, SH / H);
  const offX = (SW - W * k) / 2, offY = (SH - H * k) / 2;
  const doc = new DOMParser().parseFromString('<body>' + String(frame.html || '') + '</body>', 'text/html');
  const assets = frame.assets || [];
  const bg = bgOf(frame.bg);
  const els = [];
  const box = (st) => {
    const l = num(st.left), t = num(st.top), w = num(st.width), h = num(st.height);
    return { x: r1((offX + l * k) / SW * 100), y: r1((offY + t * k) / SH * 100), w: r1(w * k / SW * 100), h: r1(h * k / SH * 100) };
  };
  Array.from(doc.body.children).forEach((sp) => {
    if (!sp.classList.contains('sp')) return;
    const st = sp.style;
    const b = box(st);
    if (!(b.w > 0) || !(b.h > 0)) return;
    const rot = /rotate\((-?[\d.]+)deg\)/.exec(st.transform || '');
    const rotv = rot ? clamp(+rot[1], -360, 360) : 0;
    const img = sp.querySelector('img[data-a]');
    if (img) {
      const blob = assets[+img.getAttribute('data-a')];
      if (blob) els.push(Object.assign({ t: 'image', ifit: 'fill', rot: rotv, _blob: blob }, b));
      return;
    }
    if (sp.querySelector('table')) {
      const lines = Array.from(sp.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.children).map((td) => td.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join('   |   ')).filter(Boolean);
      if (lines.length) els.push(Object.assign({ t: 'text', html: lines.map((l) => '<div>' + l.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</div>').join(''),
        size: clamp(Math.round(28 * k), 14, 80), color: bg.color && /^#(0|1|2|3)/i.test(bg.color) ? '#ffffff' : '#222222', font: 'Hyperlegible', rot: rotv, pad: 12, lh: 1.3 }, b));
      return;
    }
    // Picture used as the box's own fill (or as the whole slide's background).
    const abg = sp.getAttribute('data-abg');
    const fullSlide = num(st.left) <= 1 && num(st.top) <= 1 && num(st.width) >= W - 2 && num(st.height) >= H - 2;
    if (abg != null && assets[+abg]) {
      if (fullSlide && !sp.textContent.trim() && !bg.blob) { bg.blob = assets[+abg]; return; }
      els.push(Object.assign({ t: 'image', ifit: 'cover', rot: rotv, _blob: assets[+abg] }, b));
    }
    const txt = richText(sp, k);
    const fill = colourIn(st, 'background-color');
    const grad = /linear-gradient\((.*)\)/i.exec(st.backgroundImage || '');
    let c1 = fill, c2 = '';
    if (grad) { const parts = splitTop(grad[1]).filter((p) => !/^-?[\d.]+deg$/i.test(p)); c1 = canon(parts[0]); c2 = canon(parts[parts.length - 1]); }
    const bw = Math.round(num(st.borderTopWidth) * k), bc = bw ? colourIn(st, 'border-top-color') : '';
    const radius = st.borderRadius || '';
    const round = /%/.test(radius) ? 'ellipse' : num(radius) > 0 ? 'round' : 'rect';
    const solid = (c1 && c1 !== 'transparent' && !/,\s*0\)$/.test(c1)) || (bw && bc);
    if (!txt && !solid) return;
    const o = Object.assign({ rot: rotv }, b);
    if (txt) {
      const padL = num(st.paddingLeft) * k;
      Object.assign(o, { html: txt.html, size: txt.size, color: txt.color || canon(st.color) || '#ffffff', font: txt.font || fontKey(st.fontFamily) || 'Hyperlegible', align: ['left', 'center', 'right', 'justify'].includes(txt.align) ? txt.align : 'left',
        va: { 'flex-start': 'top', center: 'middle', 'flex-end': 'bottom' }[st.justifyContent] || 'top', pad: Math.round(clamp(padL, 0, 80)), lh: 1.12 });
      if (txt.bold) o.b = true;
      if (txt.italic) o.i = true;
    }
    if (solid) {
      o.t = 'shape'; o.shape = round;
      if (c1 && !/,\s*0\)$/.test(c1)) o.fill = c1;
      if (c2 && c2 !== c1) o.grad = { c2, a: 180 };
      if (bw && bc) { o.bw = clamp(bw, 1, 60); o.bc = bc; }
      if (round === 'round') o.rad = Math.round(num(radius) * k);
    } else o.t = 'text';
    els.push(o);
  });
  return { els: els.slice(0, 200), bg, w: W, h: H, count: els.length };
}
