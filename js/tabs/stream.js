// Tools → Stream: everything for the live stream in OBS Studio.
//   1. Connect OBS — one click (obs-websocket) creates the sources and a presentation scene; or copy /
//      drag the two addresses into Browser Sources by hand.
//   2. OBS control — switch scenes, follow the slides automatically, start/stop streaming and recording.
//   3. Lower thirds — names, announcements, a scrolling ticker; Bible verses and hymn words automatically.
//   4. Look — style, position, size, church logo, text over the camera for the full-slide output.
// Nothing on this tab changes the projector.
import { h, clear } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn, seg, toggle, select, modal, confirmBox, promptBox } from '../core/ui.js';
import { hub } from '../core/stagehub.js';
import { obs, LOWER_NAME, FULL_NAME } from '../core/obsctl.js';
import { fmtCode } from '../core/stagenet.js';

const pad2 = (n) => String(n).padStart(2, '0');
const dur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 3600) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60); };

export default function create(ctx) {
  const { settings, toast } = ctx;
  const S = () => settings.v.stream;
  const card = (title, ...kids) => h('div.card.st-card', h('h3', title), ...kids);
  const usesLan = () => !!ctx.companion;

  // ------------------------------------------------------------ 1. connect OBS
  const urlIn = h('input.field', { value: S().obsUrl || 'ws://127.0.0.1:4455', spellcheck: 'false', 'aria-label': 'OBS WebSocket address', style: { width: '220px' } });
  const passIn = h('input.field', { value: S().obsPass || '', type: 'password', autocomplete: 'off', placeholder: 'WebSocket password', 'aria-label': 'OBS WebSocket password', style: { width: '200px' } });
  let camPicked = false;
  const camSel = h('select.field', { 'aria-label': 'Camera scene', onchange: () => { camPicked = true; } });
  const obsState = h('div.st-net');
  const connBtn = h('button.btn.primary', { type: 'button', onclick: () => connectOnly() }, icon('link'), h('span', 'Connect to OBS'));
  const setupBtn = h('button.btn.primary', { type: 'button', onclick: () => setupNow() }, icon('check'), h('span', 'Set up OBS'));
  const disBtn = h('button.btn.sm', { type: 'button', onclick: () => { obs.disconnect(); } }, icon('x'), h('span', 'Disconnect'));
  const camRow = h('div.st-step', h('div', h('b', '2. '), 'Which scene has your camera? The lower third goes on top of it.'), h('div.row.wrap', camSel, setupBtn));
  const autoCard = card('Connect OBS (automatic)',
    h('p.note', 'One click puts SDA Sabbath into OBS: a “', h('b', LOWER_NAME), '” overlay on your camera scene, and a “', h('b', S().presScene), '” scene with the slides full screen. Needs OBS 28 or newer: in OBS open ', h('b', 'Tools → WebSocket Server Settings'), ', tick ', h('b', 'Enable WebSocket server'), ', and copy the password from ', h('b', 'Show Connect Info'), '.'),
    h('div.st-step', h('div', h('b', '1. '), 'Connect'), h('div.row.wrap', urlIn, passIn, connBtn, disBtn)),
    camRow,
    obsState,
    h('p.note', 'OBS on another computer: open SDA Sabbath from the companion on that computer, or set OBS up by hand below. If the browser asks to allow access to devices on your network, allow it.'));

  // Step 1 only connects (nothing in OBS changes); step 2 creates the sources once the camera scene is known.
  let camGuess = '';
  async function connectOnly() {
    settings.set('stream.obsUrl', urlIn.value.trim() || 'ws://127.0.0.1:4455');
    settings.set('stream.obsPass', passIn.value);
    connBtn.disabled = true;
    const ok = await obs.connect({ url: urlIn.value.trim(), pass: passIn.value });
    connBtn.disabled = false;
    if (!ok) { toast(obs.error || 'Could not connect to OBS.', 'err', 9000); return; }
    camGuess = S().camScene && obs.scenes.includes(S().camScene) ? S().camScene : (await obs.findCameraScene()) || '';
    paintAll();
    if (!S().camScene) toast('Connected to OBS. Check the camera scene, then press “Set up OBS”.', 'ok', 6000);
  }
  async function setupNow() {
    if (obs.state !== 'on') { await connectOnly(); if (obs.state !== 'on') return; }
    await prepareLinks();
    setupBtn.disabled = true;
    try {
      const u = urls();
      const r = await obs.setup({ lowerUrl: u.lower, fullUrl: u.full, camScene: camSel.value });
      toast('OBS is set up: lower third on “' + r.cam + '”, slides on “' + r.pres + '”.', 'ok', 6000);
    } catch (e) { toast('OBS set-up failed: ' + e.message, 'err', 9000); }
    setupBtn.disabled = false;
    paintAll();
  }
  /** The internet link must be on for OBS to follow by room code (not needed with the companion). */
  async function prepareLinks() {
    if (usesLan()) return;
    hub.ensureCode();
    if (!settings.v.stage.online || hub.net.state === 'off' || hub.net.state === 'error') await hub.goOnline(true);
  }
  const urls = () => obs.urls(ctx);

  // ------------------------------------------------------------ manual set-up
  const lowerUrlEl = h('code.st-url');
  const fullUrlEl = h('code.st-url');
  const lowerDrag = h('a.btn.sm.drag', { draggable: 'true', title: 'Drag this into the Sources list in OBS', onclick: (e) => e.preventDefault() }, icon('grip'), h('span', 'Drag into OBS'));
  const fullDrag = h('a.btn.sm.drag', { draggable: 'true', title: 'Drag this into the Sources list in OBS', onclick: (e) => e.preventDefault() }, icon('grip'), h('span', 'Drag into OBS'));
  const copy = (which) => {
    prepareLinks();
    const u = urls()[which];
    const done = () => toast('Address copied. In OBS: Sources → + → Browser → paste it as the URL, width 1920, height 1080.', 'ok', 7000);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, () => promptBox('Copy this address', 'Address', u));
    else promptBox('Copy this address', 'Address', u);
  };
  const manualCard = card('Set up OBS by hand',
    h('p.note', 'In OBS, under Sources press + → ', h('b', 'Browser'), ', paste the address, set Width 1920 and Height 1080, and press OK. Or drag the button straight onto the Sources list.'),
    h('div.st-src', h('div', h('b', 'Lower third'), h('span.note', ' — over the camera: Bible verses, hymn words, names, ticker, logo. Transparent.')), lowerUrlEl,
      h('div.row.wrap', h('button.btn.sm', { type: 'button', onclick: () => copy('lower') }, icon('copy'), h('span', 'Copy address')), lowerDrag)),
    h('div.st-src', h('div', h('b', 'Presentation'), h('span.note', ' — the slides full screen, exactly as on the projector (for a “Presentation” scene).')), fullUrlEl,
      h('div.row.wrap', h('button.btn.sm', { type: 'button', onclick: () => copy('full') }, icon('copy'), h('span', 'Copy address')), fullDrag)),
    h('p.note', 'Videos and screen sharing are not sent to OBS: add a Window Capture of the SDA Sabbath display window to the Presentation scene for those.'));
  [['lower', lowerDrag], ['full', fullDrag]].forEach(([k, a]) => a.addEventListener('dragstart', (e) => {
    const u = urls()[k];
    // OBS turns a dropped link into a Browser Source (it reads the URL from the drag data).
    try { e.dataTransfer.setData('text/uri-list', u); e.dataTransfer.setData('text/plain', u); e.dataTransfer.effectAllowed = 'copyLink'; } catch (er) { /* */ }
  }));

  // ------------------------------------------------------------ 2. OBS control
  const sceneChips = h('div.row.wrap.st-scenes');
  const streamBtn = h('button.btn', { type: 'button', onclick: () => toggleOut('stream') });
  const recBtn = h('button.btn', { type: 'button', onclick: () => toggleOut('record') });
  const outState = h('div.row.wrap.st-out');
  const autoSceneT = toggle('Follow the slides: the presentation scene for slides, pictures and banners; the camera (with the words in the lower third) for Bible verses and hymns, black and clear', !!S().autoScene, (v) => { settings.set('stream.autoScene', v); if (v) obs.resumeAuto(); });
  const mediaSel = select([['camera', 'the camera scene'], ['presentation', 'the presentation scene (with a Window Capture of the display)'], ['stay', 'no change']], S().mediaScene || 'camera', (v) => settings.set('stream.mediaScene', v));
  const studioT = toggle('In Studio Mode, put scenes in Preview (you press Transition)', S().studioPreview !== false, (v) => settings.set('stream.studioPreview', v));
  const pausedEl = h('div.st-showing', { hidden: true }, h('span.st-pill', 'Following paused'), h('span.grow', 'You chose a scene in OBS. Following starts again with the next item.'),
    h('button.btn.sm', { type: 'button', onclick: () => obs.resumeAuto() }, icon('play'), h('span', 'Resume now')));
  const healthEl = h('div.note.st-health');
  const controlCard = card('OBS control', outState, healthEl, h('div.row.wrap', streamBtn, recBtn), h('div.note', 'Scenes (click to put on air):'), sceneChips, autoSceneT,
    h('div.row.wrap', h('span.note', 'Videos and screen sharing switch to'), mediaSel), studioT, pausedEl,
    h('p.note', 'Scene switching only moves between the camera scene and the presentation scene, so a scene you pick yourself in OBS (pre-service loop, closing card) is never taken off air.'));
  async function toggleOut(which) {
    const on = which === 'stream' ? obs.streaming : obs.recording;
    if (on && !(await confirmBox(which === 'stream' ? 'Stop the live stream?' : 'Stop recording?', which === 'stream' ? 'Viewers will see the stream end.' : 'The recording file is closed.', which === 'stream' ? 'Stop streaming' : 'Stop recording', true))) return;
    if (!on && which === 'stream') {
      // Pre-flight: what viewers will see when the stream starts.
      const outs = hub.obsOutputs();
      const checks = [
        [outs.some((o) => o.mode === 'lower'), 'Lower third is connected in OBS'],
        [outs.some((o) => o.mode === 'full'), 'Presentation (slides) is connected in OBS'],
        [!!obs.program, 'On air now: ' + (obs.program || '—')],
        [hub.overlaysOn, hub.overlaysOn ? 'Overlays are switched on' : 'Overlays are hidden (switch them on under Lower thirds)'],
      ];
      const body = h('div.col', h('p', 'OBS starts streaming to the service set in OBS → Settings → Stream.'),
        h('ul.st-check', ...checks.map(([ok, t]) => h('li' + (ok ? '.ok' : '.no'), (ok ? '✓ ' : '! ') + t))));
      const go = await new Promise((res) => { let d = false; modal({ title: 'Start the live stream?', body, onclose: () => { if (!d) res(false); }, actions: [{ label: 'Cancel', onclick: () => { d = true; res(false); } }, { label: 'Go live', primary: true, onclick: () => { d = true; res(true); } }] }); });
      if (!go) return;
    }
    try { await (which === 'stream' ? obs.toggleStream() : obs.toggleRecord()); } catch (e) { toast('OBS: ' + e.message, 'err', 6000); }
  }

  // ------------------------------------------------------------ 3. lower thirds
  const onT = toggle('Show overlays on the stream', hub.overlaysOn, (v) => hub.setOverlays(v), 'Off hides every lower third, the ticker and the logo at once');
  const nameIn = h('input.field', { placeholder: 'Name, e.g. Pastor J. Mokoena', 'data-free-text': '', style: { flex: '1 1 200px' } });
  const roleIn = h('input.field', { placeholder: 'Title or role, e.g. Guest speaker', 'data-free-text': '', style: { flex: '1 1 200px' } });
  const secSel = select([['0', 'Until hidden'], ['6', '6 seconds'], ['8', '8 seconds'], ['12', '12 seconds'], ['20', '20 seconds']], String(S().lowerSec), (v) => settings.set('stream.lowerSec', +v));
  const namesEl = h('div.row.wrap.st-presets');
  const textIn = h('input.field', { placeholder: 'Announcement, e.g. Welcome to everyone joining online', 'data-free-text': '', style: { flex: '1' } });
  const tickIn = h('input.field', { placeholder: 'Scrolling ticker text, e.g. Prayer requests: WhatsApp 082 …', 'data-free-text': '', style: { flex: '1' } });
  const nowLower = h('div.st-showing', { hidden: true });
  const showName = () => {
    const t = nameIn.value.trim(), r = roleIn.value.trim();
    if (!t && !r) { nameIn.focus(); return; }
    hub.showLower({ title: t, text: r, kind: 'name' });
  };
  [nameIn, roleIn].forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') showName(); }));
  textIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && textIn.value.trim()) hub.showLower({ title: '', text: textIn.value, kind: 'text' }); });
  tickIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') hub.setTicker(tickIn.value); });
  const lowerCard = card('Lower thirds',
    h('div.row.wrap', onT, h('button.btn.sm', { type: 'button', onclick: () => { hub.hideLower(); } }, icon('x'), h('span', 'Hide lower third'))),
    nowLower,
    h('div.note', 'Name'),
    h('div.row.wrap', nameIn, roleIn),
    h('div.row.wrap', h('button.btn.primary', { type: 'button', onclick: showName }, icon('present'), h('span', 'Show')), h('span.note', 'for'), secSel,
      h('button.btn.sm', { type: 'button', title: 'Keep this name for next time', onclick: () => {
        const t = nameIn.value.trim(), r = roleIn.value.trim();
        if (!t) { nameIn.focus(); return; }
        const list = (S().names || []).filter((x) => !(x.t === t && x.r === r));
        list.unshift({ t, r }); settings.set('stream.names', list.slice(0, 30)); paintNames();
      } }, icon('star'), h('span', 'Save name'))),
    namesEl,
    h('div.note', 'Announcement'),
    h('div.row', textIn, h('button.btn', { type: 'button', onclick: () => { if (textIn.value.trim()) hub.showLower({ title: '', text: textIn.value, kind: 'text' }); } }, h('span', 'Show'))),
    h('div.note', 'Ticker (scrolls along the bottom until stopped)'),
    h('div.row', tickIn, h('button.btn', { type: 'button', onclick: () => hub.setTicker(tickIn.value) }, h('span', 'Start')), h('button.btn', { type: 'button', onclick: () => hub.setTicker('') }, h('span', 'Stop'))));
  function paintNames() {
    clear(namesEl);
    // Who leads the parts of today's plan, one click away.
    const fromPlan = [];
    ((hub.plan && hub.plan.items) || []).forEach((it) => { if (it.role && !fromPlan.some((x) => x.t === it.role)) fromPlan.push({ t: it.role, r: it.t }); });
    fromPlan.slice(0, 12).forEach((x) => namesEl.append(h('button.chip.plan-chip', { type: 'button', title: 'From the service plan — show now', onclick: () => { nameIn.value = x.t; roleIn.value = x.r || ''; hub.showLower({ title: x.t, text: x.r || '', kind: 'name' }); } }, icon('plan'), x.t + (x.r ? ' · ' + x.r : ''))));
    (S().names || []).forEach((x, i) => {
      const chip = h('button.chip', { type: 'button', title: 'Show this name now (right-click to remove)', onclick: () => { nameIn.value = x.t; roleIn.value = x.r || ''; hub.showLower({ title: x.t, text: x.r || '', kind: 'name' }); },
        oncontextmenu: (e) => { e.preventDefault(); const list = (S().names || []).slice(); list.splice(i, 1); settings.set('stream.names', list); paintNames(); } },
      x.t + (x.r ? ' · ' + x.r : ''));
      namesEl.append(chip);
    });
  }
  function paintLower() {
    const m = hub.lower;
    nowLower.hidden = !m && !hub.ticker && hub.overlaysOn;
    const parts = [];
    if (!hub.overlaysOn) parts.push(h('span.st-pill', 'Overlays hidden'));
    if (m) parts.push(h('span.st-pill.on', 'On the stream'), h('span.grow.trunc', [m.title, m.text].filter(Boolean).join(' — ')), h('button.btn.sm', { type: 'button', onclick: () => hub.hideLower() }, icon('x'), h('span', 'Hide')));
    if (hub.ticker) parts.push(h('span.st-pill.on', 'Ticker'), h('span.grow.trunc', hub.ticker.text), h('button.btn.sm', { type: 'button', onclick: () => hub.setTicker('') }, icon('x'), h('span', 'Stop')));
    nowLower.replaceChildren(...parts);
    onT.querySelector('input').checked = hub.overlaysOn;
  }

  // ------------------------------------------------------------ automatic lower thirds
  const autoLowerCard = card('Automatic lower thirds',
    toggle('Bible verses: the reference and the verse appear on the stream when they go on the screen', S().autoBible, (v) => settings.set('stream.autoBible', v)),
    toggle('Hymns: the words appear on the stream so viewers at home can sing along', S().autoHymns, (v) => settings.set('stream.autoHymns', v)),
    h('div.row.wrap', h('span.note', 'Hymns show'), seg([['lines', 'The words'], ['title', 'Only the hymn title']], S().hymnMode, (v) => settings.set('stream.hymnMode', v))),
    toggle('Other text slides (responsive readings, Tools) too', S().autoOther, (v) => settings.set('stream.autoOther', v)),
    h('p.note', 'A name or announcement you show by hand goes over the automatic words while it is up.'));

  // ------------------------------------------------------------ look
  const lookCard = card('Look',
    h('div.form.st-form',
      h('label', 'Style'), seg([['classic', 'Classic'], ['light', 'Light'], ['minimal', 'Minimal']], S().theme, (v) => settings.set('stream.theme', v)),
      h('label', 'Position'), seg([['left', 'Left'], ['center', 'Centre']], S().pos, (v) => settings.set('stream.pos', v)),
      h('label', 'Size'), select([['0.85', 'Small'], ['1', 'Normal'], ['1.15', 'Large'], ['1.3', 'Extra large']], String(S().size || 1), (v) => settings.set('stream.size', +v)),
      h('label', 'Accent colour'), h('div.row', h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(S().accent) ? S().accent : '#c9a44c', oninput: (e) => settings.set('stream.accent', e.target.value) }),
        h('button.btn.sm', { type: 'button', onclick: () => settings.set('stream.accent', '') }, 'Same as the projector')),
      h('label', 'Presentation'), seg([['stage', 'Same as projector'], ['transparent', 'Text over the camera']], S().fullBg, (v) => settings.set('stream.fullBg', v))),
    h('p.note', 'Text over the camera: the slide background is left out and the camera scene is put underneath the slides in the presentation scene (when OBS is connected).'),
    toggle('Church logo in the corner of the stream (from Settings → Screen)', S().bug, (v) => settings.set('stream.bug', v)));

  // ------------------------------------------------------------ preview
  let pvMode = 'lower';
  const pvHost = h('div.st-pv');
  let pvFrame = null;
  const pvCard = card('What the stream sees',
    seg([['lower', 'Lower third'], ['full', 'Presentation']], pvMode, (v) => { pvMode = v; if (pvFrame) { pvFrame.remove(); pvFrame = null; } paintPreview(); }),
    pvHost, h('p.note', 'The checkerboard is see-through: in OBS the camera picture shows there.'));
  function paintPreview() {
    const want = !el.hidden;
    if (want && !pvFrame) { pvFrame = h('iframe.st-pv-f', { src: 'obs.html?via=win&preview=1&mode=' + pvMode, title: 'Stream preview' }); pvHost.append(pvFrame); }
    else if (!want && pvFrame) { pvFrame.remove(); pvFrame = null; }
  }

  // ------------------------------------------------------------ painting
  function paintObs() {
    const st = obs.state;
    obsState.className = 'st-net ' + (st === 'on' ? 'on' : st === 'error' || st === 'auth' ? 'error' : '');
    obsState.textContent = st === 'on' ? 'Connected to OBS' + (obs.version ? ' (WebSocket ' + obs.version + ')' : '') + (obs.studio ? ' · Studio Mode' : '') + ' · ' + hub.obsOutputs().length + ' SDA Sabbath source(s) following'
      : st === 'connecting' ? (obs.error || 'Connecting to OBS…') : obs.error || obs.lastError || 'Not connected';
    connBtn.hidden = st === 'on';
    setupBtn.querySelector('span').textContent = S().camScene && obs.scenes.includes(S().presScene) ? 'Set up OBS again (repair)' : 'Set up OBS';
    disBtn.hidden = st === 'off';
    controlCard.hidden = st !== 'on';
    camRow.hidden = st !== 'on';
    const cur = camPicked ? camSel.value : (S().camScene && obs.scenes.includes(S().camScene) ? S().camScene : camGuess);
    clear(camSel);
    const cams = obs.scenes.filter((x) => x !== S().presScene);
    cams.forEach((x) => camSel.append(h('option', { value: x }, x + (x === camGuess && x !== S().camScene ? '  (has a camera)' : ''))));
    camSel.value = cur && cams.includes(cur) ? cur : camGuess || obs.program || cams[0] || '';
    pausedEl.hidden = !(obs.autoPaused && S().autoScene);
    const hl = obs.health;
    healthEl.hidden = !obs.streaming || !hl;
    if (hl) {
      const drop = hl.total ? (hl.skipped / hl.total) * 100 : 0;
      healthEl.textContent = hl.reconnecting ? '⚠ Reconnecting to the streaming service…' : 'Connection ' + (hl.congestion > 0.5 ? '⚠ congested' : hl.congestion > 0.15 ? 'busy' : 'good') + ' · dropped frames ' + drop.toFixed(1) + ' %';
      healthEl.classList.toggle('warn', hl.reconnecting || hl.congestion > 0.5 || drop > 2);
    }
    clear(sceneChips);
    obs.scenes.forEach((x) => sceneChips.append(h('button.chip' + (x === obs.program ? '.live-chip' : ''), { type: 'button', 'aria-pressed': String(x === obs.program), title: obs.studio ? 'Click: Preview · the program changes when you press Transition in OBS' : 'Put this scene on air',
      onclick: () => obs.setScene(x).catch((e) => toast('OBS: ' + e.message, 'err')) },
      x === obs.program ? h('span.st-dot') : null, x, obs.studio && x === obs.preview ? h('span.faint', ' (preview)') : null)));
    streamBtn.replaceChildren(icon(obs.streaming ? 'x' : 'cast'), h('span', obs.streaming ? 'Stop streaming' : 'Start streaming'));
    streamBtn.classList.toggle('danger', obs.streaming);
    recBtn.replaceChildren(icon(obs.recording ? 'x' : 'video'), h('span', obs.recording ? 'Stop recording' : 'Start recording'));
    tickOut();
  }
  function tickOut() {
    const parts = [];
    parts.push(h('span.st-pill' + (obs.streaming ? '.live' : ''), obs.streaming ? '● LIVE ' + dur(Date.now() - obs.streamSince) : 'Not streaming'));
    parts.push(h('span.st-pill' + (obs.recording ? '.live' : ''), obs.recording ? '● REC ' + dur(Date.now() - obs.recordSince) : 'Not recording'));
    parts.push(h('span.note', 'On air: ' + (obs.program || '—')));
    outState.replaceChildren(...parts);
  }
  function paintUrls() {
    const lan = usesLan();
    const u = urls();
    lowerUrlEl.textContent = u.lower; fullUrlEl.textContent = u.full;
    lowerDrag.href = u.lower; fullDrag.href = u.full;
    linkNote.textContent = lan
      ? 'OBS follows through the SDA Sabbath companion on this PC — no internet needed.'
      : 'OBS follows over the internet with the room code ' + fmtCode(settings.v.stage.code) + ' (the same link phones use; turned on automatically). On a PC without internet, run the SDA Sabbath companion instead.';
  }
  const linkNote = h('p.note');
  manualCard.append(linkNote);
  function paintAll() { paintObs(); paintUrls(); paintLower(); paintNames(); }

  const el = h('section.stage-tab.stream-tab',
    h('div.toolbar', h('h2', 'Stream'), h('span.note.hide-sm', 'OBS Studio: lower thirds and the slides for the live stream'), h('div.grow'),
      h('button.btn.sm', { type: 'button', onclick: () => hub.hideLower() }, icon('x'), h('span', 'Hide lower third'))),
    h('div.scroll.st-grid',
      h('div.st-col', lowerCard, autoLowerCard, pvCard),
      h('div.st-col', controlCard, autoCard, manualCard, lookCard)));

  obs.on('state', paintAll);
  obs.on('change', paintObs);
  hub.on('overlay', paintLower);
  hub.on('outlets', paintObs);
  hub.on('plan', paintNames);
  settings.on('change:stage', (p) => { if (p === 'stage.code' || p === 'stage.relays') paintUrls(); });
  settings.on('change:stream', (p) => { if (p === 'stream.obsUrl') paintUrls(); });
  setInterval(() => { if (!el.hidden && (obs.streaming || obs.recording)) tickOut(); }, 1000);
  paintAll();

  return {
    el,
    onShow() { paintAll(); paintPreview(); },
    onHide() { if (pvFrame) { pvFrame.remove(); pvFrame = null; } },
    open() { return null; },
  };
}
