// Tools → Stage: the second screen for the people on the platform (confidence monitor).
//   Screens   – a stage window on another screen of this PC, Cast, the church network (companion), and the
//               layout every stage screen starts with.
//   Phones & laptops – a room code + QR code anyone on the platform can open (internet, peer to peer),
//               a control PIN for those who may change slides and timers, and who is connected.
//   Messages  – text that appears only on the stage screens (never on the projector), quick messages,
//               and what the stage sent back.
//   Timers    – speaker count-down, service stopwatch, "ends at" clocks; one is featured on the stage.
// A live preview shows exactly what the stage screens show.
import { h, clear, fmtTime } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn, seg, toggle, select, modal, closeModal, promptBox, confirmBox, menu } from '../core/ui.js';
import { hub, timerValue, DEFAULT_PRESETS } from '../core/stagehub.js';
import { fmtCode } from '../core/stagenet.js';

const MIN = 60000;
const KIND = { window: 'Stage window', cast: 'Cast', lan: 'Church network', peer: 'Internet' };

export default function create(ctx) {
  const { settings, toast } = ctx;
  const S = () => settings.v.stage;
  const card = (title, ...kids) => h('div.card.st-card', h('h3', title), ...kids);

  // ------------------------------------------------------------ screens
  const winBtn = h('button.btn.primary', { type: 'button', onclick: () => hub.openWindow() }, icon('present'), h('span', 'Open stage screen'));
  const winClose = btn('x', 'Close the stage window', () => hub.closeWindow(), { cls: 'sm', label: 'Close' });
  const screenBtn = h('button.btn', { type: 'button', onclick: chooseScreen, hidden: !('getScreenDetails' in window) }, icon('pc'), h('span', 'Choose screen…'));
  const castBtn = h('button.btn', { type: 'button', hidden: !hub.canCast(), onclick: () => hub.cast().catch((e) => { if (!e || (e.name !== 'AbortError' && e.name !== 'NotAllowedError')) toast('Casting the stage failed: ' + ((e && e.message) || e), 'err'); }) }, icon('cast'), h('span', 'Cast stage screen'));
  const lanRow = h('div.col');

  async function chooseScreen() {
    const r = await hub.listScreens();
    if (!r) { toast('This browser cannot list screens. Drag the stage window onto the stage monitor and press F there.', '', 6000); hub.openWindow(); return; }
    const list = h('div.list');
    r.screens.forEach((s, i) => list.appendChild(h('button', { type: 'button', onclick: () => { settings.set('stage.screenLabel', s.label || ''); closeModal(); hub.closeWindow(); setTimeout(() => hub.openWindow(), 150); } },
      icon('pc'), h('span.grow', (s.label || 'Screen ' + (i + 1)) + (s === r.current ? '  (this screen)' : '') + (s.label && s.label === settings.v.display.screenLabel ? '  · projector' : '')),
      h('span.faint', s.width + ' × ' + s.height))));
    modal({ title: 'Show the stage screen on which screen?', body: list });
  }

  const layoutSeg = seg([['full', 'Full'], ['words', 'Words'], ['slides', 'Slides'], ['timer', 'Timer']], S().layout, (v) => settings.set('stage.layout', v));
  const monToggle = toggle('Stage row under Black / Logo / Clear', S().monitor !== false, (v) => settings.set('stage.monitor', v), 'While a stage screen is connected, the main screen has a Stage row; its Preview switch shows what the stage sees');
  settings.on('change:stage', (p) => { if (p === 'stage.monitor') monToggle.querySelector('input').checked = S().monitor !== false; });
  const opts = h('div.st-opts',
    toggle('Show what comes next', S().showNext, (v) => settings.set('stage.showNext', v)),
    toggle('Show the order of service', S().showPlan, (v) => settings.set('stage.showPlan', v)),
    monToggle,
    toggle('Show speaker notes (slides)', S().showNotes, (v) => settings.set('stage.showNotes', v)),
    toggle('Show the slide picture', S().showLive, (v) => settings.set('stage.showLive', v)),
    toggle('24-hour clock', S().clock24, (v) => settings.set('stage.clock24', v)),
    toggle('Mirror (teleprompter glass)', S().mirror, (v) => settings.set('stage.mirror', v)),
    toggle('The stage window may change slides', S().allowWinControl !== false, (v) => settings.set('stage.allowWinControl', v), 'A touch screen on the platform can then move the slides'));
  const sizeSel = select([['0.8', 'Small'], ['1', 'Normal'], ['1.2', 'Large'], ['1.4', 'Extra large']], String(S().textSize || 1), (v) => settings.set('stage.textSize', +v));

  const screensCard = card('Stage screens',
    h('p.note', 'A second screen for the preacher, singers and band: the slide on screen and what comes next, the words in large type, speaker notes, the time, timers and your messages. The congregation never sees it.'),
    h('div.row.wrap', winBtn, screenBtn, castBtn, winClose),
    lanRow,
    h('div.form.st-form',
      h('label', 'Layout'), layoutSeg,
      h('label', 'Text size'), sizeSel),
    h('details.st-more', h('summary', 'Display options'), opts),
    h('p.note', 'Phones and laptops can choose their own layout; the stage window and cast screens use this one. Words: the words in very large type (singers). Slides: the pictures only. Timer: one big clock for the preacher.'));

  function paintScreens() {
    const open = hub.windowOpen();
    winBtn.querySelector('span').textContent = open ? 'Stage window is open' : 'Open stage screen';
    winBtn.classList.toggle('primary', !open);
    winClose.hidden = !open;
    clear(lanRow);
    const comp = ctx.companion;
    if (comp) {
      const base = (comp.urls && comp.urls[0]) || location.origin;
      const url = base + '/stage.html?via=lan';
      lanRow.append(h('div.st-lan',
        h('div.row.wrap', h('span.st-pill' + (hub.lan.state === 'on' ? '.on' : ''), hub.lan.state === 'on' ? 'Church network: on' : hub.lan.state === 'connecting' ? 'Church network: connecting…' : 'Church network: off'),
          hub.lan.state === 'on' ? null : h('button.btn.sm', { type: 'button', onclick: () => hub.connectLan(location.origin, settings.v.companion.pin) }, icon('reload'), h('span', 'Connect'))),
        h('p.note', 'Without internet: a TV browser, tablet or phone on the church Wi-Fi opens ', h('code', url), ' (or scans the QR code under Phones & laptops).')));
    }
  }

  // ------------------------------------------------------------ phones & laptops
  const onlineSw = toggle('Let phones and laptops join', !!S().online, (v) => hub.goOnline(v), 'Uses the internet to connect; the slides then go straight from this PC to each device');
  const netState = h('div.st-net');
  const codeEl = h('div.st-code', { 'aria-label': 'Room code' });
  const qrBox = h('div.st-qr');
  const urlEl = h('code.st-url');
  const shortEl = h('div.note.st-short');
  const pinEl = h('b.st-pin');
  const pinEl2 = h('b.st-pin');
  const joinBox = h('div.st-join',
    h('div.st-join-l',
      h('div.note', 'Room code'), codeEl,
      shortEl,
      h('div.row.wrap', { style: { marginTop: '6px' } },
        h('button.btn.sm', { type: 'button', onclick: copyLink }, icon('copy'), h('span', 'Copy link')),
        navigator.share ? h('button.btn.sm', { type: 'button', onclick: shareLink }, icon('link'), h('span', 'Share…')) : null,
        h('button.btn.sm', { type: 'button', onclick: newCode }, icon('reload'), h('span', 'New code'))),
      h('div.st-pinrow', h('span.note', 'Control PIN'), pinEl2),
      h('p.note', 'Anyone with the code can follow. Only devices that enter the control PIN, or that you allow under Connected screens, can change slides and timers.')),
    qrBox);
  const advBtn = h('button.btn.sm', { type: 'button', onclick: advanced }, icon('settings'), h('span', 'Connection settings…'));
  const peersCard = card('Phones & laptops',
    h('p.note', 'Pastors, worship leaders and the band follow along on their own phone, tablet or laptop: scan the QR code, or open the short address and type the code. No app to install.'),
    h('div.row.wrap', onlineSw, netState),
    joinBox, h('div.row', advBtn));

  function paintNet() {
    const s = S();
    const on = !!s.online;
    onlineSw.querySelector('input').checked = on;
    joinBox.hidden = !on || !s.code;
    const st = hub.net.state;
    netState.className = 'st-net ' + st;
    netState.textContent = !on ? '' : { starting: 'Starting…', on: 'Ready · ' + hub.count((o) => o.kind === 'peer') + ' connected', error: 'Could not start: ' + hub.net.error, offline: 'No internet on this PC — use the church network or a stage window', off: '' }[st] || '';
    pinEl.textContent = pinEl2.textContent = s.pin || '—';
    if (!on || !s.code) return;
    codeEl.textContent = fmtCode(s.code);
    const url = hub.joinUrl(s.code);
    urlEl.textContent = url;
    shortEl.replaceChildren('Or open ', h('b', hub.shortUrl()), ' and type the code.');
    if (qrBox.dataset.url !== url) {
      qrBox.dataset.url = url;
      clear(qrBox);
      import('../../vendor/qrcode.min.js').then((m) => {
        const q = m.default(0, 'M'); q.addData(url); q.make();
        qrBox.appendChild(h('img', { src: q.createDataURL(5, 2), alt: 'QR code to join the stage screen' }));
        qrBox.appendChild(h('div.note', 'Scan to join'));
      }).catch(() => {});
    }
  }
  function copyLink() {
    const url = hub.joinUrl(S().code);
    const done = () => toast('Link copied. Send it to the people on the platform.', 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => promptBox('Copy this link', 'Link', url));
    else promptBox('Copy this link', 'Link', url);
  }
  function shareLink() {
    navigator.share({ title: 'Stage screen', text: 'Follow the service on the stage screen. Code: ' + fmtCode(S().code), url: hub.joinUrl(S().code) }).catch(() => {});
  }
  async function newCode() {
    if (hub.count((o) => o.kind === 'peer') && !(await confirmBox('New room code?', 'Everyone who joined with the current code is disconnected and must scan the new QR code.', 'New code', true))) return;
    await hub.newCode();
    paintNet();
  }
  function advanced() {
    const url = h('input.field', { value: S().turnUrl || '', placeholder: 'turn:turn.example.org:3478', style: { width: '100%' } });
    const user = h('input.field', { value: S().turnUser || '', placeholder: 'user name', autocomplete: 'off' });
    const pass = h('input.field', { value: S().turnPass || '', placeholder: 'password', type: 'password', autocomplete: 'off' });
    const relays = h('input.field', { value: S().relays || '', placeholder: 'wss://relay.example.org (empty: the public relays)', style: { width: '100%' } });
    modal({
      title: 'Connection settings', wide: true,
      body: h('div.col',
        h('p.note', 'Phones on the same Wi-Fi as this PC connect directly. A phone on mobile data usually connects too; on some networks (strict firewalls, some mobile carriers) it cannot, and a TURN relay server is needed. Most churches never need this.'),
        h('label.muted', 'TURN server address (optional)'), url,
        h('div.row.wrap', user, pass),
        h('label.muted', 'Own Nostr relays for finding each other (optional, advanced)'), relays,
        h('p.note', 'Only needed if your church runs its own relay. The QR code then carries it, so phones use it too.'),
        h('p.note', 'Without internet, use the church network instead: run the SDA Sabbath companion on this PC, and screens on the Wi-Fi open its /stage.html?via=lan address.')),
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onclick: () => {
        settings.set('stage.turnUrl', url.value.trim()); settings.set('stage.turnUser', user.value.trim()); settings.set('stage.turnPass', pass.value);
        settings.set('stage.relays', relays.value.trim()); qrBox.dataset.url = ''; paintNet();
        if (S().online) hub.goOnline(true);
      } }],
    });
  }

  // ------------------------------------------------------------ connected screens
  const whoList = h('div.list.st-who');
  const whoCard = card('Connected screens',
    h('div.st-pinrow', h('span.note', 'Control PIN'), pinEl,
      h('button.btn.sm', { type: 'button', title: 'A new PIN: devices that unlocked with the old one can only follow again', onclick: () => { hub.newPin(); paintNet(); toast('New control PIN: ' + S().pin, 'ok'); } }, icon('reload'), h('span', 'New PIN'))),
    h('p.note', 'Stage screens only follow. Someone on the platform who should change slides and timers enters this PIN on their screen (⚙ → Unlock controls), or you switch on Control for their device here.'),
    whoList);
  function paintWho() {
    clear(whoList);
    const list = hub.screens();
    if (!list.length) { whoList.append(h('p.note.pad', 'No stage screens yet. Open the stage screen, cast it, or let phones and laptops join.')); return; }
    list.forEach((o) => {
      const ctl = h('input', { type: 'checkbox', checked: !!o.control, onchange: () => hub.setControl(o.id, ctl.checked) });
      whoList.append(h('div.li',
        icon(o.kind === 'peer' ? 'phone' : o.kind === 'cast' ? 'cast' : o.kind === 'lan' ? 'link' : 'present'),
        h('div.grow', h('div', { style: { fontWeight: 700 } }, o.name || KIND[o.kind] || 'Screen'), h('div.note', [KIND[o.kind], o.dev].filter(Boolean).join(' · '))),
        o.kind === 'window' ? h('span.note', o.control ? 'Can control' : 'Follows') : h('label.switch', { title: 'Allow this screen to change slides and timers' }, ctl, h('span', 'Control')),
        o.kind === 'window' ? null : btn('x', 'Disconnect ' + (o.name || 'this screen'), () => hub.disconnect(o.id), { cls: 'sm' })));
    });
  }

  // ------------------------------------------------------------ messages
  const msgIn = h('input.field', { placeholder: 'Message for the stage, e.g. “5 minutes left”', 'aria-label': 'Message for the stage', maxlength: 400, 'data-free-text': '', style: { flex: '1' } });
  let flash = false;
  const flashT = toggle('Flash', false, (v) => { flash = v; }, 'Make the message blink for a few seconds to catch attention');
  const secSel = select([['0', 'Until cleared'], ['10', '10 seconds'], ['30', '30 seconds'], ['60', '1 minute'], ['120', '2 minutes']], String(S().msgSec || 0), (v) => settings.set('stage.msgSec', +v));
  const showing = h('div.st-showing', { hidden: true });
  const presetsEl = h('div.row.wrap.st-presets');
  const histEl = h('div.st-hist');
  const send = (text) => { if (!String(text || '').trim()) { msgIn.focus(); return; } hub.sendMessage(text, { flash }); msgIn.value = ''; if (!hub.screens().length) toast('Sent. No stage screen is connected yet.', '', 3000); };
  msgIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(msgIn.value); } });
  const msgCard = card('Message to the stage',
    h('div.row', msgIn, h('button.btn.primary', { type: 'button', onclick: () => send(msgIn.value) }, icon('send'), h('span', 'Send'))),
    h('div.row.wrap', flashT, h('span.note', 'Show for'), secSel),
    showing,
    h('div.note', 'Quick messages (click to send):'),
    presetsEl,
    histEl);
  function paintMsg() {
    const m = hub.msg;
    showing.hidden = !m;
    if (m) showing.replaceChildren(h('span.st-pill.on', 'On the stage'), h('span.grow.trunc', m.text), h('button.btn.sm', { type: 'button', onclick: () => hub.clearMessage() }, icon('x'), h('span', 'Clear')));
    clear(histEl);
    const old = hub.history.filter((x) => !m || x.id !== m.id).slice(0, 5);
    if (old.length) histEl.append(h('div.note', 'Sent before:'), h('div.row.wrap', ...old.map((x) => h('button.chip', { type: 'button', title: 'Send again', onclick: () => send(x.text) }, x.text.length > 40 ? x.text.slice(0, 40) + '…' : x.text))));
  }
  function paintPresets() {
    clear(presetsEl);
    hub.presets().forEach((p) => presetsEl.append(h('button.chip', { type: 'button', onclick: () => send(p) }, p)));
    presetsEl.append(h('button.chip', { type: 'button', title: 'Change the quick messages', onclick: editPresets }, icon('edit'), 'Edit'));
  }
  function editPresets() {
    const area = h('textarea.field', { rows: 9, style: { width: '100%', height: 'auto', padding: '8px 10px' }, 'data-free-text': '' }, hub.presets().join('\n'));
    modal({
      title: 'Quick messages', body: h('div.col', h('p.note', 'One message per line (up to 24).'), area),
      actions: [{ label: 'Default messages', onclick: () => { area.value = DEFAULT_PRESETS.join('\n'); return false; } }, { label: 'Cancel' },
        { label: 'Save', primary: true, onclick: () => { settings.set('stage.presets', area.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 24)); paintPresets(); } }],
    });
  }

  // ------------------------------------------------------------ talk-back from the stage
  const talkList = h('div.st-talk');
  const talkCard = card('From the stage', talkList);
  function paintTalk() {
    clear(talkList);
    if (!hub.talk.length) { talkList.append(h('p.note', 'Messages the stage sends you (Talk to the media desk on their screen) appear here and as a notice.')); return; }
    hub.talk.slice(0, 8).forEach((t) => talkList.append(h('div.st-talk-i', h('b', t.from), h('span.grow', t.text), h('span.faint', new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      h('button.btn.sm', { type: 'button', title: 'Reply on the stage screens', onclick: async () => { const r = await promptBox('Reply to ' + t.from, 'Shows on the stage screens', ''); if (r && r.trim()) hub.sendMessage(r); } }, 'Reply'))));
    talkList.append(h('button.btn.sm', { type: 'button', onclick: () => { hub.talk = []; paintTalk(); } }, 'Clear list'));
  }

  // ------------------------------------------------------------ timers
  const timersEl = h('div.st-timers');
  const warnSel = select([['60', '1 minute'], ['120', '2 minutes'], ['180', '3 minutes'], ['300', '5 minutes']], String(S().warnSec || 120), (v) => settings.set('stage.warnSec', +v));
  const timersCard = card('Timers',
    timersEl,
    h('div.row.wrap',
      h('button.btn.sm', { type: 'button', onclick: (e) => menu(e.currentTarget, [
        { label: 'Count-down', icon: 'timer', onclick: () => hub.addTimer('down') },
        { label: 'Stopwatch (counts up)', icon: 'clock', onclick: () => hub.addTimer('up') },
        { label: 'Count-down to a time (e.g. service ends at 12:00)', icon: 'clock', onclick: async () => { const r = await promptBox('Count down to', 'Time (24-hour, e.g. 12:00)', '12:00'); if (r && /^\d{1,2}:\d{2}$/.test(r.trim())) hub.addTimer('to', 'Ends at ' + r.trim(), { at: r.trim() }); } },
        '-', { label: 'Back to the default timers', icon: 'reload', onclick: () => hub.resetTimers() },
      ]) }, icon('plus'), h('span', 'Add timer')),
      h('span.note', 'Turn amber at'), warnSel),
    toggle('Plan parts with a planned time start the featured count-down when they go on screen', S().autoPlanTimer !== false, (v) => settings.set('stage.autoPlanTimer', v), 'Plan tab → ⋯ on a part → Planned time'));
  const valEls = new Map();
  function paintTimers() {
    clear(timersEl); valEls.clear();
    const feat = S().featured;
    hub.timers().forEach((t) => {
      const val = h('div.st-tv');
      valEls.set(t.id, { el: val, t });
      const isFeat = t.id === feat || (!hub.timers().some((x) => x.id === feat) && hub.timers()[0] === t);
      const row = h('div.st-timer' + (isFeat ? '.feat' : ''),
        h('div.st-th',
          h('label.st-feat', { title: 'Show this timer large on the stage' }, h('input', { type: 'radio', name: 'st-feat', checked: isFeat, onchange: () => { settings.set('stage.featured', t.id); paintTimers(); } }), h('span', isFeat ? 'Large on stage' : 'Show large')),
          h('b.grow.trunc', t.name + (t.label ? ' · ' + t.label : '')),
          btn('more', 'Timer options', (e) => menu(e.currentTarget, [
            { label: 'Rename…', icon: 'edit', onclick: async () => { const r = await promptBox('Timer name', 'Name', t.name); if (r) hub.timer(t.id, 'rename', r); } },
            t.mode === 'down' ? { label: 'Set time…', icon: 'timer', onclick: async () => { const r = await promptBox('Count down from', 'Minutes (e.g. 25 or 2.5)', String(Math.round((t.dur || 0) / 600) / 100)); const m = parseFloat(String(r || '').replace(',', '.')); if (m > 0) hub.timer(t.id, 'set', { ms: m * MIN }); } } : null,
            t.mode === 'to' ? { label: 'Change the time…', icon: 'clock', onclick: async () => { const r = await promptBox('Count down to', 'Time (24-hour, e.g. 12:00)', t.at || '12:00'); if (r) hub.timer(t.id, 'at', r.trim()); } } : null,
            t.label ? { label: 'Remove the part name', icon: 'x', onclick: () => hub.timer(t.id, 'label', '') } : null,
            '-', { label: 'Remove timer', icon: 'trash', onclick: () => hub.timer(t.id, 'remove') },
          ]), { cls: 'sm' })),
        val,
        t.mode === 'to' ? h('div.note', 'Counts down to ' + t.at + ' every day.') : h('div.row.wrap.st-tb',
          h('button.btn.sm' + (t.running ? '' : '.primary'), { type: 'button', onclick: () => hub.timer(t.id, 'toggle') }, icon(t.running ? 'pause' : 'play'), h('span', t.running ? 'Pause' : 'Start')),
          btn('reload', 'Reset', () => hub.timer(t.id, 'reset'), { cls: 'sm' }),
          h('button.btn.sm', { type: 'button', title: 'One minute more', onclick: () => hub.timer(t.id, 'add', MIN) }, '+1'),
          h('button.btn.sm', { type: 'button', title: 'One minute less', onclick: () => hub.timer(t.id, 'add', -MIN) }, '−1'),
          t.mode === 'down' ? h('span.st-sep') : null,
          ...(t.mode === 'down' ? [5, 10, 15, 20, 30, 40, 45].map((m) => h('button.btn.sm', { type: 'button', title: 'Count down from ' + m + ' minutes and start', onclick: () => hub.timer(t.id, 'set', { ms: m * MIN, start: true }) }, m + ' min')) : [])));
      timersEl.append(row);
    });
    tickTimers();
  }
  function fmtVal(t, v) {
    if (t.mode === 'up') return fmtTime(v / 1000);
    if (v > 0) return fmtTime(Math.ceil(v / 1000));
    return '+' + fmtTime(-v / 1000);
  }
  function tickTimers() {
    const now = Date.now();
    valEls.forEach(({ el, t }) => {
      const v = timerValue(t, now);
      el.textContent = fmtVal(t, v);
      el.classList.toggle('over', t.mode !== 'up' && v <= 0);
      el.classList.toggle('warn', t.mode !== 'up' && v > 0 && v <= (S().warnSec || 120) * 1000);
      el.classList.toggle('stopped', !t.running && t.mode !== 'to');
    });
  }
  setInterval(() => { if (!el.hidden) tickTimers(); }, 500);

  // ------------------------------------------------------------ preview
  const pvHost = h('div.st-pv');
  const pvToggle = toggle('Live preview', S().preview !== false && !settings.lowPower(), (v) => { settings.set('stage.preview', v); paintPreview(); }, 'Shows here exactly what the stage screens show');
  const pvCard = card('What the stage sees', pvToggle, pvHost);
  let pvFrame = null;
  // The preview is drawn at TV size (1280 × 720) and scaled down, so it shows the TV layout, not the phone one.
  const pvScale = () => { if (pvFrame) pvFrame.style.transform = 'scale(' + ((pvHost.clientWidth || 640) / 1280) + ')'; };
  if (window.ResizeObserver) new ResizeObserver(pvScale).observe(pvHost);
  function paintPreview() {
    const want = S().preview !== false && !settings.lowPower() && !el.hidden;
    if (want && !pvFrame) {
      pvFrame = h('iframe.st-pv-f.st-pv-tv', { src: 'stage.html?via=win&preview=1', title: 'Stage screen preview', loading: 'lazy', tabindex: '-1' });
      pvHost.append(pvFrame);
      pvScale();
    } else if (!want && pvFrame) { pvFrame.remove(); pvFrame = null; }
  }

  // ------------------------------------------------------------ layout of the tab
  const el = h('section.stage-tab',
    h('div.toolbar', h('h2', 'Stage'), h('span.note.hide-sm', 'The second screen for the people on the platform'), h('div.grow'),
      h('button.btn.sm', { type: 'button', onclick: () => hub.openWindow() }, icon('present'), h('span', 'Stage screen')),
      h('button.btn.sm', { type: 'button', onclick: () => msgIn.focus() }, icon('msg'), h('span', 'Message'))),
    h('div.scroll.st-grid',
      h('div.st-col', msgCard, timersCard, talkCard, pvCard),
      h('div.st-col', peersCard, whoCard, screensCard)));

  hub.on('outlets', () => { paintWho(); paintScreens(); paintNet(); });
  hub.on('net', paintNet);
  hub.on('lan', paintScreens);
  hub.on('msg', paintMsg);
  hub.on('timers', paintTimers);
  hub.on('talk', paintTalk);
  settings.on('change:stage', (p) => {
    if (p === 'stage.layout') layoutSeg.set(S().layout);
    if (p === 'stage.code' || p === 'stage.pin' || p === 'stage.online') paintNet();
    if (p === 'stage.featured' || p === 'stage.warnSec') paintTimers();
  });
  paintScreens(); paintNet(); paintWho(); paintMsg(); paintPresets(); paintTalk(); paintTimers();

  return {
    el,
    onShow() { paintPreview(); paintScreens(); paintNet(); paintWho(); tickTimers(); },
    onHide() { if (pvFrame) { pvFrame.remove(); pvFrame = null; } },
    focusMessage() { setTimeout(() => msgIn.focus(), 30); },
    open() { return null; },
  };
}
