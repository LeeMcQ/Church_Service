// First start: a short setup — sign in, your church, your language, your screens, statistics — then the app.
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
  if (only !== 'account') steps.push('church', ...(touchOnly ? [] : ['screens']), ...(cloud.enabled() ? ['stats'] : []), 'done');
  let i = 0;
  const wrap = h('div.welcome', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Set up Church Service' });
  const card = h('div.welcome-card');
  wrap.append(card);
  document.body.append(wrap);
  const mustSignIn = () => cloud.requireSignIn() && !cloud.user && navigator.onLine !== false;

  const close = () => {
    if (mustSignIn()) { i = 0; paint(); toast('Please sign in first. (Without internet you can carry on and sign in later.)', 'err', 5000); return; }
    if (only !== 'account') settings.set('app.setupDone', true);
    wrap.remove();
    if (onClose) onClose();
  };
  const next = () => { if (i < steps.length - 1) { i++; paint(); } else close(); };
  const back = () => { if (i > 0) { i--; paint(); } };

  function paint() {
    clear(card);
    const step = steps[i];
    const dots = h('div.welcome-dots', ...steps.map((s, j) => h('span' + (j === i ? '.on' : j < i ? '.done' : ''))));
    const head = (title, sub) => h('div', h('div.welcome-brand', h('img', { src: 'icons/favicon.svg', alt: '', width: 34, height: 34 }), h('span', 'Church Service')), dots, h('h2', title), sub ? h('p.note', sub) : null);
    const nav = (label = 'Next', { skip = true } = {}) => h('div.welcome-nav',
      i > 0 ? h('button.btn', { type: 'button', onclick: back }, 'Back') : h('span'),
      h('div.grow'),
      skip && step !== 'done' && !(step === 'account' && mustSignIn()) ? h('button.btn.ghost', { type: 'button', onclick: step === 'account' ? next : close }, step === 'account' ? 'Not now' : 'Skip the rest') : null,
      h('button.btn.primary', { type: 'button', onclick: next }, label));
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
  paint();
}
