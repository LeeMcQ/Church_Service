// Next (green) and Live (red) monitors. They use the same renderer as the projector,
// so the operator sees exactly what the congregation will see.
import { h, clear, debounce } from './core/util.js';
import { createStage, frameOf } from './core/render.js';
import { live, frameCount, slideName } from './core/live.js';
import { link } from './core/link.js';
import { settings } from './core/settings.js';
import { icon } from './core/icons.js';
import { hub as stageHub } from './core/stagehub.js';
import { missing, openNext, roleName } from './core/screens.js';


export function createMonitors(host) {
  const nextHost = h('div.stage-host');
  const liveHost = h('div.stage-host');
  const nextTitle = h('span.t', '');
  const liveTitle = h('span.t', '');
  const nextScreen = h('div.screen.next', nextHost);
  const liveScreen = h('div.screen.live', liveHost);
  const frames = h('div.mon-frames');
  const blackBtn = h('button.btn', { type: 'button', title: 'Black screen (B)', onclick: () => live.setBlank('black') }, icon('black'), h('span', 'Black'));
  const logoBtn = h('button.btn', { type: 'button', title: 'Show logo (L)', onclick: () => live.setBlank('logo') }, icon('logo'), h('span', 'Logo'));
  const clearBtn = h('button.btn', { type: 'button', title: 'Clear the screen (C, or Esc twice)', onclick: () => live.clear() }, icon('clear'), h('span', 'Clear'));
  const actions = h('div.mon-actions', blackBtn, logoBtn, clearBtn);
  const extra = h('div.mon-extra.note', '');
  // Phones with nothing staged or live show this slim strip instead of two empty screens.
  const strip = h('div.mon-strip', h('span.tally-dot.next'), h('span', 'Nothing on screen · pick something, then tap Present'));

  // Stage: while a stage screen is connected, a third monitor shows exactly what the platform sees.
  const stageTitle = h('span.t', '');
  const stageScreen = h('div.screen.stage-mon');
  // Below Black / Logo / Clear: a switch shows the live preview of the stage screen when it is needed.
  const stageSw = h('input', { type: 'checkbox', onchange: () => settings.set('stage.monitorPreview', stageSw.checked) });
  const stageToggle = h('label.switch.mon-sw', { title: 'Show what the stage screen shows' }, stageSw, h('span', 'Preview'));
  const stageSec = h('section.mon-stage', { hidden: true }, h('div.mon-h', h('span.tally-dot.stage'), h('span', 'Stage'), stageTitle, stageToggle), stageScreen);

  host.append(strip,
    h('section', h('div.mon-h', h('span.tally-dot.next'), h('span', 'Next'), nextTitle), nextScreen),
    h('section', h('div.mon-h', h('span.tally-dot.live'), h('span', 'Live'), liveTitle), liveScreen, frames),
    actions, stageSec, extra,
  );

  const nextStage = createStage(nextHost, { placeholderOnly: true });
  const liveStage = createStage(liveHost, { placeholderOnly: true });
  let streamVid = { next: null, live: null };
  let snapT = null, snapCanvas = null;

  function setStream(which, screenEl, stream) {
    if (streamVid[which]) { streamVid[which].srcObject = null; streamVid[which].remove(); streamVid[which] = null; }
    if (!stream) return;
    const v = h('video', { muted: true, autoplay: true, playsInline: true });
    v.muted = true; v.srcObject = stream;
    screenEl.appendChild(v);
    v.play().catch(() => {});
    streamVid[which] = v;
  }

  function emptyText(screenEl, text) {
    let e = screenEl.querySelector('.screen-empty');
    if (!text) { if (e) e.remove(); return; }
    if (!e) { e = h('div.screen-empty'); screenEl.appendChild(e); }
    e.textContent = text;
  }

  const renderNext = debounce(() => {
    const same = live.sameAsLive();
    const cue = same ? live.cue : live.staged;
    const idx = same ? live.index : (cue && cue.index);
    const part = cue && !same ? slideName(cue, idx) : '';
    nextTitle.textContent = cue ? (same ? 'Live: ' : '') + cue.title + (part ? ' · ' + part : '') + (cue.sub ? '  ' + cue.sub : '') : '';
    const f = frameOf(cue, idx);
    nextStage.show(f);
    setStream('next', nextScreen, cue && cue.deck.kind === 'stream' ? cue.stream : null);
    emptyText(nextScreen, cue ? '' : 'Pick something in a tab — it shows here before you present it.');
  }, settings.lowPower() ? 160 : 60);

  function renderFrames() {
    clear(frames);
    const cue = live.cue;
    const n = frameCount(cue);
    if (!cue || n < 2 || !cue.deck.frames) return;
    const labels = cue.labels || [];
    const max = Math.min(n, 60);
    for (let i = 0; i < max; i++) {
      frames.appendChild(h('button.frame-chip' + (i === live.index ? '.cur' : ''), { type: 'button', title: 'Show ' + (labels[i] || i + 1), onclick: () => live.go(i) }, labels[i] || String(i + 1)));
    }
  }

  function renderLive() {
    const cue = live.cue;
    liveTitle.textContent = cue ? cue.title + (cue.sub ? '  ' + cue.sub : '') : '';
    const f = frameOf(cue, live.index);
    liveStage.show(f);
    setStream('live', liveScreen, cue && cue.deck.kind === 'stream' ? cue.stream : null);
    emptyText(liveScreen, cue ? '' : live.blank === 'black' ? '' : 'Nothing is live.');
    renderFrames();
    clearInterval(snapT);
    if (cue && cue.deck.kind === 'video' && !settings.lowPower()) startSnapshots();
    else if (snapCanvas) { snapCanvas.remove(); snapCanvas = null; }
  }

  // Live video thumbnail: copy a frame from the display's own <video> once a second
  // (no second decoder needed — important on weak PCs).
  function startSnapshots() {
    if (!snapCanvas) { snapCanvas = h('canvas', { width: 320, height: 180, style: { position: 'absolute', inset: '0', width: '100%', height: '100%' } }); liveScreen.appendChild(snapCanvas); }
    const ctx2 = snapCanvas.getContext('2d');
    snapT = setInterval(() => {
      const d = link.direct();
      const v = d && d.mediaEl;
      if (!v || !v.videoWidth) return;
      const W = 320, H = 180, sc = Math.min(W / v.videoWidth, H / v.videoHeight);
      ctx2.fillStyle = '#000'; ctx2.fillRect(0, 0, W, H);
      try { ctx2.drawImage(v, (W - v.videoWidth * sc) / 2, (H - v.videoHeight * sc) / 2, v.videoWidth * sc, v.videoHeight * sc); } catch (e) { /* */ }
    }, 1000);
  }

  function setAspect() {
    const a = link.aspect();
    [nextScreen, liveScreen].forEach((s) => { s.style.aspectRatio = String(a); });
    nextStage.setAspect(a); liveStage.setAspect(a);
  }

  function applyStyle(s) { nextStage.applyStyle(s); liveStage.applyStyle(s); renderNext(); if (live.cue) renderLive(); }

  function updateBlank(mode) {
    inStep(() => liveStage.setBlank(mode));
    blackBtn.classList.toggle('live-on', mode === 'black');
    logoBtn.classList.toggle('live-on', mode === 'logo');
  }

  function updateExtra() {
    if (!link.kind) extra.textContent = 'No display connected. Press Present to open one.';
    else extra.textContent = (link.ready ? 'Presenting to: ' : 'Connecting to: ') + (link.info.label || link.kind) +
      (link.info.w ? '  (' + link.info.w + ' × ' + link.info.h + ')' : '') + (link.hasMirror() ? ' + projector 2' : '');
    // The screen layout has more outputs than are open: one click opens the next (browsers allow one per click).
    const todo = link.kind ? missing().filter((r) => r !== 'projector') : [];
    if (todo.length) {
      extra.append(h('div', { style: { marginTop: '6px' } }, h('button.btn.sm.primary', { type: 'button', onclick: async () => { await openNext(); setTimeout(updateExtra, 900); } },
        icon('present'), h('span', 'Open ' + roleName(todo[0]) + (todo.length > 1 ? ' (' + todo.length + ' to open)' : '')))));
    }
  }
  link.on('mirror', updateExtra);
  stageHub.on('outlets', updateExtra);

  // "Same as Live": the Next monitor is showing what is already on screen.
  const markSame = () => nextScreen.classList.toggle('same', live.sameAsLive());
  // Without a logo of its own, Logo shows a default slide (church name or "Welcome"); the tip says where to set one.
  const syncLogo = () => {
    logoBtn.removeAttribute('aria-disabled');
    logoBtn.title = live.hasLogo() ? 'Show logo (L)' : 'Show the default logo slide (L). Add your logo in Settings → Screen';
  };
  live.on('staged', renderNext);
  live.on('staged', markSame);
  // On a TV or another computer, the Live monitor waits until the display says it has drawn the change,
  // so both change at the same moment.
  const inStep = (fn) => {
    if (!link.remote() || !link.lastQ) { fn(); return; }
    const q = link.lastQ;
    link.whenShown(q).then(() => { if (q === link.lastQ || !link.remote()) fn(); });
  };
  live.on('live', () => inStep(renderLive));
  live.on('live', markSame);
  live.on('live', renderNext);
  live.on('go', () => { inStep(() => liveStage.show(frameOf(live.cue, live.index))); renderFrames(); markSame(); renderNext(); });
  settings.on('change:display', syncLogo);
  settings.on('change:church', syncLogo);
  syncLogo();
  live.on('blank', updateBlank);
  live.on('style', applyStyle);
  link.on('hello', () => { setAspect(); updateExtra(); });
  link.on('state', updateExtra);
  settings.on('change:display', (p) => { if (p === 'display.aspect') setAspect(); });

  // ---- the Stage monitor (a live stage-screen preview, drawn at TV size and scaled down)
  let stageFrame = null;
  const stageScale = () => { if (stageFrame) stageFrame.style.transform = 'scale(' + ((stageScreen.clientWidth || 320) / 1280) + ')'; };
  if (window.ResizeObserver) new ResizeObserver(stageScale).observe(stageScreen);
  function syncStage() {
    const screens = stageHub.screens().filter((o) => o.role !== 'obs');
    const S = settings.v.stage || {};
    const want = screens.length > 0 && S.monitor !== false;
    stageSec.hidden = !want;
    const on = want && S.monitorPreview === true;
    stageSw.checked = on;
    stageScreen.hidden = !on;
    stageTitle.textContent = want ? (screens.length === 1 ? screens[0].name || screens[0].label || '1 screen' : screens.length + ' screens') : '';
    const draw = on && !settings.lowPower();
    if (draw && !stageFrame) {
      stageFrame = h('iframe.st-pv-f.st-pv-tv', { src: 'stage.html?via=win&preview=1', title: 'What the stage screen shows', tabindex: '-1' });
      stageScreen.append(stageFrame);
      emptyText(stageScreen, '');
      stageScale();
    } else if (!draw && stageFrame) { stageFrame.remove(); stageFrame = null; }
    if (on && !draw) emptyText(stageScreen, 'Stage preview is off in low-power mode.');
  }
  stageHub.on('outlets', syncStage);
  settings.on('change:stage', (p) => { if (p === 'stage.monitor' || p === 'stage.monitorPreview') syncStage(); });
  settings.on('change:app', (p) => { if (p === 'app.lowPower') syncStage(); });
  syncStage();

  setAspect(); updateExtra();
  live.buildStyle();
  renderNext();
  emptyText(liveScreen, 'Nothing is live.');
  return { renderNext, renderLive };
}
