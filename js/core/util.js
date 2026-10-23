// Small DOM and data helpers. No framework: every kilobyte and every
// re-render counts on a 2 GB phone or an old church PC.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));

/** h('button.btn.sm', {onclick, title}, 'Text', childNode, [more]) */
export function h(tag, attrs, ...kids) {
  let el;
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  if (m) {
    el = document.createElement(m[1] || 'div');
    (m[2].match(/[.#][\w-]+/g) || []).forEach((t) => {
      if (t[0] === '.') el.classList.add(t.slice(1)); else el.id = t.slice(1);
    });
  } else el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pad2 = (n) => (n < 10 ? '0' : '') + n;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

export function debounce(fn, ms) {
  let t;
  const d = function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export function throttle(fn, ms) {
  let last = 0, t;
  return function (...a) {
    const now = Date.now();
    clearTimeout(t);
    if (now - last >= ms) { last = now; fn.apply(this, a); }
    else t = setTimeout(() => { last = Date.now(); fn.apply(this, a); }, ms - (now - last));
  };
}

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return hh ? hh + ':' + pad2(mm) + ':' + pad2(ss) : mm + ':' + pad2(ss);
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

/** Tiny event emitter used by the store, link and live controller. */
export function emitter(obj = {}) {
  const map = {};
  obj.on = (ev, fn) => { (map[ev] = map[ev] || []).push(fn); return () => obj.off(ev, fn); };
  obj.off = (ev, fn) => { map[ev] = (map[ev] || []).filter((f) => f !== fn); };
  obj.emit = (ev, ...a) => { (map[ev] || []).slice().forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); };
  return obj;
}

export function isTyping(e) {
  const t = e.target;
  if (!t || !t.tagName) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName === 'INPUT') {
    const ty = (t.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(ty);
  }
  return false;
}

export const isBlob = (x) => x != null && typeof x === 'object' && typeof x.arrayBuffer === 'function' && typeof x.size === 'number' && typeof x.type === 'string';

/** Low-power heuristic: ≤2 GB RAM or ≤2 cores. */
export function lowPowerDevice() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  return mem <= 2 || cores <= 2;
}

export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve(Array.from(inp.files || [])); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function readText(file) {
  return file.text ? file.text() : new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file);
  });
}

export const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Returns the URL if it is absolute http(s), else ''. Blocks javascript:, data:, file: and friends. */
export function safeHttpUrl(u) {
  try { const x = new URL(String(u || '').trim()); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : ''; } catch (e) { return ''; }
}

/** Deep copy of imported JSON where every string under a "url"/"href"/"src" key must be http(s). */
export function scrubUrls(v, depth = 0) {
  if (depth > 20 || v == null) return v;
  if (Array.isArray(v)) return v.map((x) => scrubUrls(x, depth + 1));
  if (typeof v !== 'object') return v;
  const out = {};
  for (const k of Object.keys(v)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const x = v[k];
    out[k] = (/^(url|href|src|link|music)$/i.test(k) && typeof x === 'string') ? safeHttpUrl(x) : scrubUrls(x, depth + 1);
  }
  return out;
}

/** The address folder this copy of the app lives in (for example '/Church_Service/'). Used to keep window and channel names apart from any other app on the same site. */
export const APP_SCOPE = (typeof location !== 'undefined' ? location.pathname : '/').replace(/[^/]*$/, '');
