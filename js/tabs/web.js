// Web tab: show a web page on the screen. Two ways:
//   • Mirror a browser tab — an exact copy of what you see, without the mouse pointer.
//   • Embed — the page loads directly on the display (only for sites that allow it, e.g. YouTube).
import { h, clear, safeHttpUrl } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn, seg, toast, emptyState } from '../core/ui.js';
import { capture, stopStream, canCapture, attachSurfaceControl } from '../lib/capture.js';

function youtubeEmbed(url) {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{6,})/.exec(url);
  return m ? 'https://www.youtube-nocookie.com/embed/' + m[1] + '?autoplay=1&rel=0&modestbranding=1' : null;
}
function normaliseUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  // Only http(s) pages may load: javascript:, data:, file: etc. are refused.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) || /^\s*(javascript|data|vbscript|file|blob|about):/i.test(u)) return safeHttpUrl(u);
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(u)) return 'https://' + u;
  return 'https://www.google.com/search?q=' + encodeURIComponent(u);
}

export default function create(ctx) {
  const { live } = ctx;
  let mode = 'mirror';
  let cap = null, surf = null;
  const url = h('input.field.grow', { type: 'url', placeholder: 'Web address, e.g. youtube.com/watch?v=…', inputmode: 'url',
    onkeydown: (e) => { if (e.key === 'Enter') go(); } });
  const frame = h('iframe.web-frame', { title: 'Web page preview', referrerpolicy: 'strict-origin-when-cross-origin' /* YouTube Error 153 needs a Referer; origin only */, allow: 'autoplay; fullscreen; encrypted-media' });
  const capVideo = h('video', { muted: true, autoplay: true, playsInline: true });
  capVideo.muted = true;
  const capBox = h('div.cap-prev', capVideo);
  const note = h('p.note.pad', '');
  const zoomRow = h('div.row', { hidden: true });
  const body = h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' } });
  const modeSeg = seg([['mirror', 'Mirror a tab'], ['embed', 'Embed page']], mode, (v) => { mode = v; render(); });

  const el = h('section',
    h('div.toolbar', h('h2', 'Web'), modeSeg, url, h('button.btn.primary', { type: 'button', onclick: () => go() }, 'Go')),
    body);

  function render() {
    clear(body);
    if (mode === 'embed') {
      note.textContent = 'The page loads on the display by itself. Many sites (Google, Facebook, banks) refuse to be embedded — use “Mirror a tab” for those. YouTube and most video sites work.';
      body.append(note, frame);
      if (url.value) stageEmbed();
    } else {
      note.textContent = canCapture()
        ? '1. Open the page in a normal browser tab (or press “Open in a window”).  2. Press “Choose tab” and pick it. The screen shows exactly that tab, without your mouse pointer. Scroll it here with the mouse wheel where Chrome allows.'
        : 'Mirroring needs Chrome or Edge on a computer. On this device, use “Embed page”.';
      body.append(note,
        h('div.row.wrap.pad', { style: { paddingTop: 0 } },
          h('button.btn', { type: 'button', onclick: openWindow }, icon('window'), 'Open in a window'),
          h('button.btn.primary', { type: 'button', onclick: chooseTab, disabled: !canCapture() }, icon('tab'), 'Choose tab'),
          cap ? h('button.btn.danger', { type: 'button', onclick: stop }, icon('stop'), 'Stop mirroring') : null,
          zoomRow),
        cap ? capBox : emptyState('tab', 'No tab mirrored yet', 'The mirrored tab appears here.'));
      if (cap) stageStream();
    }
  }

  function go() {
    const u = normaliseUrl(url.value);
    if (!u) { if (url.value.trim()) toast('Only http:// or https:// web addresses can be opened.', 'err'); return; }
    url.value = u;
    if (mode === 'embed') { frame.src = youtubeEmbed(u) || u; stageEmbed(); }
    else openWindow();
  }

  function stageEmbed() {
    const u = normaliseUrl(url.value);
    if (!u) return;
    const src = youtubeEmbed(u) || u;
    if (frame.src !== src) frame.src = src;
    let host = u; try { host = new URL(u).host; } catch (e) { /* */ }
    ctx.setStaged('web', { id: 'web:' + src, tab: 'web', title: host, sub: 'Web page', deck: { kind: 'web', frame: { kind: 'web', url: src, title: host, sub: 'Web page' } }, plan: { tab: 'web', url: u, label: host } });
  }

  let webWin = null;
  function openWindow() {
    const u = normaliseUrl(url.value) || 'https://www.google.com';
    webWin = window.open(u, 'selah-web', 'popup=yes,width=1280,height=760');
    if (!webWin) toast('Allow pop-ups to open the page in a window.', 'err');
    else toast('Now press “Choose tab” or “Choose window” and pick that page.', '', 5000);
  }

  async function chooseTab() {
    try {
      if (cap) stop(true);
      cap = await capture({ surface: 'browser', audio: true });
      capVideo.srcObject = cap.stream;
      cap.stream.getVideoTracks()[0].addEventListener('ended', () => stop());
      surf = attachSurfaceControl(capVideo, cap.controller);
      clear(zoomRow);
      if (surf) {
        zoomRow.hidden = false;
        zoomRow.append(btn('minus', 'Zoom out the page', surf.zoomOut, { cls: 'sm' }), btn('plus', 'Zoom in the page', surf.zoomIn, { cls: 'sm' }), btn('reload', 'Reset zoom', surf.zoomReset, { cls: 'sm' }));
      }
      render();
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message, 'err'); }
  }

  function stageStream() {
    if (!cap) return;
    const title = cap.label || 'Browser tab';
    ctx.setStaged('web', { id: 'webcap:' + title, tab: 'web', title, sub: 'Mirrored tab', stream: cap.stream, deck: { kind: 'stream', frame: { kind: 'stream', title, sub: 'Mirrored tab' } } });
  }

  function stop(silent) {
    if (!cap) return;
    const s = cap.stream;
    if (surf) { surf.detach(); surf = null; }
    stopStream(s); cap = null; capVideo.srcObject = null;
    if (live.cue && live.cue.stream === s) live.clear();
    ctx.setStaged('web', null);
    if (!silent) render();
  }

  render();
  return {
    el,
    async open({ url: u }) {
      await ctx.showTab('web');
      url.value = u || '';
      if (youtubeEmbed(u || '')) { mode = 'embed'; modeSeg.set('embed'); }
      render();
      if (mode === 'embed') stageEmbed();
      return ctx.stagedOf('web');
    },
    controls(cue) {
      if (cue.deck.kind === 'stream') return h('div.row', h('button.btn.sm', { type: 'button', onclick: () => stop() }, icon('stop'), 'Stop mirroring'));
      return h('div.row', h('button.btn.sm', { type: 'button', title: 'Reload the page on the display', onclick: () => { const c = live.cue; if (c) live.replace(Object.assign({}, c, { deck: { kind: 'web', frame: Object.assign({}, c.deck.frame) } })); } }, icon('reload'), 'Reload'));
    },
  };
}
