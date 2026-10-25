// Bible tab: pick a passage (type it, or tap book → chapter → verses), see it in Next,
// press Present. Whole verses only: up to 3 verses share a slide, longer passages go over several slides.
import { h, clear, esc, debounce } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn, modal, seg, toggle, menu, select, activatable, enter, motionOK, emptyState, keepInView } from '../core/ui.js';
import { EN, SHORT, parseRef, refText } from '../core/books.js';
import { listTranslations, getInfo, versesFor, verseHtml, verseText, search as bibleSearch } from '../core/bibledata.js';
import { fitsText } from '../core/render.js';
const importBibleDialog = (cb) => import('./bible-import.js').then((m) => m.importBibleDialog(cb));

export default function create(ctx) {
  const { settings, live } = ctx;
  const S = () => settings.v.bible;
  const st = { tr: S().primary, book: 43, chapter: 3, segs: null, step: 'books', mode: 'browse' };
  let info = null, trList = [], noFocus = false;

  // ------------------------------------------------------------ toolbar
  const refInput = h('input.field', { type: 'search', placeholder: 'John 3:16-18', style: { width: '200px' }, 'aria-label': 'Bible reference',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); goRef(refInput.value, e.ctrlKey || e.metaKey); } } });
  // Focus that we set ourselves stays quiet until the operator types or clicks.
  ['keydown', 'pointerdown', 'blur'].forEach((ev) => refInput.addEventListener(ev, () => refInput.classList.remove('quiet-focus')));
  const trSel = h('select.field', { 'aria-label': 'Translation', onchange: () => setTr(trSel.value) });
  const parSel = h('select.field.hide-sm', { 'aria-label': 'Second translation (side by side)', title: 'Show a second translation next to the first', onchange: () => { settings.set('bible.parallel', parSel.value); restage(); } });
  const searchBtn = btn('search', 'Search the Bible', () => setMode(st.mode === 'search' ? 'browse' : 'search'), { cls: 'sm' });
  const optsBtn = btn('settings', 'Bible display options', () => optionsDialog(), { cls: 'sm' });
  const moreBtn = btn('more', 'More', () => menu(moreBtn, [
    { label: 'Add a Bible (NIV, ESV, NKJV, …)', icon: 'plus', onclick: () => importBibleDialog(async (id) => { await loadTranslations(); setTr(id); }) },
    { label: 'Add this passage to the service plan', icon: 'plan', onclick: addToPlan, disabled: !st.segs },
    { label: 'Clear history', icon: 'trash', onclick: () => { settings.set('bible.history', []); renderHistory(); } },
  ]), { cls: 'sm' });
  // Placeholder options until the list loads, so the toolbar keeps its size (no layout jump on phones).
  [['kjv', 'KJV'], ['web', 'WEB'], ['afr53', 'AFR']].forEach(([v, a]) => trSel.appendChild(h('option', { value: v }, a)));
  trSel.value = st.tr;
  parSel.appendChild(h('option', { value: '' }, 'No second'));
  const toolbar = h('div.toolbar', h('h2', 'Bible'), refInput, trSel, h('span.faint.hide-sm', { 'aria-hidden': 'true' }, '+'), parSel, h('div.grow'), searchBtn, optsBtn, moreBtn);
  const hist = h('div.bible-hist');

  // ------------------------------------------------------------ browse panes
  const crumbs = h('div.crumbs');
  const bookGrid = h('div.book-grid');
  const chapGrid = h('div.num-grid');
  const verseList = h('div.verse-list');
  // 1 2 3 … n: every verse of the chapter one tap away (tap selects it as Next, double-tap presents).
  const vStrip = h('div.vstrip', { role: 'group', 'aria-label': 'Jump to verse' });
  const chapHead = h('span', 'Chapter');
  const verseHead = h('span.grow.trunc', 'Verses');
  const split = h('div.split.bible-split', { 'data-step': 'books' },
    h('div.pane.p-books', h('div.pane-h', 'Books'), h('div.scroll', bookGrid)),
    h('div.pane.p-chapters', h('div.pane-h', chapHead), h('div.scroll', chapGrid)),
    h('div.pane.p-verses', h('div.pane-h', verseHead, h('span.faint', { style: { fontWeight: 400 } }, 'Tap · Shift+tap for a range · Double-tap to present')), vStrip, h('div.scroll', verseList)));

  // ------------------------------------------------------------ search panel
  const sInput = h('input.field.grow', { type: 'search', placeholder: 'Words to find, e.g. “faith hope love”', onkeydown: (e) => { if (e.key === 'Enter') runSearch(); } });
  const sProg = h('div.progress', { hidden: true }, h('i'));
  const sResults = h('div.verse-list');
  const sPanel = h('div.tabpanel', { hidden: true, style: { display: 'flex' } },
    h('div.toolbar', sInput, h('button.btn.primary', { type: 'button', onclick: () => runSearch() }, 'Search'), btn('x', 'Close search', () => setMode('browse'), { cls: 'sm' })),
    sProg, h('div.scroll', { style: { flex: '1' } }, sResults));

  const el = h('section', toolbar, hist, crumbs, split, sPanel);

  function setMode(m) {
    st.mode = m;
    split.hidden = m === 'search'; crumbs.hidden = m === 'search'; sPanel.hidden = m !== 'search';
    searchBtn.setAttribute('aria-pressed', String(m === 'search'));
    if (m === 'search') setTimeout(() => sInput.focus(), 30);
  }

  // ------------------------------------------------------------ translations
  async function loadTranslations() {
    trList = await listTranslations(true);
    clear(trSel); clear(parSel);
    parSel.appendChild(h('option', { value: '' }, 'No second'));
    trList.forEach((t) => {
      trSel.appendChild(h('option', { value: t.id, title: t.name }, t.abbr));
      parSel.appendChild(h('option', { value: t.id, title: t.name }, t.abbr));
    });
    if (!trList.some((t) => t.id === st.tr) && trList[0]) st.tr = trList[0].id;
    trSel.value = st.tr;
    parSel.value = trList.some((t) => t.id === S().parallel) ? S().parallel : '';
  }

  async function setTr(id) {
    st.tr = id; trSel.value = id;
    settings.set('bible.primary', id);
    info = await getInfo(id);
    renderBooks(); renderChapters(); await renderVerses();
    restage();
  }

  // ------------------------------------------------------------ browse rendering
  const bookLabel = (i) => (info.lang === 'en' || !info.lang ? SHORT[i] : info.names[i]);
  function renderBooks() {
    clear(bookGrid);
    bookGrid.appendChild(h('div.grp', 'Old Testament'));
    info.books.forEach((b, i) => {
      if (i === 39) bookGrid.appendChild(h('div.grp', 'New Testament'));
      if (!b[1]) return;
      bookGrid.appendChild(h('button' + (i >= 39 ? '.nt' : ''), { type: 'button', title: b[0], 'aria-pressed': String(st.book === i + 1),
        onclick: () => { st.book = i + 1; st.chapter = 1; renderBooks(); renderChapters(); setStep('chapters'); renderVerses(); } }, bookLabel(i)));
    });
    renderCrumbs();
  }

  function renderChapters() {
    clear(chapGrid);
    const b = info.books[st.book - 1];
    chapHead.textContent = b[0];
    for (let c = 1; c <= b[1]; c++) {
      chapGrid.appendChild(h('button', { type: 'button', 'aria-label': b[0] + ' ' + c, 'aria-pressed': String(st.chapter === c),
        onclick: () => { st.chapter = c; renderChapters(); setStep('verses'); renderVerses(); } }, String(c)));
    }
    renderCrumbs();
  }

  let lastClicked = null;
  async function renderVerses() {
    const book = st.book, chap = st.chapter;
    verseHead.textContent = info.names[book - 1] + ' ' + chap;
    const verses = await versesFor(st.tr, book, [{ c1: chap, v1: null, c2: chap, v2: null }]);
    if (book !== st.book || chap !== st.chapter) return;
    clear(verseList);
    if (info.lang && info.lang !== 'en') verseList.setAttribute('lang', info.lang); else verseList.removeAttribute('lang');
    const frag = document.createDocumentFragment();
    verses.forEach((v) => {
      const row = h('div.vr', { 'data-v': v.v, html: '<b>' + v.v + '</b><span>' + verseHtml(v.text, { redLetter: false, italics: S().italics }) + '</span>' });
      // Enter presents the verse at once (like a double-click); Space and a click only select it.
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); presentVerse(book, chap, v.v); } });
      activatable(row);
      row.addEventListener('click', (e) => clickVerse(v.v, e.shiftKey));
      row.addEventListener('dblclick', () => presentVerse(book, chap, v.v));
      frag.appendChild(row);
    });
    verseList.appendChild(frag);
    renderStrip(verses);
    enter(verseList, 'fade');
    markSelection();
    markLive();
    renderCrumbs();
  }

  const presentVerse = (book, chap, v) => selectVerses(book, [{ c1: chap, v1: v, c2: chap, v2: v }]).then(() => live.take());
  function renderStrip(verses) {
    clear(vStrip);
    const book = st.book, chap = st.chapter;
    vStrip.setAttribute('aria-label', 'Jump to verse in ' + info.names[book - 1] + ' ' + chap);
    const frag = document.createDocumentFragment();
    verses.forEach((v) => frag.appendChild(h('button', { type: 'button', 'data-v': v.v, tabindex: '-1', 'aria-label': 'Verse ' + v.v, 'aria-pressed': 'false',
      onclick: (e) => clickVerse(v.v, e.shiftKey),
      ondblclick: () => presentVerse(book, chap, v.v),
      onkeydown: (e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); presentVerse(book, chap, v.v); } } }, String(v.v))));
    vStrip.appendChild(frag);
    vStrip.hidden = !verses.length;
    vStrip.scrollLeft = 0;
  }
  // A mouse wheel scrolls the strip sideways (it is one row on every screen size).
  vStrip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || vStrip.scrollWidth <= vStrip.clientWidth) return;
    e.preventDefault(); vStrip.scrollLeft += e.deltaY;
  }, { passive: false });
  /** Keep a strip button visible inside the strip (sideways only; the page never moves). */
  function stripShow(b) {
    if (!b || vStrip.hidden) return;
    const l = b.offsetLeft - vStrip.offsetLeft, r = l + b.offsetWidth;
    if (l >= vStrip.scrollLeft && r <= vStrip.scrollLeft + vStrip.clientWidth) return;
    vStrip.scrollTo({ left: Math.max(0, l - Math.round(vStrip.clientWidth / 3)), behavior: motionOK() ? 'smooth' : 'auto' });
  }

  function clickVerse(v, shift) {
    const chap = st.chapter;
    let segs;
    const s0 = st.segs && st.segs.length === 1 && st.segs[0];
    if (shift && s0 && st.selBook === st.book && s0.c1 === chap && s0.c2 === chap && lastClicked != null) {
      const a = Math.min(lastClicked, v), b = Math.max(lastClicked, v);
      segs = [{ c1: chap, v1: a, c2: chap, v2: b }];
    } else { segs = [{ c1: chap, v1: v, c2: chap, v2: v }]; lastClicked = v; }
    selectVerses(st.book, segs);
  }

  function markSelection() {
    const rows = verseList.children;
    for (const r of rows) {
      const v = +r.getAttribute('data-v');
      const on = st.selBook === st.book && (st.segs || []).some((s) => inSeg(s, st.chapter, v));
      if (on && !r.classList.contains('sel')) enter(r, 'pick'); // soft pulse on newly picked verses
      r.classList.toggle('sel', on);
      r.setAttribute('aria-pressed', String(on));
    }
    let first = null;
    for (const b of vStrip.children) {
      const v = +b.getAttribute('data-v');
      const on = st.selBook === st.book && (st.segs || []).some((s) => inSeg(s, st.chapter, v));
      b.setAttribute('aria-pressed', String(on));
      if (on && !first) first = b;
    }
    // One stop for the Tab key: the selected verse (or verse 1); the number keys and the list reach the rest.
    for (const b of vStrip.children) b.tabIndex = b === (first || vStrip.firstChild) ? 0 : -1;
    stripShow(first);
  }
  // Live = the verses on screen now (this slide); the rest of the live passage gets a lighter mark.
  function markLive() {
    const c = live.cue;
    const on = c && c.tab === 'bible' && c.book === st.book && c.trId === st.tr;
    const cur = on && c.ranges ? [c.ranges[Math.min(live.index, c.ranges.length - 1)]] : on ? c.segs : [];
    let firstRow = null, firstChip = null;
    for (const r of verseList.children) {
      const v = +r.getAttribute('data-v');
      const isLive = !!on && cur.some((s) => inSeg(s, st.chapter, v));
      r.classList.toggle('live', isLive);
      r.classList.toggle('in-live', !!on && !isLive && c.segs.some((s) => inSeg(s, st.chapter, v)));
      if (isLive && !firstRow) firstRow = r;
    }
    for (const b of vStrip.children) {
      const isLive = !!on && cur.some((s) => inSeg(s, st.chapter, +b.getAttribute('data-v')));
      b.classList.toggle('live', isLive);
      if (isLive && !firstChip) firstChip = b;
    }
    return { row: firstRow, chip: firstChip };
  }
  // When the live verse changes (arrows, F5, Next, clicker, a click), the list scrolls so it stays in view.
  // Focus is never moved; reduced motion jumps instead of gliding.
  let liveChap = null;
  async function followLive() {
    const c = live.cue;
    if (!c || c.tab !== 'bible' || !info) { markLive(); liveChap = null; return; }
    const r = c.ranges ? c.ranges[Math.min(live.index, c.ranges.length - 1)] : c.segs[0];
    // Reading on into the next chapter: the list follows, if it was showing the chapter being read.
    if (c.book === st.book && c.trId === st.tr && liveChap != null && st.chapter === liveChap && r.c1 !== st.chapter && st.mode === 'browse') {
      st.chapter = r.c1; renderChapters(); await renderVerses();
    }
    liveChap = c.book === st.book ? r.c1 : null;
    // The reference box and the history chip say what is on screen now (John 3:19–20), not where reading began.
    if (c.continued && c.book === st.book) {
      if (document.activeElement !== refInput) refInput.value = refText(info.names, c.book, c.segs);
      const list = S().history || [];
      const ref = refText(EN, c.book, c.segs);
      if (list[0] && list[0].tr === c.trId && list[0].ref !== ref) {
        settings.set('bible.history', [{ ref, tr: c.trId }].concat(list.slice(1).filter((x) => !(x.ref === ref && x.tr === c.trId))));
        renderHistory();
      }
    }
    const m = markLive();
    if (!el.hidden) { keepInView(m.row); stripShow(m.chip); }
  }
  const inSeg = (s, c, v) => {
    const v1 = s.v1 == null ? 1 : s.v1, v2 = s.v2 == null ? 999 : s.v2;
    if (c < s.c1 || c > s.c2) return false;
    if (c === s.c1 && v < v1) return false;
    if (c === s.c2 && v > v2) return false;
    return true;
  };

  function setStep(step) {
    const was = st.step;
    st.step = step; split.setAttribute('data-step', step); renderCrumbs();
    // Phones show one pane at a time: slide the new one in from the side it comes from.
    if (was !== step && ctx.isMobile()) {
      const order = ['books', 'chapters', 'verses'];
      enter(split.querySelector('.p-' + step), order.indexOf(step) > order.indexOf(was) ? 'from-right' : 'from-left');
    }
  }
  function renderCrumbs() {
    if (!info) return;
    clear(crumbs);
    const c = (label, step) => h('button.chip', { type: 'button', 'aria-pressed': String(st.step === step), onclick: () => setStep(step) }, label);
    crumbs.append(c('Books', 'books'), icon('next'), c(info.names[st.book - 1], 'chapters'), icon('next'), c('Chapter ' + st.chapter, 'verses'));
  }

  // ------------------------------------------------------------ selection → staged cue
  async function selectVerses(book, segs, { reveal = true } = {}) {
    st.selBook = book; st.segs = segs;
    if (reveal) {
      st.book = book;
      if (st.chapter !== segs[0].c1) { st.chapter = segs[0].c1; renderChapters(); await renderVerses(); }
      renderBooks();
      markSelection();
      const row = verseList.querySelector('.vr.sel');
      if (ctx.isMobile()) setStep('verses');
      keepInView(row);
    }
    refInput.value = refText(info.names, book, segs);
    const cue = await buildCue(st.tr, book, segs);
    if (st.segs === segs) ctx.setStaged('bible', cue);
    return cue;
  }
  const restage = debounce(() => { if (st.segs) selectVerses(st.selBook, st.segs, { reveal: false }); }, 50);

  async function goRef(text, present) {
    await ready; // the Bibles may still be loading on a slow device
    if (!info) return null;
    const r = parseRef(text);
    if (!r) { ctx.toast('Could not read “' + text + '”. Try “John 3:16” or “Ps 23”.', 'err'); return null; }
    if (!info.books[r.book - 1] || !info.books[r.book - 1][1]) { ctx.toast(info.abbr + ' has no ' + EN[r.book - 1] + '.', 'err'); return null; }
    const cue = await selectVerses(r.book, r.segs);
    if (present && cue) live.take(cue);
    return cue;
  }

  // ------------------------------------------------------------ slide building
  async function buildCue(tr, book, segs) {
    const tinfo = await getInfo(tr);
    const verses = await versesFor(tr, book, segs);
    if (!verses.length) return null;
    const parId = S().parallel && S().parallel !== tr ? S().parallel : null;
    let pinfo = null, pmap = null;
    if (parId) {
      try { pinfo = await getInfo(parId); const pv = await versesFor(parId, book, segs); pmap = new Map(pv.map((v) => [v.c + ':' + v.v, v.text])); }
      catch (e) { pinfo = null; }
    }
    const style = live.style || settings.displayStyle();
    const aspect = ctx.link.aspect();
    const ro = { redLetter: S().redLetter, italics: S().italics };
    const num = S().numbers;
    const vHtml = (p, text) => '<span class="v">' + (num ? '<span class="vn">' + p.v + (p.part || '') + '</span>' : '') + verseHtml(text, ro) + '</span>';
    const label = (g) => {
      const a = g[0], b = g[g.length - 1];
      if (g.length === 1) return a.v + (a.part || '');
      return a.c === b.c ? a.v + '–' + b.v : a.c + ':' + a.v + '–' + b.c + ':' + b.v;
    };
    const frameFor = (g) => {
      const a = g[0], b = g[g.length - 1];
      // A verse cut into parts says where it is: "Esther 8:9 (1/2)". No word is changed.
      const ref = refText(tinfo.names, book, [{ c1: a.c, v1: a.v, c2: b.c, v2: b.v }]) + (g.length === 1 && a.part ? ' (' + a.pn + '/' + a.pt + ')' : '');
      const html = g.map((p) => vHtml(p, p.text)).join('');
      const f = { kind: 'text', variant: 'bible', html, foot: ref, footR: tinfo.abbr, refPos: S().refPos };
      if (pinfo) {
        const phtml = g.map((p) => vHtml(p, p.ptext != null ? p.ptext : pmap.get(p.c + ':' + p.v) || '')).join('');
        f.cols = [{ html, ref: tinfo.abbr }, { html: phtml, ref: pinfo.abbr }];
        f.colLayout = S().parallelLayout; f.footR = '';
      }
      return f;
    };
    // Whole verses only: a verse is never cut across slides. Up to 3 verses share a slide (or the number
    // chosen in the options); a longer passage is spread evenly over slides (4 verses: 2 + 2, 7: 3 + 2 + 2).
    // The text gets smaller when it must, down to a floor; only below that do the verses go on more slides.
    const usual = Math.max(style.minFont || 58, Math.round((style.maxFont || 150) * 0.56));
    const STEPS = [usual, 72, 64, 56, 50, 44, 40];
    const SINGLE = [usual, 72, 64, 56, 50, 44, 40, 36, 32, 28];
    const smallest = (g, steps) => {
      for (const px of steps) if (fitsText(frameFor(g), Object.assign({}, style, { minFont: px }), aspect)) return px;
      return 0;
    };
    const per = S().perSlide;
    const maxPer = per === 'auto' ? 3 : Math.max(1, +per || 1);
    const groups = [];
    const sizes = [];
    const balanced = (list, max) => {
      const k = Math.ceil(list.length / max);
      const base = Math.floor(list.length / k), extra = list.length % k;
      const out = [];
      let i = 0;
      for (let j = 0; j < k; j++) { const n = base + (j < extra ? 1 : 0); out.push(list.slice(i, i + n)); i += n; }
      return out;
    };
    const place = (g) => {
      if (g.length === 1) { groups.push(g); sizes.push(smallest(g, SINGLE) || SINGLE[SINGLE.length - 1]); return; }
      const px = smallest(g, STEPS);
      if (px) { groups.push(g); sizes.push(px); return; }
      balanced(g, Math.ceil(g.length / 2)).forEach(place); // too long even small: fewer verses on each slide
    };
    balanced(verses, maxPer).forEach(place);
    const baseFrame = frameFor;
    const frameAt = (g, i) => { const f = baseFrame(g); if (sizes[i] && sizes[i] < (style.minFont || 58)) f.minFont = sizes[i]; return f; };
    const frames = groups.map(frameAt);
    const first = verses[0], last = verses[verses.length - 1];
    const title = refText(tinfo.names, book, segs);
    return {
      id: 'bible:' + tr + ':' + book + ':' + JSON.stringify(segs), tab: 'bible', title,
      sub: tinfo.abbr + (pinfo ? ' + ' + pinfo.abbr : ''),
      deck: { kind: 'text', frames }, index: 0, labels: groups.map(label),
      ranges: groups.map((g) => ({ c1: g[0].c, v1: g[0].v, c2: g[g.length - 1].c, v2: g[g.length - 1].v })),
      trId: tr, book, segs, bounds: { first: { c: first.c, v: first.v }, last: { c: last.c, v: last.v } },
      extend: S().continue ? (dir) => extend(tr, book, dir) : null,
      onTake: () => pushHistory(refText(EN, book, segs), tr),
      plan: { tab: 'bible', ref: refText(EN, book, segs), tr, label: title + ' (' + tinfo.abbr + ')' },
    };
  }

  // Continue reading past the selection (Next on the last slide shows the following verses).
  async function extend(tr, book, dir) {
    const cur = live.cue;
    if (!cur || !cur.bounds) return null;
    const tinfo = await getInfo(tr);
    const counts = tinfo.books[book - 1][2];
    const step = S().perSlide === 'auto' ? 3 : +S().perSlide || 1;
    let c, v1, v2;
    if (dir > 0) {
      c = cur.bounds.last.c; v1 = cur.bounds.last.v + 1;
      if (v1 > counts[c - 1]) { c += 1; v1 = 1; }
      if (c > counts.length) return null;
      v2 = Math.min(counts[c - 1], v1 + step - 1);
    } else {
      c = cur.bounds.first.c; v2 = cur.bounds.first.v - 1;
      if (v2 < 1) { c -= 1; if (c < 1) return null; v2 = counts[c - 1]; }
      v1 = Math.max(1, v2 - step + 1);
    }
    const cue = await buildCue(tr, book, [{ c1: c, v1, c2: c, v2 }]);
    if (cue && dir < 0) cue.index = cue.deck.frames.length - 1;
    if (cue) { cue.onTake = null; cue.continued = true; }
    return cue;
  }

  // ------------------------------------------------------------ history & plan
  function pushHistory(ref, tr) {
    const list = (S().history || []).filter((x) => !(x.ref === ref && x.tr === tr));
    list.unshift({ ref, tr });
    settings.set('bible.history', list.slice(0, 12));
    renderHistory();
  }
  function renderHistory() {
    clear(hist);
    (S().history || []).forEach((x) => {
      const t = trList.find((y) => y.id === x.tr);
      hist.appendChild(h('button.chip', { type: 'button', title: 'Select again', onclick: () => api.open({ ref: x.ref, tr: x.tr }) }, x.ref + (t ? '  ' + t.abbr : '')));
    });
  }
  async function addToPlan() {
    const cue = ctx.stagedOf('bible');
    if (!cue) return;
    (await ctx.tab('plan')).addItem(cue.plan);
  }

  // ------------------------------------------------------------ search
  let searchCtl = null;
  async function runSearch() {
    const q = sInput.value.trim();
    if (!q) return;
    if (parseRef(q) && /\d/.test(q)) { setMode('browse'); goRef(q); return; }
    if (searchCtl) searchCtl.aborted = true;
    const my = searchCtl = { aborted: false };
    clear(sResults); sProg.hidden = false;
    const bar = sProg.firstChild;
    const res = await bibleSearch(st.tr, q, { onProgress: (p) => { bar.style.width = Math.round(p * 100) + '%'; }, signal: my });
    if (my.aborted) return;
    sProg.hidden = true;
    if (!res.length) {
      const other = trList.find((t) => t.id !== st.tr && (t.lang || 'en') === (info.lang || 'en')) || trList.find((t) => t.id !== st.tr);
      sResults.appendChild(emptyState('search', 'No verses found', 'All the words must appear in ' + info.abbr + '. Try fewer words' + (other ? ' or another translation.' : '.'),
        other ? { label: 'Search ' + other.abbr, onclick: async () => { await setTr(other.id); runSearch(); } } : null));
      return;
    }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp('(' + words.join('|') + ')', 'gi');
    // Highlight in the plain text and escape each piece, so a search for e.g. "quota" cannot
    // match inside an escaped character such as &quot; and break the verse.
    const marked = (t) => verseText(t).split(re).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
    res.forEach((r, i) => {
      const ref = info.names[r.b - 1] + ' ' + r.c + ':' + r.v;
      const row = h('div.vr', { html: '<b style="min-width:auto;white-space:nowrap">' + esc(ref) + '</b><span>' + marked(r.text) + '</span>' });
      if (i < 12) row.style.setProperty('--i', i); // stagger the first rows only
      activatable(row);
      row.addEventListener('click', () => { setMode('browse'); selectVerses(r.b, [{ c1: r.c, v1: r.v, c2: r.c, v2: r.v }]); });
      sResults.appendChild(row);
    });
    enter(sResults, 'stagger', 700);
    if (res.length >= 200) sResults.appendChild(h('p.note.pad', 'Showing the first 200 matches. Add more words to narrow it down.'));
  }

  // ------------------------------------------------------------ options
  function optionsDialog() {
    const s = S();
    const set = (k) => (v) => { settings.set('bible.' + k, v); restage(); };
    modal({
      title: 'Bible on screen',
      body: h('div.form',
        // On phones the second translation lives here instead of the crowded toolbar.
        ctx.isMobile() ? h('label', 'Second translation') : null,
        ctx.isMobile() ? (() => { const x = select([['', 'None']].concat(trList.filter((t) => t.id !== st.tr).map((t) => [t.id, t.abbr + ' · ' + t.name])), S().parallel || '',
          (v) => { settings.set('bible.parallel', v); parSel.value = v; restage(); }, 'field'); x.setAttribute('aria-label', 'Second translation'); return x; })() : null,
        h('label', 'Verses per slide'), seg([['auto', 'Auto (up to 3)'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], String(s.perSlide), set('perSlide')),
        h('label', ''), h('p.note', 'A verse is never cut in two: the words get smaller when a slide needs room for whole verses.'),
        h('label', 'Reference'), seg([['bottom', 'Bottom'], ['top', 'Top'], ['none', 'Hidden']], s.refPos, set('refPos')),
        h('label', 'Two translations'), seg([['cols', 'Side by side'], ['rows', 'Stacked']], s.parallelLayout, set('parallelLayout')),
        h('label', 'Verse numbers'), toggle('Show verse numbers', s.numbers, set('numbers')),
        h('label', 'Words of Jesus'), toggle('Show in colour (KJV)', s.redLetter, set('redLetter')),
        h('label', 'Supplied words'), toggle('Show in italics (KJV)', s.italics, set('italics')),
        h('label', 'Keep reading'), toggle('Next after the last slide shows the following verses', s.continue, set('continue')),
        h('label', 'Text size'), h('p.note', 'Text grows to fill the screen. Change the smallest allowed size, font and colours in Settings → Screen.'),
      ),
      actions: [{ label: 'Done', primary: true }],
    });
  }

  // ------------------------------------------------------------ public API
  const api = {
    el,
    async open({ ref, tr }) {
      await ready;
      if (tr && tr !== st.tr && trList.some((t) => t.id === tr)) await setTr(tr);
      noFocus = true;
      await ctx.showTab('bible');
      setMode('browse');
      return goRef(ref);
    },
    /** Slides for a reference without selecting it here (used by Banners → Topics). */
    async cueFor(ref, tr) {
      await ready;
      const r = parseRef(ref);
      if (!r) return null;
      const t = tr && trList.some((x) => x.id === tr) ? tr : st.tr;
      const ti = await getInfo(t);
      if (!ti.books[r.book - 1] || !ti.books[r.book - 1][1]) return null;
      const cue = await buildCue(t, r.book, r.segs);
      if (cue) cue.extend = null; // a topic passage does not "keep reading"
      return cue;
    },
    /** Number keys: select verse n of the chapter shown (two quick digits reach verse 10 and up). */
    numberKey(n, multi) {
      if (!info || st.mode !== 'browse') return false;
      const row = verseList.querySelector('.vr[data-v="' + n + '"]');
      if (!row) { if (!multi) ctx.toast(info.names[st.book - 1] + ' ' + st.chapter + ' has no verse ' + n + '.', '', 2200); return true; }
      lastClicked = n;
      selectVerses(st.book, [{ c1: st.chapter, v1: n, c2: st.chapter, v2: n }]);
      return true;
    },
    onShow() { if (!st.segs && !noFocus && !ctx.isMobile()) setTimeout(() => { refInput.classList.add('quiet-focus'); refInput.focus(); }, 50); noFocus = false; },
    controls(cue) {
      if (trList.length < 2) return null;
      const box = h('div.row.hide-sm');
      trList.slice(0, 6).forEach((t) => {
        box.appendChild(h('button.chip', { type: 'button', title: 'Show this passage in ' + t.name, 'aria-pressed': String(cue.trId === t.id),
          onclick: async () => {
            const lc = live.cue;
            if (!lc || lc.tab !== 'bible') return;
            const n = await buildCue(t.id, lc.book, lc.segs);
            if (n) { n.onTake = null; live.replace(n, live.index); }
          } }, t.abbr));
      });
      return box;
    },
  };
  live.on('live', followLive);
  live.on('go', followLive);
  window.addEventListener('selah-bibles', () => { loadTranslations().then(() => { if (!trList.some((t) => t.id === st.tr) && trList[0]) setTr(trList[0].id); }); });

  // Placeholder blocks while the Bibles load (they shimmer unless reduced motion is on).
  const skel = (n, cls) => { const f = document.createDocumentFragment(); for (let i = 0; i < n; i++) f.appendChild(h('div.sk' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' })); return f; };
  bookGrid.appendChild(skel(24)); verseList.appendChild(skel(6, 'line'));
  bookGrid.setAttribute('aria-busy', 'true');
  renderHistory(); // draw saved history straight away so the layout does not jump when the Bibles arrive
  const ready = (async () => {
    await loadTranslations();
    info = await getInfo(st.tr);
    st.tr = info.id;
    renderBooks(); bookGrid.removeAttribute('aria-busy'); renderChapters(); await renderVerses();
    renderHistory();
  })().catch((e) => { clear(bookGrid); clear(verseList); el.appendChild(emptyState('bible', 'The Bibles could not be loaded', e.message)); });

  return api;
}
