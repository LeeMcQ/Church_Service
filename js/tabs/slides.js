// Slides tab: PDF, PowerPoint, pictures, and links (Google Slides, etc.).
// Local files are converted once and kept offline. Links can be imported as PDF
// (when publicly shared) or presented live from the web.
import { h, clear, uid, fmtBytes } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn, dropzone, menu, toast, confirmBox, promptBox, seg, emptyState } from '../core/ui.js';
import { db } from '../core/db.js';
import { createStage, renderFrame } from '../core/render.js';

export default function create(ctx) {
  const { settings, live } = ctx;
  let decks = [];
  let deck = null;
  let frames = null;     // frames of the selected deck
  let thumbs = [];       // thumb blobs (pdf/images)
  let stagedIndex = 0;
  let autoT = null;
  const urls = [];

  const libList = h('div.list');
  const grid = h('div.thumbs');
  const head = h('h2.grow.trunc', '');
  const info = h('span.note', '');
  const prog = h('div', { hidden: true, style: { padding: '10px 14px' } }, h('div.note', ''), h('div.progress', h('i')));
  const notes = h('div.note.pad', { hidden: true, style: { whiteSpace: 'pre-wrap', borderTop: '1px solid var(--line)' } });
  const zone = dropzone('Drop PDF, PowerPoint (.pptx) or pictures here, or tap to choose', '.pdf,.pptx,image/*', (files) => importFiles(files));
  const addBtn = btn('plus', 'Add files', () => zone.querySelector('input').click(), { cls: 'sm', label: 'Add' });
  const linkBtn = btn('link', 'Add from link', () => addFromLink(), { cls: 'sm', label: 'Link' });
  const saveBannerBtn = btn('banner', 'Make the selected slide a banner you can edit', () => makeBanner(), { cls: 'sm', label: 'Make banner' });
  saveBannerBtn.hidden = true;
  const deckMenuBtn = btn('more', 'Deck options', () => deck && menu(deckMenuBtn, [
    { label: 'Make this slide an editable banner', icon: 'banner', onclick: () => makeBanner() },
    ...(deck && deck.type === 'pptx' ? [{ label: 'Make a picture banner (exact look)', icon: 'banner', onclick: () => makeBanner(true) }] : []),
    { label: 'Duplicate this slide', icon: 'copy', onclick: duplicateSlide },
    { label: 'Delete this slide', icon: 'trash', onclick: deleteSlide },
    { label: 'Move slide earlier', icon: 'up', onclick: () => moveSlide(-1) },
    { label: 'Move slide later', icon: 'down', onclick: () => moveSlide(1) },
    { label: 'Present from this slide', icon: 'present', onclick: () => { stageAt(stagedIndex); live.take(); } },
    { label: 'Rename deck', icon: 'edit', onclick: renameDeck },
    { label: 'Add to the service plan', icon: 'plan', onclick: addToPlan },
    { label: 'Delete deck', icon: 'trash', onclick: deleteDeck },
  ]), { cls: 'sm' });
  const fitSeg = seg([['contain', 'Fit'], ['cover', 'Fill']], settings.v.slides.fit, (v) => { settings.set('slides.fit', v); if (deck) stageAt(stagedIndex); });

  const el = h('section',
    h('div.toolbar', h('h2', 'Slides'), addBtn, linkBtn, h('div.grow'), fitSeg),
    prog,
    h('div.split.lib-split',
      h('div.pane', h('div.pane-h', 'Library'), h('div.scroll', { style: { flex: '1' } }, libList, h('div.pad', zone))),
      h('div.pane', h('div.pane-h', head, info, saveBannerBtn, deckMenuBtn), h('div.scroll', { style: { flex: '1' } }, grid, notes))));

  // ------------------------------------------------------------ library
  async function loadLibrary() {
    const all = await db.all('files');
    decks = all.filter((f) => f.kind === 'deck').sort((a, b) => b.added - a.added);
    renderLibrary();
    if (!deck && decks[0]) selectDeck(decks[0].id);
    if (!decks.length) renderDeck();
  }

  function renderLibrary() {
    clear(libList);
    decks.forEach((d) => libList.appendChild(h('button', { type: 'button', 'aria-pressed': String(!!deck && deck.id === d.id), onclick: () => selectDeck(d.id) },
      icon(d.type === 'pdf' ? 'slides' : d.type === 'pptx' ? 'present' : d.type === 'web' ? 'web' : 'snapshot'),
      h('span.grow', h('div.trunc', d.name), h('div.note', d.count + (d.count === 1 ? ' slide' : ' slides') + ' · ' + d.type.toUpperCase())))));
  }

  async function selectDeck(id) {
    deck = decks.find((d) => d.id === id) || null;
    stagedIndex = 0;
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    frames = null; thumbs = [];
    renderLibrary();
    if (!deck) { renderDeck(); return; }
    if (deck.type === 'pptx') {
      const rec = await db.get('renders', deck.id + '/frames');
      frames = rec ? rec.frames : [];
    } else if (deck.type === 'web') {
      frames = [{ kind: 'web', url: deck.url, title: deck.name }];
    } else {
      frames = []; thumbs = [];
      for (let i = 0; i < deck.count; i++) {
        const r = await db.get('renders', deck.id + '/' + i);
        frames.push({ kind: 'image', src: r ? r.full : null });
        thumbs.push(r ? r.thumb : null);
      }
    }
    renderDeck();
    stageAt(0);
  }

  let io = null;
  function renderDeck() {
    clear(grid);
    if (io) { io.disconnect(); io = null; }
    notes.hidden = true;
    head.hidden = !deck; deckMenuBtn.hidden = !deck; saveBannerBtn.hidden = !deck;
    if (!deck) { head.textContent = ''; info.textContent = ''; grid.appendChild(emptyState('slides', decks.length ? 'No slide deck open' : 'No slides yet', decks.length ? 'Pick a deck from the library.' : 'Add a PDF, PowerPoint, pictures, or a Google Slides / web link.', null, { style: { gridColumn: '1/-1' } })); return; }
    head.textContent = deck.name;
    info.textContent = deck.count + ' slides' + (deck.size ? ' · ' + fmtBytes(deck.size) : '');
    if ('IntersectionObserver' in window) io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { drawThumb(e.target); io.unobserve(e.target); } }), { root: grid.parentNode, rootMargin: '200px' });
    frames.forEach((f, i) => {
      const t = h('button.thumb', { type: 'button', 'aria-pressed': String(i === stagedIndex), 'data-i': i, title: 'Slide ' + (i + 1) + ' — double-click to present',
        onclick: () => { stageAt(i); if (isLiveDeck()) live.go(i); },
        ondblclick: () => { stageAt(i); live.take(); } });
      if (deck.type !== 'pptx' && thumbs[i]) { const u = URL.createObjectURL(thumbs[i]); urls.push(u); t.appendChild(h('img', { src: u, alt: '', loading: 'lazy' })); }
      t.appendChild(h('span.n', String(i + 1)));
      grid.appendChild(t);
      if (deck.type === 'pptx') { if (io) io.observe(t); else drawThumb(t); }
    });
  }

  function drawThumb(t) {
    const i = +t.getAttribute('data-i');
    if (t.querySelector('.stage-host')) return;
    const host = h('div.stage-host');
    t.insertBefore(host, t.firstChild);
    const st = createStage(host, { placeholderOnly: true, aspect: 16 / 9 });
    st.applyStyle({ fade: 0, bg: '#000' });
    st.show(frames[i]);
  }

  const isLiveDeck = () => live.cue && live.cue.tab === 'slides' && deck && live.cue.deckId === deck.id;

  function stageAt(i) {
    if (!deck || !frames || !frames.length) { ctx.setStaged('slides', null); return; }
    stagedIndex = Math.max(0, Math.min(i, frames.length - 1));
    const fit = settings.v.slides.fit;
    const fr = frames.map((f) => (f.kind === 'image' ? Object.assign({}, f, { fit }) : f));
    const cue = {
      id: 'slides:' + deck.id, tab: 'slides', title: deck.name, sub: deck.type.toUpperCase(),
      deck: { kind: deck.type === 'pptx' ? 'html' : deck.type === 'web' ? 'web' : 'image', frames: fr }, index: stagedIndex, deckId: deck.id,
      labels: fr.map((_, k) => String(k + 1)),
      plan: { tab: 'slides', deck: deck.id, label: deck.name },
    };
    ctx.setStaged('slides', cue);
    Array.prototype.forEach.call(grid.children, (c, k) => c.setAttribute && c.classList.contains('thumb') && c.setAttribute('aria-pressed', String(k === stagedIndex)));
    const f = frames[stagedIndex];
    notes.hidden = !(f && f.notes);
    if (f && f.notes) notes.textContent = 'Speaker notes: ' + f.notes;
  }

  function markLive() {
    Array.prototype.forEach.call(grid.children, (c, k) => c.classList && c.classList.toggle('live', isLiveDeck() && live.index === k));
  }
  live.on('go', markLive); live.on('live', markLive);

  // ------------------------------------------------------------ import
  function showProgress(text, frac) {
    prog.hidden = text == null;
    if (text != null) { prog.firstChild.textContent = text; prog.querySelector('i').style.width = Math.round((frac || 0) * 100) + '%'; }
  }

  function box() {
    const a = ctx.link.aspect();
    const lp = settings.lowPower();
    const W = lp ? 1280 : 1920;
    return { boxW: W, boxH: Math.round(W / a) };
  }

  async function importFiles(files) {
    const imgs = files.filter((f) => /^image\//.test(f.type));
    for (const f of files) {
      try {
        if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') await importPdf(f);
        else if (/\.pptx$/i.test(f.name)) await importPptx(f);
        else if (/\.(ppt|key|odp)$/i.test(f.name)) toast(f.name + ': save it as .pptx or PDF first.', 'err', 6000);
      } catch (e) { console.error(e); toast('Could not import ' + f.name + ': ' + e.message, 'err', 7000); }
    }
    if (imgs.length) await importImages(imgs);
    showProgress(null);
    const newId = deck && deck.id;
    await loadLibrary();
    if (newId) await selectDeck(newId);
  }

  async function importPdf(file, name) {
    const { renderPdf } = await import('../lib/pdf.js');
    const id = uid();
    let count = 0;
    showProgress('Preparing ' + (name || file.name) + '…', 0);
    await renderPdf(file, Object.assign(box(), {
      quality: settings.v.slides.quality,
      onPage: async (i, r, n) => {
        await db.put('renders', id + '/' + i, { full: r.full, thumb: r.thumb });
        count = i + 1;
        showProgress('Preparing ' + (name || file.name) + ' — page ' + count + ' of ' + n, count / n);
      },
    }));
    await db.put('files', id, { id, kind: 'deck', type: 'pdf', name: (name || file.name).replace(/\.(pdf|pptx)$/i, ''), count, size: file.size, added: Date.now() });
    toast((name || file.name) + ': ' + count + ' slides ready offline.', 'ok');
    deck = { id };
  }

  async function importPptx(file) {
    // Exact conversion through the companion (LibreOffice) when it is available.
    if (ctx.companion && ctx.companion.converter) {
      try {
        showProgress('Converting ' + file.name + ' with the companion…', 0.1);
        const r = await fetch('api/convert', { method: 'POST', body: file, headers: { 'X-Filename': encodeURIComponent(file.name), 'X-Selah-Pin': settings.v.companion.pin || '' } });
        if (r.ok) { const pdf = await r.blob(); await importPdf(pdf, file.name); return; }
      } catch (e) { console.warn('convert', e); }
    }
    showProgress('Reading ' + file.name + '…', 0.2);
    const { parsePptx } = await import('../lib/pptx.js');
    const res = await parsePptx(file);
    if (!res.slides.length) throw new Error('No slides found.');
    const id = uid();
    await db.put('renders', id + '/frames', { frames: res.slides });
    await db.put('files', id, { id, kind: 'deck', type: 'pptx', name: file.name.replace(/\.pptx$/i, ''), count: res.slides.length, size: file.size, added: Date.now(), w: res.w, h: res.h });
    toast(file.name + ': ' + res.slides.length + ' slides imported. For an exact copy of the design, save it as PDF in PowerPoint.', 'ok', 7000);
    deck = { id };
  }

  async function importImages(files) {
    const { prepareImage } = await import('../lib/pdf.js');
    let name = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : 'Pictures (' + files.length + ')';
    if (files.length > 1) name = (await promptBox('Name this set of pictures', 'For example “Announcements”', name)) || name;
    const id = uid();
    let size = 0;
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (let i = 0; i < files.length; i++) {
      showProgress('Preparing pictures — ' + (i + 1) + ' of ' + files.length, (i + 1) / files.length);
      const r = await prepareImage(files[i], box());
      size += r.full.size;
      await db.put('renders', id + '/' + i, { full: r.full, thumb: r.thumb });
    }
    await db.put('files', id, { id, kind: 'deck', type: 'images', name, count: files.length, size, added: Date.now() });
    deck = { id };
  }

  // ------------------------------------------------------------ links (Google Slides, etc.)
  function googleSlidesId(url) {
    const m = String(url || '').match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/) || String(url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  async function addFromLink() {
    const raw = await promptBox('Add slides from a link', 'Paste a Google Slides, PowerPoint Online, or other slides link', '');
    if (!raw) return;
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url)) { toast('That does not look like a web link.', 'err'); return; }
    await importFromLink(url);
    showProgress(null);
    const newId = deck && deck.id;
    await loadLibrary();
    if (newId) await selectDeck(newId);
  }

  async function importFromLink(url) {
    const id = uid();
    const gid = googleSlidesId(url);
    if (gid) {
      // Try public PDF export first (works when the deck is shared “Anyone with the link”).
      const pdfUrl = 'https://docs.google.com/presentation/d/' + gid + '/export/pdf';
      showProgress('Trying Google Slides PDF export…', 0.2);
      try {
        const r = await fetch(pdfUrl, { mode: 'cors' });
        if (r.ok) {
          const blob = await r.blob();
          if (blob.type === 'application/pdf' || blob.size > 1000) {
            const file = new File([blob], 'Google Slides.pdf', { type: 'application/pdf' });
            await importPdf(file, 'Google Slides');
            toast('Google Slides imported as offline PDF.', 'ok');
            return;
          }
        }
      } catch (e) { console.warn('gs-pdf', e); }
      // Fallback: present live via the published/embed view.
      const embed = 'https://docs.google.com/presentation/d/' + gid + '/embed?start=false&loop=false&delayms=3000';
      await db.put('files', id, { id, kind: 'deck', type: 'web', name: 'Google Slides', count: 1, url: embed, added: Date.now() });
      toast('Google Slides added as a live link. Share the deck as “Anyone with the link” for offline PDF import.', 'ok', 8000);
      deck = { id };
      return;
    }
    // Generic link — present as a web page.
    const name = (await promptBox('Name this link', 'Short name for the library', url.replace(/^https?:\/\//, '').slice(0, 40))) || 'Web slides';
    await db.put('files', id, { id, kind: 'deck', type: 'web', name, count: 1, url, added: Date.now() });
    toast('Link added. It will open when you present (needs internet).', 'ok');
    deck = { id };
  }

  async function duplicateSlide() {
    if (!deck || !frames || stagedIndex < 0) return;
    const src = frames[stagedIndex];
    if (!src || src.kind !== 'image') { toast('Only picture slides can be duplicated.', 'err'); return; }
    const rec = await db.get('renders', deck.id + '/' + stagedIndex);
    if (!rec) return;
    const newI = deck.count;
    await db.put('renders', deck.id + '/' + newI, rec);
    frames.push(src);
    thumbs.push(rec.thumb || null);
    deck.count++;
    await db.put('files', deck.id, deck);
    renderDeck();
    stageAt(newI);
    toast('Slide duplicated.', 'ok', 1500);
  }

  async function deleteSlide() {
    if (!deck || !frames || stagedIndex < 0 || deck.count <= 1) { toast('Cannot delete the only slide.', 'err'); return; }
    if (!(await confirmBox('Delete this slide?', 'Remove slide ' + (stagedIndex + 1) + '?', 'Delete', true))) return;
    // Shift remaining renders down.
    for (let i = stagedIndex; i < deck.count - 1; i++) {
      const next = await db.get('renders', deck.id + '/' + (i + 1));
      if (next) await db.put('renders', deck.id + '/' + i, next);
    }
    await db.del('renders', deck.id + '/' + (deck.count - 1));
    frames.splice(stagedIndex, 1);
    thumbs.splice(stagedIndex, 1);
    deck.count--;
    await db.put('files', deck.id, deck);
    stagedIndex = Math.min(stagedIndex, deck.count - 1);
    renderDeck();
    stageAt(stagedIndex);
    toast('Slide deleted.', 'ok', 1500);
  }

  async function moveSlide(dir) {
    if (!deck || !frames) return;
    const to = stagedIndex + dir;
    if (to < 0 || to >= deck.count) return;
    // Swap renders in the database.
    const a = await db.get('renders', deck.id + '/' + stagedIndex);
    const b = await db.get('renders', deck.id + '/' + to);
    if (a && b) {
      await db.put('renders', deck.id + '/' + stagedIndex, b);
      await db.put('renders', deck.id + '/' + to, a);
    }
    // Swap in memory.
    [frames[stagedIndex], frames[to]] = [frames[to], frames[stagedIndex]];
    [thumbs[stagedIndex], thumbs[to]] = [thumbs[to], thumbs[stagedIndex]];
    stagedIndex = to;
    renderDeck();
    stageAt(stagedIndex);
  }
  async function renameDeck() {
    const n = await promptBox('Rename', 'Name', deck.name);
    if (!n) return;
    deck.name = n; await db.put('files', deck.id, deck);
    renderLibrary(); head.textContent = n; stageAt(stagedIndex);
  }
  async function deleteDeck() {
    if (!(await confirmBox('Delete slides?', 'Remove “' + deck.name + '” from this device?', 'Delete', true))) return;
    await db.delPrefix('renders', deck.id + '/');
    await db.del('files', deck.id);
    deck = null; ctx.setStaged('slides', null);
    await loadLibrary();
  }
  /** Draw a PowerPoint (HTML) slide to a picture: render it, copy every computed style, and rasterise through SVG. */
  async function rasterSlide(f) {
    const W = Math.round(f.w || 960), H = Math.round(f.h || 540);
    const k = Math.min(2, 1920 / W);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-20000px;top:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden;';
    document.body.appendChild(host);
    try {
      const cleanup = await renderFrame(host, f, { sw: W, sh: H });
      const box = host.querySelector('.f-html');
      if (!box) throw new Error('no slide');
      box.style.transform = 'none';
      await new Promise((r) => setTimeout(r, 60));
      const toData = async (u) => {
        const b = await (await fetch(u)).blob();
        return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
      };
      const clone = box.cloneNode(true);
      const src = [box, ...box.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
      for (let i = 0; i < src.length; i++) {
        const cs = getComputedStyle(src[i]);
        let css = '';
        for (const pr of cs) css += pr + ':' + cs.getPropertyValue(pr) + ';';
        dst[i].setAttribute('style', css);
        if (dst[i].tagName === 'IMG' && /^blob:/.test(src[i].src)) dst[i].setAttribute('src', await toData(src[i].src));
        const bg = cs.backgroundImage;
        const m = bg && bg.match(/url\("?(blob:[^")]+)"?\)/);
        if (m) dst[i].style.backgroundImage = 'url("' + (await toData(m[1])) + '")';
      }
      clone.style.transform = 'none'; clone.style.position = 'static';
      const xml = new XMLSerializer().serializeToString(clone);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject width="100%" height="100%">' +
        xml + '</foreignObject></svg>';
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('could not draw the slide')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
      const c = document.createElement('canvas');
      c.width = Math.round(W * k); c.height = Math.round(H * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      if (cleanup) cleanup();
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    } finally { host.remove(); }
  }

  /** Make the selected slide a banner. A PowerPoint slide becomes real slide elements (text boxes, shapes,
   *  pictures, background) that the slide editor can change; a PDF page or picture becomes the banner's picture.
   *  `exact` makes a flat picture of a PowerPoint slide instead (looks identical, but is not editable). */
  async function makeBanner(exact) {
    if (!deck || !frames || !frames[stagedIndex]) { toast('Open a slide first.', 'err'); return; }
    const f = frames[stagedIndex];
    const name = deck.name + ' – slide ' + (stagedIndex + 1);
    try {
      let spec = null, msg = 'Slide ' + (stagedIndex + 1) + ' is now a banner. Save it, or set it as Next.';
      if (f.kind === 'image') {
        const r = await db.get('renders', deck.id + '/' + stagedIndex);
        if (r && r.full) spec = { blob: r.full, name };
        msg = 'Slide ' + (stagedIndex + 1) + ' is now a banner with the page as its picture. Add or change text with the slide tools; the words inside the page are part of the picture.';
      } else if (f.kind === 'html') {
        if (exact !== true) {
          try {
            const { slideToBanner } = await import('../core/slidetobanner.js');
            const r = slideToBanner(f);
            if (r.els.length) { spec = { els: r.els, bg: r.bg, name }; msg = 'Slide ' + (stagedIndex + 1) + ' is now a banner you can edit: click its text to retype it, move or resize anything, change colours. Save it, or set it as Next.'; }
          } catch (e) { console.warn('slide to banner', e); }
        }
        if (!spec) {
          let blob = null;
          try { blob = await rasterSlide(f); } catch (e) { console.warn('raster', e); }
          if (blob && blob.size > 2000) { spec = { blob, name }; msg = 'Slide ' + (stagedIndex + 1) + ' is now a picture banner (an exact copy, so its words cannot be retyped).'; }
          else {
            const d = new DOMParser().parseFromString('<div>' + String(f.html || '').replace(/<\/(p|div|h\d|li)>/gi, '$&\n') + '</div>', 'text/html');
            const lines = (d.body.textContent || '').split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
            if (lines.length) spec = { title: lines[0], text: lines.slice(1).join('\n'), name };
          }
        }
      }
      if (!spec) { toast('This slide cannot become a banner (web links have no picture). Import it as PDF first.', 'err', 6000); return; }
      const ai = await ctx.showTab('ai');
      const b = ai && ai.fromSlide ? ai : await ctx.tab('ai');
      await b.fromSlide(spec);
      toast(msg, 'ok', 6000);
    } catch (e) { console.error(e); toast('Could not make a banner: ' + e.message, 'err', 6000); }
  }
  async function addToPlan() { const c = ctx.stagedOf('slides'); if (c) (await ctx.tab('plan')).addItem(c.plan); }

  // ------------------------------------------------------------ auto-advance (announcement loops)
  function stopAuto() { clearInterval(autoT); autoT = null; }
  live.on('live', (c) => { if (!c || c.tab !== 'slides') stopAuto(); });

  const api = {
    el,
    importFiles,
    /** Read the slide library again (after a shared plan brought slides in). */
    async reload() { await ready; await loadLibrary(); },
    async open({ deck: id, index = 0 }) {
      await ready;
      await ctx.showTab('slides');
      if (!decks.some((d) => d.id === id)) { toast('Those slides are no longer on this device.', 'err'); return null; }
      await selectDeck(id); stageAt(index);
      return ctx.stagedOf('slides');
    },
    controls(cue) {
      const secs = settings.v.slides.autoSec || 8;
      const sel = h('select.field', { title: 'Seconds per slide', 'aria-label': 'Seconds per slide', style: { height: '36px' }, onchange: () => { settings.set('slides.autoSec', +sel.value); if (autoT) { stopAuto(); start(); } } },
        [5, 8, 10, 15, 20, 30].map((s) => h('option', { value: s, selected: s === secs }, s + ' s')));
      const autoB = h('button.btn.sm', { type: 'button', 'aria-pressed': String(!!autoT), title: 'Advance automatically and loop (for announcements)',
        onclick: () => { if (autoT) stopAuto(); else start(); autoB.setAttribute('aria-pressed', String(!!autoT)); } }, icon('loop'), h('span', 'Auto'));
      function start() { cue.autoLoop = true; autoT = setInterval(() => live.next(), (settings.v.slides.autoSec || 8) * 1000); }
      const go = h('input.field', { type: 'number', min: 1, max: cue.deck.frames.length, placeholder: '#', title: 'Go to slide number', 'aria-label': 'Go to slide number', style: { width: '64px', height: '36px' },
        onkeydown: (e) => { if (e.key === 'Enter') { live.go((+go.value || 1) - 1); go.value = ''; go.blur(); } } });
      return h('div.row', autoB, sel, h('span.hide-sm', go));
    },
  };
  const ready = loadLibrary();
  return api;
}
