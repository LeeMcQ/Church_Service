// Service plan: prepare the order of service at home, then step through it in church.
// Each part of the plan has a name ("Opening Hymn") and, once attached, the media it shows: a Bible
// passage, hymn or chorus, slides, a video, a web page or a banner.
import { h, clear, uid, download, debounce } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn, menu, toast, promptBox, confirmBox, modal, closeModal, activatable, emptyState, toggle } from '../core/ui.js';
import { db } from '../core/db.js';
import { parseRef, refText, EN } from '../core/books.js';
import { getInfo, versesFor, listTranslations, verseText } from '../core/bibledata.js';
import { church, nextSabbath } from '../core/church.js';
import { music } from '../core/hymnmusic.js';
import { collectPlan, packageBlob, openPackage, installPackage, fmtSize, EXT } from '../core/planpack.js';

const TEMPLATES = {
  'Divine Service': [
    'Reading of the 4th Commandment',
    'Sabbath Day hymn',
    'Praise My Soul',
    'Opening Prayer',
    'Scripture Reading',
    'Scripture from the Bible',
    'Opening Hymn',
    'Pastoral Prayer',
    'Tithes & Offering',
    "Children's Story",
    'Special Item',
    'Welcome & Introduction to Speaker',
    'Sermon',
    'Closing Hymn',
    'Dismiss Us Lord',
    'Closing Prayer',
  ],
  'Sabbath School': ['Song service', 'Opening hymn', 'Opening prayer', 'Mission story', 'Lesson study', 'Closing hymn', 'Closing prayer'],
  'Vespers / AY': ['Song service', 'Opening hymn', 'Prayer', 'Scripture', 'Programme', 'Closing hymn', 'Prayer'],
  'Empty plan': [],
};
const TEMPLATE_PARTS = new Set(Object.values(TEMPLATES).flat().map((x) => x.toLowerCase()));
// Parts that show the same thing every week come ready filled in a new plan (they can still be changed).
const TEMPLATE_MEDIA = {
  'Divine Service': {
    'Reading of the 4th Commandment': { tab: 'bible', ref: 'Exodus 20:8–11', label: 'Exodus 20:8–11' },
    'Praise My Soul': { tab: 'hymns', n: 4, book: 'sda-online', label: 'Hymn 4 — Praise, My Soul, the King of Heaven' },
    'Dismiss Us Lord': { tab: 'hymns', n: 690, book: 'sda-online', label: 'Hymn 690 — Dismiss Us, Lord, With Blessing' },
  },
};

// Fields that describe an item's media (everything else — id, part, role, done — belongs to the part).
const MEDIA_KEYS = ['tab', 'n', 'book', 'ref', 'tr', 'deck', 'item', 'url', 'banner', 'loop', 'topic', 'index', 'heading', 'label'];
const KINDS = [
  ['bible', 'Bible', 'bible'], ['hymns', 'Hymn / chorus', 'hymn'], ['slides', 'Slides', 'slides'],
  ['video', 'Video / music', 'video'], ['ai', 'Banner', 'banner'], ['web', 'Web page', 'web'],
];
const low = (s) => String(s || '').toLowerCase();
const clip = (s, n) => (s.length > n ? s.slice(0, s.lastIndexOf(' ', n) > n * 0.6 ? s.lastIndexOf(' ', n) : n) + '…' : s);

export default function create(ctx) {
  const { live } = ctx;
  let plans = [], plan = null, cur = -1;
  let openTabs = [];        // ids of plans kept open as tabs

  const planSel = h('select.field', { 'aria-label': 'Plan', onchange: () => openPlan(planSel.value) });
  const tabBar = h('div.plan-tabs');
  let lastAddedId = null;   // new items go below the last one added, so several adds keep their order

  const partOf = (it) => it.part || (it.heading ? it.label : '');
  const titleOf = (it) => partOf(it) || it.label || 'Part';
  const mediaLabel = (it) => (it.heading ? '' : partOf(it) ? it.label : '');

  const moreBtn = btn('more', 'Plan options', () => menu(moreBtn, [
    { label: 'New plan…', icon: 'plus', onclick: newPlan },
    { label: 'Rename', icon: 'edit', onclick: renamePlan, disabled: !plan },
    { label: 'Duplicate this plan', icon: 'copy', onclick: duplicatePlan, disabled: !plan },
    { label: 'Save as template…', icon: 'save', onclick: saveAsTemplate, disabled: !plan || !plan.items.length },
    { label: 'Templates…', icon: 'star', onclick: manageTemplates },
    { label: 'Copy the order of service (text)', icon: 'copy', onclick: copyOrder, disabled: !plan },
    { label: 'Mark all as not shown', icon: 'reload', onclick: () => { if (plan) { plan.items.forEach((i) => { i.done = false; }); save(); render(); } }, disabled: !plan },
    { label: plan && plan.autoAdvance ? 'Auto-advance: on' : 'Auto-advance: off', icon: 'next', onclick: toggleAuto, disabled: !plan },
    '-',
    { label: 'Export to Word document…', icon: 'download', onclick: exportWord, disabled: !plan },
    { label: 'Save or share this plan (with its media)…', icon: 'send', onclick: () => sharePlan(plan.items, plan.name, 'plan'), disabled: !plan },
    { label: 'Open a shared plan or template…', icon: 'upload', onclick: importPlan },
    '-',
    { label: 'Delete this plan', icon: 'trash', onclick: deletePlan, disabled: !plan },
  ]), { cls: 'sm' });
  const nextBtn = h('button.btn.primary', { type: 'button', title: 'Put the next part of the plan on the green Next screen', onclick: () => step(1) }, icon('next'), h('span', 'Next part'));
  const prevBtn = btn('prev', 'Previous part', () => step(-1), { cls: 'sm' });

  // ------------------------------------------------------------ quick add (type, then pick a suggestion)
  const addInput = h('input.field', { type: 'search', autocomplete: 'off', spellcheck: false, 'aria-label': 'Add to the plan',
    placeholder: 'Add: hymn 73, Amazing grace, John 3:16, a slide deck, video, banner, or a part like “Offering”' });
  const sugBox = h('div.plan-sug', { role: 'listbox', hidden: true });
  const addWrap = h('div.plan-add', addInput, sugBox);
  const mediaBtn = h('button.btn', { type: 'button', title: 'Choose a Bible passage, hymn, slides, video, banner or web page', onclick: () => openPicker() }, icon('plus'), h('span', 'Add media…'));

  const listEl = h('div');
  const el = h('section',
    h('div.toolbar.plan-top', h('h2', 'Plan'), planSel, h('div.grow'), prevBtn, nextBtn, moreBtn),
    tabBar,
    h('div.toolbar.plan-addbar', addWrap, mediaBtn),
    h('div.scroll', { style: { flex: '1' } }, listEl));

  // ------------------------------------------------------------ storage
  // Plans saved by older versions, imported files or a damaged database: keep only usable items.
  const okPlan = (p) => p && typeof p === 'object' && (typeof p.id === 'string' || typeof p.id === 'number');
  function tidy(p) {
    if (typeof p.name !== 'string' || !p.name.trim()) p.name = 'Service plan';
    p.items = (Array.isArray(p.items) ? p.items : []).filter((it) => it && typeof it === 'object' && typeof it.tab === 'string');
    p.items.forEach((it) => {
      if (typeof it.label !== 'string') it.label = String(it.label == null ? '' : it.label);
      if (!it.id) it.id = uid();
      if (it.heading && !it.part) it.part = it.label;
      // Earlier versions joined the part name and the media into one label ("Opening Hymn — Hymn 73 — …").
      if (!it.heading && !it.part && it.label.includes(' — ')) {
        const k = it.label.indexOf(' — ');
        const head = it.label.slice(0, k);
        if (TEMPLATE_PARTS.has(low(head))) { it.part = head; it.label = it.label.slice(k + 3); }
      }
    });
    return p;
  }
  async function load() {
    plans = ((await db.all('plans').catch(() => [])) || []).filter(okPlan).map(tidy).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const curId = await db.get('kv', 'plan-current').catch(() => null);
    const saved = await db.get('kv', 'plan-tabs').catch(() => null);
    openTabs = (Array.isArray(saved) ? saved : []).filter((id) => plans.some((p) => p.id === id));
    clear(planSel);
    planSel.hidden = !plans.length;
    plans.forEach((p) => planSel.appendChild(h('option', { value: p.id }, p.name)));
    if (!plans.length) { plan = null; renderTabs(); render(); return; }
    openPlan(plans.some((p) => p.id === curId) ? curId : plans[0].id);
  }

  function renderTabs() {
    clear(tabBar);
    if (!openTabs.length) { tabBar.hidden = true; return; }
    tabBar.hidden = false;
    openTabs.forEach((id) => {
      const p = plans.find((x) => x.id === id);
      if (!p) return;
      const tab = h('button.plan-tab' + (plan && plan.id === id ? '.on' : ''), { type: 'button', title: p.name, onclick: () => openPlan(id) },
        h('span.trunc', p.name));
      const x = h('button.plan-tab-x', { type: 'button', title: 'Close', onclick: (e) => { e.stopPropagation(); closeTab(id); } }, '×');
      tab.appendChild(x);
      tabBar.appendChild(tab);
    });
  }

  function openPlan(id) {
    plan = plans.find((p) => p.id === id) || null;
    if (plan && !openTabs.includes(id)) openTabs.push(id);
    planSel.value = id; cur = -1; lastAddedId = null;
    db.put('kv', 'plan-current', id);
    db.put('kv', 'plan-tabs', openTabs);
    renderTabs();
    render();
  }

  function closeTab(id) {
    openTabs = openTabs.filter((x) => x !== id);
    db.put('kv', 'plan-tabs', openTabs);
    if (plan && plan.id === id) {
      const next = openTabs[openTabs.length - 1];
      if (next) openPlan(next); else { plan = null; renderTabs(); render(); }
    } else renderTabs();
  }

  const save = () => { if (plan) { plan.updated = Date.now(); return db.put('plans', plan.id, plan); } };

  // A new plan is named after the coming Sabbath (the same day the banners use), not after today.
  const today = () => 'Sabbath ' + nextSabbath().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  // ------------------------------------------------------------ templates (ready-made and your own)
  // Keys: 'b:<name>' for the ready-made orders above, 'c:<id>' for templates saved on this device.
  let myTpls = [];
  let defTpl = 'b:Divine Service';
  async function loadTpls() {
    const r = await db.get('kv', 'plan-templates').catch(() => null);
    myTpls = r && Array.isArray(r.list) ? r.list.filter((t) => t && t.id && typeof t.name === 'string' && Array.isArray(t.items)) : [];
    defTpl = (r && r.def) || 'b:Divine Service';
    if (!tplByKey(defTpl)) defTpl = 'b:Divine Service';
  }
  const saveTpls = () => db.put('kv', 'plan-templates', { list: myTpls, def: defTpl });
  function allTpls() {
    return myTpls.map((t) => ({ key: 'c:' + t.id, name: t.name, count: t.items.length, mine: true }))
      .concat(Object.keys(TEMPLATES).map((k) => ({ key: 'b:' + k, name: k, count: TEMPLATES[k].length, mine: false })));
  }
  const tplByKey = (key) => allTpls().find((t) => t.key === key) || null;
  const keyOf = (t) => (/^[bc]:/.test(t) ? t : 'b:' + t);

  function makePlan(name, template) {
    const key = keyOf(template || 'b:Empty plan');
    let items;
    if (key.startsWith('c:')) {
      const t = myTpls.find((x) => 'c:' + x.id === key);
      items = t ? JSON.parse(JSON.stringify(t.items)) : [];
      items.forEach((it) => { it.id = uid(); delete it.done; });
    } else {
      const fill = TEMPLATE_MEDIA[key.slice(2)] || {};
      items = (TEMPLATES[key.slice(2)] || []).map((label) => (fill[label]
        ? Object.assign({ id: uid(), part: label, heading: false }, fill[label])
        : { id: uid(), tab: 'note', heading: true, part: label, label }));
    }
    return { id: uid(), name, items, updated: Date.now() };
  }

  /** Save the open plan as a template: its parts, who leads them and (if wanted) the media attached. */
  function saveAsTemplate() {
    if (!plan) return;
    const base = plan.name.replace(/^Sabbath\s+\d{1,2}\s+\w+\.?$/i, '').trim();
    const name = h('input.field', { value: base || 'Our Divine Service', placeholder: 'e.g. Our Divine Service, Communion Sabbath' });
    let keep = true, makeDef = !myTpls.length;
    const same = () => myTpls.find((t) => low(t.name) === low(name.value.trim()));
    const note = h('p.note', '');
    const paintNote = () => { note.textContent = same() ? 'A template with this name exists — it will be updated.' : ''; };
    name.addEventListener('input', paintNote);
    const body = h('div.col', { style: { gap: '10px' } },
      h('p.note', 'New plans can start from this order: ' + plan.items.length + ' part' + (plan.items.length === 1 ? '' : 's') + '. Change the template any time by saving again with the same name.'),
      h('label.muted', 'Template name'), name, note,
      toggle('Keep the attached media (hymns, readings, slides, videos, banners)', keep, (v) => { keep = v; }, 'Off: only the part names and who leads them'),
      toggle('Use it for new plans (default)', makeDef, (v) => { makeDef = v; }));
    paintNote();
    modal({ title: 'Save as template', body, actions: [{ label: 'Cancel' }, { label: 'Save template', primary: true, onclick: async () => {
      const nm = name.value.trim();
      if (!nm) { toast('Give the template a name.', 'err'); return false; }
      if (TEMPLATES[nm]) { toast('“' + nm + '” is a ready-made order. Choose another name.', 'err'); return false; }
      const items = plan.items.map((it) => {
        const c = JSON.parse(JSON.stringify(it));
        delete c.done; delete c.id;
        if (!keep && !c.heading) { const t = titleOf(it); MEDIA_KEYS.forEach((k) => { delete c[k]; }); Object.assign(c, { tab: 'note', heading: true, part: t, label: t }); }
        return c;
      });
      const old = same();
      if (old) Object.assign(old, { name: nm, items, updated: Date.now() });
      else myTpls.unshift({ id: uid(), name: nm, items, updated: Date.now() });
      const t = old || myTpls[0];
      if (makeDef) defTpl = 'c:' + t.id;
      await saveTpls();
      render();
      toast((old ? 'Template updated: ' : 'Template saved: ') + nm + (makeDef ? ' (default for new plans)' : '') + '.', 'ok', 3500);
      return true;
    } }] });
    setTimeout(() => { name.focus(); name.select(); }, 40);
  }

  /** List of templates: choose the default, rename or delete your own. */
  function manageTemplates() {
    const list = h('div.col.tpl-list');
    const paint = () => {
      clear(list);
      allTpls().forEach((t) => {
        const isDef = t.key === defTpl;
        list.appendChild(h('div.tpl-row' + (isDef ? '.def' : ''),
          h('span.grow', h('div.trunc', h('b', t.name), isDef ? h('span.pi-badge.next', { style: { marginLeft: '8px' } }, 'Default') : null),
            h('div.note', t.count + ' part' + (t.count === 1 ? '' : 's') + (t.mine ? ' · yours' : ' · ready-made'))),
          h('div.row', { style: { gap: '4px' } },
            isDef ? null : h('button.btn.sm', { type: 'button', title: 'Start new plans from this template', onclick: async () => { defTpl = t.key; await saveTpls(); paint(); render(); } }, icon('star'), h('span', 'Make default')),
            h('button.btn.sm', { type: 'button', title: 'Make a new plan from this template now', onclick: async () => { closeModal(); await createFromTemplate(t.key); } }, icon('plus'), h('span.hide-sm', 'New plan')),
            t.mine ? btn('send', 'Share', () => { const tt = myTpls.find((x) => 'c:' + x.id === t.key); closeModal(); sharePlan(tt.items, tt.name, 'template'); }, { cls: 'sm' }) : null,
            t.mine ? btn('edit', 'Rename', async () => {
              const tt = myTpls.find((x) => 'c:' + x.id === t.key);
              const n = await promptBox('Rename template', 'Name', tt.name);
              if (n && n.trim() && !TEMPLATES[n.trim()]) { tt.name = n.trim(); await saveTpls(); }
              manageTemplates();
            }, { cls: 'sm' }) : null,
            t.mine ? btn('trash', 'Delete', async () => {
              const ok = await confirmBox('Delete template?', 'Delete the template “' + t.name + '”? Plans made from it stay.', 'Delete', true);
              if (ok) { myTpls = myTpls.filter((x) => 'c:' + x.id !== t.key); if (defTpl === t.key) defTpl = 'b:Divine Service'; await saveTpls(); render(); }
              manageTemplates();
            }, { cls: 'sm' }) : null)));
      });
    };
    paint();
    modal({ title: 'Plan templates', body: h('div.col', { style: { gap: '10px' } },
      h('p.note', 'New plans start from the default template. To make your own: build a plan the way your church does it, attach its hymns, slides, videos and banners, then Plan options (⋯) → Save as template. Share sends a template with its media to another device.'),
      h('div.row', h('button.btn.sm', { type: 'button', onclick: () => { closeModal(); importPlan(); } }, icon('upload'), h('span', 'Open a shared template…'))),
      list), actions: [{ label: 'Close' }] });
  }
  async function storeNew(p) { await db.put('plans', p.id, p); await db.put('kv', 'plan-current', p.id); await load(); }

  async function newPlan() {
    const body = h('div.col');
    const name = h('input.field', { value: today() });
    let tpl = defTpl;
    const tplList = h('div.row.wrap');
    allTpls().forEach((t) => tplList.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(t.key === tpl), title: t.count + ' parts' + (t.key === defTpl ? ' · default' : ''),
      onclick: (e) => { tpl = t.key; Array.from(tplList.children).forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget))); } },
      t.key === defTpl ? icon('star') : null, t.name)));
    body.append(h('label.muted', 'Name'), name, h('label.muted', 'Start from'), tplList,
      h('button.btn.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => manageTemplates() }, icon('edit'), h('span', 'Manage templates…')));
    modal({ title: 'New service plan', body, actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onclick: () => storeNew(makePlan(name.value.trim() || 'Service', tpl)) }] });
  }
  async function renamePlan() { const n = await promptBox('Rename plan', 'Name', plan.name); if (n && n.trim()) { plan.name = n.trim(); await save(); await load(); } }
  async function deletePlan() { if (await confirmBox('Delete plan?', 'Delete “' + plan.name + '”?', 'Delete', true)) { await db.del('plans', plan.id); plan = null; await load(); } }
  async function duplicatePlan() {
    if (!plan) return;
    const copy = JSON.parse(JSON.stringify(plan));
    copy.id = uid(); copy.name = plan.name + ' (copy)';
    copy.items.forEach((i) => { i.done = false; i.id = uid(); });
    copy.updated = Date.now();
    await storeNew(copy);
    toast('Plan duplicated.', 'ok');
  }
  function toggleAuto() {
    if (!plan) return;
    plan.autoAdvance = !plan.autoAdvance;
    save(); render();
    toast(plan.autoAdvance ? 'Auto-advance on: after Present, the next part is put on Next.' : 'Auto-advance off.', 'ok', 3500);
  }
  /** The plan as a Word document to print or share: order of service, and optionally the readings and hymn words. */
  async function exportWord() {
    if (!plan) return;
    const prefs = (await db.get('kv', 'plan-word').catch(() => null)) || {};
    const c = church();
    const sab = nextSabbath();
    const p2 = (n) => (n < 10 ? '0' : '') + n;
    const isoDay = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const date = h('input.field', { type: 'date', value: isoDay(sab), 'aria-label': 'Date of the service' });
    const start = h('input.field', { type: 'time', value: c.service, 'aria-label': 'Start time' });
    const o = { times: prefs.times !== false, scripture: prefs.scripture !== false, hymns: !!prefs.hymns, notes: !!prefs.notes };
    const hasMins = plan.items.some((i) => i.mins > 0);
    const body = h('div.col', { style: { gap: '10px' } },
      h('p.note', 'Makes a Word file (.docx) with the whole plan laid out to read, print and share. It opens in Word, Google Docs, LibreOffice and Pages.'),
      h('div.row.wrap', { style: { gap: '12px' } },
        h('div.col', { style: { gap: '4px' } }, h('label.muted', 'Date'), date),
        h('div.col', { style: { gap: '4px' } }, h('label.muted', 'Service starts'), start)),
      toggle('Show the time each part starts', o.times, (v) => { o.times = v; }, hasMins ? 'Worked out from the minutes planned for each part' : 'Needs minutes on the parts (part menu → Who leads / minutes)'),
      toggle('Add the Scripture readings in full', o.scripture, (v) => { o.scripture = v; }, 'The text of each Bible passage, in the plan’s translation'),
      toggle('Add the hymn words', o.hymns, (v) => { o.hymns = v; }, 'Check your copyright licence (for example CCLI) before you share the file'),
      toggle('Leave a column for notes', o.notes, (v) => { o.notes = v; }, 'Wide page with space to write on the printed copy'));
    modal({ title: 'Export to Word', body, actions: [{ label: 'Cancel' }, { label: 'Create Word document', primary: true, onclick: async () => {
      db.put('kv', 'plan-word', o).catch(() => {});
      try { await makeWord(date.value, start.value, o); } catch (e) { console.error(e); toast('Could not make the document: ' + e.message, 'err', 6000); }
    } }] });
  }
  async function makeWord(dateStr, startStr, o) {
    const { planWord } = await import('../lib/planword.js');
    const c = church();
    const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr + 'T12:00:00') : nextSabbath();
    const parts = plan.items.map((it, i) => ({ n: i + 1, part: titleOf(it), kind: it.heading ? 'note' : it.tab, kindLabel: kindText(it), detail: mediaLabel(it) || '', role: it.role || '', mins: it.mins > 0 ? it.mins : 0, empty: !!it.heading }));
    const model = { church: c.name, title: plan.name, dateLine: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      start: /^\d{1,2}:\d{2}$/.test(startStr) ? startStr.replace(/^(\d):/, '0$1:') : c.service, showTimes: o.times, notes: o.notes, parts, readings: [], hymns: [],
      generated: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) };
    if (o.scripture) {
      for (const it of plan.items) {
        if (it.heading || it.tab !== 'bible' || !it.ref) continue;
        const r = parseRef(it.ref);
        if (!r) continue;
        const tr = it.tr || ctx.settings.v.bible.primary;
        let vs = [];
        try { vs = await versesFor(tr, r.book, r.segs); } catch (e) { vs = []; }
        vs = vs.filter((v) => v.text);
        const more = vs.length > 60;
        model.readings.push({ ref: it.ref, tr, part: partOf(it) !== it.ref ? partOf(it) : '', verses: vs.slice(0, 60).map((v) => ({ v: v.v, t: verseText(v.text).trim() })), more });
      }
    }
    if (o.hymns) {
      let books = [];
      try { books = await (await fetch('data/hymns/index.json')).json(); } catch (e) { books = []; }
      const cache = {};
      for (const it of plan.items) {
        if (it.heading || it.tab !== 'hymns' || !it.n) continue;
        const order = books.filter((b) => b.id === it.book).concat(books.filter((b) => b.id !== it.book));
        for (const b of order) {
          try {
            cache[b.id] = cache[b.id] || await (await fetch('data/hymns/' + b.file)).json();
            const hy = (cache[b.id].hymns || []).find((x) => x.n === +it.n);
            if (hy && Array.isArray(hy.v)) { model.hymns.push({ n: hy.n, title: hy.t, book: b.short, stanzas: hy.v, chorus: Array.isArray(hy.c) ? hy.c : null }); break; }
          } catch (e) { /* try the next book */ }
        }
      }
    }
    const blob = planWord(model);
    download(blob, (plan.name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'Order_of_service') + '.docx');
    toast('Word document ready: “' + plan.name + '.docx”. Check your downloads.', 'ok', 5000);
  }
  // ------------------------------------------------------------ save / share a plan or template with its media
  // One .sdaplan file: the parts, who leads them, and the slides, pictures, banners and videos they show.
  // Bible passages and hymns go as references (every copy of Church Service has them).
  const safeName = (n) => (String(n || 'Service plan').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'Service_plan');
  async function sharePlan(items, name, kind) {
    if (!items || !items.length) { toast('There is nothing in this ' + (kind === 'template' ? 'template' : 'plan') + ' yet.', 'err'); return; }
    let est;
    try { est = await collectPlan(items, { media: true, videos: true, ask: false, kind, name }); } catch (e) { toast('Could not read the media: ' + e.message, 'err'); return; }
    const st = est.stats;
    let media = true, videos = st.videoBytes < 1.5 * 1073741824;
    const refs = items.filter((it) => !it.heading && (it.tab === 'bible' || it.tab === 'hymns')).length;
    const other = [st.decks ? st.decks + ' slide deck' + (st.decks === 1 ? '' : 's') : '', st.banners ? st.banners + ' banner' + (st.banners === 1 ? '' : 's') : ''].filter(Boolean).join(', ');
    const sizeNote = h('p.note', '');
    const paintSize = () => {
      const n = (media ? st.otherBytes : 0) + (media && videos ? st.videoBytes : 0);
      sizeNote.textContent = 'File size: about ' + (n ? fmtSize(n + 4096) : '10 KB') + '.';
    };
    const vidToggle = toggle('Include the videos and music' + (st.videos ? ' (' + st.videos + ', ' + fmtSize(st.videoBytes) + ')' : ''), videos, (v) => { videos = v; paintSize(); },
      'Off: the parts keep the video names; the other device adds its own copies');
    if (!st.videos) vidToggle.hidden = true;
    const body = h('div.col', { style: { gap: '10px' } },
      h('p', h('b', name), h('span.note', '  ·  ' + items.length + ' part' + (items.length === 1 ? '' : 's'))),
      toggle('Include slides, pictures and banners' + (other ? ' (' + other + (st.otherBytes ? ', ' + fmtSize(st.otherBytes) : '') + ')' : ''), media, (v) => { media = v; vidToggle.querySelector('input').disabled = !v || !st.videos; paintSize(); },
        'Off: a small file with links only: part names, who leads, Bible passages and hymns'),
      vidToggle,
      h('p.note', (refs ? refs + (refs === 1 ? ' Bible passage or hymn goes as a reference; ' : ' Bible passages and hymns go as references; ') : 'Bible passages and hymns go as references; ') +
        'every copy of Church Service has them. Bibles or hymnbooks you imported yourself must also be on the other device.'),
      est.manifest.missing.length ? h('p.note', { style: { color: 'var(--warn, #b45309)' } }, 'Not on this device, so not included: ' + est.manifest.missing.slice(0, 6).join(', ') + (est.manifest.missing.length > 6 ? '…' : '') + '.') : null,
      st.handles ? h('p.note', 'Some videos are linked to files on this PC; you may be asked to allow Church Service to read them.') : null,
      sizeNote,
      h('p.note', 'To use it: on the other device open Plan → ⋯ → Open a shared plan or template, and choose the file.'));
    paintSize();
    const make = async () => {
      const t = toast('Preparing the file…', '', 60000);
      try {
        const pack = await collectPlan(items, { media, videos: media && videos, kind, name });
        let last = 0;
        const blob = await packageBlob(pack, (done, total) => {
          const pct = total ? Math.floor((done / total) * 100) : 100;
          if (t && total > 50 * 1048576 && pct >= last + 5) { last = pct; t.textContent = 'Preparing the file… ' + pct + '%'; }
        });
        if (t && t.remove) t.remove();
        return { blob, fname: safeName(name) + EXT, pack };
      } catch (e) { toast('Could not make the file: ' + e.message, 'err', 6000); return null; }
    };
    const canShare = (() => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'plan' + EXT, { type: 'application/octet-stream' })] })); } catch (e) { return false; } })();
    const actions = [{ label: 'Cancel' }];
    if (canShare) actions.push({ label: 'Share…', onclick: async () => {
      const r = await make(); if (!r) return false;
      try { await navigator.share({ files: [new File([r.blob], r.fname, { type: 'application/octet-stream' })], title: name, text: 'Service plan from Church Service' }); }
      catch (e) { if (e.name !== 'AbortError') { download(r.blob, r.fname); toast('Sharing is not available here; the file was saved instead.', '', 4000); } }
      return true;
    } });
    actions.push({ label: 'Save file', primary: true, onclick: async () => {
      const r = await make(); if (!r) return false;
      download(r.blob, r.fname);
      toast('Saved “' + r.fname + '” (' + fmtSize(r.blob.size) + '). Check your downloads; send it by e-mail, WhatsApp, a USB stick or a shared drive.', 'ok', 7000);
      return true;
    } });
    modal({ title: kind === 'template' ? 'Save or share this template' : 'Save or share this plan', body, actions });
  }

  function importPlan() {
    const inp = h('input', { type: 'file', accept: EXT + ',.json,.zip,application/zip,application/json' });
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      let pkg;
      try { pkg = await openPackage(f); } catch (e) { toast(e.message || 'This is not a Church Service plan file.', 'err', 5000); return; }
      const m = pkg.manifest;
      const n = { decks: 0, videos: 0, pictures: 0 };
      (m.files || []).forEach((x) => { if (x && x.kind === 'deck') n.decks++; else if (x && x.kind === 'media') n.videos++; else if (x) n.pictures++; });
      const what = [n.decks ? n.decks + ' slide deck' + (n.decks === 1 ? '' : 's') : '', (m.banners || []).length ? m.banners.length + ' banner' + (m.banners.length === 1 ? '' : 's') : '',
        n.videos ? n.videos + ' video' + (n.videos === 1 ? '' : 's') : ''].filter(Boolean).join(', ');
      const linkOnly = m.items.filter((it) => it && !it.heading && ((it.tab === 'slides' && it.deck) || (it.tab === 'video' && it.item) || (it.tab === 'ai' && it.banner)))
        .filter((it) => !(m.files || []).some((x) => x && (x.id === it.deck || x.id === it.item)) && !(m.banners || []).some((b) => b && b.id === it.banner));
      const name = h('input.field', { value: m.name || f.name.replace(/\.(sdaplan|json|zip)$/i, '') });
      let asTpl = m.kind === 'template', makeDef = false;
      const defT = toggle('Use it for new plans (default template)', makeDef, (v) => { makeDef = v; });
      defT.hidden = !asTpl;
      const kindSeg = h('div.seg', { role: 'group', 'aria-label': 'Open as' });
      const paintSeg = () => {
        kindSeg.replaceChildren(...[['plan', 'A new plan'], ['tpl', 'A template']].map(([k, lab]) => h('button', { type: 'button', 'aria-pressed': String((k === 'tpl') === asTpl),
          onclick: () => { asTpl = k === 'tpl'; defT.hidden = !asTpl; paintSeg(); } }, lab)));
      };
      paintSeg();
      const body = h('div.col', { style: { gap: '10px' } },
        h('p', h('b', m.items.length + ' part' + (m.items.length === 1 ? '' : 's')), what ? h('span.note', '  ·  with ' + what) : h('span.note', '  ·  links only')),
        h('label.muted', 'Name'), name,
        h('label.muted', 'Add it as'), kindSeg, defT,
        linkOnly.length ? h('p.note', linkOnly.length + ' part' + (linkOnly.length === 1 ? ' shows' : 's show') + ' media that is not in the file (' + linkOnly.slice(0, 3).map((x) => x.label || 'media').join(', ') + (linkOnly.length > 3 ? '…' : '') + '). Add it on this device, then attach it to the part.') : null,
        h('p.note', 'Slides, pictures and videos already on this device are not copied twice.'));
      modal({ title: 'Open a shared plan', body, actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, onclick: async () => {
        const nm = name.value.trim() || 'Shared plan';
        toast('Adding…', '', 20000);
        let res;
        try {
          res = await installPackage(pkg, {
            addBanners: async (docs) => { const t = await ctx.tab('ai'); if (t.addBanners) await t.addBanners(docs); },
            reloadSlides: async () => { const t = await ctx.tab('slides'); if (t.reload) await t.reload(); },
            reloadVideos: async () => { const t = await ctx.tab('video'); if (t.reload) await t.reload(); },
          });
        } catch (e) { toast('Could not add it: ' + e.message, 'err', 6000); return false; }
        const got = [res.made.decks ? res.made.decks + ' slide deck' + (res.made.decks === 1 ? '' : 's') : '', res.made.banners ? res.made.banners + ' banner' + (res.made.banners === 1 ? '' : 's') : '',
          res.made.videos ? res.made.videos + ' video' + (res.made.videos === 1 ? '' : 's') : ''].filter(Boolean).join(', ');
        if (asTpl) {
          let tn = nm;
          if (TEMPLATES[tn]) tn += ' (shared)';
          const items = res.items.map((it) => { const c = Object.assign({}, it); delete c.id; return c; });
          const old = myTpls.find((t) => low(t.name) === low(tn));
          if (old) Object.assign(old, { items, updated: Date.now() }); else myTpls.unshift({ id: uid(), name: tn, items, updated: Date.now() });
          const t = old || myTpls[0];
          if (makeDef) defTpl = 'c:' + t.id;
          await saveTpls();
          render();
          toast('Template added: ' + tn + (makeDef ? ' (default for new plans)' : '') + (got ? '. Also added ' + got : '') + '.', 'ok', 6000);
        } else {
          const p = { id: uid(), name: nm, items: res.items, updated: Date.now() };
          tidy(p);
          await storeNew(p);
          toast('Plan added' + (got ? ' with ' + got : '') + (res.reused ? '; ' + res.reused + ' item' + (res.reused === 1 ? ' was' : 's were') + ' already here' : '') + '.', 'ok', 6000);
        }
        return true;
      } }] });
    };
    inp.click();
  }

  // ------------------------------------------------------------ list
  const KIND_NAME = { bible: 'Bible', hymns: 'Hymn', slides: 'Slides', video: 'Video', web: 'Web page' };
  function kindText(it) {
    if (it.heading) return '';
    if (it.tab === 'ai') return it.loop ? 'Pre-service loop' : it.topic ? 'Bible verses' + (it.tr ? ' · ' + it.tr.toUpperCase() : '') : 'Banner';
    return (KIND_NAME[it.tab] || '') + (it.tab === 'bible' && it.tr ? ' · ' + it.tr.toUpperCase() : '');
  }
  const KIND_COLOR = { bible: '#3b82f6', hymns: '#8b5cf6', slides: '#f59e0b', video: '#ef4444', web: '#06b6d4', ai: '#10b981', note: '#6b7280' };
  const ICONS = { bible: 'bible', hymns: 'hymn', slides: 'slides', video: 'video', web: 'web', ai: 'banner' };
  function kindColor(it) { return KIND_COLOR[it.heading ? 'note' : it.tab] || KIND_COLOR.note; }

  function previewTile(it) {
    const col = kindColor(it);
    const tile = h('div.pi-tile', { style: { background: col + '22', borderColor: col }, title: kindText(it) || 'Part' });
    if (it.heading) {
      tile.appendChild(h('span.pi-tile-t', '—'));
      return tile;
    }
    if (it.tab === 'bible') {
      tile.appendChild(h('span.pi-tile-t', it.ref || 'Bible'));
      tile.appendChild(h('span.pi-tile-s', 'Verse'));
    } else if (it.tab === 'hymns') {
      tile.appendChild(h('span.pi-tile-t', it.n ? String(it.n) : '♪'));
      const short = (it.label || '').replace(/^Hymn\s+\d+\s*[—-]\s*/i, '').slice(0, 12);
      tile.appendChild(h('span.pi-tile-s', short || 'Hymn'));
    } else if (it.tab === 'slides') {
      tile.appendChild(h('span.pi-tile-t', icon('slides')));
      if (it.deck) {
        db.get('renders', it.deck + '/0').then((r) => {
          if (r && r.thumb) {
            const u = URL.createObjectURL(r.thumb);
            tile.textContent = '';
            tile.appendChild(h('img', { src: u, alt: '', onload: () => setTimeout(() => URL.revokeObjectURL(u), 2000) }));
          }
        }).catch(() => {});
      }
    } else if (it.tab === 'video') {
      tile.appendChild(h('span.pi-tile-t', icon('video')));
      const short = (it.label || '').slice(0, 10);
      if (short) tile.appendChild(h('span.pi-tile-s', short));
    } else if (it.tab === 'ai') {
      tile.appendChild(h('span.pi-tile-t', icon('banner')));
      const short = (it.label || '').replace(/^Banner:\s*/i, '').slice(0, 10);
      if (short) tile.appendChild(h('span.pi-tile-s', short));
      // Try to show banner thumbnail.
      if (it.banner) {
        ctx.tab('ai').then((api) => {
          if (!api || !api.bannerThumb) return;
          api.bannerThumb(it.banner).then((url) => {
            if (url) { tile.textContent = ''; tile.appendChild(h('img', { src: url, alt: '' })); }
          }).catch(() => {});
        }).catch(() => {});
      }
    } else if (it.tab === 'web') {
      tile.appendChild(h('span.pi-tile-t', icon('web')));
      const short = (it.label || '').slice(0, 10);
      if (short) tile.appendChild(h('span.pi-tile-s', short));
    } else {
      tile.appendChild(h('span.pi-tile-t', icon(itemIcon(it))));
    }
    return tile;
  }
  const itemIcon = (it) => (it.heading ? 'info' : it.loop ? 'loop' : ICONS[it.tab] || 'info');

  // Which plan item is on the screen now (so the row can say "On screen"), and which was put on Next.
  const shownCue = new Map(); // item id -> cue id
  const onScreen = (it) => !!(live.cue && shownCue.get(it.id) === live.cue.id);
  live.on('live', () => {
    if (!plan) return;
    // A part counts as shown once it is really on the screen (not when it was only put on Next).
    let changed = false;
    plan.items.forEach((it) => {
      if (!it.done && onScreen(it)) {
        it.done = true; changed = true;
        // A part with a planned time starts the stage count-down when it first goes on screen.
        if (it.mins > 0 && ctx.stage) ctx.stage.planPartLive(titleOf(it), it.mins);
      }
    });
    if (changed) save();
    if (!el.hidden) render(); else publishStage();
  });
  live.on('staged', () => { if (plan && !el.hidden) render(); else publishStage(); });

  /** The order of service as the stage screens show it (names, who leads, planned time, where we are). */
  function publishStage() {
    if (!ctx.stage) return;
    if (!plan) { ctx.stage.setPlan(null); return; }
    ctx.stage.setPlan({
      name: plan.name,
      items: plan.items.map((it, i) => {
        const now = onScreen(it);
        const next = !now && !it.heading && live.staged && shownCue.get(it.id) === live.staged.id;
        return { t: titleOf(it), m: mediaLabel(it) || '', role: it.role || '', mins: it.mins > 0 ? it.mins : 0,
          st: now ? 'now' : next || (i === cur && !it.done) ? 'next' : it.done ? 'done' : '' };
      }),
    });
  }

  function summaryBar() {
    const real = plan.items.filter((x) => !x.heading);
    const linked = real.length, parts = plan.items.length;
    const done = real.filter((x) => x.done).length;
    const open = plan.items.filter((x) => x.heading).length;
    const pct = linked ? Math.round((done / linked) * 100) : 0;
    return h('div.plan-sum',
      h('div.row.wrap', h('b', plan.name), h('span.note', parts + ' part' + (parts === 1 ? '' : 's') + (linked ? ' · ' + done + ' of ' + linked + ' shown' : '')),
        open ? h('span.note.plan-open', open + ' without media yet') : null),
      linked ? h('div.plan-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'Parts shown' }, h('i', { style: { width: pct + '%' } })) : null);
  }

  async function presentItem(i, withMusic) {
    const it = plan.items[i];
    if (!it || it.heading) return;
    // Leaving a hymn: stop its music unless this present is itself starting music.
    if (!withMusic) { try { music.stop(); } catch (e) { /* */ } }
    if (withMusic && it.tab === 'hymns') {
      ctx.hold = 'plan';
      try {
        const t = await ctx.tab('hymns');
        const c = await t.presentAndPlay(it);
        if (c) { cur = i; shownCue.set(it.id, c.id); render(); }
      } catch (e) { toast('Could not present and play: ' + e.message, 'err'); }
      finally { ctx.hold = null; }
      return;
    }
    const c = await select(i);
    if (c) { live.take(c); if (plan.autoAdvance) setTimeout(() => step(1, true), 400); }
  }

  function removeItem(i) {
    const gone = plan.items.splice(i, 1)[0];
    if (!gone) return;
    const wasCur = cur;
    if (cur > i) cur--; else if (cur === i) cur = -1;
    if (lastAddedId === gone.id) lastAddedId = null;
    save(); render();
    toast(h('span', 'Removed “' + titleOf(gone) + '”. ', h('button.btn.sm', { type: 'button', onclick: () => {
      plan.items.splice(Math.min(i, plan.items.length), 0, gone); cur = wasCur; save(); render(); toast('Put back.', 'ok', 1500);
    } }, 'Undo')), '', 7000);
  }

  async function renameItem(it) {
    const n = await promptBox('Name of this part', 'For example “Opening Hymn” or “Scripture Reading”', partOf(it) || it.label);
    if (n == null) return;
    const v = n.trim();
    if (it.heading) { it.part = v || it.part; it.label = it.part; } else it.part = v;
    save(); render();
  }

  function detach(it) {
    const name = titleOf(it);
    MEDIA_KEYS.forEach((k) => { delete it[k]; });
    Object.assign(it, { tab: 'note', heading: true, part: name, label: name });
    shownCue.delete(it.id);
    save(); render();
  }

  function duplicateItem(i) {
    const copy = JSON.parse(JSON.stringify(plan.items[i]));
    copy.id = uid(); copy.done = false;
    plan.items.splice(i + 1, 0, copy);
    save(); render(); flash(copy.id);
  }

  function itemMenu(anchor, it, i) {
    menu(anchor, [
      it.heading ? null : { label: 'Set as Next', icon: 'next', onclick: () => select(i).then((c) => { if (c) toast(titleOf(it) + ' is Next. Press Present (F5).', 'ok', 2500); }) },
      { label: it.heading ? 'Attach media…' : 'Change media…', icon: 'link', onclick: () => openPicker({ target: it }) },
      it.heading ? null : { label: 'Remove the media (keep this part)', icon: 'x', onclick: () => detach(it) },
      { label: 'Rename this part…', icon: 'edit', onclick: () => renameItem(it) },
      { label: 'Who leads this part…', icon: 'edit', onclick: async () => { const r = await promptBox('Who leads this part?', 'Role or name (e.g. Elder, Deacon, Speaker)', it.role || ''); if (r != null) { it.role = r.trim(); save(); render(); } } },
      { label: it.mins > 0 ? 'Planned time: ' + it.mins + ' min…' : 'Planned time…', icon: 'clock', onclick: async () => {
        const r = await promptBox('Planned time for “' + titleOf(it) + '”', 'Minutes (empty for none). The stage count-down starts from this when the part goes on screen.', it.mins > 0 ? String(it.mins) : '');
        if (r == null) return;
        const m = Math.round(parseFloat(String(r).replace(',', '.')) * 10) / 10;
        if (m > 0 && m <= 600) it.mins = m; else delete it.mins;
        save(); render();
      } },
      it.heading ? null : { label: it.done ? 'Mark as not shown yet' : 'Mark as shown', icon: 'check', onclick: () => { it.done = !it.done; save(); render(); } },
      '-',
      { label: 'Add media below this part…', icon: 'plus', onclick: () => openPicker({ after: it }) },
      { label: 'Add a part below…', icon: 'plus', onclick: async () => {
        const n = await promptBox('New part', 'Name, e.g. “Special Item”', '');
        if (n && n.trim()) addItem({ tab: 'note', heading: true, part: n.trim(), label: n.trim() }, { after: it });
      } },
      { label: 'Duplicate', icon: 'copy', onclick: () => duplicateItem(i) },
      { label: 'Move up', icon: 'up', onclick: () => moveItem(i, -1), disabled: i === 0 },
      { label: 'Move down', icon: 'down', onclick: () => moveItem(i, 1), disabled: i >= plan.items.length - 1 },
      '-',
      { label: 'Remove from plan', icon: 'trash', onclick: () => removeItem(i) },
    ]);
  }

  function flash(id) {
    requestAnimationFrame(() => {
      const row = listEl.querySelector('[data-id="' + id + '"]');
      if (!row) return;
      row.classList.add('flash');
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => row.classList.remove('flash'), 1600);
    });
  }

  let dragFrom = -1;
  function render() {
    publishStage();
    clear(listEl);
    // No plan yet: nothing to step through, so no Next / Previous item buttons.
    nextBtn.hidden = prevBtn.hidden = planSel.hidden = !plan;
    if (!plan) {
      const dt = tplByKey(defTpl) || tplByKey('b:Divine Service');
      listEl.appendChild(emptyState('plan', 'No service plan yet', 'Prepare the order of service before Sabbath: Bible readings, hymns, slides and videos in the order you need them. Start from a ready-made order or one of your own:',
        { label: dt.name, icon: 'plus', primary: true, onclick: () => createFromTemplate(dt.key) }));
      const alt = h('div.row.wrap.plan-tpls');
      allTpls().filter((t) => t.key !== dt.key && t.key !== 'b:Empty plan').forEach((t) => alt.appendChild(h('button.btn', { type: 'button', onclick: () => createFromTemplate(t.key) }, t.mine ? icon('star') : null, h('span', t.name))));
      alt.appendChild(h('button.btn', { type: 'button', onclick: newPlan }, icon('plus'), h('span', 'New plan…')));
      alt.appendChild(h('button.btn', { type: 'button', onclick: importPlan }, icon('upload'), h('span', 'Open a shared plan…')));
      listEl.lastChild.appendChild(alt);
      return;
    }
    listEl.appendChild(summaryBar());
    plan.items.forEach((it, i) => {
      const now = onScreen(it);
      const isNext = !now && !it.heading && live.staged && shownCue.get(it.id) === live.staged.id;
      const more = btn('more', 'More for this part', (e) => { e.stopPropagation(); itemMenu(more, it, i); }, { cls: 'sm' });
      const media = mediaLabel(it);
      const row = h('div.plan-item.kind-' + (it.heading ? 'note' : it.tab) + (i === cur ? '.cur' : '') + (it.done ? '.done' : '') + (now ? '.now' : '') + (it.heading ? '.is-head' : ''), {
        draggable: 'true', 'data-id': it.id,
        title: it.heading ? 'Use Attach to add media to this part' : 'Click: put on Next · Double-click: present now',
        style: { '--kind': kindColor(it) },
        onclick: () => select(i),
        ondblclick: () => presentItem(i),
        ondragstart: (e) => { dragFrom = i; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (x) { /* */ } },
        ondragover: (e) => { if (dragFrom < 0) return; e.preventDefault(); row.classList.add('drag-over'); },
        ondragleave: () => row.classList.remove('drag-over'),
        ondrop: (e) => { e.preventDefault(); row.classList.remove('drag-over'); const from = dragFrom; dragFrom = -1; if (from >= 0 && from !== i) dropItem(from, i); },
        ondragend: () => { dragFrom = -1; listEl.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over')); },
      },
      h('span.pi-n', String(i + 1)),
      previewTile(it),
      h('div', { style: { minWidth: 0 } },
        h('div.pi-t', icon(itemIcon(it)), h('span.trunc', titleOf(it)),
          now ? h('span.pi-badge.live', 'On screen') : isNext ? h('span.pi-badge.next', 'Next') : null,
          it.done && !now ? h('span.pi-done', { title: 'Shown' }, icon('check')) : null),
        it.heading
          ? h('div.pi-s', 'No media yet')
          : h('div.pi-s.trunc', kindText(it) + (media ? ' · ' + media : '')),
        it.role || it.mins > 0 ? h('div.pi-s.pi-role', [it.role, it.mins > 0 ? it.mins + ' min' : ''].filter(Boolean).join(' · ')) : null),
      h('div.row.pi-act', { onclick: (e) => e.stopPropagation(), ondblclick: (e) => e.stopPropagation() },
        it.heading
          ? h('button.btn.sm', { type: 'button', title: 'Attach a Bible passage, hymn, slides, video, web page or banner to this part', onclick: () => openPicker({ target: it }) }, icon('link'), h('span', 'Attach'))
          : it.tab === 'hymns'
            ? h('div.row', { style: { gap: '4px' } },
                h('button.btn.sm.primary', { type: 'button', title: 'Show the words on the screen', onclick: () => presentItem(i) }, icon('present'), h('span.hide-sm', 'Present')),
                h('button.btn.sm', { type: 'button', title: 'Show the words and start the music', onclick: () => presentItem(i, true) }, icon('play'), h('span.hide-sm', 'Present & play')))
            : h('button.btn.sm.primary', { type: 'button', title: 'Show this part on the screen now', onclick: () => presentItem(i) }, icon('present'), h('span.hide-sm', 'Present')),
        more));
      activatable(row);
      listEl.appendChild(row);
    });
    if (!plan.items.length) listEl.appendChild(h('p.note.pad', 'Empty plan. Type in the box above (for example “hymn 73”, “Amazing grace”, “John 3:16” or a part like “Offering”), use Add media…, or use “Add to plan” in the other tabs.'));
  }

  function dropItem(from, to) {
    const [it] = plan.items.splice(from, 1);
    plan.items.splice(to, 0, it);
    if (cur === from) cur = to; else if (from < cur && to >= cur) cur--; else if (from > cur && to <= cur) cur++;
    save(); render();
  }

  async function createFromTemplate(tpl) {
    await storeNew(makePlan(today(), tpl));
    toast('Plan ready. Attach media to each part, or double-click a part to present it.', 'ok', 4500);
  }

  function copyOrder() {
    if (!plan) return;
    const text = plan.name + '\n\n' + plan.items.map((it, i) => {
      const m = mediaLabel(it);
      return (i + 1) + '. ' + titleOf(it) + (m ? ' — ' + m : '') + (it.role ? ' (' + it.role + ')' : '');
    }).join('\n');
    const file = () => download(new Blob([text], { type: 'text/plain' }), plan.name.replace(/[^\w-]+/g, '_') + '.txt');
    const done = () => toast('Order of service copied. Paste it into a message or document.', 'ok', 3500);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, file);
    else file();
  }

  function moveItem(i, d) {
    const j = i + d;
    if (j < 0 || j >= plan.items.length) return;
    const t = plan.items[i]; plan.items[i] = plan.items[j]; plan.items[j] = t;
    if (cur === i) cur = j; else if (cur === j) cur = i;
    save(); render(); flash(plan.items[j].id);
  }

  /** Open the item in its own tab so it becomes Next. Returns the staged cue. */
  async function select(i) {
    cur = i; lastAddedId = null;
    const it = plan.items[i];
    render();
    if (!it || it.heading) return null;
    let c = null;
    ctx.hold = 'plan';
    try {
      const t = await ctx.tab(it.tab);
      c = await t.open(it);
      if (c) shownCue.set(it.id, c.id);
    } catch (e) { toast('Could not open this part: ' + e.message, 'err'); }
    finally { ctx.hold = null; }
    ctx.setStaged('plan', c);
    render();
    return c;
  }

  /** Previous / next part of the plan (parts without media are skipped). */
  async function step(d, auto) {
    if (!plan) return;
    // Moving on by hand stops hymn music so the next part's media can take over.
    if (!auto) { try { music.stop(); } catch (e) { /* no music playing */ } }
    let i = cur;
    do { i += d; } while (plan.items[i] && plan.items[i].heading);
    if (i < 0 || i >= plan.items.length) { toast(d > 0 ? 'End of the plan.' : 'Start of the plan.'); return; }
    const c = await select(i);
    if (c && !auto) toast(titleOf(plan.items[i]) + ' is Next. Press Present (F5).', 'ok', 2500);
  }

  // ------------------------------------------------------------ adding and attaching
  /** Fill in a hymn's title and hymnbook, and make Bible labels show the translation. */
  async function enrich(ref) {
    const r = Object.assign({}, ref);
    if (r.tab === 'hymns' && r.n && (!r.label || /^Hymn \d+$/.test(r.label) || !r.book)) {
      try {
        const t = await ctx.tab('hymns');
        await t.whenReady();
        const all = t.lookup(+r.n);
        const x = (r.book && all.find((y) => y.bookId === r.book)) || all[0];
        if (x) { r.label = (x.n ? 'Hymn ' + x.n + ' — ' : '') + x.t; r.book = r.book || x.bookId; }
      } catch (e) { /* keep the plain label */ }
    }
    if (!r.label) r.label = 'Item';
    return r;
  }

  /** Attach media to an existing part, keeping the part's name, role and place. */
  async function attach(target, ref) {
    const name = titleOf(target);
    const r = await enrich(ref);
    MEDIA_KEYS.forEach((k) => { delete target[k]; });
    Object.assign(target, r, { heading: false, part: name, done: false });
    shownCue.delete(target.id);
    await save(); render(); flash(target.id);
    toast('“' + name + '” now shows ' + r.label + '.', 'ok', 2500);
  }

  async function addItem(ref, opt = {}) {
    if (!ref) return null;
    await ready;
    if (!plan) await storeNew(makePlan('Service plan', 'Empty plan'));
    const item = Object.assign({ id: uid() }, await enrich(ref));
    // Where it goes: below the part asked for, else below the last item added, else below the selected part, else at the end.
    let at = plan.items.length;
    const afterIdx = (it) => (it ? plan.items.indexOf(it) : -1);
    const lastIdx = lastAddedId ? plan.items.findIndex((x) => x.id === lastAddedId) : -1;
    if (opt.after && afterIdx(opt.after) >= 0) at = afterIdx(opt.after) + 1;
    else if (lastIdx >= 0) at = lastIdx + 1;
    else if (cur >= 0 && cur < plan.items.length) at = cur + 1;
    plan.items.splice(at, 0, item);
    if (cur >= at) cur++;
    lastAddedId = item.id;
    await save(); render(); flash(item.id);
    if (!opt.quiet) toast('Added “' + titleOf(item) + '”' + (at < plan.items.length - 1 ? ' after “' + titleOf(plan.items[at - 1] || item) + '”.' : ' at the end.'), 'ok', 2500);
    return item;
  }

  // Suggestions for the quick-add box: everything that matches what was typed, best first.
  async function suggestions(text) {
    const t = text.trim();
    if (!t) return [];
    const out = [];
    const lt = low(t);
    const num = /^(?:h|hymn|lied|ingoma|#|no\.?)?\s*(\d{1,4})$/i.exec(t);
    if (/^https?:\/\/\S+$/i.test(t)) out.push({ ic: 'web', title: t.replace(/^https?:\/\//, '').slice(0, 60), sub: 'Web page (needs internet)', ref: { tab: 'web', url: t, label: t.replace(/^https?:\/\//, '').slice(0, 48) } });
    let hy = null;
    try { hy = await ctx.tab('hymns'); await hy.whenReady(); } catch (e) { hy = null; }
    if (num && hy) {
      hy.lookup(+num[1]).slice(0, 4).forEach((x) => out.push({ ic: 'hymn', title: 'Hymn ' + x.n + ' — ' + x.t, sub: x.book, ref: { tab: 'hymns', n: x.n, book: x.bookId, label: 'Hymn ' + x.n + ' — ' + x.t } }));
    }
    if (!num || !/^\d+$/.test(t)) {
      const r = parseRef(t);
      if (r) {
        const lab = refText(EN, r.book, r.segs);
        const tr = ctx.settings.v.bible.primary;
        out.push({ ic: 'bible', title: lab, sub: 'Bible · ' + String(tr).toUpperCase(), ref: { tab: 'bible', ref: lab, tr, label: lab } });
      }
    }
    const weak = [];   // hymns that only share words in their verses: offered after "add as a part"
    if (!num && t.length >= 2) {
      const key = (x) => low(x).replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ').trim();
      const kt = key(t);
      if (hy) hy.searchAll(t, 8).forEach((x) => {
        const lab = (x.n ? 'Hymn ' + x.n + ' — ' : '') + x.t;
        const s = { ic: 'hymn', title: lab, sub: x.book, ref: { tab: 'hymns', n: x.n, book: x.bookId, label: lab } };
        if (key(x.t).includes(kt)) out.push(s); else if (weak.length < 3) { s.sub = x.book + ' · words in the verses'; weak.push(s); }
      });
      const files = await db.all('files').catch(() => []);
      files.filter((f) => f.kind === 'deck' && low(f.name).includes(lt)).slice(0, 3)
        .forEach((f) => out.push({ ic: 'slides', title: f.name, sub: 'Slides · ' + (f.count || 0) + ' slides', ref: { tab: 'slides', deck: f.id, label: f.name } }));
      files.filter((f) => f.kind === 'media' && low(f.name).includes(lt)).slice(0, 3)
        .forEach((f) => out.push({ ic: 'video', title: f.name, sub: 'Video / music', ref: { tab: 'video', item: f.id, label: f.name } }));
      const bs = (await db.get('kv', 'banners').catch(() => null)) || [];
      (Array.isArray(bs) ? bs : []).filter((b) => b && low(b.name || (b.f && b.f.title)).includes(lt)).slice(0, 3)
        .forEach((b) => out.push({ ic: 'banner', title: b.name || (b.f && b.f.title) || 'Banner', sub: 'Banner', ref: { tab: 'ai', banner: b.id, label: 'Banner: ' + (b.name || (b.f && b.f.title) || 'Banner') } }));
      if ('pre-service loop'.includes(lt) || lt.includes('loop')) out.push({ ic: 'loop', title: 'Pre-service loop', sub: 'Banners → Pre-service loop', ref: { tab: 'ai', loop: true, label: 'Pre-service loop' } });
    }
    out.push({ ic: 'info', title: 'Add “' + t + '” as a part', sub: 'A heading in the order of service (attach media later)', ref: { tab: 'note', heading: true, part: t, label: t } });
    return out.concat(weak);
  }

  let sugs = [], sugAt = 0, sugSeq = 0;
  function paintSugs() {
    clear(sugBox);
    sugBox.hidden = !sugs.length;
    sugs.forEach((s, i) => sugBox.appendChild(h('button.plan-sug-i', { type: 'button', role: 'option', 'aria-selected': String(i === sugAt),
      onmousedown: (e) => e.preventDefault(), onclick: () => takeSug(i), onmousemove: () => { if (sugAt !== i) { sugAt = i; paintSugs(); } } },
      icon(s.ic), h('span.grow', h('div.trunc', s.title), h('div.note.trunc', s.sub)))));
  }
  const refreshSugs = debounce(async () => {
    const my = ++sugSeq;
    const list = await suggestions(addInput.value);
    if (my !== sugSeq) return;
    sugs = list; sugAt = 0; paintSugs();
  }, 140);
  async function takeSug(i) {
    const s = sugs[i];
    if (!s) return;
    sugs = []; paintSugs(); addInput.value = '';
    await addItem(s.ref);
    addInput.focus();
  }
  addInput.addEventListener('input', refreshSugs);
  addInput.addEventListener('focus', () => { if (addInput.value.trim()) refreshSugs(); });
  addInput.addEventListener('blur', () => setTimeout(() => { sugs = []; paintSugs(); }, 150));
  addInput.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!sugs.length) return;
      e.preventDefault();
      sugAt = (sugAt + (e.key === 'ArrowDown' ? 1 : -1) + sugs.length) % sugs.length; paintSugs();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!addInput.value.trim()) return;
      // Enter before the list arrived: work it out now.
      if (!sugs.length) { sugSeq++; sugs = await suggestions(addInput.value); sugAt = 0; }
      takeSug(sugAt);
    } else if (e.key === 'Escape') {
      if (sugs.length) { e.preventDefault(); e.stopPropagation(); sugs = []; paintSugs(); }
    }
  });

  // ------------------------------------------------------------ media picker
  /** Choose media: {target} attaches to that part (and closes), otherwise items are added (the dialog stays open). */
  function openPicker(opt = {}) {
    const target = opt.target || null;
    let after = opt.after || null;
    let kind = opt.kind || (target && !target.heading && KINDS.some((k) => k[0] === target.tab) ? target.tab : 'bible');
    const status = h('p.note.pk-status', '');
    const search = h('input.field', { type: 'search', autocomplete: 'off', spellcheck: false });
    const list = h('div.pk-list');
    const extra = h('div.row.wrap.pk-extra');
    const kinds = h('div.row.wrap.pk-kinds', { role: 'tablist' });
    KINDS.forEach(([k, label, ic]) => kinds.appendChild(h('button.chip', { type: 'button', role: 'tab', 'data-k': k, 'aria-selected': String(k === kind), onclick: () => { kind = k; search.value = ''; paint(); } }, icon(ic), label)));
    const body = h('div.col.pk', { style: { gap: '10px' } },
      h('p.note', target ? 'Choose what “' + titleOf(target) + '” shows.' : 'Pick items to add' + (after ? ' below “' + titleOf(after) + '”' : '') + '. The dialog stays open so you can add several.'),
      kinds, search, extra, list, status);

    let addedCount = 0;
    async function pick(ref) {
      if (target) { closeModal(); await attach(target, ref); return; }
      const it = await addItem(ref, { after, quiet: true });
      if (it) { after = it; addedCount++; status.textContent = 'Added: ' + titleOf(it) + (addedCount > 1 ? '  (' + addedCount + ' added)' : ''); }
    }
    const row = (ic, title, sub, ref) => h('button.pk-i', { type: 'button', onclick: () => pick(ref) }, icon(ic), h('span.grow', h('div.trunc', title), sub ? h('div.note.trunc', sub) : null), h('span.pk-add', target ? 'Use' : 'Add'));

    let seq = 0;
    async function paint() {
      const my = ++seq;
      kinds.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.getAttribute('data-k') === kind)));
      clear(extra); clear(list);
      const q = search.value.trim(), lq = low(q);
      search.hidden = false;
      if (kind === 'bible') {
        search.placeholder = 'Type a reference: Psalm 23, John 3:16-18, Rom 12:1-2';
        await biblePicker(my);
      } else if (kind === 'hymns') {
        search.placeholder = 'Hymn number or words from the title or verses';
        const hy = await ctx.tab('hymns'); await hy.whenReady();
        if (my !== seq) return;
        if (!q) { list.appendChild(h('p.note', 'Type a hymn number (e.g. 73) or words (e.g. “amazing grace”). Your own songs and choruses are searched too.')); return; }
        const res = /^\d+$/.test(q) ? hy.lookup(+q).concat(hy.searchAll(q, 30).filter((x) => x.n !== +q)) : hy.searchAll(q, 40);
        if (!res.length) list.appendChild(h('p.note', 'No hymn or chorus matches “' + q + '”. Use Hymns → Find lyrics to fetch a new song.'));
        res.forEach((x) => { const lab = (x.n ? 'Hymn ' + x.n + ' — ' : '') + x.t; list.appendChild(row('hymn', lab, x.book, { tab: 'hymns', n: x.n, book: x.bookId, label: lab })); });
      } else if (kind === 'slides' || kind === 'video') {
        const isS = kind === 'slides';
        search.placeholder = isS ? 'Filter slide decks' : 'Filter videos and music';
        extra.appendChild(h('button.btn.sm', { type: 'button', onclick: () => addFilesHere(kind) }, icon('upload'), h('span', isS ? 'Add new slides (PDF, PowerPoint, pictures)…' : 'Add a new video or music file…')));
        const files = (await db.all('files').catch(() => [])).filter((f) => f.kind === (isS ? 'deck' : 'media') && (!lq || low(f.name).includes(lq))).sort((a, b) => (b.added || 0) - (a.added || 0));
        if (my !== seq) return;
        if (!files.length) list.appendChild(h('p.note', q ? 'Nothing matches “' + q + '”.' : isS ? 'No slides on this device yet. Use the button above to add some.' : 'No videos or music on this device yet. Use the button above to add some.'));
        files.forEach((f) => list.appendChild(isS
          ? row('slides', f.name, (f.count || 0) + ' slides · ' + String(f.type || '').toUpperCase(), { tab: 'slides', deck: f.id, label: f.name })
          : row('video', f.name, f.url ? 'Link' : 'Video / music', { tab: 'video', item: f.id, label: f.name })));
      } else if (kind === 'ai') {
        search.placeholder = 'Filter banners';
        extra.appendChild(h('button.btn.sm', { type: 'button', onclick: () => { closeModal(); ctx.showTab('ai'); toast('Make a banner, press Save, then add it to the plan.', '', 4000); } }, icon('banner'), h('span', 'Make a new banner…')));
        const bs = (await db.get('kv', 'banners').catch(() => null)) || [];
        if (my !== seq) return;
        if (!lq || 'pre-service loop'.includes(lq)) list.appendChild(row('loop', 'Pre-service loop', 'Your banners and announcement slides taking turns', { tab: 'ai', loop: true, label: 'Pre-service loop' }));
        const grs = (await db.get('kv', 'banner-groups').catch(() => null)) || [];
        const gname = (b) => { const g = Array.isArray(grs) && b.group && grs.find((x) => x && x.id === b.group); return g ? g.name : ''; };
        const subOf = (b) => ['Banner', gname(b), Array.isArray(b.pages) && b.pages.length ? (b.pages.length + 1) + ' slides' : ''].filter(Boolean).join(' · ');
        const shown = (Array.isArray(bs) ? bs : []).filter((b) => b && (!lq || low((b.name || (b.f && b.f.title) || '') + ' ' + gname(b)).includes(lq)))
          .sort((a, b) => gname(a).localeCompare(gname(b)) || String(a.name || '').localeCompare(String(b.name || '')));
        if (!shown.length && Array.isArray(bs) && !bs.length) list.appendChild(h('p.note', 'No saved banners yet. Make one in the Banners tab and press Save.'));
        shown.forEach((b) => { const nm = b.name || (b.f && b.f.title) || 'Banner'; list.appendChild(row('banner', nm, subOf(b), { tab: 'ai', banner: b.id, label: 'Banner: ' + nm })); });
      } else if (kind === 'web') {
        search.placeholder = 'Paste a link: https://…';
        const ok = /^https?:\/\/\S+\.\S+/i.test(q);
        list.appendChild(ok
          ? row('web', q.replace(/^https?:\/\//, '').slice(0, 60), 'Web page (needs internet). YouTube links play full screen.', { tab: 'web', url: q, label: q.replace(/^https?:\/\//, '').slice(0, 48) })
          : h('p.note', 'Paste the full address of the page or YouTube video, starting with https://'));
      }
    }

    // Bible: a typed reference, or book → chapter → verses (tap one verse, or a first and a last verse).
    let bk = 43, ch = 3, v1 = null, v2 = null, tr = (target && target.tab === 'bible' && target.tr) || ctx.settings.v.bible.primary;
    if (target && target.tab === 'bible' && target.ref) { const r0 = parseRef(target.ref); if (r0) { bk = r0.book; ch = r0.segs[0].c1 || 1; } }
    async function biblePicker(my) {
      const trs = await listTranslations().catch(() => []);
      const info = await getInfo(tr).catch(() => null);
      if (my !== seq) return;
      const trSel = h('select.field.pk-tr', { 'aria-label': 'Translation', onchange: () => { tr = trSel.value; paint(); } },
        trs.map((t) => h('option', { value: t.id, selected: t.id === tr }, t.abbr + ' — ' + t.name)));
      extra.appendChild(trSel);
      const typed = search.value.trim() ? parseRef(search.value.trim()) : null;
      if (typed) {
        const lab = refText(EN, typed.book, typed.segs);
        list.appendChild(row('bible', lab, 'Bible · ' + String(tr).toUpperCase(), { tab: 'bible', ref: lab, tr, label: lab }));
        return;
      }
      if (search.value.trim()) list.appendChild(h('p.note', 'Not a Bible reference yet. Try “John 3:16” or “Psalm 23”.'));
      if (!info) { list.appendChild(h('p.note', 'This Bible is not on the device.')); return; }
      const names = info.names || info.books.map((b) => b[0]);
      const bookSel = h('select.field', { 'aria-label': 'Book', onchange: () => { bk = +bookSel.value; ch = 1; v1 = v2 = null; paint(); } });
      info.books.forEach((b, i) => { if (b[1]) bookSel.appendChild(h('option', { value: i + 1, selected: i + 1 === bk }, names[i] || b[0])); });
      const nCh = (info.books[bk - 1] && info.books[bk - 1][1]) || 1;
      if (ch > nCh) ch = 1;
      const chips = h('div.pk-chaps');
      for (let c = 1; c <= nCh; c++) chips.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(c === ch), onclick: () => { ch = c; v1 = v2 = null; paint(); } }, String(c)));
      const whole = refText(EN, bk, [{ c1: ch, v1: null, c2: ch, v2: null }]);
      const pickRange = () => {
        const a = Math.min(v1, v2 || v1), b = Math.max(v1, v2 || v1);
        const lab = refText(EN, bk, [{ c1: ch, v1: a, c2: ch, v2: b }]);
        pick({ tab: 'bible', ref: lab, tr, label: lab });
      };
      const useBar = h('div.row.wrap.pk-use',
        h('button.btn.sm', { type: 'button', onclick: () => pick({ tab: 'bible', ref: whole, tr, label: whole }) }, icon('plus'), h('span', 'Whole chapter: ' + whole)),
        v1 ? h('button.btn.sm.primary', { type: 'button', onclick: pickRange }, icon('plus'), h('span', refText(EN, bk, [{ c1: ch, v1: Math.min(v1, v2 || v1), c2: ch, v2: Math.max(v1, v2 || v1) }]))) : h('span.note', 'Tap a verse, or a first and a last verse.'));
      const verses = h('div.pk-verses');
      extra.appendChild(bookSel);
      list.append(chips, useBar, verses);
      const vs = await versesFor(tr, bk, [{ c1: ch, v1: null, c2: ch, v2: null }]).catch(() => []);
      if (my !== seq) return;
      const a = v1 ? Math.min(v1, v2 || v1) : 0, b = v1 ? Math.max(v1, v2 || v1) : 0;
      vs.forEach((v) => verses.appendChild(h('button.pk-v' + (v1 && v.v >= a && v.v <= b ? '.on' : ''), { type: 'button',
        onclick: () => { if (!v1 || v2) { v1 = v.v; v2 = null; } else v2 = v.v; paint(); } },
        h('b', String(v.v)), ' ', clip(String(v.text || '').replace(/[‹›]/g, ''), 120))));
      if (!vs.length) verses.appendChild(h('p.note', 'No verses.'));
    }

    async function addFilesHere(k) {
      const inp = h('input', { type: 'file', multiple: true, accept: k === 'slides' ? '.pdf,.pptx,image/*' : 'video/*,audio/*,.mkv,.mov' });
      inp.onchange = async () => {
        const files = Array.from(inp.files || []);
        if (!files.length) return;
        const before = new Set((await db.all('files').catch(() => [])).map((f) => f.id));
        closeModal();
        toast('Adding ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…', '', 2500);
        let got = null;
        try {
          const t = await ctx.tab(k);
          got = await t.importFiles(files);
        } catch (e) { toast('Could not add: ' + e.message, 'err', 5000); }
        // Videos used "for this session only" are not stored, so take them from the Video tab's answer.
        const fresh = k === 'video' && Array.isArray(got) ? got
          : (await db.all('files').catch(() => [])).filter((f) => !before.has(f.id) && f.kind === (k === 'slides' ? 'deck' : 'media'));
        // Attach or add what was just imported, then reopen the picker for more.
        if (target && fresh[0]) await attach(target, k === 'slides' ? { tab: 'slides', deck: fresh[0].id, label: fresh[0].name } : { tab: 'video', item: fresh[0].id, label: fresh[0].name });
        else {
          for (const f of fresh) after = (await addItem(k === 'slides' ? { tab: 'slides', deck: f.id, label: f.name } : { tab: 'video', item: f.id, label: f.name }, { after, quiet: true })) || after;
          if (fresh.length) toast('Added ' + fresh.length + ' to the plan.', 'ok');
          openPicker({ after, kind: k });
        }
      };
      inp.click();
    }

    search.addEventListener('input', debounce(() => paint(), 150));
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const first = list.querySelector('.pk-i'); if (first) first.click(); } });
    modal({ title: target ? (target.heading ? 'Attach media to “' + titleOf(target) + '”' : 'Change media for “' + titleOf(target) + '”') : 'Add media to the plan', body, wide: true, actions: [{ label: target ? 'Cancel' : 'Done' }] });
    paint();
    setTimeout(() => search.focus(), 40);
  }

  const api = {
    el,
    addItem: (ref) => addItem(ref),
    /** Move to the next (+1) or previous (-1) part of the plan on the Next screen (remote control). */
    step: async (d) => { await ready; if (!plan) return false; await step(d); return true; },
    onShow() { render(); },
    open() { return null; },
  };
  const ready = loadTpls().catch(() => {}).then(load);
  return api;
}
