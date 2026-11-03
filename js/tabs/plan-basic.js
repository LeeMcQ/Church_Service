// The Plan tab's Basic view: for the volunteer at the media desk during the service.
// The order of service as a simple list (tap = Next, Show = on the screen now, ▶ = a hymn with its music) and
// three big buttons underneath: Back and Next (the previous / next part of the service, whatever it is: a reading, a
// hymn, a banner, a video …) and Blank. A slim row above them steps through the slides of what is on screen.
// Advanced is the plan editor. The switch sits in the Plan tab's own toolbar; the choice is kept on this device.
import { h, clear } from '../core/util.js';
import { icon } from '../core/icons.js';
import { live, slideName } from '../core/live.js';

export function createPlanBasic({ el, toolbar, ctx, api }) {
  const { settings, ui } = ctx;
  const isBasic = () => settings.v.app.planView !== 'advanced';
  const present = () => (ctx.present ? ctx.present() : live.take());

  // ------------------------------------------------------------ the switch (in the Plan toolbar)
  const mk = (view, label, tip) => h('button', { type: 'button', role: 'radio', 'data-view': view, title: tip, onclick: () => settings.set('app.planView', view) }, label);
  const sw = h('div.plan-view', { role: 'radiogroup', 'aria-label': 'Plan view' },
    mk('basic', 'Basic', 'Basic: the order of service with Show buttons and big Back / Next / Blank buttons'),
    mk('advanced', 'Advanced', 'Advanced: edit the plan (add hymns, readings, slides, change the order, templates, sharing)'));
  const h2 = toolbar.querySelector('h2');
  if (h2) h2.after(sw); else toolbar.prepend(sw);

  // ------------------------------------------------------------ the order of service
  const listEl = h('div.bp-list');
  const headName = h('span.bp-name', '');
  const headNote = h('span.note', '');
  const panel = h('div.basic-panel', { 'aria-label': 'Order of service' },
    h('div.bp-head', headName, headNote),
    h('div.bp-scroll', listEl));

  // ------------------------------------------------------------ Back / Next / Blank
  const nextSub = h('span.bb-sub', '');
  const backBtn = h('button.bb.bb-back', { type: 'button', title: 'The previous part of the service', onclick: () => basicBack() }, icon('prev'), h('span.bb-l', 'Back'));
  const nextBtn = h('button.bb.bb-next', { type: 'button', title: 'The next part of the service (the next reading, hymn, banner …)', onclick: () => basicNext() },
    h('span.bb-main', h('span.bb-l', 'Next'), icon('next')), nextSub);
  const blankLbl = h('span.bb-l', 'Blank');
  const blankBtn = h('button.bb.bb-blank', { type: 'button', title: 'Black screen; press again to show it again (B)', onclick: () => live.setBlank('black') }, icon('black'), blankLbl);
  const musicBtn = h('button.bb.bb-music', { type: 'button', hidden: true, title: 'Stop the hymn music', onclick: () => music && music.stop() }, icon('stop'), h('span.bb-l', 'Music'));
  // The slides of what is on screen (verses, stanzas, slides): the arrow keys and a clicker do the same.
  const slideLbl = h('span.bs-l', '');
  const slidePrev = h('button.btn.bs-b', { type: 'button', title: 'Previous slide (←)', 'aria-label': 'Previous slide', onclick: () => live.prev() }, icon('prev'));
  const slideNext = h('button.btn.bs-b', { type: 'button', title: 'Next slide (→)', 'aria-label': 'Next slide', onclick: () => live.next() }, icon('next'));
  const slideRow = h('div.bb-slides', { hidden: true, role: 'group', 'aria-label': 'Slides of what is on screen' }, slidePrev, slideLbl, slideNext);
  const bar = h('div.basic-bar', { 'aria-label': 'Order of service controls' }, slideRow, backBtn, nextBtn, blankBtn, musicBtn);
  el.append(panel, bar);
  // Its height, so the small corner screen on phones sits above the big buttons instead of on them.
  if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--pb-h', bar.offsetHeight + 'px')).observe(bar);

  let music = null;
  import('../core/hymnmusic.js').then((m) => { music = m.music; music.on('state', paintBar); }).catch(() => {});

  /** The part that follows the current one (also a part without media), or -1. */
  const followIndex = (s) => (s && s.cur + 1 < s.items.length ? s.cur + 1 : -1);

  /** The part marked Next (tapped in the list), or the one after the current part. */
  function nextPart(s) {
    if (!s) return -1;
    const marked = s.items.find((x) => x.next);
    return marked ? marked.i : followIndex(s);
  }
  /** Put part i on the screen; a part with nothing to show (a prayer, the sermon) shows the logo. */
  async function showPart(s, i) {
    const c = await api.select(i);
    if (c) { await present(); return; }
    if (live.blank !== 'logo') live.setBlank('logo');
    ui.toast(s.items[i].title + ': nothing to show, so the logo is on screen.', '', 3200);
  }
  // Next and Back always move to another part of the service, whatever is on screen (a reading with more verses,
  // a hymn with more stanzas …). The slides themselves are stepped with the row above, the arrow keys or a clicker.
  async function basicNext() {
    const s = api.snapshot();
    const i = nextPart(s);
    if (i < 0) { ui.toast(s ? 'End of the order of service.' : 'Start the order of service first.', '', 3000); return; }
    await showPart(s, i);
  }
  async function basicBack() {
    const s = api.snapshot();
    if (!s || !(s.cur > 0)) { ui.toast(s ? 'This is the first part of the service.' : 'Start the order of service first.', '', 3000); return; }
    await showPart(s, s.cur - 1);
  }

  function nextLabel() {
    const s = api.snapshot();
    const i = nextPart(s);
    if (i >= 0) return (s.items[i].empty ? 'Logo · ' : '') + s.items[i].title;
    return s ? 'End of the service' : '';
  }

  function paintBar() {
    if (!isBasic()) return;
    const s = api.snapshot();
    backBtn.disabled = !s || !(s.cur > 0);
    nextSub.textContent = nextLabel();
    const c = live.cue, n = c ? live.count() : 0;
    slideRow.hidden = !c || n <= 1 || c.deck.kind === 'video';
    if (!slideRow.hidden) {
      slideLbl.textContent = (slideName(c, live.index) || 'Slide ' + (live.index + 1)) + '  ·  ' + (live.index + 1) + ' of ' + n;
      slidePrev.disabled = live.index <= 0;
      slideNext.disabled = live.index >= n - 1 && !c.extend;
    }
    const black = live.blank === 'black';
    blankBtn.classList.toggle('on', black);
    blankLbl.textContent = black ? 'Show again' : 'Blank';
    musicBtn.hidden = !(music && music.isPlaying());
  }

  function row(it) {
    const show = async (e, withMusic) => {
      e.stopPropagation();
      if (withMusic) { await api.presentAndPlay(it.i); return; }
      const c = await api.select(it.i);
      if (c) await present();
    };
    const state = it.now ? h('span.pi-badge.live', 'On screen') : it.next ? h('span.pi-badge.next', 'Next') : it.done ? h('span.bp-done', { title: 'Shown' }, icon('check')) : null;
    return h('div.bp-row' + (it.now ? '.now' : '') + (it.next ? '.next' : '') + (it.done && !it.now ? '.done' : '') + (it.empty ? '.empty' : ''), {
      role: 'button', tabindex: '0', 'data-i': String(it.i),
      title: it.empty ? 'Nothing to show for this part yet' : 'Tap: put on Next · Show: put it on the screen now',
      onclick: () => {
        if (it.empty) { ui.toast('Nothing to show for “' + it.title + '” yet. Add it in Advanced.', '', 3200); return; }
        api.select(it.i);
      },
      onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); e.currentTarget.click(); } },
    },
    h('span.bp-n', String(it.i + 1)),
    h('div.bp-txt', h('div.bp-t', h('span.trunc', it.title), state), h('div.bp-s.trunc', it.empty ? 'Nothing to show' : it.media)),
    it.empty ? null : h('div.bp-act',
      it.kind === 'hymns' ? h('button.btn.bp-play', { type: 'button', title: 'Show the words and start the music', 'aria-label': 'Show ' + it.title + ' with music', onclick: (e) => show(e, true) }, icon('play')) : null,
      h('button.btn.primary.bp-show', { type: 'button', title: 'Show this on the screen now', onclick: (e) => show(e) }, icon('present'), h('span', 'Show'))));
  }

  let lastFocus = -1;
  function renderList() {
    if (!isBasic()) return;
    const s = api.snapshot();
    clear(listEl);
    if (!s) {
      headName.textContent = 'No order of service yet'; headNote.textContent = '';
      listEl.append(h('div.bp-empty.empty',
        h('p', 'Start today’s Divine Service with its usual parts, then add the hymns and readings in Advanced.'),
        h('div.row.wrap',
          h('button.btn.primary', { type: 'button', onclick: () => api.createDefault() }, icon('plus'), h('span', 'Start today’s service')),
          h('button.btn', { type: 'button', onclick: () => api.importPlan() }, icon('upload'), h('span', 'Open a shared plan…')))));
      return;
    }
    headName.textContent = s.name;
    headNote.textContent = s.total ? s.shown + ' of ' + s.total + ' shown' : '';
    s.items.forEach((it) => listEl.appendChild(row(it)));
    if (!s.items.length) listEl.append(h('p.note.pad', 'This plan is empty. Add parts in Advanced.'));
    // Keep the part on screen in view (only when it changes, so scrolling by hand is not undone).
    const now = s.items.findIndex((x) => x.now);
    const focus = now >= 0 ? now : s.cur;
    if (focus !== lastFocus && focus >= 0) {
      lastFocus = focus;
      const r = listEl.querySelector('[data-i="' + focus + '"]');
      if (r) requestAnimationFrame(() => r.scrollIntoView({ block: 'nearest' }));
    }
  }

  function apply() {
    const basic = isBasic();
    el.classList.toggle('is-basic', basic);
    document.documentElement.classList.toggle('plan-basic', basic);
    sw.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.view === 'basic') === basic)));
    renderList(); paintBar();
  }
  api.subscribe(() => { renderList(); paintBar(); });
  ['staged', 'live', 'go', 'blank'].forEach((ev) => live.on(ev, paintBar));
  settings.on('change:app', (p) => { if (p === 'app.planView') apply(); });
  apply();
  return { isBasic, next: basicNext };
}
