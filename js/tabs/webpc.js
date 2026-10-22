// Web & PC: one tab for everything that comes from outside the app —
//   • Web page: embed a page on the display, or mirror a browser tab (web.js)
//   • PC screen: share the whole screen or one window, e.g. PowerPoint or a Bible app (screen.js)
// The two parts keep their own Next item; the one that is open is the tab's Next.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import createWeb from './web.js';
import createScreen from './screen.js';

export default function create(ctx) {
  let part = ctx.settings.v.app.webPart === 'screen' ? 'screen' : 'web';
  const staged = { web: null, screen: null };

  // Each part talks to its own copy of ctx: what it stages is kept here and shown when its part is open.
  const partCtx = (name) => Object.assign(Object.create(ctx), {
    setStaged(_id, cue) {
      if (cue) Object.assign(cue, { tab: 'web', part: name });
      staged[name] = cue || null;
      if (part === name) ctx.setStaged('web', staged[name]);
    },
    stagedOf: (id) => (id === 'web' || id === 'screen' ? staged[name] : ctx.stagedOf(id)),
    async showTab(id) {
      if (id === 'web' || id === 'screen') { await ctx.showTab('web'); show(name); return api; }
      return ctx.showTab(id);
    },
  });
  const parts = { web: createWeb(partCtx('web')), screen: createScreen(partCtx('screen')) };
  Object.values(parts).forEach((p) => p.el.classList.add('webpc-part'));

  const tabs = h('div.seg.webpc-seg', { role: 'group', 'aria-label': 'Web page or PC screen' });
  const LABELS = { web: ['web', 'Web page', 'Show a web page or mirror a browser tab'], screen: ['pc', 'PC screen', 'Show the whole screen or one program (PowerPoint, a Bible app …)'] };
  function paintTabs() {
    tabs.replaceChildren(...Object.keys(LABELS).map((k) => h('button', { type: 'button', title: LABELS[k][2], 'aria-pressed': String(k === part), onclick: () => show(k) },
      icon(LABELS[k][0]), h('span', LABELS[k][1]))));
  }

  const el = h('section.webpc',
    h('div.toolbar.webpc-bar', h('h2', 'Web & PC'), tabs, h('div.grow'), h('span.note.hide-sm', 'Anything from outside the app: a web page, a browser tab, a program or your whole screen.')),
    parts.web.el, parts.screen.el);

  function show(k) {
    part = k;
    ctx.settings.set('app.webPart', k);
    paintTabs();
    parts.web.el.hidden = k !== 'web';
    parts.screen.el.hidden = k !== 'screen';
    ctx.setStaged('web', staged[k]);
  }
  show(part);

  const api = {
    el,
    show,
    /** Plan items: {url} opens the web page part. */
    async open(item) { show('web'); return parts.web.open(item); },
    controls(cue) { const p = parts[cue.part] || parts.web; return p.controls ? p.controls(cue) : null; },
  };
  return api;
}
