// Basic and Advanced mode.
// Basic (the default) is for the volunteer at the media desk: the order of service, what is on screen and what
// comes next, and three big buttons (Back, Next, Blank). Advanced is the full app: every tab and tool.
// The switch sits in the top bar, so either mode is always one tap away; the choice is kept on this device.
import { h, clear } from './core/util.js';
import { icon } from './core/icons.js';
import { settings } from './core/settings.js';
import { live, slideName } from './core/live.js';

const isBasic = () => settings.v.app.mode !== 'advanced';

export function createModes({ appEl, work, getTab, showTab, current, present, ui, listener }) {
  // ------------------------------------------------------------ the switch (top bar)
  const mk = (mode, label, short, tip) => h('button', { type: 'button', role: 'radio', 'data-mode': mode, title: tip, onclick: () => setMode(mode) },
    h('span.ms-long', label), h('span.ms-short', short));
  const sw = h('div.mode-sw', { role: 'radiogroup', 'aria-label': 'View' },
    mk('basic', 'Basic', 'Basic', 'Basic: the order of service, what is on screen and big Back / Next / Blank buttons'),
    mk('advanced', 'Advanced', 'Adv', 'Advanced: every tab and tool (Bible, hymns, slides, video, plan editing, stage, streaming)'));
  const brand = document.querySelector('.topbar .brand');
  if (brand) brand.after(sw); else document.querySelector('.topbar').prepend(sw);

  // ------------------------------------------------------------ Basic: the order of service
  const listEl = h('div.bp-list');
  const headName = h('span.bp-name', '');
  const headNote = h('span.note', '');
  const panel = h('section.basic-panel', { 'aria-label': 'Order of service' },
    h('div.bp-head',
      h('div.bp-title', h('h2', 'Order of service'), headName, headNote),
      h('button.btn.sm.bp-edit', { type: 'button', title: 'Change the order of service, add hymns, readings and slides (Advanced)', onclick: () => { setMode('advanced'); showTab('plan'); } },
        icon('edit'), h('span', 'Edit'))),
    h('div.bp-scroll', listEl));
  work.appendChild(panel);

  // ------------------------------------------------------------ Basic: Back / Next / Blank
  const nextSub = h('span.bb-sub', '');
  const backBtn = h('button.bb.bb-back', { type: 'button', title: 'Previous slide (←)', onclick: () => live.prev() }, icon('prev'), h('span.bb-l', 'Back'));
  const nextBtn = h('button.bb.bb-next', { type: 'button', title: 'Next slide, then the next part of the service (→)', onclick: () => basicNext() },
    h('span.bb-main', h('span.bb-l', 'Next'), icon('next')), nextSub);
  const blankLbl = h('span.bb-l', 'Blank');
  const blankBtn = h('button.bb.bb-blank', { type: 'button', title: 'Black screen, press again to show it again (B)', onclick: () => live.setBlank('black') }, icon('black'), blankLbl);
  const musicBtn = h('button.bb.bb-music', { type: 'button', hidden: true, title: 'Stop the hymn music', onclick: () => music && music.stop() }, icon('stop'), h('span.bb-l', 'Music'));
  const bar = h('footer.basic-bar', { 'aria-label': 'Slide controls' }, backBtn, nextBtn, blankBtn, musicBtn);
  document.querySelector('#ctrlbar').after(bar);
  // Its height, so the small corner screen on phones stays above it.
  if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--bbar-h', bar.offsetHeight + 'px')).observe(bar);

  let music = null;
  const idle = (f) => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 2500 }) : setTimeout(f, 900));
  idle(() => import('./core/hymnmusic.js').then((m) => { music = m.music; music.on('state', paintBar); }).catch(() => {}));

  let plan = null, unsub = null, lastNow = -1;
  async function planApi() {
    if (plan) return plan;
    plan = await getTab('plan');
    if (plan.whenReady) await plan.whenReady();
    if (plan.subscribe && !unsub) unsub = plan.subscribe(() => { if (isBasic()) { renderList(); paintBar(); } });
    return plan;
  }

  const atEnd = () => {
    const c = live.cue;
    return !c || (c.deck.kind !== 'video' && live.index >= live.count() - 1 && !c.extend && !c.autoLoop);
  };
  /** The part that follows the current one (also a part without media), or -1. */
  function followIndex(s) {
    if (!s) return -1;
    const i = s.cur + 1;
    return i < s.items.length ? i : -1;
  }

  async function basicNext() {
    if (live.cue && !atEnd()) { live.next(); return; }
    // Something chosen by hand waits on Next: show it.
    if (live.staged && !live.sameAsLive()) { await present(); return; }
    const p = await planApi();
    const s = p.snapshot && p.snapshot();
    const i = followIndex(s);
    if (i < 0) {
      ui.toast(s ? 'End of the order of service.' : 'Make the order of service first, or search for a hymn or verse at the top and press Present.', '', 3500);
      return;
    }
    await showTab('plan');
    const c = await p.select(i);
    if (c) { await present(); return; }
    // A part with nothing to show (a prayer, the sermon): the logo goes up while it happens.
    if (live.blank !== 'logo') live.setBlank('logo');
    ui.toast(s.items[i].title + ': nothing to show, so the logo is on screen.', '', 3200);
  }

  function nextLabel() {
    const c = live.cue;
    if (c && !atEnd()) return slideName(c, live.index + 1) || 'Next slide';
    if (live.staged && !live.sameAsLive()) return 'Show: ' + live.staged.title;
    const s = plan && plan.snapshot ? plan.snapshot() : null;
    const i = followIndex(s);
    if (i >= 0) return (s.items[i].empty ? 'Logo · ' : 'Show: ') + s.items[i].title;
    return '';
  }

  function paintBar() {
    if (!isBasic()) return;
    backBtn.disabled = !live.cue || live.index <= 0;
    const sub = nextLabel();
    nextSub.textContent = sub;
    nextBtn.classList.toggle('idle', !sub);
    const black = live.blank === 'black';
    blankBtn.classList.toggle('on', black);
    blankLbl.textContent = black ? 'Show again' : 'Blank';
    musicBtn.hidden = !(music && music.isPlaying());
  }

  function row(it) {
    const show = async (e, withMusic) => {
      e.stopPropagation();
      const p = await planApi();
      await showTab('plan');
      if (withMusic) { await p.presentAndPlay(it.i); return; }
      const c = await p.select(it.i);
      if (c) await present();
    };
    const state = it.now ? h('span.pi-badge.live', 'On screen') : it.next ? h('span.pi-badge.next', 'Next') : it.done ? h('span.bp-done', { title: 'Shown' }, icon('check')) : null;
    return h('div.bp-row' + (it.now ? '.now' : '') + (it.next ? '.next' : '') + (it.done && !it.now ? '.done' : '') + (it.empty ? '.empty' : ''), {
      role: 'button', tabindex: '0', 'data-i': String(it.i),
      title: it.empty ? 'Nothing to show for this part yet' : 'Tap: put on Next · Show: put it on the screen now',
      onclick: async () => {
        if (it.empty) { ui.toast('Nothing to show for “' + it.title + '” yet. Add it with Edit (Advanced).', '', 3200); return; }
        const p = await planApi(); await showTab('plan'); await p.select(it.i);
      },
      onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); e.currentTarget.click(); } },
    },
    h('span.bp-n', String(it.i + 1)),
    h('div.bp-txt', h('div.bp-t', h('span.trunc', it.title), state), h('div.bp-s.trunc', it.empty ? 'Nothing to show' : it.media)),
    it.empty ? null : h('div.bp-act',
      it.kind === 'hymns' ? h('button.btn.bp-play', { type: 'button', title: 'Show the words and start the music', 'aria-label': 'Show ' + it.title + ' with music', onclick: (e) => show(e, true) }, icon('play')) : null,
      h('button.btn.primary.bp-show', { type: 'button', title: 'Show this on the screen now', onclick: (e) => show(e) }, icon('present'), h('span', 'Show'))));
  }

  function renderList() {
    const s = plan && plan.snapshot ? plan.snapshot() : null;
    clear(listEl);
    if (!s) {
      headName.textContent = ''; headNote.textContent = '';
      listEl.append(h('div.bp-empty',
        icon('plan'),
        h('h3', 'No order of service yet'),
        h('p', 'Start today’s Divine Service with its usual parts, then add the hymns and readings with Edit. You can also search a hymn number or Bible verse at the top and press Present.'),
        h('div.row.wrap',
          h('button.btn.primary', { type: 'button', onclick: async () => { const p = await planApi(); await p.createDefault(); } }, icon('plus'), h('span', 'Start today’s service')),
          h('button.btn', { type: 'button', onclick: async () => { const p = await planApi(); p.importPlan(); } }, icon('upload'), h('span', 'Open a shared plan…')))));
      return;
    }
    headName.textContent = s.name;
    headNote.textContent = s.total ? s.shown + ' of ' + s.total + ' shown' : '';
    s.items.forEach((it) => listEl.appendChild(row(it)));
    if (!s.items.length) listEl.append(h('p.note.pad', 'This plan is empty. Add parts with Edit.'));
    // Keep the part on screen in view (only when it changes, so scrolling by hand is not undone).
    const now = s.items.findIndex((x) => x.now);
    const focus = now >= 0 ? now : s.cur;
    if (focus !== lastNow && focus >= 0) {
      lastNow = focus;
      const r = listEl.querySelector('[data-i="' + focus + '"]');
      if (r) requestAnimationFrame(() => r.scrollIntoView({ block: 'nearest' }));
    }
  }

  // ------------------------------------------------------------ switching
  let before = null; // the Advanced tab to return to
  let applied = null; // the mode shown now (null before the first time)
  async function apply() {
    const basic = isBasic();
    const was = applied;
    applied = basic;
    appEl.classList.toggle('mode-basic', basic);
    document.documentElement.classList.toggle('basic', basic);
    sw.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.mode === 'basic') === basic)));
    if (basic) {
      if (listener && listener.on) listener.stop(); // verse suggestions belong to Advanced
      const cur = current();
      if (cur && cur !== 'plan') before = cur;
      await planApi();
      if (current() !== 'plan') await showTab('plan');
      renderList(); paintBar();
    } else if (was === true) {
      // Back to the tab used last in Advanced (Basic itself always works on the plan).
      const b = before || settings.v.app.lastTab;
      before = null;
      if (b && b !== current()) showTab(b);
    }
  }
  function setMode(mode) {
    if ((mode === 'basic') === isBasic()) return;
    settings.set('app.mode', mode);
    settings.set('app.modeTold', true);
  }
  settings.on('change:app', (p) => { if (p === 'app.mode') apply(); });
  ['staged', 'live', 'go', 'blank'].forEach((ev) => live.on(ev, paintBar));

  // A church that used Church Service before this version opens in Basic once: say where everything went.
  if (isBasic() && !settings.v.app.modeTold && settings.v.app.setupDone) {
    settings.set('app.modeTold', true);
    setTimeout(() => ui.toast('New: Basic view with big Back / Next / Blank buttons. Tap Advanced at the top for every tab.', 'ok', 7000), 1500);
  }
  apply();
  return { setMode, isBasic, el: panel, bar };
}
