// Banner slides, drawn live on the display like Bible verses: text is fitted to the screen (any
// projector shape), over a colour palette or a picture. Only ids and text travel to the display;
// colours and patterns are looked up here, so a banner can never inject its own CSS.
//
// Frame: {kind:'banner', tpl, pal, deco, pos:'center'|'left'|'low', font:'sans'|'serif',
//         kicker, title, text, foot, img?:Blob, dim?:0..0.85, logo?:Blob, qr?:'data:image/gif;base64,…',
//         qrLabel?, mark?:bool, countdown?:{at:epochMs, done:'Welcome'}}
// Any frame may also carry clock:{at, label} for a small "Service starts in 4:32" corner.
import { esc } from './util.js';
import { elsLayer, finishEls, okColor } from './slideels.js';

export const PALETTES = {
  navy: { name: 'Navy', bg: ['#1f4068', '#0b1729'], fg: '#ffffff', accent: '#f2cf7a', dark: true },
  forest: { name: 'Forest', bg: ['#245a40', '#0a1f15'], fg: '#ffffff', accent: '#ecd88f', dark: true },
  plum: { name: 'Plum', bg: ['#432a6e', '#140b26'], fg: '#ffffff', accent: '#f3c77a', dark: true },
  earth: { name: 'Earth', bg: ['#6a4422', '#21140a'], fg: '#ffffff', accent: '#f6cf93', dark: true },
  slate: { name: 'Slate', bg: ['#34424f', '#10161c'], fg: '#ffffff', accent: '#a8dcef', dark: true },
  sunset: { name: 'Sunset', bg: ['#a8461f', '#3a160b'], fg: '#ffffff', accent: '#ffe2a6', dark: true },
  parchment: { name: 'Parchment', bg: ['#f5eddc', '#dccdb0'], fg: '#2b2216', accent: '#7a4a0e', dark: false },
  black: { name: 'Black', bg: ['#000000', '#000000'], fg: '#ffffff', accent: '#f2cf7a', dark: true },
};
export const DECOS = { none: 'None', glow: 'Glow', rays: 'Rays', waves: 'Waves' };

function decoCss(deco, dark) {
  const t = dark ? '255,255,255' : '90,60,20';
  switch (deco) {
    case 'glow': return 'radial-gradient(ellipse 70% 60% at 50% 38%, rgba(' + t + ',.16), rgba(' + t + ',0) 70%)';
    case 'rays': return 'radial-gradient(ellipse 80% 70% at 50% 0%, rgba(' + t + ',.12), rgba(' + t + ',0) 70%), ' +
      'repeating-conic-gradient(from 180deg at 50% -8%, rgba(' + t + ',.06) 0deg 5deg, rgba(' + t + ',0) 5deg 13deg)';
    case 'waves': return 'radial-gradient(130% 55% at 50% 118%, rgba(' + t + ',.12) 0 46%, rgba(' + t + ',0) 46.4%), ' +
      'radial-gradient(150% 62% at 22% 128%, rgba(' + t + ',.08) 0 48%, rgba(' + t + ',0) 48.4%)';
    default: return '';
  }
}

const lines = (s) => esc(s || '').replace(/\n/g, '<br>');
const pad2 = (n) => (n < 10 ? '0' : '') + n;
export function fmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? h + ':' + pad2(m) + ':' + pad2(x) : m + ':' + pad2(x);
}

/** Keeps one element counting down to `at`; calls done() once at zero. Returns a stop function. */
function ticker(at, show, done) {
  let finished = false;
  const step = () => {
    const left = at - Date.now();
    if (left <= 0) { if (!finished) { finished = true; done(); } return; }
    show(fmtLeft(left));
  };
  step();
  const t = setInterval(step, 250);
  return () => clearInterval(t);
}

/** Small corner clock for any frame: "Service starts in 4:32" (hidden once the time is reached). */
export function clockEl(clock) {
  const el = document.createElement('div');
  el.className = 'f-clock';
  el.innerHTML = '<span class="l">' + esc(clock.label || 'Service starts in') + '</span> <b></b>';
  const b = el.querySelector('b');
  const stop = ticker(+clock.at || 0, (t) => { b.textContent = t; }, () => { el.hidden = true; });
  return { el, stop };
}

/** Build the banner element. urlFor(blob) makes object URLs that the caller revokes. Returns {el, maxF, stop?}. */
export function bannerEl(f, urlFor) {
  const pal = PALETTES[f.pal] || PALETTES.navy;
  const hasImg = !!f.img;
  const dark = hasImg ? pal.dark !== false : pal.dark;
  const el = document.createElement('div');
  el.className = 'f-banner pos-' + (['left', 'right', 'low', 'top'].includes(f.pos) ? f.pos : 'center') + (f.font === 'serif' ? ' serif' : '') +
    (dark ? ' dark' : ' light') + (hasImg ? ' has-img' : '') + ' tpl-' + String(f.tpl || 'blank').replace(/[^a-z]/g, '');
  el.style.setProperty('--b-fg', okColor(f.fgc) || pal.fg);
  el.style.setProperty('--b-accent', okColor(f.acc) || pal.accent);
  if (f.textSize) el.style.setProperty('--bn-size', (f.textSize / 100));
  if (f.textBold) el.classList.add('bold-title');
  if (f.textItalic) el.classList.add('italic-title');

  const bg = document.createElement('div');
  bg.className = 'fb-bg';
  const deco = decoCss(f.deco, pal.dark);
  if (hasImg) {
    bg.style.backgroundImage = 'url("' + urlFor(f.img) + '")';
    const fit = f.imgFit || 'cover';
    bg.style.backgroundSize = fit === 'contain' ? 'contain' : fit === 'crop' ? (f.imgZoom || 100) + '%' : 'cover';
    bg.style.backgroundPosition = f.imgPos || 'center';
    bg.style.backgroundRepeat = 'no-repeat';
  }
  else if (okColor(f.bgc)) {
    // Custom background: one colour, or a two-colour gradient at any angle.
    const c1 = okColor(f.bgc), c2 = okColor(f.bgc2);
    const ang = isFinite(+f.bga) ? +f.bga : 135;
    bg.style.background = (deco ? deco + ', ' : '') + (c2 ? 'linear-gradient(' + ang + 'deg, ' + c1 + ' 0%, ' + c2 + ' 100%)' : c1);
  }
  else bg.style.background = (deco ? deco + ', ' : '') + 'linear-gradient(135deg, ' + pal.bg[0] + ' 0%, ' + pal.bg[1] + ' 100%)';
  el.appendChild(bg);
  if (hasImg) {
    const dim = document.createElement('div');
    dim.className = 'fb-dim';
    const a = Math.max(0, Math.min(0.85, f.dim == null ? 0.45 : +f.dim));
    dim.style.background = pal.dark !== false ? 'rgba(0,0,0,' + a + ')' : 'rgba(255,250,240,' + a + ')';
    el.appendChild(dim);
  }

  const inner = document.createElement('div');
  inner.className = 'fb-in' + (f.layout ? ' has-layout' : '');
  let top = '';
  if (f.logo) top += '<img class="fb-logo" alt="" src="' + esc(urlFor(f.logo)) + '">';
  if (f.kicker && !f.countdown) top += '<div class="fb-kicker" data-part="kicker">' + lines(f.kicker) + '</div>';
  let mid;
  if (f.countdown) {
    mid = '<div class="fb-count-wrap" data-part="count">' + (f.kicker ? '<div class="fb-kicker fb-count-k">' + lines(f.kicker) + '</div>' : '') +
      '<div class="fb-count">0:00</div>' + (f.text ? '<div class="fb-text">' + lines(f.text) + '</div>' : '') + '</div>';
  } else {
    const t = (f.title || '').trim(), x = (f.text || '').trim();
    mid = '<div class="f-body"><div class="f-fit' + (t ? '' : ' only-text') + '">' +
      (t ? '<div class="fb-title" data-part="title">' + lines(t) + '</div>' : '') + (x ? '<div class="fb-text" data-part="text">' + lines(x) + '</div>' : '') + '</div></div>';
  }
  const foot = f.foot ? '<div class="fb-footline" data-part="foot">' + lines(f.foot) + '</div>' : '';
  // A giving QR code gets its own column on the right, large enough to scan from the pews.
  const qr = typeof f.qr === 'string' && /^data:image\/(gif|png);base64,[a-z0-9+/=]+$/i.test(f.qr)
    ? '<div class="fb-qr"><img alt="" src="' + f.qr + '"><span>' + esc(f.qrLabel || 'Scan to give online') + '</span></div>' : '';
  if (qr) el.classList.add('has-qr');
  inner.innerHTML = (top ? '<div class="fb-top">' + top + '</div>' : '') + mid + (foot ? '<div class="fb-foot">' + foot + '</div>' : '') +
    (f.mark ? '<div class="fb-mark">Church Service</div>' : '');
  if (qr) el.insertAdjacentHTML('beforeend', qr);
  el.appendChild(inner);
  // Free elements (text boxes, shapes, lines, pictures) sit above the template's own text.
  if (Array.isArray(f.els) && f.els.length) el.appendChild(elsLayer(f.els, urlFor, { noAnim: !!f.noAnim }));
  // Apply custom layout (drag/resize from the editor).
  if (f.layout) {
    Object.entries(f.layout).forEach(([part, box]) => {
      const node = inner.querySelector('[data-part="' + part + '"]');
      if (!node || !box) return;
      node.style.position = 'absolute';
      node.style.left = (box.x || 0) + '%';
      node.style.top = (box.y || 0) + '%';
      node.style.width = (box.w || 40) + '%';
      if (box.h) node.style.height = box.h + '%';
      node.style.margin = '0';
    });
  }

  let stop = null;
  if (f.countdown) {
    const c = inner.querySelector('.fb-count');
    stop = ticker(+f.countdown.at || 0, (t) => { c.textContent = t; }, () => {
      c.textContent = f.countdown.done || 'Welcome';
      c.classList.add('done');
      const k = inner.querySelector('.fb-count-k'); if (k) k.hidden = true;
    });
  }
  const t = (f.title || '').trim(), x = (f.text || '').trim();
  // Short headings may grow large; a heading with a message, or a long verse, stays calmer.
  const maxF = !t ? 130 : x ? 175 : t.length < 40 ? 230 : 170;
  const after = () => { const l = el.querySelector('.fe-layer'); if (l) finishEls(l); };
  return { el, maxF, stop, after };
}
