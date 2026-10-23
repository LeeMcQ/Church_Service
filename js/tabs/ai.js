// Banners: welcome, Bible-verse, announcement, offering, countdown and sunset banners, drawn live on the
// display (sharp at any size, any projector shape); a pre-service loop that runs on the display by itself;
// and Topics: key Bible verses for the 28 Fundamental Beliefs and common sermon topics, from the installed
// Bibles. Nothing here reaches the screen until Present. Online AI (optional) makes background pictures
// and short summaries that are always shown for checking first.
// (The tab id stays 'ai' so existing settings and service plans keep working.)
import { h, clear, uid, debounce, esc, normalize } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn, seg, toast, modal, closeModal, confirmBox, promptBox, menu, emptyState } from '../core/ui.js';
import { db } from '../core/db.js';
import { createStage } from '../core/render.js';
import { PALETTES, DECOS } from '../core/bannerframe.js';
import { church, hasLocation, sabbathSunsetLine, sabbathDateLine, nextTime, safeGivingUrl } from '../core/church.js';
import { listTranslations, getInfo, versesFor, verseText, search as bibleSearch } from '../core/bibledata.js';
import { parseRef, refText, SHORT } from '../core/books.js';
import * as ai from '../core/ai.js';
import { churchForm } from './church-form.js';
import { openFullBanner } from './ai-full.js';
import { createMusicView, musicChip } from './banner-music.js';
import { createSlideEditor, colorPop } from './slide-editor.js';
import { cleanEls, htmlText, okColor } from '../core/slideels.js';

// ------------------------------------------------------------ templates
const TPL = {
  welcome: { name: 'Welcome', fields: ['kicker', 'title', 'text', 'foot'], x: { logo: true, date: true }, s: { pal: 'navy', deco: 'glow' },
    d: (c) => ({ kicker: c.name, title: 'Happy Sabbath', text: 'Welcome to our worship service. We are glad you are here!' }),
    mood: 'Warm early-morning light over a peaceful green valley' },
  verse: { name: 'Bible verse', fields: ['ref', 'title', 'kicker'], x: {}, s: { pal: 'black', deco: 'none', font: 'serif' },
    d: () => ({ ref: 'Exodus 20:8' }), mood: 'A quiet, softly lit nature scene' },
  announce: { name: 'Announcement', fields: ['kicker', 'title', 'text', 'foot'], x: {}, s: { pal: 'slate', deco: 'waves' },
    d: () => ({ kicker: 'Announcement', title: 'Family Week of Prayer', text: 'Every evening at 19:00', foot: 'Main sanctuary · Everyone welcome' }),
    mood: 'Bright, friendly, softly blurred light' },
  offering: { name: 'Tithe & offering', fields: ['kicker', 'title', 'text', 'foot'], x: { qr: true }, s: { pal: 'earth', deco: 'glow' },
    d: (c) => ({ kicker: c.name, title: 'Tithes & Offerings', text: '“God loveth a cheerful giver.”\n2 Corinthians 9:7' }),
    presets: ['2 Cor 9:7', 'Mal 3:10', 'Prov 3:9', 'Luke 6:38', '1 Chr 29:14'], mood: 'A golden wheat field in late afternoon sun' },
  countdown: { name: 'Countdown', fields: ['kicker', 'at', 'done', 'text', 'foot'], x: {}, s: { pal: 'navy', deco: 'rays' },
    d: (c) => ({ kicker: 'Our service starts in', at: c.service, done: 'Welcome', text: 'Please take your seats and silence your phones.', foot: c.name }),
    mood: 'A calm sky at dawn with soft clouds' },
  sunset: { name: 'Sabbath sunset', fields: ['kicker', 'title', 'text', 'foot'], x: { sunset: true }, s: { pal: 'sunset', deco: 'rays' },
    d: (c) => ({ kicker: c.name, title: 'Welcome the Sabbath', text: 'Come, let us worship together as the sun sets.' }),
    mood: 'A peaceful sunset over gentle hills' },
  closing: { name: 'Closing blessing', fields: ['title', 'text', 'foot'], x: {}, s: { pal: 'plum', deco: 'glow' },
    d: (c) => ({ title: 'The Lord bless thee, and keep thee', text: 'Numbers 6:24', foot: (c.name ? c.name + ' · ' : '') + 'Go in peace' }),
    mood: 'An evening sky with soft golden clouds' },
  blank: { name: 'Blank', fields: ['kicker', 'title', 'text', 'foot'], x: {}, s: { pal: 'navy', deco: 'none' }, d: () => ({}), mood: 'A peaceful nature scene' },
  picture: { name: 'Picture', fields: ['title', 'text'], x: {}, s: { pal: 'navy', deco: 'none' }, d: () => ({}), mood: 'A peaceful nature scene' },
};
const FIELD = {
  kicker: { label: 'Top line', ph: 'Church name or a short heading' },
  title: { label: 'Heading', ph: 'The main words', multi: 2 },
  text: { label: 'Message', ph: 'Optional', multi: 3 },
  foot: { label: 'Bottom line', ph: 'Optional: place, time or contact' },
  ref: { label: 'Bible reference' },
  at: { label: 'Service starts at' },
  done: { label: 'At zero show', ph: 'Welcome' },
};
const EXTRAS = [
  ['logo', 'Logo', 'Your church logo from Settings → Screen'],
  ['date', 'Date', 'The coming Sabbath’s date'],
  ['sunset', 'Sunset time', 'When Sabbath begins or ends, worked out offline'],
  ['qr', 'Giving QR code', 'The giving link from Church details'],
  ['mark', '“SDA Sabbath” mark', 'A small app name in the corner'],
];
const POS = [['center', 'Centre'], ['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['low', 'Bottom']];

function newBanner(tpl = 'welcome', extra) {
  const t = TPL[tpl] || TPL.welcome;
  const c = church();
  return Object.assign({ id: null, name: '', tpl, f: Object.assign({}, t.d(c)), x: Object.assign({}, t.x),
    s: Object.assign({ pal: 'navy', deco: 'none', pos: 'center', font: 'sans', img: null, dim: null, imgFit: 'cover', imgPos: 'center', imgZoom: 100 }, t.s), els: [], pages: [] }, extra || {});
}
/** A further slide of a banner: the same fields as the banner's own first slide. */
function newSlide(tpl = 'blank') {
  const b = newBanner(tpl);
  return { tpl: b.tpl, f: b.f, x: b.x, s: b.s, els: [] };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const sig = (b) => JSON.stringify([b.name, b.group || '', b.tpl, b.f, b.x, b.s, b.els || [], b.pages || []]);
const slidesOf = (b) => [b].concat(Array.isArray(b.pages) ? b.pages : []);
const short = (s, n = 48) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const firstText = (b) => { const e = (b.els || []).find((x) => (x.t === 'text' || x.t === 'shape') && htmlText(x.html)); return e ? htmlText(e.html).split('\n')[0] : ''; };
const nameOf = (b) => b.name || short((TPL[b.tpl] || TPL.blank).name + (b.f.title || b.f.kicker ? ': ' + (b.f.title || b.f.kicker) : firstText(b) ? ': ' + firstText(b) : ''), 60);

export default function create(ctx) {
  const { live, settings, link } = ctx;
  let lib = [];             // saved banners
  let groups = [];          // {id, name}
  let loop = { items: [], secs: 8, count: true, at: '', end: '' };
  let announce = { items: [], secs: 8, count: true, at: '', end: '' };
  let loopKind = 'pre'; // 'pre' = preservice (with music), 'ann' = announcements (no music)
  let cur = newBanner();    // banner in the editor (its first slide's fields sit on it; more slides in cur.pages)
  let pg = 0;               // slide being edited (0 = the banner itself)
  let sl = cur;             // that slide: {tpl, f, x, s, els}
  let savedSig = null;      // sig(cur) when it was last saved (null = never)
  let view = 'make';
  let topics = null;
  let libFilter = '';       // group id to show, or '' for all
  let libQuery = '';        // search text

  // ------------------------------------------------------------ storage
  const saveLib = () => db.put('kv', 'banners', lib);
  const saveGroups = () => db.put('kv', 'banner-groups', groups);
  const saveLoop = () => db.put('kv', 'banner-loop', loop);
  const saveAnnounce = () => db.put('kv', 'banner-announce', announce);
  const saveDraft = debounce(() => db.put('kv', 'banner-draft', { cur, savedSig }).catch(() => {}), 500);

  // Saved data from older versions or a damaged database: repair what can be used, drop the rest.
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const fin = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
  function repairSlide(b, out) {
    if (isObj(b.f)) Object.keys(b.f).forEach((k) => { if (typeof b.f[k] === 'string') out.f[k] = b.f[k]; });
    if (isObj(b.x)) Object.keys(b.x).forEach((k) => { out.x[k] = !!b.x[k]; });
    if (isObj(b.s)) {
      const S = b.s;
      if (PALETTES[S.pal]) out.s.pal = S.pal;
      if (DECOS[S.deco]) out.s.deco = S.deco;
      if (['center', 'left', 'right', 'top', 'low'].includes(S.pos)) out.s.pos = S.pos;
      if (['sans', 'serif'].includes(S.font)) out.s.font = S.font;
      out.s.img = typeof S.img === 'string' ? S.img : null;
      out.s.dim = typeof S.dim === 'number' && isFinite(S.dim) ? S.dim : null;
      if (['cover', 'contain', 'crop'].includes(S.imgFit)) out.s.imgFit = S.imgFit;
      if (['center', 'top', 'bottom', 'left', 'right'].includes(S.imgPos)) out.s.imgPos = S.imgPos;
      if (fin(S.imgZoom, 50, 400)) out.s.imgZoom = S.imgZoom;
      if (fin(S.textSize, 30, 300)) out.s.textSize = S.textSize;
      if (fin(S.textSpacing, 0.8, 3)) out.s.textSpacing = S.textSpacing;
      if (S.textBold) out.s.textBold = true;
      if (S.textItalic) out.s.textItalic = true;
      if (S.free) out.s.free = true;
      ['bgc', 'bgc2', 'fgc', 'acc'].forEach((k) => { if (okColor(S[k])) out.s[k] = okColor(S[k]); });
      if (fin(S.bga, 0, 360)) out.s.bga = S.bga;
      if (isObj(S.layout)) {
        const L = {};
        Object.keys(S.layout).forEach((k) => { const v = S.layout[k]; if (['kicker', 'title', 'text', 'foot', 'count'].includes(k) && isObj(v) && fin(v.x, -50, 150) && fin(v.y, -50, 150)) L[k] = { x: v.x, y: v.y, w: fin(v.w, 1, 200) ? v.w : 40, h: fin(v.h, 0, 200) ? v.h : 0 }; });
        if (Object.keys(L).length) out.s.layout = L;
      }
    }
    out.els = cleanEls(b.els);
    return out;
  }
  function repair(b) {
    if (!isObj(b) || !TPL[b.tpl]) return null;
    const base = newBanner(b.tpl);
    const out = Object.assign(base, { id: typeof b.id === 'string' ? b.id : null, name: typeof b.name === 'string' ? b.name : '', created: b.created, updated: b.updated });
    if (typeof b.group === 'string') out.group = b.group;
    repairSlide(b, out);
    out.pages = (Array.isArray(b.pages) ? b.pages : []).filter((p) => isObj(p) && TPL[p.tpl]).slice(0, 60).map((p) => repairSlide(p, newSlide(p.tpl)));
    return out;
  }
  async function load() {
    const raw = await db.get('kv', 'banners').catch(() => null);
    lib = (Array.isArray(raw) ? raw : []).map(repair).filter((b) => b && b.id);
    const gr = await db.get('kv', 'banner-groups').catch(() => null);
    groups = (Array.isArray(gr) ? gr : []).filter((g) => g && g.id && g.name);
    const lp = await db.get('kv', 'banner-loop').catch(() => null);
    if (isObj(lp)) {
      loop.items = (Array.isArray(lp.items) ? lp.items : []).filter((it) => isObj(it) && (it.t === 'banner' || it.t === 'deck') && typeof it.id === 'string');
      loop.secs = [5, 8, 10, 15, 20, 30].includes(+lp.secs) ? +lp.secs : 8;
      loop.count = lp.count !== false;
      loop.at = /^\d{1,2}:\d{2}$/.test(lp.at || '') ? lp.at : '';
      loop.end = typeof lp.end === 'string' ? lp.end : '';
    }
    const an = await db.get('kv', 'banner-announce').catch(() => null);
    if (isObj(an)) {
      announce.items = (Array.isArray(an.items) ? an.items : []).filter((it) => isObj(it) && (it.t === 'banner' || it.t === 'deck') && typeof it.id === 'string');
      announce.secs = [5, 8, 10, 15, 20, 30].includes(+an.secs) ? +an.secs : 8;
      announce.count = an.count !== false;
      announce.at = /^\d{1,2}:\d{2}$/.test(an.at || '') ? an.at : '';
      announce.end = typeof an.end === 'string' ? an.end : '';
    }
    const d = await db.get('kv', 'banner-draft').catch(() => null);
    const dc = d && repair(d.cur);
    if (dc) { setDoc(dc); savedSig = typeof d.savedSig === 'string' ? d.savedSig : null; }
    await migrateOldHistory().catch((e) => console.warn('old banners', e));
  }
  // Banners saved by the old Banner tab were pictures in browser storage (about 5 MB, easily full).
  // Move them into the app's database once, as Picture banners.
  async function migrateOldHistory() {
    let old;
    try { old = JSON.parse(localStorage.getItem('selah-ai-history') || 'null'); } catch (e) { old = null; }
    if (!Array.isArray(old) || !old.length) return;
    for (const it of old.slice().reverse()) {
      if (!it || typeof it.data !== 'string' || !/^data:image\//.test(it.data)) continue;
      try {
        const blob = await (await fetch(it.data)).blob();
        const id = await storePicture(blob, (it.title || 'Banner') + '.jpg', { dim: 0 });
        lib.unshift(Object.assign(newBanner('picture'), { id: 'b-' + uid(), name: (it.title || 'Banner') + ' (earlier)', s: { pal: 'navy', deco: 'none', pos: 'center', font: 'sans', img: id, dim: 0 }, created: it.ts || Date.now(), updated: it.ts || Date.now() }));
      } catch (e) { /* skip a broken entry */ }
    }
    await saveLib();
    try { localStorage.removeItem('selah-ai-history'); } catch (e) { /* */ }
  }

  // ------------------------------------------------------------ pictures
  const blobCache = new Map();
  async function fileBlob(id) {
    if (!id) return null;
    if (blobCache.has(id)) return blobCache.get(id);
    const r = await db.get('files', id).catch(() => null);
    const b = (r && r.blob) || null;
    blobCache.set(id, b);
    return b;
  }
  /** Store a background picture (scaled to at most 2560 px, JPEG) with a thumbnail and its brightness. */
  async function storePicture(blob, name, opts = {}) {
    const bmp = await createImageBitmap(blob);
    const sc = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, c.width, c.height);
    // Pictures that can have see-through parts (logos, cut-outs) stay PNG so they don't get a black box.
    const full = await new Promise((r) => (opts.keepAlpha && /png|webp|gif/.test(blob.type) ? c.toBlob(r, 'image/png') : c.toBlob(r, 'image/jpeg', 0.86)));
    const t = document.createElement('canvas');
    t.width = 192; t.height = 108;
    const tg = t.getContext('2d');
    const k = Math.max(192 / bmp.width, 108 / bmp.height);
    tg.drawImage(bmp, (192 - bmp.width * k) / 2, (108 - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
    const thumb = await new Promise((r) => t.toBlob(r, 'image/jpeg', 0.8));
    // Average brightness decides how much the picture is darkened under white text.
    const px = tg.getImageData(0, 0, 192, 108).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const lum = sum / (px.length / 4) / 255;
    if (bmp.close) bmp.close();
    const cw = c.width, ch = c.height;
    c.width = c.height = 0;
    const id = 'bbg-' + uid();
    await db.put('files', id, { id, kind: 'banner-bg', name: name || 'Picture', type: full.type || 'image/jpeg', size: full.size, blob: full, thumb, added: Date.now(), meta: { lum, w: cw, h: ch } });
    blobCache.set(id, full);
    return id;
  }
  const autoDim = (lum) => Math.round(Math.max(0.25, Math.min(0.7, 0.2 + 0.55 * (lum == null ? 0.5 : lum))) * 100) / 100;

  // ------------------------------------------------------------ frames and cues
  let qrCache = { url: '', data: '' };
  async function qrData(url) {
    if (qrCache.url === url) return qrCache.data;
    const m = await import('../../vendor/qrcode.min.js');
    const q = m.default(0, 'M'); q.addData(url); q.make();
    qrCache = { url, data: q.createDataURL(8, 0) };
    return qrCache.data;
  }
  async function logoBlob() {
    const st = live.style || (await live.buildStyle());
    return (st && st.logoBlob) || null;
  }
  /** The display frame for a banner (pictures, logo and QR code resolved). */
  const TOKENS = [['{date}', 'Sabbath date'], ['{sunset}', 'Sabbath sunset time'], ['{church}', 'Church name'], ['{town}', 'Town'], ['{service}', 'Service time'], ['{today}', 'Today’s date']];
  function fieldValues(now) {
    const c = church();
    return { date: sabbathDateLine(now), sunset: hasLocation() ? sabbathSunsetLine(now) : '', church: c.name || '', town: c.town || '', service: c.service || '',
      today: now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
  }
  /** Display frames for every slide of a banner. */
  async function framesOf(b, opt) { const out = []; for (const x of slidesOf(b)) out.push(await frameOf(x, new Date(), opt)); return out; }
  async function frameOf(b, now = new Date(), opt = {}) {
    const c = church(), f = b.f || {}, x = b.x || {}, s = b.s || {};
    const fr = { kind: 'banner', tpl: b.tpl, pal: s.pal || 'navy', deco: s.deco || 'none', pos: s.pos || 'center', font: s.font || 'sans',
      kicker: f.kicker || '', title: f.title || '', text: f.text || '', mark: !!x.mark,
      textSize: s.textSize || 100, textBold: !!s.textBold, textItalic: !!s.textItalic, textSpacing: s.textSpacing || 1.24,
      layout: s.layout && Object.keys(s.layout).length ? s.layout : null,
      bgc: s.bgc || '', bgc2: s.bgc2 || '', bga: s.bga == null ? 135 : s.bga, fgc: s.fgc || '', acc: s.acc || '' };
    const foot = [b.tpl === 'verse' ? f.refLabel || f.ref : f.foot, x.date ? sabbathDateLine(now) : '', x.sunset ? sabbathSunsetLine(now) : '']
      .map((t) => (t || '').trim()).filter(Boolean);
    fr.foot = foot.join('  ·  ');
    if (b.tpl === 'countdown') {
      const at = nextTime(f.at || c.service, now);
      fr.title = ''; fr.countdown = { at: at ? at.getTime() : Date.now(), done: f.done || 'Welcome' };
    }
    if (s.img) {
      const im = await fileBlob(s.img);
      if (im) {
        fr.img = im;
        fr.dim = s.dim == null ? 0.45 : s.dim;
        fr.imgFit = s.imgFit || 'cover';
        fr.imgPos = s.imgPos || 'center';
        fr.imgZoom = s.imgZoom || 100;
      }
    }
    if (x.logo) { const lg = await logoBlob(); if (lg) fr.logo = lg; }
    // Free elements: fields such as {date} filled in now, pictures fetched from the database.
    if (Array.isArray(b.els) && b.els.length) {
      const fields = fieldValues(now);
      fr.els = [];
      for (const e of b.els) {
        const o = Object.assign({}, e);
        if (o.html) o.html = o.html.replace(/\{(date|sunset|church|service|today|town)\}/g, (m, k) => esc(fields[k] || ''));
        if (o.t === 'image' && o.src) o.img = await fileBlob(o.src).catch(() => null);
        fr.els.push(o);
      }
    }
    if (opt.noAnim) fr.noAnim = true;
    const gu = x.qr ? safeGivingUrl(c.givingUrl) : '';
    if (gu) { try { fr.qr = await qrData(gu); fr.qrLabel = c.givingLabel; } catch (e) { /* no QR */ } }
    return fr;
  }
  const cueId = (b) => 'banner:' + (b.id || 'draft');
  function bannerCue(b, frames, index = 0) {
    frames = Array.isArray(frames) ? frames : [frames];
    const n = frames.length;
    return { id: cueId(b), tab: 'ai', title: nameOf(b), sub: n > 1 ? 'Banner · ' + n + ' slides' : 'Banner', withMusic: true, deck: { kind: 'banner', frames }, index: Math.min(index, n - 1),
      labels: n > 1 ? frames.map((f, i) => 'Slide ' + (i + 1)) : [TPL[b.tpl].name],
      plan: b.id ? { tab: 'ai', banner: b.id, label: 'Banner: ' + nameOf(b) } : null };
  }

  // ------------------------------------------------------------ layout
  const viewSeg = h('div.seg.bn-views', { role: 'group', 'aria-label': 'Banners & Music views' });
  const VIEWS = [['make', 'Make'], ['library', 'Saved'], ['loop', 'Service loop', ''], ['music', 'Music'], ['topics', 'Topics']];
  function renderViewSeg() {
    clear(viewSeg);
    VIEWS.forEach(([v, label, pre]) => viewSeg.appendChild(h('button', { type: 'button', 'aria-pressed': String(v === view),
      onclick: () => setView(v) }, pre ? [h('span.hide-sm', pre + label.toLowerCase()), h('span.bn-sm', label)] : label, v === 'library' && lib.length ? ' (' + lib.length + ')' : '')));
  }
  const churchBtn = h('button.btn.sm', { type: 'button', title: 'Church name, town, location, service time and giving link', onclick: () => churchDialog() }, icon('pin'), h('span.hide-sm', 'Church details'));
  const views = { make: h('div.bn-view'), library: h('div.bn-view.scroll.pad'), loop: h('div.bn-view.scroll.pad'), music: h('div.bn-view.scroll.pad.mu-view'), topics: h('div.bn-view') };
  const el = h('section.banners',
    h('div.toolbar', h('h2', 'Banners & Music'), viewSeg, h('div.grow'), churchBtn),
    views.make, views.library, views.loop, views.music, views.topics);
  const musicView = createMusicView(ctx, views.music);

  function setView(v) {
    view = v;
    renderViewSeg();
    Object.keys(views).forEach((k) => { views[k].hidden = k !== v; });
    if (v === 'make') { refreshPreview(); } else if (editor) editor.deselect();
    if (v === 'library') renderLibrary();
    if (v === 'loop') renderLoop();
    if (v === 'topics') renderTopics();
    if (v === 'music') musicView.show();
  }

  function churchDialog() {
    modal({ title: 'Your church', body: h('div', h('p.note', { style: { marginBottom: '10px' } }, 'Banners use these details. They are also in Settings → Church. Nothing here leaves this device.'),
      churchForm(settings, () => { schedule(); })), actions: [{ label: 'Done', primary: true }], wide: true });
  }

  // ============================================================ MAKE
  let editor = null, stripReady = false;
  const host = h('div.stage-host');
  const screen = h('div.screen.bn-screen', host);
  const stage = createStage(host, { placeholderOnly: true });
  const nameInp = h('input.field', { placeholder: 'Name (for the Saved list)', 'aria-label': 'Banner name', style: { flex: '1 1 160px', minWidth: '0' },
    oninput: () => { cur.name = nameInp.value; changed(false); } });
  const saveBtn = h('button.btn', { type: 'button', onclick: () => saveCurrent(true) }, icon('save'), h('span', 'Save'));
  const nextBtn = h('button.btn.primary', { type: 'button', title: 'Put this banner on the green Next screen (from the slide you are on). Press Present (F5) to show it.', onclick: () => setNext() }, icon('next'), h('span', 'Set as Next'));
  const editorScroll = h('div.scroll.pad.bn-editor');
  // Group of the banner being edited (it is saved with the banner).
  const groupSel = h('select.field.sm', { 'aria-label': 'Group for this banner', onchange: async () => {
    if (groupSel.value === '+') { const g = await newGroup(); groupSel.value = ''; if (g) { cur.group = g.id; } renderGroupSel(); changed(false); return; }
    if (groupSel.value) cur.group = groupSel.value; else delete cur.group;
    changed(false);
  } });
  const groupRow = h('label.row.bn-group-row', icon('folder'), h('span.note', 'Group'), groupSel);
  function renderGroupSel() {
    clear(groupSel);
    groupSel.appendChild(h('option', { value: '' }, '(No group)'));
    groups.forEach((g) => groupSel.appendChild(h('option', { value: g.id }, g.name)));
    groupSel.appendChild(h('option', { value: '+' }, 'New group…'));
    groupSel.value = cur.group && groups.some((g) => g.id === cur.group) ? cur.group : '';
  }
  const formatScroll = h('div.scroll.pad.bn-format');
  // The slides are a list box; the "+ Slide" button sits next to it (a list box may only hold its options).
  const stripList = h('div.bn-strip-list', { role: 'listbox', 'aria-label': 'Slides of this banner' });
  const strip = h('div.bn-strip', stripList);
  const wideBtn = h('button.btn.sm', { type: 'button', title: 'Bigger slide: make the editing area wider', 'aria-pressed': 'false', onclick: () => setWide(!wide) }, icon('wide'), h('span.hide-sm', 'Wide'));
  let wide = false;
  try { wide = localStorage.getItem('selah-bn-wide') === '1'; } catch (e) { /* */ }
  const sideSeg = h('div.seg.bn-side-seg', { role: 'tablist', 'aria-label': 'Panel' });
  let side = 'slide';
  function renderSideSeg() {
    clear(sideSeg);
    [['slide', 'Slide'], ['format', 'Format options']].forEach(([k, l]) => sideSeg.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': String(side === k), onclick: () => setSide(k) }, l)));
  }
  function setSide(k) {
    side = k; renderSideSeg();
    editorScroll.hidden = k !== 'slide'; formatScroll.hidden = k !== 'format';
    if (k === 'format' && !formatScroll.firstChild.childNodes.length) formatScroll.firstChild.replaceChildren(h('p.note', 'Select something on the slide to see its options: size, fill, border, text, picture adjustments, animation and arrange.'));
  }
  const editPane = h('div.pane.bn-edit-pane', h('div.bn-side-bar', sideSeg), editorScroll, formatScroll);
  const previewPane = h('div.pane.bn-preview-pane',
    h('div.bn-preview-in',
      screen,
      strip,
      h('div.row.wrap.bn-actions', nextBtn, saveBtn,
        h('button.btn', { type: 'button', title: 'Add to the current service plan', onclick: () => addCurToPlan() }, icon('plan'), h('span', 'Add to plan')),
        h('button.btn', { type: 'button', title: 'Add to the current Service loop (Preservice or Announcements)', onclick: () => addCurToLoop() }, icon('loop'), h('span', 'Add to loop'))),
      h('div.row', nameInp,
        h('button.btn.sm', { type: 'button', title: 'Start a new banner', onclick: () => startNew() }, icon('plus'), h('span', 'New'))),
      groupRow,
      musicChip(ctx, () => setView('music')),
      h('p.note', 'Click anything on the slide to change it; double-click text to type. Insert text boxes, pictures, shapes and lines from the toolbar. Right-click for more. Set as Next puts the banner on the green Next screen; Present (F5) shows it.')));
  const makeSplit = h('div.split.banner-split', editPane, previewPane);
  const tbRow = h('div.bn-tb-row');
  views.make.classList.add('bn-make');
  views.make.append(tbRow, makeSplit);
  function setWide(v) {
    wide = v; makeSplit.classList.toggle('bn-wide', v); wideBtn.setAttribute('aria-pressed', String(v));
    try { localStorage.setItem('selah-bn-wide', v ? '1' : '0'); } catch (e) { /* */ }
    requestAnimationFrame(() => { stage.fit(); editor.afterRender(); });
  }

  // ------------------------------------------------------------ the slide being edited, and undo/redo
  function setDoc(b, keepHistory) {
    cur = b;
    if (!Array.isArray(cur.pages)) cur.pages = [];
    if (!Array.isArray(cur.els)) cur.els = [];
    pg = 0; sl = cur;
    if (editor) editor.deselect();
    if (!keepHistory) hist.reset();
    if (stripReady) renderStrip();
    renderGroupSel();
  }
  /** Replace the slide being edited (a new kind of banner for this slide only). */
  function replaceSlide(nb) {
    if (pg === 0) { Object.assign(cur, { tpl: nb.tpl, f: nb.f, x: nb.x, s: nb.s, els: nb.els || [] }); sl = cur; }
    else { cur.pages[pg - 1] = { tpl: nb.tpl, f: nb.f, x: nb.x, s: nb.s, els: nb.els || [] }; sl = cur.pages[pg - 1]; }
  }
  const hist = {
    stack: [], i: -1, t: null,
    snap() { return JSON.stringify({ d: cur, pg }); },
    reset() { clearTimeout(this.t); this.t = null; this.stack = [this.snap()]; this.i = 0; },
    mark(soon) {
      clearTimeout(this.t);
      if (soon) { this.t = setTimeout(() => this.push(), 450); return; }
      this.push();
    },
    flush() { if (this.t) { clearTimeout(this.t); this.t = null; this.push(); } },
    push() {
      this.t = null;
      const s = this.snap();
      if (s === this.stack[this.i]) return;
      this.stack = this.stack.slice(0, this.i + 1); this.stack.push(s);
      if (this.stack.length > 120) this.stack.shift();
      this.i = this.stack.length - 1;
      if (editor) editor.refreshToolbar();
    },
    can(d) { return d < 0 ? this.i > 0 || !!this.t : this.i < this.stack.length - 1; },
    go(d) {
      this.flush();
      const j = this.i + d;
      if (j < 0 || j >= this.stack.length) return;
      this.i = j;
      const o = JSON.parse(this.stack[j]);
      const keepId = cur.id, keepName = cur.name;
      const selNow = editor ? editor.selection() : [];
      cur = o.d; cur.id = keepId; cur.name = keepName; if (!Array.isArray(cur.pages)) cur.pages = [];
      pg = Math.min(o.pg || 0, cur.pages.length); sl = pg ? cur.pages[pg - 1] : cur;
      editor.deselect();
      updateSaveBtn(); saveDraft(); renderEditor(); renderStrip();
      refreshPreview().then(() => editor.select(selNow));
    },
  };
  function goPage(i) {
    if (i < 0 || i > cur.pages.length || i === pg) return;
    editor.deselect();
    pg = i; sl = i ? cur.pages[i - 1] : cur;
    renderEditor(); renderStrip(); refreshPreview();
  }

  // ------------------------------------------------------------ the canvas editor
  editor = createSlideEditor({
    screen,
    stageEl: () => stage.el,
    slide: () => sl,
    tokens: TOKENS,
    commit: (o = {}) => {
      updateSaveBtn(); saveDraft();
      hist.mark(!!o.typing);
      stripThumbSoon();
      if (o.render === 'now') return o.force ? refreshPreview(true) : refreshPreview();
      if (o.render === 'soon') schedule();
      return Promise.resolve();
    },
    storeImage: (blob, name) => storePicture(blob, name),
    pictures: async () => (await db.all('files').catch(() => [])).filter((f) => f.kind === 'banner-bg').sort((a, b) => (b.added || 0) - (a.added || 0))
      .map((f) => ({ id: f.id, name: f.name, w: f.meta && f.meta.w, h: f.meta && f.meta.h })),
    undo: () => hist.go(-1), redo: () => hist.go(1),
    canUndo: () => hist.can(-1), canRedo: () => hist.can(1),
    canConvert: () => sl.tpl !== 'countdown',
    convertParts: (list) => convertParts(list),
    onSelect: (ids) => { if (ids.length) setSide('format'); else if (side === 'format') setSide('slide'); },
    preview: () => replayAnimations(),
  });
  tbRow.append(editor.toolbar, wideBtn);
  // Undo/redo anywhere in the Make view (text fields keep their own undo).
  views.make.addEventListener('keydown', (ev) => {
    const t = ev.target, ctrl = ev.ctrlKey || ev.metaKey;
    if (!ctrl || ev.altKey) return;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = ev.key.toLowerCase();
    if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); hist.go(-1); }
    else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); ev.stopPropagation(); hist.go(1); }
  });
  formatScroll.appendChild(editor.panel);
  renderSideSeg(); setSide('slide');
  if (wide) makeSplit.classList.add('bn-wide');
  wideBtn.setAttribute('aria-pressed', String(wide));

  /** The template's own lines became text boxes: empty their fields so they aren't drawn twice. */
  function convertParts(list) {
    const now = new Date();
    const date = sl.x.date ? sabbathDateLine(now) : '', sunset = sl.x.sunset && hasLocation() ? sabbathSunsetLine(now) : '';
    list.forEach(({ part, el }) => {
      if (part === 'foot') {
        // Keep the date and sunset lines live: they become {date} and {sunset} fields.
        if (date) el.html = el.html.split(esc(date)).join('{date}');
        if (sunset) el.html = el.html.split(esc(sunset)).join('{sunset}');
        sl.f.foot = ''; sl.f.refLabel = ''; if (sl.tpl === 'verse') sl.f.ref = '';
      } else sl.f[part] = '';
    });
    if (list.some((x) => x.part === 'foot')) { sl.x.date = false; sl.x.sunset = false; }
    sl.s.free = true;
    delete sl.s.layout;
    renderEditor();
  }
  function replayAnimations() {
    frameOf(sl).then((fr) => { stage.show(fr).then(() => editor.afterRender()); });
  }

  function setPreviewAspect() {
    const a = link.aspect ? link.aspect() : 16 / 9;
    stage.setAspect(a);
    screen.style.aspectRatio = String(a);
  }
  live.on('style', (s) => { stage.applyStyle(s); setPreviewAspect(); refreshPreview(); });
  if (link.on) link.on('hello', () => { setPreviewAspect(); refreshPreview(); });

  let previewSeq = 0, previewWaiting = false;
  async function refreshPreview(force) {
    if (view !== 'make') return;
    if (editor.isEditing() && force !== true) { previewWaiting = true; return; } // never redraw under the user's typing or dragging
    previewWaiting = false;
    const my = ++previewSeq;
    const fr = await frameOf(sl, new Date(), { noAnim: true });
    if (my !== previewSeq) return;
    await stage.show(fr);
    if (my !== previewSeq) return;
    editor.afterRender();
    // Keep the Next screen truthful while editing the banner that is staged.
    if (live.staged && live.staged.id === cueId(cur) && live.staged.tab === 'ai') ctx.setStaged('ai', bannerCue(cur, await framesOf(cur), live.staged.index || 0));
  }
  setInterval(() => { if (previewWaiting && !editor.isEditing()) refreshPreview(); }, 400);

  // ------------------------------------------------------------ slides strip (several slides per banner)
  let stripMinis = [];
  const stripThumbSoon = debounce(() => {
    const it = strip.querySelector('.bn-strip-it[aria-selected="true"] .stage-host');
    if (!it || !it._stage) return;
    frameOf(sl, new Date(), { noAnim: true }).then((f) => it._stage.show(f)).catch(() => {});
  }, 600);
  function renderStrip() {
    stripReady = true;
    stripMinis.forEach((s) => s.destroy()); stripMinis = [];
    clear(stripList);
    Array.from(strip.children).forEach((c) => { if (c !== stripList) c.remove(); });
    const slides = slidesOf(cur);
    slides.forEach((x, i) => {
      const hostM = h('div.stage-host');
      const it = h('div.bn-strip-it', { role: 'option', 'aria-selected': String(i === pg), tabindex: '0', draggable: 'true', title: 'Slide ' + (i + 1) + (slides.length > 1 ? ' · drag to reorder · right-click for more' : ''),
        onclick: () => goPage(i),
        onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); goPage(i); } if (ev.key === 'Delete') { ev.preventDefault(); deletePage(i); } },
        oncontextmenu: (ev) => { ev.preventDefault(); pageMenu(it, i); },
        ondragstart: (ev) => { ev.dataTransfer.setData('text/x-slide', String(i)); ev.dataTransfer.effectAllowed = 'move'; },
        ondragover: (ev) => { if (Array.from(ev.dataTransfer.types).includes('text/x-slide')) { ev.preventDefault(); it.classList.add('drop'); } },
        ondragleave: () => it.classList.remove('drop'),
        ondrop: (ev) => { it.classList.remove('drop'); const from = +ev.dataTransfer.getData('text/x-slide'); if (isFinite(from)) movePage(from, i); } },
        h('div.bn-strip-th', hostM), h('span.bn-strip-n', String(i + 1)));
      if (slides.length > 1) it.appendChild(h('button.bn-strip-more', { type: 'button', title: 'Slide options', 'aria-label': 'Slide ' + (i + 1) + ' options', onclick: (ev) => { ev.stopPropagation(); pageMenu(ev.currentTarget, i); } }, icon('more')));
      stripList.appendChild(it);
      requestAnimationFrame(async () => {
        const st = createStage(hostM, { placeholderOnly: true, aspect: link.aspect ? link.aspect() : 16 / 9 });
        hostM._stage = st; stripMinis.push(st);
        if (live.style) st.applyStyle(live.style);
        try { st.show(await frameOf(x, new Date(), { noAnim: true })); } catch (e) { /* */ }
      });
    });
    const add = h('button.bn-strip-add', { type: 'button', title: 'New slide', onclick: () => newPageMenu(add) }, icon('plus'), h('span', 'Slide'));
    strip.appendChild(add);
  }
  function plainSlide(x) { return { tpl: x.tpl, f: clone(x.f), x: clone(x.x), s: clone(x.s), els: clone(x.els || []) }; }
  function newPageMenu(anchor) {
    menu(anchor, [
      { label: 'Blank slide', icon: 'plus', onclick: () => addPage(Object.assign(newSlide('blank'), { s: Object.assign(newSlide('blank').s, { pal: sl.s.pal, deco: sl.s.deco, img: sl.s.img, dim: sl.s.dim, bgc: sl.s.bgc, bgc2: sl.s.bgc2, bga: sl.s.bga, fgc: sl.s.fgc, acc: sl.s.acc }) })) },
      { label: 'Duplicate this slide', icon: 'dup', hint: 'Ctrl+D', onclick: () => addPage(plainSlide(sl)) },
      '-',
      ...Object.keys(TPL).filter((k) => k !== 'blank').map((k) => ({ label: TPL[k].name, icon: 'banner', onclick: () => addPage(newSlide(k)) })),
    ]);
  }
  function addPage(x, at = pg + 1) {
    if (cur.pages.length >= 59) { toast('A banner can have up to 60 slides.', 'err'); return; }
    // Slide i lives at pages[i-1]; the banner itself is slide 0.
    cur.pages.splice(at - 1, 0, x);
    pg = at; sl = cur.pages[at - 1];
    editor.deselect();
    changed(true); renderStrip();
    if (x.tpl === 'verse' && x.f.ref) fetchVerse();
  }
  function deletePage(i) {
    const n = slidesOf(cur).length;
    if (n < 2) { toast('A banner needs at least one slide.', '', 2500); return; }
    if (i === 0) { const nx = cur.pages.shift(); Object.assign(cur, { tpl: nx.tpl, f: nx.f, x: nx.x, s: nx.s, els: nx.els || [] }); }
    else cur.pages.splice(i - 1, 1);
    pg = Math.min(pg >= i && pg > 0 ? pg - 1 : pg, cur.pages.length); sl = pg ? cur.pages[pg - 1] : cur;
    editor.deselect();
    changed(true); renderStrip();
  }
  function movePage(from, to) {
    const all = slidesOf(cur).map(plainSlide);
    if (from === to || from < 0 || to < 0 || from >= all.length || to >= all.length) return;
    const [m] = all.splice(from, 1); all.splice(to, 0, m);
    Object.assign(cur, all[0]); cur.pages = all.slice(1);
    pg = to; sl = pg ? cur.pages[pg - 1] : cur;
    editor.deselect();
    changed(true); renderStrip();
  }
  function pageMenu(anchor, i) {
    const n = slidesOf(cur).length;
    menu(anchor, [
      { label: 'Duplicate slide', icon: 'dup', onclick: () => { goPage(i); addPage(plainSlide(sl)); } },
      { label: 'New slide after this', icon: 'plus', onclick: () => { goPage(i); newPageMenu(anchor); } },
      { label: 'Move earlier', icon: 'up', disabled: i === 0, onclick: () => movePage(i, i - 1) },
      { label: 'Move later', icon: 'down', disabled: i >= n - 1, onclick: () => movePage(i, i + 1) },
      '-',
      { label: 'Delete slide', icon: 'trash', disabled: n < 2, onclick: () => deletePage(i) },
    ]);
  }

  const schedule = debounce(refreshPreview, 120);
  function changed(rerender) {
    updateSaveBtn();
    saveDraft();
    hist.mark(true);
    if (rerender) renderEditor();
    schedule();
    stripThumbSoon();
  }
  function updateSaveBtn() {
    const clean = savedSig && savedSig === sig(cur) && cur.id && lib.some((b) => b.id === cur.id);
    saveBtn.disabled = !!clean;
    saveBtn.lastChild.textContent = clean ? 'Saved' : 'Save';
  }

  async function setNext() {
    const frs = await framesOf(cur);
    ctx.setStaged('ai', bannerCue(cur, frs, pg));
    toast(frs.length > 1 ? 'Banner is Next, from slide ' + (pg + 1) + ' of ' + frs.length + '. Press Present (F5); the arrow keys move through the slides.' : 'Banner is Next. Press Present (F5) to show it.', 'ok', 3000);
  }
  async function saveCurrent(announce) {
    try {
      const now = Date.now();
      if (!cur.id) { cur.id = 'b-' + uid(); cur.created = now; }
      cur.updated = now;
      if (!cur.name) cur.name = nameOf(cur);
      nameInp.value = cur.name;
      if (cur.group && !groups.some((g) => g.id === cur.group)) delete cur.group;
      const copy = clone(cur);
      // Give this banner its own picture copy so later edits don't change saved ones.
      if (copy.s && copy.s.img) {
        const srcId = copy.s.img;
        const shared = lib.some((b) => b.id !== copy.id && b.s && b.s.img === srcId);
        if (shared) {
          try {
            const rec = await db.get('files', srcId).catch(() => null);
            if (rec && rec.blob) {
              const newId = await storePicture(rec.blob, (rec.name || 'Picture') + ' (copy)');
              copy.s.img = newId;
            }
          } catch (e) { /* keep shared if copy fails */ }
        }
      }
      const i = lib.findIndex((b) => b.id === copy.id);
      if (i >= 0) lib[i] = copy; else lib.unshift(copy);
      savedSig = sig(cur);
      await saveLib();
      saveDraft(); updateSaveBtn(); renderViewSeg();
      if (announce) toast('Saved.', 'ok', 2000);
      return copy;
    } catch (e) {
      toast('Could not save banner: ' + (e.message || e), 'err', 5000);
      console.error(e);
      return null;
    }
  }
  async function addCurToPlan() {
    const b = await saveCurrent(false);
    if (!b) return;
    (await ctx.tab('plan')).addItem({ tab: 'ai', banner: b.id, label: 'Banner: ' + nameOf(b) });
  }
  async function addCurToLoop() {
    if (!cur.id) { const b = await saveCurrent(false); if (!b) return; }
    const L = loopKind === 'ann' ? announce : loop;
    const saveL = loopKind === 'ann' ? saveAnnounce : saveLoop;
    const name = loopKind === 'ann' ? 'Announcements' : 'Preservice';
    if (!L.items.some((it) => it.t === 'banner' && it.id === cur.id)) { L.items.push({ t: 'banner', id: cur.id }); saveL(); }
    toast('Added to ' + name + ' (' + L.items.length + ' item' + (L.items.length === 1 ? '' : 's') + ').', 'ok');
  }
  function startNew(tpl) {
    // Always a fresh banner so editing it cannot change a saved one.
    setDoc(newBanner(tpl || 'welcome'));
    cur.id = null;
    if (libFilter && libFilter !== '-' && groups.some((g) => g.id === libFilter)) { cur.group = libFilter; renderGroupSel(); }
    savedSig = null;
    nameInp.value = '';
    changed(true);
    if (sl.tpl === 'verse') fetchVerse();
  }
  function edit(b) {
    setDoc(clone(b)); savedSig = sig(cur);
    nameInp.value = cur.name || '';
    setView('make');
    changed(true);
  }

  // ------------------------------------------------------------ editor
  let trList = [];
  function renderEditor() {
    clear(editorScroll);
    const c = church();
    if (!c.name) {
      editorScroll.appendChild(h('div.card.bn-church', h('div.row.wrap',
        icon('pin'), h('div.grow', h('b', 'Add your church’s name once'), h('div.note', 'Banners fill it in, with the date, sunset time and giving QR code.')),
        h('button.btn.sm.primary', { type: 'button', onclick: () => churchDialog() }, 'Church details'))));
    }
    const nSlides = slidesOf(cur).length;
    if (nSlides > 1) editorScroll.appendChild(h('div.row.bn-slide-no', h('b', 'Slide ' + (pg + 1) + ' of ' + nSlides), h('span.note', 'Each slide has its own kind, text and look.')));
    // Insert: the same as the toolbar, for people who look here first.
    editorScroll.append(h('h3.bn-h', 'Insert'), h('div.row.wrap.bn-insert',
      h('button.btn.sm', { type: 'button', onclick: () => editor.insertText() }, icon('textbox'), h('span', 'Text box')),
      h('button.btn.sm', { type: 'button', onclick: () => editor.insertImage() }, icon('image'), h('span', 'Picture')),
      h('button.btn.sm', { type: 'button', onclick: () => editor.insertShape('round') }, icon('shape'), h('span', 'Shape')),
      h('button.btn.sm', { type: 'button', onclick: () => editor.insertLine('arrow') }, icon('arrow'), h('span', 'Arrow')),
      h('button.btn.sm', { type: 'button', onclick: (ev) => newPageMenu(ev.currentTarget) }, icon('plus'), h('span', 'New slide'))));
    // Template chips
    const tplRow = h('div.row.wrap.bn-tpls');
    Object.keys(TPL).forEach((k) => tplRow.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(sl.tpl === k), onclick: () => switchTemplate(k) }, TPL[k].name)));
    editorScroll.append(h('h3.bn-h', nSlides > 1 ? 'Kind of slide' : 'Kind of banner'), tplRow);

    // Fields
    const form = h('div.form.bn-form');
    const t = TPL[sl.tpl];
    const free = !!sl.s.free;
    if (free) {
      editorScroll.appendChild(h('div.card.bn-free', h('b', 'Text is on the slide'), h('p.note', 'This slide’s words are in text boxes now. Click one on the slide to move or format it; double-click to type. Use Insert → Text box to add more.')));
    }
    (free ? [] : t.fields).forEach((k) => {
      const F = FIELD[k];
      let label = F.label;
      if (sl.tpl === 'verse' && k === 'title') label = 'Verse text';
      if (sl.tpl === 'verse' && k === 'kicker') label = 'Top line';
      if (sl.tpl === 'countdown' && k === 'kicker') label = 'Above the clock';
      if (k === 'ref') {
        const refInp = h('input.field', { value: sl.f.ref || '', placeholder: 'e.g. Psalm 23:1 or John 3:16', 'aria-label': 'Bible reference', style: { flex: '1 1 160px', minWidth: '0' },
          oninput: () => { sl.f.ref = refInp.value; fetchVerseSoon(); } });
        const trSel = h('select.field', { 'aria-label': 'Translation', onchange: () => { sl.f.tr = trSel.value; fetchVerse(); } });
        trList.forEach((x) => trSel.appendChild(h('option', { value: x.id, selected: x.id === (sl.f.tr || settings.v.bible.primary) }, x.abbr)));
        form.append(h('label', label), h('div.row', refInp, trSel));
        return;
      }
      if (k === 'at') {
        const tm = h('input.field', { type: 'time', value: sl.f.at || c.service, 'aria-label': 'Service starts at', style: { width: '130px' },
          onchange: () => { sl.f.at = tm.value; changed(false); } });
        form.append(h('label', label), h('div.row', tm, h('span.note', 'Counts down on the screen; shows “' + (sl.f.done || 'Welcome') + '” at zero.')));
        return;
      }
      const inp = F.multi
        ? h('textarea.field.bn-ta', { rows: F.multi, placeholder: F.ph || '', 'aria-label': label })
        : h('input.field', { placeholder: F.ph || '', 'aria-label': label, style: { width: '100%' } });
      inp.value = sl.f[k] || '';
      inp.oninput = () => { sl.f[k] = inp.value; changed(false); };
      if (sl.tpl === 'verse' && k === 'title') inp.dataset.verse = '1';
      form.append(h('label', label), inp);
    });
    if (t.presets) {
      const pr = h('div.row.wrap');
      t.presets.forEach((r) => pr.appendChild(h('button.chip', { type: 'button', title: 'Use this verse as the message', onclick: () => presetVerse(r) }, r)));
      form.append(h('label', 'Verse'), pr);
    }
    editorScroll.appendChild(form);

    // Extras
    const ex = h('div.row.wrap.bn-extras');
    const hasLogo = !!(settings.v.display.logo);
    EXTRAS.forEach(([k, label, title]) => {
      let why = '';
      if (k === 'logo' && !hasLogo) why = 'Add a logo picture in Settings → Screen first.';
      if (k === 'sunset' && !hasLocation()) why = 'Add your church’s location in Church details first.';
      if (k === 'qr' && !safeGivingUrl(c.givingUrl)) why = 'Add a giving link in Church details first.';
      const on = !!sl.x[k] && !why;
      ex.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(on), title: why || title, 'aria-disabled': why ? 'true' : null,
        onclick: () => { if (why) { toast(why, '', 4000); if (k !== 'logo') churchDialog(); return; } sl.x[k] = !sl.x[k]; changed(true); } },
      on ? icon('check') : null, label));
    });
    editorScroll.append(h('h3.bn-h', 'Also show'), ex);

    // Look
    const sw = h('div.row.wrap.bn-swatches');
    Object.keys(PALETTES).forEach((k) => {
      const p = PALETTES[k];
      sw.appendChild(h('button.swatch', { type: 'button', title: p.name, 'aria-label': 'Colours: ' + p.name, 'aria-pressed': String((sl.s.pal || 'navy') === k),
        style: { background: 'linear-gradient(135deg,' + p.bg[0] + ',' + p.bg[1] + ')', color: p.accent }, onclick: () => { sl.s.pal = k; changed(true); } }, 'Aa'));
    });
    const decoSeg = seg(Object.keys(DECOS).map((k) => [k, DECOS[k]]), sl.s.deco || 'none', (v) => { sl.s.deco = v; changed(false); });
    const posSeg = seg(POS, sl.s.pos || 'center', (v) => { sl.s.pos = v; changed(false); });
    const fontSeg = seg([['sans', 'Clear sans'], ['serif', 'Serif']], sl.s.font || 'sans', (v) => { sl.s.font = v; changed(false); });
    const boldBtn = h('button.chip', { type: 'button', 'aria-pressed': String(!!sl.s.textBold), title: 'Bold title', onclick: () => { sl.s.textBold = !sl.s.textBold; changed(false); } }, 'B');
    const italicBtn = h('button.chip', { type: 'button', 'aria-pressed': String(!!sl.s.textItalic), title: 'Italic title', onclick: () => { sl.s.textItalic = !sl.s.textItalic; changed(false); } }, 'I');
    const sizeOut = h('span.note', (sl.s.textSize || 100) + '%');
    const sizeR = h('input', { type: 'range', min: 60, max: 160, step: 5, 'aria-label': 'Text size', style: { flex: '1', maxWidth: '180px' },
      oninput: () => { sl.s.textSize = +sizeR.value; sizeOut.textContent = sl.s.textSize + '%'; changed(false); } });
    sizeR.value = sl.s.textSize || 100;
    const spaceOut = h('span.note', (sl.s.textSpacing || 1.24).toFixed(2));
    const spaceR = h('input', { type: 'range', min: 1.0, max: 1.8, step: 0.04, 'aria-label': 'Line spacing', style: { flex: '1', maxWidth: '180px' },
      oninput: () => { sl.s.textSpacing = +spaceR.value; spaceOut.textContent = sl.s.textSpacing.toFixed(2); changed(false); } });
    spaceR.value = sl.s.textSpacing || 1.24;
    // Background and text colours of your own (beyond the ready-made colour sets).
    const colBtn = (label, val, onPick, none) => { const b = h('button.btn.sm.se-cb', { type: 'button', onclick: () => colorPop(b, val, onPick, { none: !!none, noneLabel: 'Use the colour set' }) }, h('span.se-sw', { style: { background: val || 'transparent' } }), label); return b; };
    const bgKind = !sl.s.bgc ? 'set' : sl.s.bgc2 ? 'grad' : 'solid';
    const bgRow = h('div.col', { style: { gap: '8px' } },
      seg([['set', 'Colour set'], ['solid', 'One colour'], ['grad', 'Gradient']], bgKind, (v) => {
        if (v === 'set') { delete sl.s.bgc; delete sl.s.bgc2; }
        else { sl.s.bgc = sl.s.bgc || PALETTES[sl.s.pal || 'navy'].bg[0]; if (v === 'grad') sl.s.bgc2 = sl.s.bgc2 || PALETTES[sl.s.pal || 'navy'].bg[1]; else delete sl.s.bgc2; }
        changed(true);
      }),
      bgKind !== 'set' ? h('div.row.wrap',
        colBtn(bgKind === 'grad' ? 'From' : 'Colour', sl.s.bgc, (c) => { if (c) sl.s.bgc = c; changed(true); }),
        bgKind === 'grad' ? colBtn('To', sl.s.bgc2, (c) => { if (c) sl.s.bgc2 = c; changed(true); }) : null,
        bgKind === 'grad' ? (() => { const r = h('input', { type: 'range', min: 0, max: 360, step: 5, 'aria-label': 'Gradient angle', style: { maxWidth: '140px' }, oninput: () => { sl.s.bga = +r.value; changed(false); } }); r.value = sl.s.bga == null ? 135 : sl.s.bga; return h('label.row', h('span.note', 'Angle'), r); })() : null) : null,
      sl.s.img ? h('p.note', 'A picture is chosen, so it shows instead of the background colour.') : null);
    const txtCols = h('div.row.wrap',
      colBtn('Text', sl.s.fgc || PALETTES[sl.s.pal || 'navy'].fg, (c) => { if (c) sl.s.fgc = c; else delete sl.s.fgc; changed(true); }, true),
      colBtn('Accent (top & bottom lines)', sl.s.acc || PALETTES[sl.s.pal || 'navy'].accent, (c) => { if (c) sl.s.acc = c; else delete sl.s.acc; changed(true); }, true));
    const look = h('div.form.bn-form',
      h('label', 'Colours'), sw,
      h('label', 'Background'), bgRow,
      h('label', 'Pattern'), decoSeg,
      h('label', 'Picture'), pictureRow(),
      sl.s.img ? h('label', 'Picture settings') : null, sl.s.img ? pictureSettings() : null,
      sl.s.img ? h('label', 'Darken picture') : null, sl.s.img ? dimRow() : null,
      free ? null : h('label', 'Text colours'), free ? null : txtCols,
      free ? null : h('label', 'Text position'), free ? null : posSeg,
      free ? null : h('label', 'Font'), free ? null : fontSeg,
      free ? null : h('label', 'Style'), free ? null : h('div.row', boldBtn, italicBtn),
      free ? null : h('label', 'Text size'), free ? null : h('div.row', sizeR, sizeOut),
      free ? null : h('label', 'Line spacing'), free ? null : h('div.row', spaceR, spaceOut));
    editorScroll.append(h('h3.bn-h', 'Look'), look);
    if (sl.s.img) decoSeg.querySelectorAll('button').forEach((b) => { b.disabled = true; b.title = 'Patterns are for plain colours (a picture is chosen)'; });
  }

  function switchTemplate(k) {
    if (k === sl.tpl) return;
    const keep = { id: null, name: '', s: Object.assign({}, sl.s) };
    const nb = newBanner(k);
    // Keep a chosen picture; take the new kind's colours only when no picture is used.
    if (keep.s.img) { nb.s.img = keep.s.img; nb.s.dim = keep.s.dim; }
    ['bgc', 'bgc2', 'bga'].forEach((x) => { if (keep.s[x] != null) nb.s[x] = keep.s[x]; });
    nb.els = sl.els || [];
    editor.deselect();
    if (!cur.pages.length && !nb.els.length) {
      // A one-slide banner: another kind starts a new banner, so a saved one is never overwritten by accident.
      setDoc(Object.assign(newBanner(k), { s: nb.s }), true); cur.id = null; cur.name = ''; savedSig = null; nameInp.value = '';
      hist.mark(false);
    } else replaceSlide(nb);
    changed(true);
    if (k === 'verse') fetchVerse();
  }

  // Verse text from the installed Bible (any translation, Afrikaans and Xhosa too).
  let verseSeq = 0;
  async function versesText(ref, tr) {
    const r = parseRef(ref);
    if (!r || !/\d/.test(ref)) return null;
    const info = await getInfo(tr || settings.v.bible.primary);
    if (!info.books[r.book - 1] || !info.books[r.book - 1][1]) return null;
    const vs = await versesFor(info.id, r.book, r.segs);
    if (!vs.length) return null;
    return { text: vs.slice(0, 12).map((v) => verseText(v.text)).join(' ').replace(/^(A Psalm[^.]*\.|To the chief Musician[^.]*\.|[A-Z]{2,}\.)\s*/, ''),
      label: refText(info.names, r.book, r.segs) + ' (' + info.abbr + ')', many: vs.length > 12 };
  }
  async function fetchVerse() {
    const my = ++verseSeq;
    const v = await versesText(sl.f.ref || '', sl.f.tr).catch(() => null);
    if (my !== verseSeq) return;
    if (!v) { changed(false); return; }
    sl.f.title = v.text; sl.f.refLabel = v.label;
    const ta = editorScroll.querySelector('textarea[data-verse]');
    if (ta) ta.value = v.text;
    if (v.many) toast('Long passage: only the first 12 verses fit on one banner.', '', 3500);
    changed(false);
  }
  const fetchVerseSoon = debounce(fetchVerse, 350);
  async function presetVerse(ref) {
    const v = await versesText(ref, settings.v.bible.primary).catch(() => null);
    if (!v) { toast('That verse is not in the installed Bible.', 'err'); return; }
    sl.f.text = '“' + v.text + '”\n' + v.label.replace(/ \([^)]*\)$/, '');
    changed(true);
  }

  // Pictures: the church's own photos (kept offline), or one made by online AI.
  function pictureRow() {
    const row = h('div.col.bn-pics');
    const inp = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const f = inp.files[0]; inp.value = '';
      if (!f) return;
      try { await usePicture(await storePicture(f, f.name)); } catch (e) { toast('Could not use that picture: ' + e.message, 'err'); }
    } });
    const aiDesc = h('input.field', { placeholder: 'Describe a picture (optional), e.g. mountains at sunrise', 'aria-label': 'Describe the AI picture', style: { flex: '1 1 200px', minWidth: '0' } });
    // Maker 1: a background only. The banner words stay sharp (drawn live by the app) on top of it.
    const aiBtn = h('button.btn.sm', { type: 'button', title: 'Make a background picture with online AI (no text in it, the banner words stay sharp on top)', onclick: async () => {
      aiBtn.disabled = true; const lbl = aiBtn.lastChild.textContent; aiBtn.lastChild.textContent = 'Making picture…';
      try {
        const desc = aiDesc.value.trim();
        const prompt = (desc || TPL[sl.tpl].mood) + '. A wide 16:9 background photograph for a church projector screen. Calm, reverent and uplifting, soft natural light, ' +
          'simple composition with plenty of open space for text. Absolutely no text, letters, words, numbers, logos, signs or watermarks.';
        const flags = ai.flaggedWords(desc);
        if (flags.length) { toast('Please describe a picture suitable for church.', 'err'); return; }
        const blob = await ai.aiImage(prompt);
        await usePicture(await storePicture(blob, 'AI picture ' + new Date().toLocaleDateString()));
        toast('AI picture added. It is saved on this device and works offline from now on.', 'ok', 4000);
      } catch (e) { toast(ai.friendlyAiError(e), 'err', 8000); }
      finally { aiBtn.disabled = false; aiBtn.lastChild.textContent = lbl; }
    } }, icon('sparkle'), h('span', 'Make background'));
    // Maker 2: a full finished banner picture with all the words in it, built around the church's own pictures.
    const fullBtn = h('button.btn.sm', { type: 'button', title: 'Make one finished banner picture with all your words and your own pictures built in', onclick: () => fullBannerDialog() },
      icon('sparkle'), h('span', 'Make full banner…'));
    const gallery = h('div.bn-gallery');
    row.append(h('div.row.wrap',
      h('button.btn.sm', { type: 'button', onclick: () => inp.click() }, icon('upload'), h('span', 'Choose picture…')),
      sl.s.img ? h('button.btn.sm', { type: 'button', title: 'Remove the picture from this banner only', onclick: () => { sl.s.img = null; changed(true); } }, icon('x'), h('span', 'No picture')) : null,
      inp), gallery);
    if (ai.hasKey() && ai.canImage()) {
      row.append(h('div.card.bn-aimakers',
        h('h4', icon('sparkle'), ' Two online AI picture makers'),
        h('div.bn-maker', h('b', '1. Background'), h('p.note', 'A picture with no words. Your banner words are drawn sharp on top by the app.'), h('div.row.wrap', aiDesc, aiBtn)),
        h('div.bn-maker', h('b', '2. Full banner'), h('p.note', 'One finished picture with all your words in it, built around pictures you attach. Check the spelling.'), h('div.row.wrap', fullBtn))));
    } else row.append(h('p.note', 'Two online AI picture makers (background, and full banner with your words and pictures): add a key in Settings → AI (OpenAI, Gemini, Grok, Together or OpenRouter).'));
    fillGallery(gallery);
    return row;
  }
  /** The full-banner maker: opens a dialog pre-filled from the banner being edited. */
  async function fullBannerDialog() {
    const c = church();
    const fr = await frameOf(cur).catch(() => null) || {};
    const f = sl.f || {};
    let heading = (fr.title || '').trim();
    if (sl.tpl === 'countdown') heading = ((f.kicker || 'Our service starts at') + ' ' + (f.at || c.service || '')).trim();
    const kicker = (fr.kicker || '').trim();
    openFullBanner({
      fields: { church: c.name || '', heading, message: fr.text || '', foot: fr.foot || '', extra: kicker && kicker !== c.name && sl.tpl !== 'countdown' ? 'Small top line: "' + kicker + '"' : '', style: TPL[sl.tpl].mood },
      files: async () => (await db.all('files').catch(() => [])).filter((x) => x.kind === 'banner-bg').sort((a, b) => (b.added || 0) - (a.added || 0)),
      logo: () => logoBlob(),
      storePicture: (blob, name) => storePicture(blob, name, {}),
      onUse: (id) => {
        const keepQr = !!(sl.x && sl.x.qr);
        setDoc(newBanner('picture'));
        sl.s.img = id; sl.s.dim = 0; sl.x = { qr: keepQr }; cur.name = 'AI banner';
        savedSig = null; nameInp.value = cur.name;
        changed(true);
        toast('Full AI banner is ready. Set as Next, or Save it.', 'ok', 4000);
      },
    });
  }
  async function fillGallery(gallery) {
    const files = (await db.all('files').catch(() => [])).filter((f) => f.kind === 'banner-bg').sort((a, b) => (b.added || 0) - (a.added || 0));
    clear(gallery);
    files.forEach((f) => {
      const u = URL.createObjectURL(f.thumb || f.blob);
      const pick = h('button.bn-pic', { type: 'button', title: 'Use ' + (f.name || 'this picture'), 'aria-pressed': String(sl.s.img === f.id),
        onclick: () => usePicture(f.id) }, h('img', { src: u, alt: f.name || 'Picture', onload: () => setTimeout(() => URL.revokeObjectURL(u), 1000) }));
      const del = h('button.bn-pic-x', { type: 'button', title: 'Delete this picture from this device', 'aria-label': 'Delete picture ' + (f.name || ''),
        onclick: async () => {
          const usesPic = (b) => slidesOf(b).some((x) => (x.s && x.s.img === f.id) || (x.els || []).some((e) => e.src === f.id));
          const used = lib.filter(usesPic);
          if (used.length && !(await confirmBox('Delete picture?', 'It is used by ' + used.length + ' saved banner' + (used.length === 1 ? '' : 's') + '. Those banners will keep their own copy.', 'Delete', true))) return;
          // Give each saved banner that uses it its own copy before deleting.
          for (const b of used) {
            try {
              const rec = await db.get('files', f.id).catch(() => null);
              if (rec && rec.blob) {
                const newId = await storePicture(rec.blob, (rec.name || 'Picture') + ' (kept)');
                slidesOf(b).forEach((x) => { if (x.s && x.s.img === f.id) x.s.img = newId; (x.els || []).forEach((e) => { if (e.src === f.id) e.src = newId; }); });
              }
            } catch (e) { /* keep the id if copy fails */ }
          }
          if (used.length) await saveLib();
          await db.del('files', f.id); blobCache.delete(f.id);
          slidesOf(cur).forEach((x) => { if (x.s && x.s.img === f.id) x.s.img = null; (x.els || []).forEach((e) => { if (e.src === f.id) e.src = ''; }); });
          changed(true);
          fillGallery(gallery);
        } }, icon('x'));
      gallery.appendChild(h('div.bn-pic-wrap', pick, del));
    });
  }
  async function usePicture(id) {
    const rec = await db.get('files', id).catch(() => null);
    sl.s.img = id;
    sl.s.dim = autoDim(rec && rec.meta && rec.meta.lum);
    changed(true);
  }
  function dimRow() {
    const out = h('span.note', Math.round((sl.s.dim == null ? 0.45 : sl.s.dim) * 100) + '%');
    const r = h('input', { type: 'range', min: 0, max: 0.85, step: 0.05, 'aria-label': 'Darken picture', style: { flex: '1', maxWidth: '240px' },
      oninput: () => { sl.s.dim = +r.value; out.textContent = Math.round(sl.s.dim * 100) + '%'; changed(false); } });
    r.value = sl.s.dim == null ? 0.45 : sl.s.dim;
    return h('div.row', r, out);
  }

  function pictureSettings() {
    if (!sl.s.img) return null;
    const fitSeg = seg([['cover', 'Fill'], ['contain', 'Fit'], ['crop', 'Crop']], sl.s.imgFit || 'cover', (v) => { sl.s.imgFit = v; changed(false); });
    const posSeg = seg([['center', 'Centre'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']], sl.s.imgPos || 'center', (v) => { sl.s.imgPos = v; changed(false); });
    const zoomOut = h('span.note', (sl.s.imgZoom || 100) + '%');
    const zoom = h('input', { type: 'range', min: 80, max: 200, step: 5, 'aria-label': 'Zoom picture', style: { flex: '1', maxWidth: '200px' },
      oninput: () => { sl.s.imgZoom = +zoom.value; zoomOut.textContent = sl.s.imgZoom + '%'; if ((sl.s.imgFit || 'cover') === 'crop') changed(false); } });
    zoom.value = sl.s.imgZoom || 100;
    return h('div.col', { style: { gap: '8px' } },
      h('div.row.wrap', h('span.note', 'How the picture sits'), fitSeg),
      h('div.row.wrap', h('span.note', 'Position'), posSeg),
      h('div.row', h('span.note', 'Zoom'), zoom, zoomOut),
      h('p.note', 'Fill covers the banner. Fit shows the whole picture. Crop + zoom lets you focus on part of it. Darken keeps the words readable.'));
  }

  // ============================================================ SAVED (library)
  let minis = [];
  const destroyMinis = () => { minis.forEach((s) => s.destroy()); minis = []; };
  function mini(frameP) {
    const hostM = h('div.stage-host');
    const box = h('div.bn-thumb', hostM);
    box.style.aspectRatio = String(link.aspect ? link.aspect() : 16 / 9);
    requestAnimationFrame(async () => {
      const st = createStage(hostM, { placeholderOnly: true, aspect: link.aspect ? link.aspect() : 16 / 9 });
      minis.push(st);
      if (live.style) st.applyStyle(live.style);
      try { st.show(await frameP); } catch (e) { /* */ }
    });
    return box;
  }
  /** Every word on every slide of a banner, for searching the Saved list. */
  function bannerWords(b) {
    const parts = [nameOf(b)];
    slidesOf(b).forEach((x) => {
      parts.push((TPL[x.tpl] || TPL.blank).name);
      Object.values(x.f || {}).forEach((v) => { if (typeof v === 'string') parts.push(v); });
      (x.els || []).forEach((e) => { if (e.html) parts.push(htmlText(e.html)); });
    });
    const g = b.group && groups.find((x) => x.id === b.group);
    if (g) parts.push(g.name);
    return normalize(parts.join(' ')).toLowerCase();
  }
  /** Put a saved banner in a group ('' = none); the banner open in the editor follows. */
  async function setGroup(b, gid) {
    if (gid) b.group = gid; else delete b.group;
    b.updated = Date.now();
    if (cur.id === b.id) { if (gid) cur.group = gid; else delete cur.group; savedSig = sig(cur); saveDraft(); }
    await saveLib(); renderLibrary(); renderGroupSel();
  }
  async function newGroup(name) {
    const n = name != null ? name : await promptBox('New group', 'Name, e.g. Youth, Announcements, Christmas', '');
    if (!n || !n.trim()) return null;
    const ex = groups.find((g) => g.name.toLowerCase() === n.trim().toLowerCase());
    if (ex) return ex;
    const g = { id: 'g-' + uid(), name: n.trim().slice(0, 60) };
    groups.push(g); await saveGroups(); renderGroupSel();
    return g;
  }
  function addToLoopList(L, saveL, b, label) {
    if (!L.items.some((it) => it.t === 'banner' && it.id === b.id)) { L.items.push({ t: 'banner', id: b.id }); saveL(); toast('Added to ' + label + '.', 'ok'); }
    else toast('Already in ' + label + '.', '', 2500);
  }
  function renderLibrary() {
    destroyMinis();
    const box = views.library;
    clear(box);
    if (libFilter && libFilter !== '-' && !groups.some((g) => g.id === libFilter)) libFilter = '';
    // Toolbar: search, group filter, groups
    const qIn = h('input.field.sm', { type: 'search', placeholder: 'Search banners and their words…', value: libQuery, 'aria-label': 'Search banners',
      oninput: (e) => { libQuery = e.target.value; renderLibrary(); const n = views.library.querySelector('input[type=search]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } } });
    const count = (gid) => lib.filter((b) => (gid === '-' ? !b.group || !groups.some((g) => g.id === b.group) : b.group === gid)).length;
    const gSel = h('select.field.sm', { 'aria-label': 'Group', onchange: (e) => { libFilter = e.target.value; renderLibrary(); } },
      h('option', { value: '' }, 'All groups (' + lib.length + ')'));
    groups.forEach((g) => gSel.appendChild(h('option', { value: g.id }, g.name + ' (' + count(g.id) + ')')));
    if (groups.length) gSel.appendChild(h('option', { value: '-' }, 'Not in a group (' + count('-') + ')'));
    gSel.value = libFilter;
    const newGrp = h('button.btn.sm', { type: 'button', title: 'Create a group', onclick: async () => { const g = await newGroup(); if (g) { libFilter = g.id; renderLibrary(); } } }, icon('plus'), h('span', 'New group'));
    const g = libFilter && libFilter !== '-' ? groups.find((x) => x.id === libFilter) : null;
    const renGrp = g ? h('button.btn.sm', { type: 'button', title: 'Rename this group', onclick: async () => {
      const n = await promptBox('Rename group', 'Name', g.name);
      if (!n || !n.trim()) return;
      g.name = n.trim().slice(0, 60); await saveGroups(); renderLibrary(); renderGroupSel();
    } }, icon('edit'), h('span', 'Rename group')) : null;
    const delGrp = g ? h('button.btn.sm', { type: 'button', title: 'Remove this group', onclick: async () => {
      if (!(await confirmBox('Remove group?', 'Remove “' + g.name + '”? The ' + count(g.id) + ' banner' + (count(g.id) === 1 ? '' : 's') + ' in it stay, just without a group.', 'Remove'))) return;
      groups = groups.filter((x) => x.id !== g.id);
      lib.forEach((b) => { if (b.group === g.id) delete b.group; });
      if (cur.group === g.id) { delete cur.group; savedSig = sig(cur); }
      libFilter = '';
      await saveGroups(); await saveLib(); renderLibrary(); renderGroupSel();
    } }, icon('trash'), h('span', 'Remove group')) : null;
    box.appendChild(h('div.row.wrap.bn-lib-bar', qIn, gSel, newGrp, renGrp, delGrp));
    // Filter
    const q = normalize(libQuery.trim()).toLowerCase();
    const inGroup = (b) => !libFilter || (libFilter === '-' ? !b.group || !groups.some((x) => x.id === b.group) : b.group === libFilter);
    const shown = lib.filter((b) => inGroup(b) && (!q || q.split(/\s+/).every((w) => bannerWords(b).includes(w))));
    if (!shown.length) {
      box.appendChild(emptyState('banner', lib.length ? 'No banners match' : 'No saved banners yet',
        lib.length ? (g && !libQuery ? 'This group is empty. Use ••• → Move to group on a banner, or choose this group when you save one.' : 'Try another group or clear the search.') : 'Make a banner and press Save.',
        { label: 'Make a banner', icon: 'plus', primary: true, onclick: () => setView('make') }));
      return;
    }
    const grid = h('div.bn-lib');
    shown.forEach((b) => {
      const n = slidesOf(b).length;
      const more = btn('more', 'More', () => menu(more, [
        { label: 'Add to Preservice loop', icon: 'loop', onclick: () => addToLoopList(loop, saveLoop, b, 'Preservice') },
        { label: 'Add to Announcements loop', icon: 'loop', onclick: () => addToLoopList(announce, saveAnnounce, b, 'Announcements') },
        { label: 'Add to the service plan', icon: 'plan', onclick: async () => (await ctx.tab('plan')).addItem({ tab: 'ai', banner: b.id, label: 'Banner: ' + nameOf(b) }) },
        { label: 'Move to group…', icon: 'folder', onclick: () => {
          menu(more, [
            { label: '(No group)', icon: b.group ? '' : 'check', onclick: () => setGroup(b, '') },
            ...groups.map((gr) => ({ label: gr.name, icon: b.group === gr.id ? 'check' : '', onclick: () => setGroup(b, gr.id) })),
            '-',
            { label: 'New group…', icon: 'plus', onclick: async () => { const gr = await newGroup(); if (gr) setGroup(b, gr.id); } },
          ]);
        } },
        { label: 'Rename…', icon: 'edit', onclick: async () => { const nm = await promptBox('Rename banner', 'Name', b.name || nameOf(b)); if (nm && nm.trim()) { b.name = nm.trim(); b.updated = Date.now(); if (cur.id === b.id) { cur.name = b.name; nameInp.value = b.name; savedSig = sig(cur); } await saveLib(); renderLibrary(); } } },
        { label: 'Duplicate', icon: 'copy', onclick: async () => { const c = clone(b); c.id = 'b-' + uid(); c.name = nameOf(b) + ' (copy)'; c.created = c.updated = Date.now(); lib.unshift(c); await saveLib(); renderLibrary(); renderViewSeg(); toast('Copied, in the same group.', 'ok', 2000); } },
        '-',
        { label: 'Delete', icon: 'trash', onclick: async () => {
          const inLoops = [loop, announce].some((L) => L.items.some((it) => it.t === 'banner' && it.id === b.id) || L.end === b.id);
          if (!(await confirmBox('Delete banner?', 'Delete “' + nameOf(b) + '”' + (n > 1 ? ' and its ' + n + ' slides' : '') + '?' + (inLoops ? ' It is also taken out of the Service loop.' : ''), 'Delete', true))) return;
          lib = lib.filter((x) => x.id !== b.id);
          [loop, announce].forEach((L) => { L.items = L.items.filter((it) => !(it.t === 'banner' && it.id === b.id)); if (L.end === b.id) L.end = ''; });
          if (cur.id === b.id) { cur.id = null; savedSig = null; }
          await saveLib(); await saveLoop(); await saveAnnounce(); renderLibrary(); renderViewSeg(); updateSaveBtn();
        } },
      ]), { cls: 'sm' });
      const gName = b.group ? (groups.find((x) => x.id === b.group) || {}).name : '';
      const thumb = mini(frameOf(b, new Date(), { noAnim: true }));
      thumb.classList.add('bn-thumb-open');
      thumb.title = 'Edit this banner';
      thumb.addEventListener('click', () => edit(b));
      if (n > 1) thumb.appendChild(h('span.bn-thumb-n', icon('slides'), String(n)));
      const card = h('div.bn-card',
        thumb,
        h('div.bn-card-b',
          h('div.bn-card-t.trunc', { title: nameOf(b) }, nameOf(b)),
          h('div.note', TPL[b.tpl] ? TPL[b.tpl].name : 'Banner', n > 1 ? ' · ' + n + ' slides' : '', b.updated ? ' · ' + new Date(b.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''),
          gName ? h('div.bn-card-g', h('button.chip.sm', { type: 'button', title: 'Show this group', onclick: () => { libFilter = b.group; renderLibrary(); } }, icon('folder'), gName)) : null,
          h('div.row.bn-card-a',
            h('button.btn.sm.primary', { type: 'button', title: n > 1 ? 'Put all ' + n + ' slides on the Next screen' : 'Put on the Next screen', onclick: async () => { ctx.setStaged('ai', bannerCue(b, await framesOf(b))); toast('“' + nameOf(b) + '” is Next. Press Present (F5).', 'ok', 2500); } }, icon('next'), h('span', 'Set as Next')),
            h('button.btn.sm.icon', { type: 'button', title: 'Edit', 'aria-label': 'Edit ' + nameOf(b), onclick: () => edit(b) }, icon('edit')),
            more)));
      grid.appendChild(card);
    });
    box.appendChild(grid);
  }

  // ============================================================ PRE-SERVICE LOOP
  async function decks() { return (await db.all('files').catch(() => [])).filter((f) => f.kind === 'deck' && f.type !== 'web'); }
  async function deckFrames(d) {
    if (d.type === 'pptx') { const rec = await db.get('renders', d.id + '/frames').catch(() => null); return rec ? rec.frames.map((f) => Object.assign({}, f)) : []; }
    const out = [];
    for (let i = 0; i < (d.count || 0); i++) {
      const r = await db.get('renders', d.id + '/' + i).catch(() => null);
      if (r && r.full) out.push({ kind: 'image', src: r.full, fit: settings.v.slides.fit || 'contain' });
    }
    return out;
  }
  async function loopCue(kind = 'pre') {
    const L = kind === 'ann' ? announce : loop;
    const frames = [], labels = [];
    const dl = await decks();
    for (const it of L.items) {
      if (it.t === 'banner') {
        const b = lib.find((x) => x.id === it.id); if (!b) continue;
        const bf = await framesOf(b);
        bf.forEach((f, i) => { frames.push(f); labels.push(short(nameOf(b), 16) + (bf.length > 1 ? ' ' + (i + 1) : '')); });
      } else if (it.t === 'deck') {
        const d = dl.find((x) => x.id === it.id); if (!d) continue;
        const fs = await deckFrames(d);
        fs.forEach((f, i) => { frames.push(f); labels.push(short(d.name, 12) + ' ' + (i + 1)); });
      }
    }
    if (!frames.length) return null;
    const len = frames.length;
    const secs = +L.secs || 8;
    let at = null, end = null;
    if (L.count) { const t = nextTime(L.at || church().service); at = t ? t.getTime() : null; }
    if (at) frames.forEach((f) => { if (!(f.kind === 'banner' && f.countdown)) f.clock = { at, label: 'Service starts in' }; });
    if (at && L.end) {
      const b = lib.find((x) => x.id === L.end);
      if (b) { frames.push(await frameOf(b)); labels.push('At start: ' + short(nameOf(b), 14)); end = frames.length - 1; }
    }
    const title = kind === 'ann' ? 'Announcements' : 'Preservice';
    return { id: (kind === 'ann' ? 'ann:' : 'loop:') + Date.now(), tab: 'ai', title, sub: len + ' slide' + (len === 1 ? '' : 's') + ' · every ' + secs + ' s',
      deck: { kind: 'loop', frames, auto: { secs, len, at, end } }, index: 0, labels, autoLoop: true, isLoop: true, withMusic: kind !== 'ann',
      plan: { tab: 'ai', loop: true, label: title } };
  }
  async function renderLoop() {
    destroyMinis();
    const box = views.loop;
    clear(box);
    const dl = await decks();
    const c = church();
    const kind = loopKind;
    const L = kind === 'ann' ? announce : loop;
    const saveL = kind === 'ann' ? saveAnnounce : saveLoop;
    const title = kind === 'ann' ? 'Announcements' : 'Preservice';

    box.appendChild(h('h3', { style: { margin: '0 0 8px' } }, 'Service loop'));
    const sub = h('div.seg', { role: 'group', 'aria-label': 'Service loop kind', style: { marginBottom: '10px' } });
    [['pre', 'Preservice'], ['ann', 'Announcements']].forEach(([k, lab]) => {
      sub.appendChild(h('button', { type: 'button', 'aria-pressed': String(k === kind),
        onclick: () => { loopKind = k; renderLoop(); } }, lab));
    });
    box.appendChild(sub);

    box.appendChild(h('p.note.bn-intro', kind === 'ann'
      ? 'Announcement slides and banners take turns on the screen. No music. It runs on the display itself, so it keeps going if this phone or PC sleeps.'
      : 'Plays before the service: your banners and announcement slides take turns on the screen, with music. It runs on the display itself, so it keeps going if this phone or PC sleeps.'));
    if (kind !== 'ann') box.appendChild(h('div.row', { style: { marginBottom: '10px' } }, musicChip(ctx, () => setView('music'))));

    const list = h('div.list.bn-loop-list');
    if (!L.items.length) list.appendChild(h('p.note.pad', 'Empty. Add saved banners or slide decks below.'));
    L.items.forEach((it, i) => {
      let name = '', kindT = '', thumb;
      if (it.t === 'banner') { const b = lib.find((x) => x.id === it.id); name = b ? nameOf(b) : '(deleted banner)'; kindT = 'Banner'; thumb = b ? mini(frameOf(b)) : h('div.bn-thumb'); }
      else { const d = dl.find((x) => x.id === it.id); name = d ? d.name : '(deleted slides)'; kindT = d ? d.count + ' slide' + (d.count === 1 ? '' : 's') : 'Slides'; thumb = h('div.bn-thumb', h('div.bn-thumb-ic', icon('slides'))); }
      list.appendChild(h('div.li.bn-loop-row', thumb,
        h('div.grow', h('div.trunc', name), h('div.note', kindT)),
        btn('up', 'Move up', () => { if (i > 0) { const t = L.items[i - 1]; L.items[i - 1] = it; L.items[i] = t; saveL(); renderLoop(); } }, { cls: 'sm' }),
        btn('down', 'Move down', () => { if (i < L.items.length - 1) { const t = L.items[i + 1]; L.items[i + 1] = it; L.items[i] = t; saveL(); renderLoop(); } }, { cls: 'sm' }),
        btn('trash', 'Remove', () => { L.items.splice(i, 1); saveL(); renderLoop(); }, { cls: 'sm' })));
    });
    box.appendChild(list);
    box.appendChild(h('div.row.wrap.bn-add',
      h('button.btn', { type: 'button', onclick: () => pickBanners(L, saveL) }, icon('banner'), h('span', 'Add banners…')),
      h('button.btn', { type: 'button', onclick: () => pickDecks(dl, L, saveL) }, icon('slides'), h('span', 'Add slides…'))));

    const secsSeg = seg([5, 8, 10, 15, 20, 30].map((s) => [String(s), s + ' s']), String(L.secs || 8), (v) => { L.secs = +v; saveL(); });
    const atInp = h('input.field', { type: 'time', value: L.at || c.service, 'aria-label': 'Service starts at', style: { width: '130px' },
      onchange: () => { L.at = atInp.value; saveL(); } });
    const countChip = h('button.chip', { type: 'button', 'aria-pressed': String(!!L.count), onclick: () => { L.count = !L.count; saveL(); renderLoop(); } },
      L.count ? icon('check') : null, 'Show “Service starts in” clock');
    const endSel = h('select.field', { 'aria-label': 'When it is time', onchange: () => { L.end = endSel.value; saveL(); } },
      h('option', { value: '' }, 'Keep looping'),
      lib.map((b) => h('option', { value: b.id, selected: L.end === b.id }, 'Show: ' + nameOf(b))));
    box.appendChild(h('div.form.bn-form',
      h('label', 'Each slide shows for'), secsSeg,
      h('label', 'Countdown'), h('div.row.wrap', countChip),
      L.count ? h('label', 'Service starts at') : null, L.count ? h('div.row', atInp) : null,
      L.count ? h('label', 'When it is time') : null, L.count ? h('div.col', { style: { alignItems: 'flex-start' } }, endSel, h('p.note', 'For example your Welcome banner. The loop stops there.')) : null));
    box.appendChild(h('div.row.wrap.bn-actions',
      h('button.btn.primary', { type: 'button', disabled: !L.items.length, onclick: async () => {
        const cue = await loopCue(kind);
        if (!cue) { toast('Nothing to show yet.', 'err'); return; }
        ctx.setStaged('ai', cue); toast(title + ' is Next. Press Present (F5) to start it.', 'ok', 2500);
      } }, icon('next'), h('span', 'Set as Next')),
      h('button.btn', { type: 'button', disabled: !L.items.length, onclick: async () => (await ctx.tab('plan')).addItem({ tab: 'ai', loop: true, label: title }) }, icon('plan'), h('span', 'Add to plan'))));
  }
  function pickBanners(L, saveL) {
    if (!lib.length) { toast('No saved banners yet. Make one and press Save.'); setView('make'); return; }
    const chosen = new Set();
    const list = h('div.list', { style: { maxHeight: '50vh', overflow: 'auto' } });
    lib.forEach((b) => {
      const inLoop = L.items.some((it) => it.t === 'banner' && it.id === b.id);
      const row = h('button', { type: 'button', 'aria-pressed': 'false', disabled: inLoop, onclick: () => { if (chosen.has(b.id)) chosen.delete(b.id); else chosen.add(b.id); row.setAttribute('aria-pressed', String(chosen.has(b.id))); } },
        icon('banner'), h('span.grow', nameOf(b)), inLoop ? h('span.note', 'already added') : null);
      list.appendChild(row);
    });
    modal({ title: 'Add banners', body: list, actions: [{ label: 'Add', primary: true, onclick: () => { chosen.forEach((id) => L.items.push({ t: 'banner', id })); saveL(); renderLoop(); closeModal(); } }, { label: 'Cancel' }] });
  }
  function pickDecks(dl, L, saveL) {
    if (!dl.length) { toast('No slide decks yet.'); return; }
    const chosen = new Set();
    const list = h('div.list', { style: { maxHeight: '50vh', overflow: 'auto' } });
    dl.forEach((d) => {
      const inLoop = L.items.some((it) => it.t === 'deck' && it.id === d.id);
      const row = h('button', { type: 'button', 'aria-pressed': 'false', disabled: inLoop, onclick: () => { if (chosen.has(d.id)) chosen.delete(d.id); else chosen.add(d.id); row.setAttribute('aria-pressed', String(chosen.has(d.id))); } },
        icon('slides'), h('span.grow', d.name), inLoop ? h('span.note', 'already added') : null);
      list.appendChild(row);
    });
    modal({ title: 'Add slides', body: list, actions: [{ label: 'Add', primary: true, onclick: () => { chosen.forEach((id) => L.items.push({ t: 'deck', id })); saveL(); renderLoop(); closeModal(); } }, { label: 'Cancel' }] });
  }

  // ============================================================ TOPICS
  const tpSearch = h('input.field.grow', { type: 'search', placeholder: 'Topic, belief or words — e.g. hope, Sabbath, baptism, Psalm 23', 'aria-label': 'Find a topic',
    oninput: () => filterTopics(), onkeydown: (e) => { if (e.key === 'Enter') runTopicSearch(); } });
  const tpTr = h('select.field', { 'aria-label': 'Translation', onchange: () => { if (curTopic) showTopic(curTopic); else if (lastQuery) runTopicSearch(); } });
  const tpList = h('div.tp-list');
  const tpOut = h('div.tp-out.scroll.pad');
  const askIn = h('input.field.grow', { type: 'search', placeholder: 'Ask a question, e.g. What does the Bible say about the Sabbath?', 'aria-label': 'Ask a question', 'data-free-text': '',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); askAi(); } } });
  const askBtn = h('button.btn.primary', { type: 'button', title: 'Online AI answers your question in three ways that fit a slide. You choose one.', onclick: () => askAi() }, icon('sparkle'), h('span', 'Ask AI'));
  views.topics.append(
    h('div.toolbar.tp-bar', tpSearch, tpTr, h('button.btn', { type: 'button', onclick: () => runTopicSearch() }, icon('search'), h('span', 'Find'))),
    h('div.toolbar.tp-bar.tp-ask', icon('sparkle'), askIn, askBtn),
    h('div.split.topics-split', h('div.pane', h('div.scroll', tpList)), h('div.pane', tpOut)));
  let curTopic = null, lastQuery = '';

  async function loadTopics() {
    if (topics) return topics;
    const r = await fetch('data/topics/topics.json');
    topics = (await r.json()).topics || [];
    topics.forEach((t) => { t._k = normalize([t.t, t.d, (t.a || []).join(' ')].join(' ')); });
    return topics;
  }
  async function renderTopics() {
    if (!trList.length) trList = await listTranslations().catch(() => []);
    if (!tpTr.options.length) trList.forEach((x) => tpTr.appendChild(h('option', { value: x.id, selected: x.id === settings.v.bible.primary }, x.abbr)));
    await loadTopics().catch(() => { clear(tpList); tpList.appendChild(h('p.note.pad', 'The topic list could not be loaded.')); });
    filterTopics();
    if (!curTopic && !lastQuery && !tpOut.childNodes.length) {
      tpOut.appendChild(emptyState('bible', 'Key verses for any topic', 'Pick a belief or topic, or type words. Verses come from the Bible you choose above, so they work offline and in Afrikaans or Xhosa too.'));
    }
  }
  function filterTopics() {
    if (!topics) return;
    const q = normalize(tpSearch.value.trim());
    clear(tpList);
    const groups = [['belief', '28 Fundamental Beliefs'], ['topic', 'Topics']];
    groups.forEach(([g, label]) => {
      const items = topics.filter((t) => t.group === g && (!q || t._k.includes(q) || (g === 'belief' && String(t.n) === q)));
      if (!items.length) return;
      tpList.appendChild(h('div.tp-h', label));
      items.forEach((t) => {
        const b = h('button.tp-item', { type: 'button', 'aria-pressed': String(curTopic === t), onclick: () => showTopic(t) },
          t.n ? h('span.tp-n', String(t.n)) : null, h('span.grow', h('span.tp-t', t.t), h('span.note.tp-d', t.d)));
        tpList.appendChild(b);
      });
    });
    if (!tpList.childNodes.length) tpList.appendChild(h('p.note.pad', 'No topic matches. Press Find to search the Bible for these words.'));
  }
  function bestTopic(q) {
    const n = normalize(q);
    if (!n || !topics) return null;
    const num = /^(?:fb|belief|fundamental belief)?\s*#?(\d{1,2})$/.exec(n);
    if (num) return topics.find((t) => t.group === 'belief' && t.n === +num[1]) || null;
    return topics.find((t) => normalize(t.t) === n) || topics.find((t) => (t.a || []).some((a) => normalize(a) === n)) ||
      topics.find((t) => normalize(t.t).includes(n)) || topics.find((t) => (t.a || []).some((a) => normalize(a).includes(n) || (n.length > 4 && n.includes(normalize(a))))) || null;
  }
  async function runTopicSearch() {
    await loadTopics();
    const q = tpSearch.value.trim();
    if (!q) return;
    lastQuery = q;
    if (/\d/.test(q) && parseRef(q) && !/^(?:fb|belief)?\s*#?\d{1,2}$/i.test(q)) { showPassages(q, [q]); return; }
    const t = bestTopic(q);
    if (t) { showTopic(t); return; }
    // No topic: search the chosen Bible for the words.
    curTopic = null; filterTopics();
    dropAskStage();
    clear(tpOut);
    tpOut.appendChild(h('p.note', 'Searching ' + (tpTr.selectedOptions[0] ? tpTr.selectedOptions[0].textContent : 'the Bible') + ' for “' + q + '”…'));
    const info = await getInfo(tpTr.value || settings.v.bible.primary);
    const res = await bibleSearch(info.id, q, { limit: 40 });
    clear(tpOut);
    if (!res.length) { tpOut.appendChild(emptyState('search', 'Nothing found for “' + q + '”', 'Try fewer words, another translation, or one of the topics on the left.')); return; }
    tpOut.appendChild(h('div.tp-head', h('h3', 'Verses with “' + q + '”'), h('p.note', res.length >= 40 ? 'The first 40 verses in ' + info.abbr + '.' : res.length + ' verses in ' + info.abbr + '.')));
    res.forEach((r) => tpOut.appendChild(verseRow(info.names[r.b - 1] + ' ' + r.c + ':' + r.v, verseText(r.text))));
  }
  async function showTopic(t) {
    curTopic = t; lastQuery = '';
    filterTopics();
    await showPassages(t.t, t.r, t);
    if (ctx.isMobile()) tpOut.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function showPassages(title, refs, topic) {
    dropAskStage();
    clear(tpOut);
    const tr = tpTr.value || settings.v.bible.primary;
    const info = await getInfo(tr);
    const head = h('div.tp-head',
      h('h3', topic && topic.n ? topic.n + '. ' + title : title),
      topic ? h('p.note', topic.d) : null,
      h('div.row.wrap.bn-actions',
        h('button.btn.primary', { type: 'button', onclick: () => stageTopic(topic, refs, title, tr) }, icon('next'), h('span', refs.length > 1 ? 'Set all as Next' : 'Set as Next')),
        topic ? h('button.btn', { type: 'button', onclick: async () => (await ctx.tab('plan')).addItem({ tab: 'ai', topic: topic.id, tr, label: 'Verses: ' + topic.t }) }, icon('plan'), h('span', 'Add to plan')) : null,
        h('button.btn', { type: 'button', title: 'A short summary with Bible references, made online and shown here for checking first', onclick: () => aiSummary(title, refs) }, icon('sparkle'), h('span', 'AI summary (online)'))));
    tpOut.appendChild(head);
    const aiBox = h('div.tp-ai');
    tpOut.appendChild(aiBox);
    for (const ref of refs) {
      const r = parseRef(ref);
      if (!r) continue;
      let text = '', label = ref;
      try {
        if (info.books[r.book - 1] && info.books[r.book - 1][1]) {
          const vs = await versesFor(info.id, r.book, r.segs, { english: true });
          text = vs.map((v) => verseText(v.text)).join(' ');
          label = refText(info.names, r.book, r.segs);
        }
      } catch (e) { /* missing book in this translation */ }
      tpOut.appendChild(verseRow(label, text || '(not in ' + info.abbr + ')', ref));
    }
  }
  function verseRow(label, text, ref) {
    const tr = tpTr.value || settings.v.bible.primary;
    const r = ref || label;
    return h('div.tp-verse',
      h('div.tp-verse-t', h('b', label), ' ', text.length > 420 ? text.slice(0, 419) + '…' : text),
      h('div.row.tp-verse-a',
        h('button.btn.sm', { type: 'button', title: 'Put this passage on the Next screen', onclick: async () => {
          const cue = await (await ctx.tab('bible')).cueFor(r, tr);
          if (!cue) { toast('That passage is not in this translation.', 'err'); return; }
          ctx.setStaged('ai', cue); toast(cue.title + ' is Next. Press Present (F5).', 'ok', 2500);
        } }, icon('next'), h('span', 'Next')),
        h('button.btn.sm', { type: 'button', title: 'Make a banner with this verse', onclick: () => {
          setDoc(newBanner('verse')); sl.f.ref = r; sl.f.tr = tr; savedSig = null; nameInp.value = '';
          setView('make'); changed(true); fetchVerse();
        } }, icon('banner'), h('span', 'Banner'))));
  }
  async function topicCue(topic, refs, title, tr) {
    const bible = await ctx.tab('bible');
    const frames = [], labels = [];
    for (const ref of refs) {
      const c = await bible.cueFor(ref, tr);
      if (!c) continue;
      const sh = refText(SHORT, c.book, c.segs);
      c.deck.frames.forEach((f, i) => { frames.push(f); labels.push(c.deck.frames.length > 1 ? sh + ' (' + (i + 1) + ')' : sh); });
    }
    if (!frames.length) return null;
    const info = await getInfo(tr);
    return { id: 'topic:' + (topic ? topic.id : title) + ':' + tr, tab: 'ai', title: topic ? topic.t : title, sub: info.abbr + ' · ' + refs.length + ' passage' + (refs.length === 1 ? '' : 's'),
      deck: { kind: 'text', frames }, index: 0, labels, plan: topic ? { tab: 'ai', topic: topic.id, tr, label: 'Verses: ' + topic.t } : null };
  }
  async function stageTopic(topic, refs, title, tr) {
    const cue = await topicCue(topic, refs, title, tr);
    if (!cue) { toast('None of these passages are in this translation.', 'err'); return; }
    ctx.setStaged('ai', cue);
    toast(cue.title + ': ' + cue.deck.frames.length + ' slides are Next. Press Present (F5).', 'ok', 3000);
  }

  // AI summary: editable slides, Bible references checked against the offline Bible before anything is shown.
  async function aiSummary(title, refs) {
    const box = tpOut.querySelector('.tp-ai');
    if (!box) return;
    if (!ai.hasKey()) { toast('Add an API key in Settings → AI to use online summaries. Everything else here works offline.', '', 6000); return; }
    clear(box);
    box.appendChild(h('p.note', 'Asking ' + ai.providerName() + '…'));
    let reply;
    try {
      reply = await ai.aiText({
        system: 'You write short, accurate, Bible-based slide text for a Seventh-day Adventist church service. Warm, simple language suitable for all ages, faithful to Scripture and to Seventh-day Adventist beliefs. No controversy. Reply with JSON only.',
        prompt: 'Topic: ' + title + (refs && refs.length ? '\nKey texts: ' + refs.slice(0, 8).join('; ') : '') +
          '\nWrite 2 or 3 slides. Each slide has a short title (at most 6 words) and text (at most 45 words). Give 2 to 4 Bible references that support it.' +
          '\nReply exactly in this JSON form: {"slides":[{"title":"…","text":"…"}],"verses":["John 3:16"]}',
      });
    } catch (e) { clear(box); box.appendChild(h('p.note.warn', ai.friendlyAiError(e))); return; }
    const slides = parseSlides(reply);
    const j = ai.parseJsonReply(reply);
    const verses = (j && Array.isArray(j.verses) ? j.verses : []).map(String);
    renderAiSlides(box, slides, verses);
  }
  function parseSlides(reply) {
    const j = ai.parseJsonReply(reply);
    if (j && Array.isArray(j.slides)) {
      const out = j.slides.map((s) => ({ title: String((s && s.title) || '').trim(), text: String((s && s.text) || '').trim() })).filter((s) => s.title || s.text);
      if (out.length) return out.slice(0, 5);
    }
    // Older "Slide 1 title: … / Slide 1 text: …" replies.
    const out = [];
    const re = /slide\s*\d+\s*title\s*:\s*(.+)\s*\n\s*slide\s*\d+\s*text\s*:\s*([\s\S]*?)(?=\n\s*slide\s*\d+\s*title\s*:|$)/gi;
    let m;
    while ((m = re.exec(reply))) out.push({ title: m[1].trim(), text: m[2].trim() });
    if (out.length) return out.slice(0, 5);
    const plain = String(reply || '').trim();
    return plain ? [{ title: '', text: plain.slice(0, 600) }] : [];
  }
  function refsIn(text) {
    const found = [];
    const re = /\b((?:[1-3]\s?)?[A-Z][a-z]+\.?\s\d{1,3}(?::\d{1,3}(?:\s?[-–]\s?\d{1,3})?)?)/g;
    let m;
    while ((m = re.exec(text))) { const p = parseRef(m[1]); if (p) found.push(m[1].trim()); }
    return found;
  }
  async function renderAiSlides(box, slides, verses) {
    clear(box);
    const tr = tpTr.value || settings.v.bible.primary;
    const info = await getInfo(tr);
    const list = h('div.col');
    const draw = () => {
      clear(list);
      slides.forEach((s, i) => {
        const ti = h('input.field', { value: s.title, placeholder: 'Slide title', 'aria-label': 'Slide ' + (i + 1) + ' title', style: { width: '100%' }, oninput: () => { s.title = ti.value; } });
        const tx = h('textarea.field.bn-ta', { rows: 3, placeholder: 'Slide text', 'aria-label': 'Slide ' + (i + 1) + ' text', oninput: () => { s.text = tx.value; } });
        tx.value = s.text;
        list.appendChild(h('div.card.tp-ai-slide', h('div.row', h('b.grow', 'Slide ' + (i + 1)), btn('trash', 'Remove this slide', () => { slides.splice(i, 1); draw(); }, { cls: 'sm' })), ti, tx));
      });
    };
    draw();
    const all = slides.map((s) => s.title + ' ' + s.text).join(' ');
    const flags = ai.flaggedWords(all);
    const refs = Array.from(new Set(verses.concat(refsIn(all))));
    const checks = h('div.col.tp-checks');
    for (const ref of refs) {
      const r = parseRef(ref);
      let vs = [];
      try { if (r && info.books[r.book - 1] && info.books[r.book - 1][1]) vs = await versesFor(info.id, r.book, r.segs); } catch (e) { vs = []; }
      const ok = vs.length && vs.every((v) => v.text);
      if (ok) {
        const label = refText(info.names, r.book, r.segs);
        const txt = vs.map((v) => verseText(v.text)).join(' ');
        checks.appendChild(h('div.tp-check.ok', icon('check'), h('div.grow', h('b', label), ' ', short(txt, 160)),
          h('button.btn.sm', { type: 'button', title: 'Add this verse as a slide', onclick: () => { slides.push({ title: label, text: txt }); draw(); } }, icon('plus'), h('span', 'Slide'))));
      } else {
        checks.appendChild(h('div.tp-check.bad', icon('info'), h('div.grow', h('b', ref), ' — not found in ' + info.abbr + '. Check this reference before showing it.')));
      }
    }
    box.append(...[
      h('div.row.wrap', h('h3.grow', 'AI summary — check before showing'), h('span.note', ai.providerName())),
      flags.length ? h('p.note.warn', 'Please read carefully: the reply contains “' + flags.join('”, “') + '”.') : null,
      list,
      h('div.row.wrap', h('button.btn.sm', { type: 'button', onclick: () => { slides.push({ title: '', text: '' }); draw(); } }, icon('plus'), h('span', 'Add slide'))),
      refs.length ? h('h4', 'Bible references') : null, checks,
      h('div.row.wrap.bn-actions',
        h('button.btn.primary', { type: 'button', onclick: () => {
          const fr = slides.filter((s) => (s.title || s.text).trim()).map((s) => ({ kind: 'text', variant: 'plain', head: s.title.trim() || undefined, html: esc(s.text.trim()).replace(/\n/g, '<br>') }));
          if (!fr.length) { toast('Nothing to show yet.', 'err'); return; }
          ctx.setStaged('ai', { id: 'aisum:' + Date.now(), tab: 'ai', title: (slides[0] && slides[0].title) || 'Summary', sub: 'Checked summary', deck: { kind: 'text', frames: fr }, index: 0, labels: fr.map((f, i) => String(i + 1)) });
          toast('Summary slides are Next. Press Present (F5).', 'ok', 2500);
        } }, icon('next'), h('span', 'Set as Next')),
        h('button.btn', { type: 'button', title: 'Start a banner from the first slide', onclick: () => {
          const s = slides[0]; if (!s) return;
          setDoc(newBanner('blank')); sl.f.title = s.title; sl.f.text = s.text; savedSig = null; nameInp.value = '';
          setView('make'); changed(true);
        } }, icon('banner'), h('span', 'Make a banner')))].filter(Boolean));
  }


  // ------------------------------------------------------------ Ask AI: one question, three slide-sized answers
  // The person picks the answer they prefer (and may edit it), optionally adds a picture, and sets it as a
  // slide. Bible references in the answers are checked against the installed Bible; a verse shown on a slide
  // is always the Bible's own words, never AI's wording of it.
  let askStage = null;
  const dropAskStage = () => { if (askStage) { try { askStage.destroy(); } catch (e) { /* */ } askStage = null; } };
  const clampStr = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
  const ASK_LABELS = ['Short answer', 'With the Bible’s own words', 'Key points'];

  async function askAi() {
    const question = askIn.value.trim();
    if (!question) { askIn.focus(); return; }
    await loadTopics().catch(() => {});
    if (!ai.hasKey() || navigator.onLine === false) {
      toast(!ai.hasKey() ? 'No AI key yet (Settings → AI), so the Bible and topics were searched instead.' : 'No internet, so the Bible and topics were searched instead.', '', 5000);
      tpSearch.value = question; runTopicSearch();
      return;
    }
    dropAskStage(); curTopic = null; lastQuery = ''; filterTopics();
    clear(tpOut);
    tpOut.appendChild(h('p.note', 'Asking ' + ai.providerName() + '…'));
    askBtn.disabled = true;
    let reply;
    try {
      reply = await ai.aiText({
        system: 'You help a Seventh-day Adventist church media team answer questions on a projector slide. Be accurate, warm, simple and faithful to the Bible and to Seventh-day Adventist beliefs. No controversy. Never invent Bible references. Reply with JSON only.',
        prompt: 'Question: ' + question +
          '\nGive exactly 3 different ways to answer on one slide:' +
          '\n1 "Short answer": title (at most 6 words), text (at most 30 words), 0 to 2 Bible references.' +
          '\n2 "With the Bible’s own words": title (at most 6 words), text = one short lead-in sentence (at most 16 words), and exactly one best Bible reference (one verse or at most 3 verses) in "verses".' +
          '\n3 "Key points": title (at most 6 words), text = exactly 3 short points of at most 8 words, one per line, each starting with "• ", 0 to 2 Bible references.' +
          '\nAlso "picture": at most 12 words describing a calm, reverent background scene with no people and no text.' +
          '\nIf the question is not suitable for church or cannot be answered, reply {"options":[]}.' +
          '\nReply exactly in this JSON form: {"options":[{"label":"Short answer","title":"…","text":"…","verses":["John 3:16"]},{"label":"…","title":"…","text":"…","verses":["…"]},{"label":"Key points","title":"…","text":"• …\\n• …\\n• …","verses":[]}],"picture":"…"}',
        maxTokens: 900,
      });
    } catch (e) { clear(tpOut); tpOut.appendChild(h('p.note.warn', ai.friendlyAiError(e))); askBtn.disabled = false; return; }
    askBtn.disabled = false;
    const j = ai.parseJsonReply(reply);
    const raw = j && Array.isArray(j.options) ? j.options.filter((o) => o && typeof o === 'object').slice(0, 3) : [];
    clear(tpOut);
    if (!raw.length) {
      tpOut.appendChild(emptyState('search', 'No answer to show', 'The AI could not answer that for a slide. Try asking in other words, or search the topics on the left.'));
      return;
    }
    const tr = tpTr.value || settings.v.bible.primary;
    const options = [];
    for (let i = 0; i < raw.length; i++) {
      const o = raw[i];
      const refs = (Array.isArray(o.verses) ? o.verses : []).map((x) => String(x).trim()).filter(Boolean).slice(0, i === 1 ? 1 : 2);
      const ok = [], bad = [];
      for (const ref of refs) {
        const v = await versesText(ref, tr).catch(() => null);
        if (v) ok.push({ ref, label: v.label.replace(/ \([^)]*\)$/, ''), text: v.text }); else bad.push(ref);
      }
      let title = clampStr(o.title, 70), text = clampStr(o.text, 420), foot = ok.map((v) => v.label).join('  ·  ');
      if (i === 1 && ok[0]) {
        const vt = ok[0].text.length > 260 ? ok[0].text.slice(0, 259).replace(/\s+\S*$/, '') + '…' : ok[0].text;
        text = (text ? text + '\n\n' : '') + '“' + vt + '”';
      }
      options.push({ label: clampStr(o.label, 40) || ASK_LABELS[i] || 'Answer ' + (i + 1), title, text, foot, bad });
    }
    const mood = ai.flaggedWords(j.picture).length ? '' : clampStr(j.picture, 160);
    renderAsk(question, options, mood, tr);
  }

  function renderAsk(question, options, mood, tr) {
    dropAskStage();
    clear(tpOut);
    let sel = 0;
    const ab = newBanner('blank');           // the banner for the chosen answer
    ab.s.pal = 'navy'; ab.s.deco = 'glow';
    const cards = h('div.col.tp-ask-cards');
    const stHost = h('div.stage-host');
    const stScreen = h('div.screen.bn-screen', stHost);
    askStage = createStage(stHost, { placeholderOnly: true, aspect: link.aspect ? link.aspect() : 16 / 9 });
    if (live.style) askStage.applyStyle(live.style);
    stScreen.style.aspectRatio = String(link.aspect ? link.aspect() : 16 / 9);
    const pre = (o) => { ab.f.title = o.title; ab.f.text = o.text; ab.f.foot = o.foot; };
    const sync = () => { pre(options[sel]); refresh(); };
    let seq = 0;
    async function refresh() {
      const my = ++seq;
      const fr = await frameOf(ab).catch(() => null);
      if (my !== seq || !fr || !askStage) return;
      askStage.show(fr);
    }
    const refreshSoon = debounce(refresh, 150);
    function drawCards() {
      clear(cards);
      options.forEach((o, i) => {
        const on = i === sel;
        const ti = h('input.field', { value: o.title, 'aria-label': 'Slide heading', placeholder: 'Heading', style: { width: '100%' }, oninput: () => { o.title = ti.value; if (on) { sync(); } } });
        const tx = h('textarea.field.bn-ta', { rows: 3, 'aria-label': 'Slide text', oninput: () => { o.text = tx.value; if (on) { sync(); } } });
        tx.value = o.text;
        const ft = h('input.field', { value: o.foot, 'aria-label': 'Bible reference line', placeholder: 'Bible reference (bottom line)', style: { width: '100%' }, oninput: () => { o.foot = ft.value; if (on) sync(); } });
        const flags = ai.flaggedWords(o.title + ' ' + o.text);
        cards.appendChild(h('div.card.tp-ask-card' + (on ? '.on' : ''), { 'aria-current': on ? 'true' : null },
          h('div.row', h('span.chip', o.label), h('div.grow'),
            h('button.btn.sm' + (on ? '.primary' : ''), { type: 'button', 'aria-pressed': String(on), onclick: () => { sel = i; sync(); drawCards(); } }, on ? icon('check') : null, h('span', on ? 'Chosen' : 'Use this one'))),
          ti, tx, ft,
          o.bad.length ? h('p.note.warn', 'Not found in the Bible: ' + o.bad.join(', ') + '. Left out of the slide; check it before using.') : null,
          flags.length ? h('p.note.warn', 'Please read carefully: contains “' + flags.join('”, “') + '”.') : null));
      });
    }
    const dimInfo = h('span.note', '');
    const picRow = h('div.row.wrap');
    function drawPic() {
      clear(picRow);
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
        const f0 = file.files[0]; file.value = '';
        if (!f0) return;
        try { await setPic(await storePicture(f0, f0.name)); } catch (e) { toast('Could not use that picture: ' + e.message, 'err'); }
      } });
      const aiPic = h('button.btn', { type: 'button', title: 'Make a calm background picture for this answer with online AI (no words in it)', onclick: async () => {
        aiPic.disabled = true; const lbl = aiPic.lastChild.textContent; aiPic.lastChild.textContent = 'Making picture…';
        try {
          const blob = await ai.aiImage((mood || 'A peaceful nature scene, soft light') + '. A wide 16:9 background photograph for a church projector screen. Calm, reverent and uplifting, soft natural light, ' +
            'simple composition with plenty of open space for text. Absolutely no text, letters, words, numbers, logos, signs or watermarks.');
          await setPic(await storePicture(blob, 'AI picture ' + new Date().toLocaleDateString()));
        } catch (e) { toast(ai.friendlyAiError(e), 'err', 8000); }
        finally { aiPic.disabled = false; aiPic.lastChild.textContent = lbl; }
      } }, icon('sparkle'), h('span', ai.canImage() ? 'Add AI picture (online)' : 'AI picture (not with this provider)'));
      aiPic.disabled = !ai.canImage();
      picRow.append(aiPic, h('button.btn', { type: 'button', onclick: () => file.click() }, icon('upload'), h('span', 'Choose picture…')), file,
        ab.s.img ? h('button.btn', { type: 'button', onclick: () => { ab.s.img = null; ab.s.dim = null; drawPic(); refresh(); } }, icon('x'), h('span', 'No picture')) : null);
    }
    async function setPic(id) {
      const rec = await db.get('files', id).catch(() => null);
      ab.s.img = id; ab.s.dim = Math.max(0.35, autoDim(rec && rec.meta && rec.meta.lum));
      drawPic(); refresh();
    }
    async function cue() {
      const fr = await frameOf(ab);
      const title = (ab.f.title || ab.f.text || 'Answer').split('\n')[0];
      return Object.assign(bannerCue(ab, fr), { id: 'banner:ask:' + Date.now(), title: short(title, 50), sub: 'Answer: ' + short(question, 40), plan: null });
    }
    function saveAsBanner() {
      const b = clone(ab);
      b.id = 'b-' + uid(); b.created = b.updated = Date.now(); b.name = short(question, 50);
      lib.unshift(b); saveLib(); renderViewSeg();
      return b;
    }
    tpOut.append(
      h('div.tp-head', h('h3', 'Your question'), h('p', question), h('p.note', 'Three ways to answer on a slide. Pick the one you like, edit it if needed, and add a picture if you wish. Check it before it goes on screen.')),
      cards,
      h('h4', 'Picture (optional)'), picRow,
      h('h4', 'Slide preview'), stScreen,
      h('div.row.wrap.bn-actions',
        h('button.btn.primary', { type: 'button', onclick: async () => {
          const o = options[sel];
          if (!(o.title || o.text).trim()) { toast('The slide is empty. Choose or write an answer first.', 'err'); return; }
          ctx.setStaged('ai', await cue()); toast('Answer is Next. Press Present (F5) to show it.', 'ok', 3000);
        } }, icon('next'), h('span', 'Set as Next')),
        h('button.btn', { type: 'button', onclick: async () => { const b = saveAsBanner(); (await ctx.tab('plan')).addItem({ tab: 'ai', banner: b.id, label: 'Answer: ' + short(question, 40) }); } }, icon('plan'), h('span', 'Add to plan')),
        h('button.btn', { type: 'button', onclick: () => { saveAsBanner(); toast('Saved in Banners → Saved.', 'ok', 2500); } }, icon('save'), h('span', 'Save')),
        h('button.btn', { type: 'button', title: 'Open it in the banner editor to change colours and text position', onclick: () => {
          setDoc(clone(ab)); cur.id = null; savedSig = null; nameInp.value = ''; setView('make'); changed(true);
        } }, icon('banner'), h('span', 'Edit as banner')),
        h('button.btn', { type: 'button', onclick: () => askAi() }, icon('sparkle'), h('span', 'Ask again'))),
      dimInfo);
    drawCards(); drawPic(); sync();
    if (ctx.isMobile()) tpOut.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ============================================================ control bar + plan
  const api = {
    el,
    /** Banners brought in with a shared plan: add them to the saved banners. */
    async addBanners(docs) {
      await ready;
      const add = (docs || []).map(repair).filter((b) => b && b.id && !lib.some((x) => x.id === b.id));
      lib = add.concat(lib);
      await saveLib();
      if (view === 'library') renderLibrary();
      return add.length;
    },
    /** Turn a slide into a banner in the editor: {blob} makes a picture banner, {title,text} a text banner. */
    async fromSlide({ blob, title, text, name, els, bg }) {
      await ready;
      if (els && els.length) {
        // A slide's own pieces: text boxes, shapes and pictures that the slide editor can change.
        setDoc(newBanner('blank'));
        sl.f = {}; sl.s.pal = 'black'; sl.s.deco = 'none'; sl.s.free = true;
        if (bg && bg.color) { sl.s.bgc = bg.color; if (bg.color2) { sl.s.bgc2 = bg.color2; sl.s.bga = bg.angle == null ? 180 : bg.angle; } }
        if (bg && bg.blob) { sl.s.img = await storePicture(bg.blob, (name || 'Slide') + ' background'); sl.s.dim = 0; sl.s.imgFit = 'cover'; }
        const out = [];
        for (const e of els) {
          const o = Object.assign({ id: 'e' + uid() }, e);
          if (o._blob) { try { o.src = await storePicture(o._blob, (name || 'Slide') + ' picture', { keepAlpha: true }); } catch (er) { delete o._blob; continue; } }
          delete o._blob; out.push(o);
        }
        sl.els = cleanEls(out);
        cur.name = name || 'Slide banner';
      } else if (blob) {
        const id = await storePicture(blob, (name || 'Slide') + '.jpg');
        setDoc(newBanner('picture'));
        sl.s.img = id; sl.s.dim = 0; cur.name = name || 'Slide banner';
      } else {
        setDoc(newBanner('announce'));
        sl.f.kicker = ''; sl.f.foot = '';
        sl.f.title = String(title || '').slice(0, 120);
        sl.f.text = String(text || '').slice(0, 400);
        cur.name = name || sl.f.title || 'Slide banner';
      }
      savedSig = null; nameInp.value = cur.name;
      setView('make');
      changed(true);
      return cur;
    },
    onShow() { setPreviewAspect(); if (view === 'make') refreshPreview(); },
    onHide() { if (editor) editor.deselect(); },
    /** For tests and troubleshooting: the banner being edited. */
    _state: () => ({ cur, pg, sel: editor.selection(), undo: hist.i, editing: editor.isEditing() }),
    /** Open a plan item: {banner} | {loop} | {topic, tr}. Returns the staged cue. */
    async open(item) {
      await ready;
      let cue = null;
      if (item.banner) {
        const b = lib.find((x) => x.id === item.banner);
        if (!b) { toast('That banner is no longer on this device.', 'err'); return null; }
        cue = bannerCue(b, await framesOf(b));
      } else if (item.loop) {
        const kind = (item.label || '').toLowerCase().includes('announce') ? 'ann' : 'pre';
        cue = await loopCue(kind);
        if (!cue) { toast('That loop is empty. Add banners under Service loop.', 'err'); return null; }
      } else if (item.topic) {
        await loadTopics();
        const t = topics.find((x) => x.id === item.topic);
        if (!t) return null;
        cue = await topicCue(t, t.r, t.t, item.tr || settings.v.bible.primary);
      }
      if (cue) ctx.setStaged('ai', cue);
      return cue;
    },
    controls(cue) {
      if (!cue.isLoop) return null;
      const b = h('button.btn.sm', { type: 'button', title: 'Pause or resume the loop',
        onclick: () => { live.autoRun(!!live.autoPaused); paint(); } });
      const paint = () => { clear(b); b.append(icon(live.autoPaused ? 'play' : 'pause'), h('span', live.autoPaused ? 'Resume loop' : 'Pause loop')); };
      paint();
      const a = cue.deck.auto || {};
      return h('div.row', b, h('span.note.hide-sm', 'every ' + a.secs + ' s' + (a.at ? ' · until ' + new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : '')));
    },
    /** Saved banners, for the Plan tab's Link dialog. */
    banners() { return lib.map((b) => ({ id: b.id, name: nameOf(b) })); },
    async bannerThumb(id) {
      const b = lib.find((x) => x.id === id);
      if (!b || !b.s || !b.s.img) return null;
      const blob = await fileBlob(b.s.img).catch(() => null);
      return blob ? URL.createObjectURL(blob) : null;
    },
  };

  const ready = (async () => {
    await load().catch((e) => console.warn('banners', e));
    trList = await listTranslations().catch(() => []);
    if (!live.style) await live.buildStyle().catch(() => {});
    if (live.style) stage.applyStyle(live.style);
    setPreviewAspect();
    nameInp.value = cur.name || '';
    hist.reset();
    renderGroupSel();
    renderEditor();
    renderStrip();
    updateSaveBtn();
    setView(view);
  })();
  settings.on('change:church', (path) => {
    // A church name added after starting a banner fills the empty lines that would have shown it.
    if (path === 'church.name') {
      const c = church(), d = TPL[sl.tpl].d(c);
      Object.keys(d).forEach((k) => { if (!sl.f[k] && d[k] && c.name && d[k].includes(c.name)) sl.f[k] = d[k]; });
      saveDraft();
    }
    if (view === 'make') { renderEditor(); schedule(); }
  });
  settings.on('change:display', (p) => { if (p === 'display.logo' && view === 'make') renderEditor(); });
  renderViewSeg();
  return api;
}
