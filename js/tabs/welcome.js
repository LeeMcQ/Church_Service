// First start: a short setup — sign in, your church, your language, your screens, the hymn sound, ready for
// Sabbath without internet, statistics — then the app.
// Shown once (Settings → About → Run the setup again shows it again). Everything can be changed later.
import { h, clear } from '../core/util.js';
import { icon } from '../core/icons.js';
import { seg, toast } from '../core/ui.js';
import { settings } from '../core/settings.js';
import { cloud } from '../core/cloud.js';
import { churchForm } from './church-form.js';
import { screensPanel } from './screens-panel.js';
import { signInBox, statsToggle } from './account.js';
import { restoreButtons } from './backup-ui.js';
import { installed, installSteps } from '../core/installer.js';
import { persistStorage } from '../core/db.js';

// How this device is used on Sabbath decides the sound preset (js/core/musicengine.js SOUND_PRESETS).
const ROLES = [['pc', 'The church PC', 'best'], ['laptop', 'A laptop', 'balanced'], ['phone', 'A phone or tablet', 'light']];
const HALLS = [['small', 'Small'], ['church', 'Medium'], ['large', 'Large']];
const SPEAKERS = [['pa', 'Sound desk / PA'], ['small', 'Built-in or small speakers'], ['tv', 'TV or projector speakers']];

const LANGS = [
  ['en', 'English', { 'bible.primary': 'kjv', 'bible.parallel': '', 'hymns.book': 'sda-online' }],
  ['af', 'Afrikaans', { 'bible.primary': 'afr53', 'bible.parallel': '', 'hymns.book': 'afrikaans-sda' }],
  ['both', 'English and Afrikaans', { 'bible.primary': 'kjv', 'bible.parallel': 'afr53', 'hymns.book': 'sda-online' }],
];

export function needsSetup() { return !settings.v.app.setupDone || (cloud.requireSignIn() && !cloud.user && navigator.onLine !== false); }

/** Show the setup. onClose is called when it is finished or skipped. */
export function openWelcome({ onClose, only } = {}) {
  const steps = [];
  if (cloud.enabled() && (!cloud.user || only === 'account')) steps.push('account');
  // Phones and tablets (touch only) do not drive projector windows, and the statistics step only makes sense
  // when this copy has the cloud switched on.
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (only !== 'account') steps.push('church', ...(touchOnly ? [] : ['screens']), 'sound', 'ready', ...(cloud.enabled() ? ['stats'] : []), 'done');
  let i = 0;
  const wrap = h('div.welcome', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Set up Church Service' });
  const card = h('div.welcome-card');
  wrap.append(card);
  document.body.append(wrap);
  const mustSignIn = () => cloud.requireSignIn() && !cloud.user && navigator.onLine !== false;

  const stopTest = () => import('../core/hymnmusic.js').then((m) => { if (m.music.state && m.music.state.title === 'Sound test') m.music.stop(); }).catch(() => {});
  const close = () => {
    stopTest();
    if (mustSignIn()) { i = 0; paint(); toast('Please sign in first. (Without internet you can carry on and sign in later.)', 'err', 5000); return; }
    if (only !== 'account') settings.set('app.setupDone', true);
    wrap.remove();
    if (onClose) onClose();
  };
  const next = () => { if (i < steps.length - 1) { i++; paint(); } else close(); };
  const back = () => { if (i > 0) { i--; paint(); } };

  let head, navFor;
  function paint() {
    clear(card);
    stopTest();
    const step = steps[i];
    const dots = h('div.welcome-dots', ...steps.map((s, j) => h('span' + (j === i ? '.on' : j < i ? '.done' : ''))));
    head = (title, sub) => h('div', h('div.welcome-brand', h('img', { src: 'icons/favicon.svg', alt: '', width: 34, height: 34 }), h('span', 'Church Service')), dots, h('h2', title), sub ? h('p.note', sub) : null);
    const nav = (label = 'Next', { skip = true } = {}) => h('div.welcome-nav',
      i > 0 ? h('button.btn', { type: 'button', onclick: back }, 'Back') : h('span'),
      h('div.grow'),
      skip && step !== 'done' && !(step === 'account' && mustSignIn()) ? h('button.btn.ghost', { type: 'button', onclick: step === 'account' ? next : close }, step === 'account' ? 'Not now' : 'Skip the rest') : null,
      h('button.btn.primary', { type: 'button', onclick: next }, label));
    navFor = nav;
    let body;
    if (step === 'account') {
      body = h('div.col', { style: { gap: '12px' } },
        h('p', 'Sign in once on this device. It lets you send suggestions and see the answers, and it helps us see how many churches use Church Service. Church Service keeps working without internet.'),
        signInBox({ onDone: () => next(), compact: true }));
      card.append(head('Welcome!', 'Free presentation software for Seventh-day Adventist churches.'), body,
        h('div.welcome-nav', h('div.grow'), mustSignIn() ? null : h('button.btn.ghost', { type: 'button', onclick: next }, 'Not now')));
      return;
    }
    if (step === 'church') {
      let lang = settings.v.bible.primary === 'afr53' ? 'af' : settings.v.bible.parallel === 'afr53' ? 'both' : 'en';
      body = h('div.col', { style: { gap: '12px' } },
        restoreButtons(),
        h('label.muted', 'Language of your services'),
        seg(LANGS.map(([k, label]) => [k, label]), lang, (v) => { lang = v; const L = LANGS.find((x) => x[0] === v); Object.entries(L[2]).forEach(([k, val]) => settings.set(k, val)); }),
        h('p.note', 'Sets the Bible translation and hymnbook that open first. Every Bible and hymnbook stays available.'),
        churchForm(settings));
      card.append(head('Your church', 'Used on banners (name, sunset times for Sabbath), the logo slide and the stage screen.'), body, nav());
      return;
    }
    if (step === 'screens') {
      card.append(head('Your screens', 'What does this PC drive on Sabbath? You can change this any time in Settings → Displays.'), screensPanel({ intro: true }), nav());
      return;
    }
    if (step === 'sound') { paintSound(); return; }
    if (step === 'ready') { paintReady(); return; }
    if (step === 'stats') {
      card.append(head('Help make Church Service better'),
        h('div.col', { style: { gap: '12px' } },
          statsToggle(),
          h('p', 'Ideas or problems? Use ', h('b', 'the speech-bubble button'), ' at the top, or Settings → Account, to send a comment or suggestion at any time.')),
        nav());
      return;
    }
    const tips = touchOnly
      ? [['Tap', 'A verse, stanza or slide: it goes on Next (green)'], ['Present', 'The button at the top right shows Next on the screen (red: Live)'], ['‹ ›', 'Previous / next slide in the bar at the bottom'], ['■ ◎ ✕', 'Black screen, logo and clear: in the bottom bar while a screen is connected'], ['🔍', 'Go to: type “John 3:16” or “hymn 73”']]
      : [['F5', 'Present: show what is Next on the projector'], ['→ / Space', 'Next slide'], ['B', 'Black screen'], ['L', 'Logo'], ['C', 'Clear'], ['/', 'Go to: type “John 3:16” or “hymn 73”'], ['Ctrl+Z', 'Back to what was on screen before'], ['?', 'All keyboard shortcuts']];
    card.append(head('All set!', touchOnly ? 'How it works on this device:' : 'A few keys to remember:'),
      h('div.welcome-keys', ...tips.map(([k, t]) => h('div.row', h('kbd', k), h('span', t)))),
      h('p.note', 'Ideas or problems? The speech-bubble button at the top (or Settings → Account) sends a comment at any time.'),
      h('div.welcome-nav', i > 0 ? h('button.btn', { type: 'button', onclick: back }, 'Back') : h('span'), h('div.grow'),
        h('button.btn.primary', { type: 'button', onclick: close }, icon('check'), h('span', 'Start using Church Service'))));
  }
  // ------------------------------------------------------------ hymn sound
  async function paintSound() {
    const hm = await import('../core/hymnmusic.js');
    if (steps[i] !== 'sound') return;
    const { music, SOUND_PRESETS, EQ_PRESETS, PACKS, packFor, hqStored, hqPrefetch } = hm;
    const H = () => settings.v.hymns;
    const set = (k, v) => settings.set('hymns.' + k, v);
    let role = settings.v.app.deviceRole || (touchOnly ? 'phone' : 'pc');
    let hall = H().musicRoom === 'small' || H().musicRoom === 'large' ? H().musicRoom : 'church';
    let spk = settings.v.app.speakers || (touchOnly ? 'small' : 'pa');
    // The role's preset, then the hall and the speakers on top of it.
    const applyAll = () => {
      const pr = SOUND_PRESETS[ROLES.find((r) => r[0] === role)[2]];
      Object.entries(pr[1]).forEach(([k, v]) => set(k, v));
      set('musicPreset', ROLES.find((r) => r[0] === role)[2]);
      if (pr[1].musicRoom !== 'off' || role !== 'phone') set('musicRoom', hall);
      const eq = spk === 'small' ? 'small' : spk === 'tv' ? 'clear' : hall === 'large' ? 'hall' : (pr[1].musicEqPreset || 'flat');
      set('musicEqPreset', eq); set('musicEq', EQ_PRESETS[eq][1].slice());
      if (hall !== (pr[1].musicRoom || 'church') || eq !== (pr[1].musicEqPreset || 'flat')) set('musicPreset', 'custom');
      settings.set('app.deviceRole', role); settings.set('app.speakers', spk);
      music.applyEffects();
      paintPack();
    };
    const packBox = h('div.col', { style: { gap: '6px', alignItems: 'flex-start' } });
    async function paintPack() {
      const pack = packFor(H().musicHQ);
      clear(packBox);
      if (!pack) { packBox.append(h('p.note', 'Standard instruments, built in: light enough for any phone. Change this any time in Hymns → options.')); return; }
      const P = PACKS[pack];
      if (await hqStored(pack)) { packBox.append(h('p.inst-ok', icon('check'), h('span', P.label + ' instruments are downloaded on this device and work without internet.'))); return; }
      const prog = h('span.note');
      const dl = h('button.btn', { type: 'button', onclick: async () => {
        dl.disabled = true;
        const ok = await hqPrefetch(pack, (t, pct) => { prog.textContent = pct + '%'; });
        if (ok) paintPack(); else { dl.disabled = false; prog.textContent = navigator.onLine === false ? 'Needs internet once.' : 'Could not download now; it is tried again later.'; }
      } }, icon('download'), h('span', 'Download now (' + P.mb + ' MB, once)'));
      packBox.append(h('p.note', (pack === 'studio'
        ? 'Studio instruments: a concert grand recorded at 16 loudness levels with its full natural ring, and a pipe organ with five stops. '
        : 'High-quality instruments: a recorded concert grand and a church pipe organ. ') + 'Until the download is done, hymns play with the standard sounds.'),
        h('div.row.wrap', dl, prog));
    }
    const testBtn = h('button.btn', { type: 'button', onclick: async () => {
      if (music.state && music.state.playing && music.state.title === 'Sound test') { music.stop(); testBtn.replaceChildren(icon('play'), h('span', 'Play a test')); return; }
      testBtn.replaceChildren(icon('stop'), h('span', 'Stop the test'));
      try { await music.playTest(); } catch (e) { testBtn.replaceChildren(icon('play'), h('span', 'Play a test')); toast(e.message, 'err'); }
    } }, icon('play'), h('span', 'Play a test'));
    const body = h('div.col', { style: { gap: '10px' } },
      h('label.muted', 'This device on Sabbath'),
      seg(ROLES.map(([k, l]) => [k, l]), role, (v) => { role = v; applyAll(); }),
      packBox,
      h('label.muted', 'Your church hall'),
      seg(HALLS, hall, (v) => { hall = v; applyAll(); }),
      h('label.muted', 'The music is heard through'),
      seg(SPEAKERS, spk, (v) => { spk = v; applyAll(); }),
      h('div.row.wrap', testBtn, h('span.note', 'Hymn 73 with these settings. Adjust the volume on the sound desk, not only here.')),
      h('p.note', spk === 'pa' ? 'Best sound: connect the PC to the sound desk with a USB audio interface or a DI box (not the headphone socket), and avoid Bluetooth (it lags behind the words).'
        : 'For a bigger sound later, connect the PC to a sound desk with a USB audio interface or DI box. Fine-tune everything in Hymns → options → Music.'));
    applyAll();
    card.append(head('Hymn music', 'Accompaniment for the hymns, played by this device. Three questions set the best sound for your church.'), body, navFor());
  }

  // ------------------------------------------------------------ ready for Sabbath (offline, install, data)
  function paintReady() {
    const ctx = window.selah || {};
    const offRow = h('div'), instRow = h('div'), dataRow = h('div');
    const paintOff = () => {
      clear(offRow);
      const off = ctx.offlineState ? ctx.offlineState() : { ready: false, total: 0, done: 0 };
      const pct = off.total ? Math.min(100, Math.round(off.done / off.total * 100)) : 0;
      offRow.append(off.ready ? h('p.inst-ok', icon('check'), h('span', 'Saved on this device: Bibles, hymns, music and the app work without internet.'))
        : h('p.note', off.total ? 'Saving everything for use without internet… ' + pct + '%. Keep the internet on until it finishes.' : 'Checking that everything is saved on this device…'));
    };
    const paintInst = () => {
      clear(instRow);
      if (installed()) { instRow.append(h('p.inst-ok', icon('check'), h('span', 'Installed: Church Service has its own icon and opens without the browser.'))); return; }
      instRow.append(ctx.installPrompt
        ? h('button.btn.primary', { type: 'button', onclick: async () => { await ctx.promptInstall(); paintInst(); } }, icon('download'), h('span', 'Install Church Service'))
        : h('p.note', h('b', 'Install it: '), installSteps()));
    };
    persistStorage().then((ok) => {
      clear(dataRow);
      dataRow.append(ok ? h('p.inst-ok', icon('check'), h('span', 'Your plans, hymnbooks, Bibles and slides are kept even when the device runs low on space.'))
        : h('p.note', 'This browser may clear saved plans and slides when space runs low. Installing the app (above) protects them; Settings → Backup keeps a copy.'));
    });
    paintOff(); paintInst();
    if (ctx.onInstallChange) ctx.onInstallChange(() => { if (offRow.isConnected) { paintOff(); paintInst(); } });
    const body = h('div.col', { style: { gap: '10px' } }, offRow, instRow, dataRow,
      touchOnly ? null : h('div.row.wrap', h('button.btn', { type: 'button', onclick: () => ctx.clickerSetup && ctx.clickerSetup() }, icon('settings'), h('span', 'Test a presentation clicker')),
        h('span.note', 'If you use one: check every button does what you expect.')));
    card.append(head('Ready for Sabbath', 'So nothing depends on the internet or the browser during the service.'), body, navFor());
  }
  paint();
}
