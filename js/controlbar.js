// Bottom control bar: appears while something is live and adapts to its type.
import { h, clear, fmtTime } from './core/util.js';
import { icon } from './core/icons.js';
import { btn } from './core/ui.js';
import { live, frameCount } from './core/live.js';
import { bgAudio } from './core/audio.js';
// The hymn music engine is loaded a moment after start-up (nothing can play before it is loaded anyway).
const idle = (f) => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 800));
let music = { isPlaying: () => false, state: {}, on() {}, unlock() {}, toggle() {}, fade() {}, stop() {} };

export function createControlBar(el, getTab) {
  const counter = h('span.cb-sub', '');
  const audioBox = h('div.audio-mini', { hidden: true });
  const musicBox = h('div.audio-mini.music-mini', { hidden: true });
  const shown = () => !!live.cue || bgAudio.active || music.isPlaying();
  let typeBox = h('div.cb-type');
  let renderedFor = null;

  async function render() {
    const cue = live.cue;
    el.hidden = !shown();
    document.documentElement.style.setProperty('--bar-on', el.hidden ? '0' : '1');
    if (renderedFor === cue && el.childNodes.length) { updateCounter(); return; }
    renderedFor = cue;
    clear(el);
    if (cue) {
      el.append(
        h('div.cb-live', h('span.tally-dot.live'), h('div', { style: { minWidth: 0 } }, h('div.cb-title', cue.title), counter)),
        h('div.sep'),
        btn('prev', 'Previous', () => live.prev(), { key: '←' }),
        btn('next', 'Next', () => live.next(), { key: '→' }),
      );
      typeBox = h('div.cb-type');
      el.appendChild(typeBox);
      try {
        const tab = await getTab(cue.tab);
        if (live.cue === cue && tab && tab.controls) { const c = tab.controls(cue); if (c) typeBox.appendChild(c); }
      } catch (e) { console.warn(e); }
    } else el.appendChild(h('div.grow'));
    el.append(
      h('div.cb-end',
        btn('black', 'Black screen', () => live.setBlank('black'), { key: 'B', cls: live.blank === 'black' ? 'live-on' : '' }),
        btn('logo', 'Logo', () => live.setBlank('logo'), { key: 'L', cls: live.blank === 'logo' ? 'live-on' : '' }),
        btn('clear', 'Clear screen', () => live.clear(), { key: 'C' })),
      musicBox,
      audioBox,
    );
    const lb = el.querySelector('.cb-end .btn[aria-label="Logo"]');
    if (lb && !live.hasLogo()) lb.title = 'Show the default logo slide (L). Add your logo in Settings → Screen';
    updateCounter();
    renderAudio();
    renderMusic(true);
  }

  // Hymn music mini-player: visible whenever music plays, whatever is on screen.
  let mUi = null;
  function renderMusic(rebuild) {
    const st = music.state || {};
    musicBox.hidden = !st.playing;
    if (!st.playing) { clear(musicBox); mUi = null; return; }
    if (!mUi || rebuild) {
      clear(musicBox);
      const playB = btn('pause', 'Pause / continue the music (M)', () => { music.unlock(); music.toggle(); }, { cls: 'sm' });
      const ttl = h('span.cb-sub.trunc', { style: { maxWidth: '170px' } }, '');
      const tm = h('span.tm.cb-sub', '');
      musicBox.append(icon('music'), ttl, playB, tm,
        btn('fade', 'Fade out the music', () => music.fade(3000), { cls: 'sm' }),
        btn('stop', 'Stop the music', () => music.stop(), { cls: 'sm' }));
      mUi = { playB, ttl, tm, paused: null };
    }
    const sec = st.section != null && st.sections && st.sections[st.section] ? st.sections[st.section].label : '';
    mUi.ttl.textContent = (st.title || 'Hymn') + (sec ? ' · ' + sec : '');
    mUi.tm.textContent = st.loading ? 'loading…' : fmtTime(st.time) + ' / ' + fmtTime(st.dur);
    if (mUi.paused !== !!st.paused) { mUi.paused = !!st.paused; mUi.playB.replaceChildren(icon(st.paused ? 'play' : 'pause')); }
  }

  function updateCounter() {
    const cue = live.cue;
    if (!cue) return;
    const n = frameCount(cue);
    const lab = cue.labels && cue.labels[live.index];
    counter.textContent = (cue.sub ? cue.sub + '   ' : '') + (n > 1 ? (lab ? lab + '  ·  ' : '') + (live.index + 1) + ' / ' + n : '');
    el.querySelectorAll('.cb-end .btn').forEach((b) => b.classList.remove('live-on'));
    const bb = el.querySelector('.cb-end .btn[aria-label="Black screen"]');
    const lb = el.querySelector('.cb-end .btn[aria-label="Logo"]');
    if (bb) bb.classList.toggle('live-on', live.blank === 'black');
    if (lb) lb.classList.toggle('live-on', live.blank === 'logo');
  }

  let audioUi = null;
  function renderAudio(st) {
    audioBox.hidden = !bgAudio.active;
    if (!bgAudio.active) { clear(audioBox); audioUi = null; return; }
    const hasQueue = !!bgAudio.queue;
    if (!audioUi || audioUi.hasQueue !== hasQueue) {
      clear(audioBox);
      const playB = btn('pause', 'Play / pause the music', () => bgAudio.toggle(), { cls: 'sm' });
      const tm = h('span.tm.cb-sub', '');
      const ttl = h('span.cb-sub.trunc', { style: { maxWidth: '140px' } }, bgAudio.title);
      audioBox.append(icon('music'), ttl,
        hasQueue ? btn('prev', 'Previous piece', () => bgAudio.queue && bgAudio.queue.prev(), { cls: 'sm' }) : '',
        playB,
        hasQueue ? btn('next', 'Next piece', () => bgAudio.queue && bgAudio.queue.next(), { cls: 'sm' }) : '',
        tm,
        btn('fade', 'Fade out the music', () => bgAudio.fadeOut(3000), { cls: 'sm' }),
        btn('stop', 'Stop the music', () => bgAudio.stop(), { cls: 'sm' }));
      audioUi = { playB, tm, ttl, hasQueue };
    }
    if (st) {
      audioUi.ttl.textContent = st.title;
      audioUi.ttl.title = st.title;
      audioUi.tm.textContent = st.live || !st.dur ? 'Live' : fmtTime(st.time) + ' / ' + fmtTime(st.dur);
      audioUi.playB.replaceChildren(icon(st.paused ? 'play' : 'pause'));
    }
  }

  live.on('live', render);
  live.on('go', updateCounter);
  live.on('blank', updateCounter);
  idle(() => import('./core/hymnmusic.js').then((m) => {
    music = m.music;
    music.on('state', () => { if (el.hidden !== !shown()) { renderedFor = undefined; render(); } else renderMusic(false); });
  }));
  bgAudio.on('state', (st) => { if (el.hidden !== !shown()) { renderedFor = undefined; render(); } else renderAudio(st); });
  render();
  return { render };
}
