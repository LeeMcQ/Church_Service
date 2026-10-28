// "Install Church Service": asks once (after the first-start setup) to install the app on this device, and shows
// whether everything has been saved for use without internet. Installing gives an icon of its own, a window
// without the browser bars, and a start that never needs the internet.
//
// Browsers differ: Chrome, Edge and Samsung Internet can install with one button (beforeinstallprompt); Safari on
// iPhone/iPad and Mac installs through its Share / File menu; Firefox on a computer cannot install, but the app
// still works offline in that browser once it has been opened with internet.
import { h, clear } from './util.js';
import { icon } from './icons.js';
import { lsKey } from './storens.js';

const ua = navigator.userAgent || '';
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isSafariMac = !isIOS && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
const isFirefox = /Firefox|FxiOS/.test(ua);
const SNOOZE = lsKey('install.later');
const SNOOZE_DAYS = 7;

export const installed = () => (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || matchMedia('(display-mode: fullscreen)').matches)) || navigator.standalone === true;

/** How to install on this browser, when there is no one-button install: a short instruction, or null. */
export function installSteps() {
  if (isIOS) return h('span', 'Tap ', h('b', 'Share'), ' ', icon('upload'), ' in Safari (or the ', h('b', '⋯'), ' menu in Chrome), then ', h('b', 'Add to Home Screen'), '.');
  if (isSafariMac) return h('span', 'In Safari: ', h('b', 'File → Add to Dock'), '.');
  if (isAndroid) return h('span', 'Open the browser menu ', h('b', '⋮'), ' and choose ', h('b', 'Install app'), ' or ', h('b', 'Add to Home screen'), '.');
  if (isFirefox) return h('span', 'Firefox on a computer cannot install apps, but Church Service keeps working offline in Firefox. Bookmark it, or use Chrome or Edge to install it.');
  return h('span', 'Use the install icon at the right of the address bar, or the browser menu → ', h('b', 'Install Church Service'), '.');
}

/**
 * ctx: { promptInstall(), installAvailable(), offline(): {done,total,ready}, onChange(fn) }.
 * Shows a card at the bottom once the first-start setup is finished; "Not now" hides it for a week.
 */
export function startInstallPrompt(ctx) {
  let card = null;
  const snoozed = () => { try { return +localStorage.getItem(SNOOZE) > Date.now(); } catch (e) { return false; } };
  const close = (snooze) => {
    if (snooze) { try { localStorage.setItem(SNOOZE, String(Date.now() + SNOOZE_DAYS * 86400000)); } catch (e) { /* */ } }
    if (card) { card.remove(); card = null; }
  };
  function paint() {
    if (!card) return;
    clear(card);
    const off = ctx.offline();
    const pct = off.total ? Math.min(100, Math.round(off.done / off.total * 100)) : 0;
    const status = off.ready
      ? h('p.inst-ok', icon('check'), h('span', 'Saved on this device: everything works without internet, except the things that need it (online Bibles and lyrics, AI, YouTube, sharing to phones over the internet).'))
      : off.total ? h('p.note', 'Saving Church Service for use without internet… ' + pct + '%. Keep the internet on until this finishes.')
        : h('p.note', 'Checking that everything is saved on this device…');
    const can = ctx.installAvailable();
    card.append(
      h('div.inst-h', h('img', { src: 'icons/favicon.svg', alt: '', width: 40, height: 40 }),
        h('div', h('b', 'Install Church Service'), h('div.note', 'Its own icon and window, and it opens without internet.'))),
      status,
      can ? null : h('p.note.inst-steps', installSteps()),
      h('div.row.wrap.inst-act',
        can ? h('button.btn.primary', { type: 'button', onclick: async () => { const ok = await ctx.promptInstall(); if (ok) close(false); } }, icon('download'), h('span', 'Install')) : null,
        h('button.btn', { type: 'button', onclick: () => close(true) }, can ? 'Not now' : 'OK')));
  }
  function show() {
    if (card || installed() || snoozed()) return;
    card = h('div.inst-card', { role: 'dialog', 'aria-label': 'Install Church Service' });
    document.body.appendChild(card);
    paint();
  }
  ctx.onChange(() => { if (installed()) close(false); else paint(); });
  return { show, paint, close };
}
