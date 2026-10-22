// PC view: see a live copy of the whole screen or one window inside SDA Sabbath and present it.
// Freeze keeps the last picture on the projector while you get things ready privately.
import { h, clear, append } from '../core/util.js';
import { icon } from '../core/icons.js';
import { seg, toggle, toast, emptyState } from '../core/ui.js';
import { capture, stopStream, canCapture } from '../lib/capture.js';
import { openPip, pipSupported } from '../pip.js';

export default function create(ctx) {
  const { live, settings } = ctx;
  let cap = null;
  const video = h('video', { muted: true, autoplay: true, playsInline: true });
  video.muted = true;
  const prev = h('div.cap-prev', video);
  const status = h('span.note', 'Not sharing');
  const actions = h('div.row.wrap');
  const body = h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' } });

  const el = h('section',
    h('div.toolbar', h('h2', 'PC view'), status, h('div.grow'),
      h('span.note', 'Mouse on screen'),
      seg([['never', 'Hidden'], ['motion', 'When moving'], ['always', 'Always']], settings.v.screen.cursor, (v) => settings.set('screen.cursor', v)),
      toggle('Include sound', settings.v.screen.audio, (v) => settings.set('screen.audio', v))),
    body);

  function render() {
    clear(body); clear(actions);
    if (!canCapture()) {
      body.appendChild(emptyState('phone', 'Screen sharing isn’t available here',
        'This device cannot share its screen from a web app. Android: use Quick Settings → Cast / Screen mirroring. iPhone or iPad: use Screen Mirroring (AirPlay). On a PC use Chrome or Edge.'));
      return;
    }
    append(actions, [
      h('button.btn' + (cap ? '' : '.primary'), { type: 'button', onclick: () => start('monitor') }, icon('pc'), 'Whole screen'),
      h('button.btn', { type: 'button', onclick: () => start('window') }, icon('window'), 'One window'),
      h('button.btn', { type: 'button', onclick: () => start('browser') }, icon('tab'), 'Browser tab'),
      cap ? h('button.btn.danger', { type: 'button', onclick: () => stop() }, icon('stop'), 'Stop sharing') : null,
      pipSupported() ? h('button.btn', { type: 'button', title: 'A small always-on-top SDA Sabbath controller, so you can work in other programs', onclick: openPip }, icon('pip'), 'Mini controller') : null]);
    body.append(h('div.pad', { style: { paddingBottom: '8px' } }, actions,
      h('p.note', { style: { marginTop: '8px' } }, cap
        ? 'This is what the projector will show after Present. Work on the PC as normal; open the mini controller to keep Present, Next and Black on top of other programs.'
        : 'Pick what to share. Choosing “One window” (for example PowerPoint or a Bible app) keeps the rest of your desktop private.')),
    cap ? prev : emptyState('pc', 'Nothing shared yet', 'The live picture of your screen appears here.'));
  }

  async function start(surface) {
    try {
      if (cap) stop(true);
      cap = await capture({ surface, audio: settings.v.screen.audio });
      video.srcObject = cap.stream;
      cap.stream.getVideoTracks()[0].addEventListener('ended', () => stop());
      const title = cap.label || { monitor: 'Whole screen', window: 'Window', browser: 'Browser tab' }[cap.surface || surface] || 'Screen';
      status.textContent = 'Sharing: ' + title;
      ctx.setStaged('screen', { id: 'screen:' + title, tab: 'screen', title, sub: 'PC view', stream: cap.stream, deck: { kind: 'stream', frame: { kind: 'stream', title, sub: 'PC view' } } });
      render();
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message, 'err');
    }
  }

  function stop(silent) {
    if (!cap) return;
    const s = cap.stream;
    stopStream(s); cap = null; video.srcObject = null;
    status.textContent = 'Not sharing';
    if (live.cue && live.cue.stream === s) live.clear();
    ctx.setStaged('screen', null);
    if (!silent) render();
  }

  render();
  return {
    el,
    controls() {
      const fr = h('button.btn.sm', { type: 'button', 'aria-pressed': String(!!live.frozen), title: 'Keep the current picture on the projector while you work',
        onclick: () => live.mediaCmd('freeze', !live.frozen) }, icon('freeze'), h('span', 'Freeze'));
      const off = live.on('frozen', (on) => { fr.setAttribute('aria-pressed', String(on)); if (!document.body.contains(fr)) off(); });
      return h('div.row', fr, h('button.btn.sm', { type: 'button', onclick: () => stop() }, icon('stop'), 'Stop sharing'));
    },
  };
}
