// The Tools tab: the Stage, Stream and Listen parts (stage.js, stream.js, listen-part.js).
// Like every other tab, slides from here go to the green Next screen first; Present shows them.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import createStage from './stage.js';
import createStream from './stream.js';
import createListen from './listen-part.js';

// ------------------------------------------------------------ the Tools tab: two parts
//   Stage   – the second screen for the platform: messages, timers, phones & laptops (stage.js)
//   Stream  – OBS: lower thirds, presentation output, scene switching (stream.js)
//   Listen  – verse and hymn suggestions from what is said and sung (listen-part.js, js/listen.js)
// Each part keeps its own content; only the part that is open is shown. Stage and Stream are built the first
// time they are opened.
const PARTS = [
  ['stage', 'stage', 'Stage', 'Second screen for the platform: messages, timers, phones & laptops'],
  ['stream', 'live', 'Stream', 'OBS live stream: lower thirds, slides, scene switching'],
  ['listen', 'mic', 'Listen', 'Verse and hymn suggestions from what is said and sung'],
];
export default function create(ctx) {
  const makers = { stage: createStage, stream: createStream, listen: createListen };
  const parts = {};
  let part = PARTS.some((p) => p[0] === ctx.settings.v.app.toolsPart) ? ctx.settings.v.app.toolsPart : 'stage';
  const seg = h('div.seg.tools-seg', { role: 'group', 'aria-label': 'Tools' });
  const host = h('div.tools-parts');
  const el = h('section.tools',
    h('div.toolbar.tools-bar', h('h2', 'Tools'), seg, h('div.grow'), h('span.note.hide-sm.tools-hint')),
    host);
  const hint = el.querySelector('.tools-hint');
  function get(k) {
    if (!parts[k]) {
      const api = makers[k](ctx);
      api.el.classList.add('tools-part', 'tools-part-' + k);
      api.el.hidden = true;
      host.append(api.el);
      parts[k] = api;
    }
    return parts[k];
  }
  function paintSeg() {
    seg.replaceChildren(...PARTS.map(([k, ic, label, title]) => h('button', { type: 'button', title, 'aria-pressed': String(k === part), onclick: () => show(k) }, icon(ic), h('span', label))));
    const p = PARTS.find((x) => x[0] === part);
    hint.textContent = p ? p[3] : '';
  }
  function show(k) {
    if (!makers[k]) k = 'stage';
    const prev = parts[part];
    if (prev && part !== k) { prev.el.hidden = true; if (prev.onHide) prev.onHide(); }
    part = k;
    ctx.settings.set('app.toolsPart', k);
    const api = get(k);
    api.el.hidden = false;
    paintSeg();
    if (visible && api.onShow) api.onShow();
    return api;
  }
  let visible = false;
  show(part);
  return {
    el,
    /** Open one part (also used for the old tab names "stage" and "stream"); returns that part. */
    show(k) { return show(k); },
    onShow() { visible = true; const api = get(part); if (api.onShow) api.onShow(); },
    onHide() { visible = false; const api = parts[part]; if (api && api.onHide) api.onHide(); },
    open() { return null; },
  };
}
