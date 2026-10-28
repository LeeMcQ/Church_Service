// Frame renderer shared by the display window, the Next/Live monitors and thumbnails.
//
// Frame kinds:
//   {kind:'text', variant:'bible'|'hymn'|'title'|'plain', html, cols?:[{html,ref}], colLayout?, head?, foot?, footR?, lines?}
//   {kind:'image', src: Blob|url, fit?:'contain'|'cover'}
//   {kind:'html',  html, assets:[Blob], w, h, bg?}           (PowerPoint slides rendered as HTML)
//   {kind:'banner', ...}                                      (welcome, verse, countdown … see bannerframe.js)
//   {kind:'video'|'stream'|'web', ...}                        (owner supplies a media hook)
// Any frame may carry clock:{at, label} for a small "Service starts in 4:32" corner.
import { isBlob, esc } from './util.js';
import { bannerEl, clockEl } from './bannerframe.js';

/** The app mark (open book), drawn for the default logo slide. */
const DEFAULT_MARK = '<svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M7 18.5Q19 14 30 20.5V50Q19 44.5 7 48Z" fill="#c9a44c"/><path d="M57 18.5Q45 14 34 20.5V50Q45 44.5 57 48Z" fill="#ecd48e"/></svg>';

export const STAGE_W = 1920;

/**
 * Slide HTML from outside (an imported PowerPoint, or a frame a phone or a TV received) is rebuilt from an
 * allow-list: only plain text, layout and pictures that are already on the device survive. Scripts, frames,
 * forms, links, remote pictures and every address in a style are removed.
 */
const DROP_WITH_CONTENT = 'script,style,iframe,object,embed,link,meta,base,form,frame,frameset,svg,math,template,noscript,audio,video,source,track,input,button,textarea,select,canvas,applet';
const KEEP_TAGS = new Set(['DIV', 'P', 'SPAN', 'B', 'I', 'U', 'S', 'EM', 'STRONG', 'BR', 'IMG', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SUB', 'SUP',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'COLGROUP', 'COL', 'FONT', 'SMALL', 'BIG', 'CENTER']);
// The only class names the frames use (PowerPoint boxes, verse numbers, red letters, hymn lines, speaker names).
const FRAME_CLASSES = new Set(['sp', 'v', 'vn', 'wj', 'ln', 'hn', 'ha', 'who', 'lines']);
const safeStyle = (v) => String(v || '').replace(/\/\*[\s\S]*?\*\//g, '').split(';').filter((d) => d.trim() && !/url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding|javascript:/i.test(d)).join(';');
export function sanitizeSlideHtml(html) {
  const src = document.createElement('template');
  src.innerHTML = String(html || '').slice(0, 2000000);
  src.content.querySelectorAll(DROP_WITH_CONTENT).forEach((n) => n.remove());
  const out = document.createElement('template');
  const walk = (from, to) => {
    for (const n of Array.from(from.childNodes)) {
      if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      if (!KEEP_TAGS.has(n.tagName)) { walk(n, to); continue; } // links and unknown tags keep only their content
      const k = document.createElement(n.tagName);
      for (const a of Array.from(n.attributes)) {
        const name = a.name.toLowerCase(), v = a.value.trim();
        if (name === 'style') { const st = safeStyle(v); if (st) k.setAttribute('style', st); }
        else if (name === 'class') { const c = v.split(/\s+/).filter((x) => FRAME_CLASSES.has(x)); if (c.length) k.className = c.join(' '); }
        else if (name === 'data-a' || name === 'data-abg') { if (/^\d{1,4}$/.test(v)) k.setAttribute(name, v); }
        else if (name === 'colspan' || name === 'rowspan' || name === 'width' || name === 'height') { if (/^\d{1,4}%?$/.test(v)) k.setAttribute(name, v); }
        else if (name === 'alt') k.setAttribute('alt', v.slice(0, 200));
        else if (name === 'src' && n.tagName === 'IMG' && /^(blob:|data:image\/(png|jpe?g|gif|webp|bmp);)/i.test(v)) k.setAttribute('src', v);
      }
      walk(n, k);
      to.appendChild(k);
    }
  };
  walk(src.content, out.content);
  return out.innerHTML;
}
export const stageHeight = (aspect) => Math.round(STAGE_W / (aspect > 0.3 ? aspect : 16 / 9));

function urlFor(src, bag) {
  if (!src) return '';
  if (typeof src === 'string') return src;
  if (isBlob(src)) { const u = URL.createObjectURL(src); bag.push(u); return u; }
  return '';
}

/** Binary-search the largest font size (px) at which the content fits its box. */
export function fitBody(body, min, max) {
  const child = body.firstElementChild;
  if (!child) return min;
  const H = body.clientHeight, W = body.clientWidth;
  if (!H || !W) return min;
  const ok = (s) => { body.style.fontSize = s + 'px'; return child.offsetHeight <= H && child.scrollWidth <= W + 1; };
  let lo = Math.round(min), hi = Math.round(max), best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const fits = best >= 0;
  body.style.fontSize = (fits ? best : min) + 'px';
  body.dataset.fits = fits ? '1' : '0';
  return fits ? best : min;
}

function textFrameEl(f) {
  const wrap = document.createElement('div');
  wrap.className = 'f-text f-' + (f.variant || 'plain') + (f.cls ? ' ' + f.cls : '');
  // Language of the words (Afrikaans, isiXhosa …): screen readers and hyphenation use it. Checked, never echoed raw.
  const okLang = (l) => (typeof l === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2})?$/.test(l) ? l : '');
  if (okLang(f.lang)) wrap.setAttribute('lang', f.lang);
  let inner = '';
  if (f.head) inner += '<div class="f-head">' + esc(f.head) + '</div>';
  inner += '<div class="f-body">';
  if (f.cols && f.cols.length > 1) {
    inner += '<div class="f-par' + (f.colLayout === 'rows' ? ' rows' : '') + '">';
    f.cols.forEach((c) => { inner += '<div class="f-fit"' + (okLang(c.lang) ? ' lang="' + c.lang + '"' : '') + '>' + c.html + (c.ref ? '<span class="f-col-ref">' + esc(c.ref) + '</span>' : '') + '</div>'; });
    inner += '</div>';
  } else inner += '<div class="f-fit' + (f.lines ? ' lines' : '') + '">' + (f.html || '') + '</div>';
  inner += '</div>';
  if (f.foot || f.footR) {
    inner += '<div class="f-foot' + (f.footR ? '' : ' center') + '"><span class="fl">' + esc(f.foot || '') + '</span>' +
      (f.footR ? '<span class="fr">' + esc(f.footR) + '</span>' : '') + '</div>';
  }
  wrap.innerHTML = inner;
  return wrap;
}

function decodeImgs(el) {
  const imgs = el.querySelectorAll('img');
  return Promise.all(Array.prototype.map.call(imgs, (im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())));
}

/**
 * Render a frame into a layer element. Returns a cleanup function (revokes object URLs).
 * opts: {minFont, maxFont, hymnCap (share of maxFont for hymn words), sw, sh, media(layer, frame) -> cleanup?, placeholderOnly}
 */
export async function renderFrame(layer, frame, opts = {}) {
  const urls = [];
  layer.textContent = '';
  if (!frame) return () => {};
  const k = frame.kind;
  let mediaCleanup = null;
  if (k === 'text') {
    const el = textFrameEl(frame);
    layer.appendChild(el);
    const body = el.querySelector('.f-body');
    const maxF = opts.maxFont || 150;
    // Sung text is capped a little lower than the largest size (Settings → Screen → Hymn words: 110, 130 or 150 px
    // at the default 150), so short stanzas don't look shouty but use the screen.
    // A slide may allow smaller text than usual (a long Bible passage that must stay on one slide).
    fitBody(body, Math.min(opts.minFont || 58, frame.minFont > 0 ? frame.minFont : 999), frame.variant === 'title' ? maxF * 1.2 : frame.variant === 'hymn' ? Math.round(maxF * (opts.hymnCap > 0 && opts.hymnCap <= 1 ? opts.hymnCap : 130 / 150)) : maxF);
  } else if (k === 'image') {
    const box = document.createElement('div');
    box.className = 'f-image' + (frame.fit === 'cover' ? ' cover' : '');
    const img = document.createElement('img');
    img.alt = '';
    img.src = urlFor(frame.src, urls);
    box.appendChild(img);
    layer.appendChild(box);
    await decodeImgs(box);
  } else if (k === 'html') {
    const sw = opts.sw || STAGE_W, sh = opts.sh || 1080;
    const w = frame.w || 960, hgt = frame.h || 540;
    const sc = Math.min(sw / w, sh / hgt);
    const box = document.createElement('div');
    box.className = 'f-html';
    box.style.width = w + 'px'; box.style.height = hgt + 'px';
    box.style.transform = 'translate(' + (sw - w * sc) / 2 + 'px,' + (sh - hgt * sc) / 2 + 'px) scale(' + sc + ')';
    if (frame.bg) box.style.background = frame.bg;
    box.innerHTML = sanitizeSlideHtml(frame.html);
    const assets = frame.assets || [];
    box.querySelectorAll('[data-a]').forEach((n) => { n.src = urlFor(assets[+n.getAttribute('data-a')], urls); });
    box.querySelectorAll('[data-abg]').forEach((n) => {
      n.style.backgroundImage = 'url("' + urlFor(assets[+n.getAttribute('data-abg')], urls) + '")';
      n.style.backgroundSize = 'cover'; n.style.backgroundPosition = 'center';
    });
    layer.appendChild(box);
    await decodeImgs(box);
  } else if (k === 'banner') {
    const b = bannerEl(frame, (src) => urlFor(src, urls));
    layer.appendChild(b.el);
    const body = b.el.querySelector('.f-body');
    if (body) fitBody(body, 44, b.maxF);
    if (b.after) b.after();
    if (b.stop) mediaCleanup = b.stop;
    await decodeImgs(b.el);
  } else if (opts.media && !opts.placeholderOnly && (k === 'video' || k === 'stream' || k === 'web')) {
    mediaCleanup = (await opts.media(layer, frame)) || null;
  } else {
    // Placeholder for monitors / thumbnails.
    const ph = document.createElement('div');
    ph.className = 'f-placeholder';
    if (frame.poster) {
      const img = document.createElement('img'); img.src = urlFor(frame.poster, urls); ph.appendChild(img);
    }
    const label = { video: 'Video', stream: 'Screen share', web: 'Web page', audio: 'Audio' }[k] || 'Media';
    ph.insertAdjacentHTML('beforeend', '<div>' + esc(frame.title || label) + '</div>' + (frame.sub ? '<small>' + esc(frame.sub) + '</small>' : ''));
    layer.appendChild(ph);
  }
  let clockStop = null;
  if (frame.clock && frame.clock.at > Date.now()) { const c = clockEl(frame.clock); layer.appendChild(c.el); clockStop = c.stop; }
  return () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    if (mediaCleanup) try { mediaCleanup(); } catch (e) { /* */ }
    if (clockStop) clockStop();
  };
}

/**
 * A stage = fixed logical canvas (1920 × H) with two crossfading layers, a logo
 * layer, a blackout and a caption line (reserved for live translation).
 */
export function createStage(host, opts = {}) {
  const el = document.createElement('div');
  el.className = 'stage';
  el.innerHTML = '<div class="bgimg"></div><div class="layer"></div><div class="layer hide"></div>' +
    '<div class="logo"></div><div class="blackout"></div><div class="caption"></div>';
  host.appendChild(el);
  const bg = el.children[0];
  const layers = [el.children[1], el.children[2]];
  const logoEl = el.children[3];
  const captionEl = el.children[5];
  const cleanups = [null, null];
  let front = 0, style = {}, aspect = 16 / 9, sw = STAGE_W, sh = 1080, seq = 0;
  let styleUrls = [];
  let ro = null;

  const stage = {
    el, host,
    get size() { return { w: sw, h: sh }; },
    setAspect(a) {
      aspect = a || 16 / 9; sw = STAGE_W; sh = stageHeight(aspect);
      el.style.setProperty('--sw', sw + 'px'); el.style.setProperty('--sh', sh + 'px');
      stage.fit();
    },
    fit() {
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      const sc = Math.min(W / sw, H / sh);
      el.style.transform = 'translate(' + Math.round((W - sw * sc) / 2) + 'px,' + Math.round((H - sh * sc) / 2) + 'px) scale(' + sc + ')';
    },
    applyStyle(s) {
      style = s || {};
      styleUrls.forEach((u) => URL.revokeObjectURL(u)); styleUrls = [];
      const st = el.style;
      st.setProperty('--d-fg', s.fg || '#fff'); st.setProperty('--d-bg', s.bg || '#000');
      st.setProperty('--d-accent', s.accent || '#f2cf7a');
      st.setProperty('--d-pad', (s.pad || 96) + 'px'); st.setProperty('--d-align', s.align || 'center');
      st.setProperty('--d-fade', (s.fade || 0) + 'ms'); st.setProperty('--d-dim', String(s.bgDim == null ? 0.45 : s.bgDim));
      if (s.weight === 'regular') st.setProperty('--d-weight', '400'); else st.removeProperty('--d-weight');
      el.classList.toggle('serif', s.font === 'serif');
      el.classList.toggle('sysfont', s.font === 'system');
      el.classList.toggle('shadow', !!s.shadow);
      el.classList.toggle('cut', !s.fade);
      el.classList.remove('ref-top', 'ref-none');
      if (s.refPos === 'top') el.classList.add('ref-top'); else if (s.refPos === 'none') el.classList.add('ref-none');
      const bgu = urlFor(s.bgBlob, styleUrls);
      bg.style.backgroundImage = bgu ? 'url("' + bgu + '")' : '';
      bg.classList.toggle('dim', !!bgu);
      logoEl.textContent = '';
      const lu = urlFor(s.logoBlob, styleUrls);
      if (lu) { const im = document.createElement('img'); im.src = lu; im.alt = ''; logoEl.appendChild(im); }
      else if (s.logoText) { const d = document.createElement('div'); d.className = 'logo-text'; d.textContent = s.logoText; logoEl.appendChild(d); }
      else {
        // No logo set: a calm default slide (the app's open-book mark and the church name, or "Welcome").
        const d = document.createElement('div'); d.className = 'logo-default';
        d.innerHTML = DEFAULT_MARK;
        const t = document.createElement('div'); t.className = 'logo-text'; t.textContent = s.logoName || 'Welcome';
        d.appendChild(t); logoEl.appendChild(d);
      }
    },
    /** Show a frame. Renders into the hidden layer, then swaps. */
    async show(frame, extra = {}) {
      const my = ++seq;
      const back = 1 - front;
      if (cleanups[back]) { cleanups[back](); cleanups[back] = null; }
      // Per-frame reference position overrides (Bible vs hymn settings differ).
      el.classList.remove('ref-top', 'ref-none');
      const rp = (frame && frame.refPos) || style.refPos;
      if (rp === 'top') el.classList.add('ref-top'); else if (rp === 'none') el.classList.add('ref-none');
      layers[back].classList.add('hide');
      const c = await renderFrame(layers[back], frame, {
        minFont: style.minFont, maxFont: style.maxFont, hymnCap: style.hymnCap, sw, sh,
        media: opts.media, placeholderOnly: opts.placeholderOnly, ...extra,
      });
      if (my !== seq) { c(); return; } // superseded while loading
      cleanups[back] = c;
      layers[back].classList.remove('hide');
      layers[front].classList.add('hide');
      const old = front; front = back;
      const fade = style.fade || 0;
      setTimeout(() => {
        if (front === old || my !== seq) return;
        if (cleanups[old]) { cleanups[old](); cleanups[old] = null; }
        layers[old].textContent = '';
      }, fade + 40);
    },
    clearContent() { stage.show(null); },
    setBlank(mode) {
      el.classList.toggle('is-black', mode === 'black');
      el.classList.toggle('is-logo', mode === 'logo');
    },
    setCaption(text) {
      captionEl.textContent = '';
      if (text) { const s = document.createElement('span'); s.textContent = text; captionEl.appendChild(s); }
    },
    frontLayer() { return layers[front]; },
    observe() {
      if (ro || !window.ResizeObserver) { window.addEventListener('resize', stage.fit); return; }
      ro = new ResizeObserver(() => stage.fit()); ro.observe(host);
    },
    destroy() {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', stage.fit);
      cleanups.forEach((c) => c && c());
      styleUrls.forEach((u) => URL.revokeObjectURL(u));
      el.remove();
    },
  };
  stage.setAspect(opts.aspect || 16 / 9);
  if (opts.observe !== false) stage.observe();
  return stage;
}

// ------------------------------------------------------------ measuring
// An off-screen stage used to decide how many verses / lines fit on one slide.
let meas = null;
export function measureStage(style, aspect) {
  if (!meas) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-30000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden;pointer-events:none;';
    document.body.appendChild(host);
    meas = { host, stage: createStage(host, { observe: false, placeholderOnly: true }), key: '' };
  }
  const key = JSON.stringify([aspect, style.font, style.pad, style.align, style.weight, style.shadow]);
  if (key !== meas.key) {
    meas.key = key;
    meas.stage.setAspect(aspect);
    meas.stage.el.style.transform = 'none';
    meas.stage.applyStyle(Object.assign({}, style, { bgBlob: null, logoBlob: null, fade: 0 }));
  }
  return meas.stage;
}

/** Does this text frame fit on one slide at the minimum readable size? (one layout pass) */
export function fitsText(frame, style, aspect) {
  const st = measureStage(style, aspect);
  const layer = st.el.querySelector('.layer');
  layer.textContent = '';
  const el = textFrameEl(frame);
  layer.appendChild(el);
  st.el.classList.remove('ref-top', 'ref-none');
  if (frame.refPos === 'top') st.el.classList.add('ref-top'); else if (frame.refPos === 'none') st.el.classList.add('ref-none');
  const body = el.querySelector('.f-body');
  body.style.fontSize = (style.minFont || 58) + 'px';
  const child = body.firstElementChild;
  const ok = child.offsetHeight <= body.clientHeight && child.scrollWidth <= body.clientWidth + 1;
  layer.textContent = '';
  return ok;
}
