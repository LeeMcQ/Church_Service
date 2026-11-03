// "How did you hear about SDA Sabbath, and how has it changed your services?" Asked once, after a church has used
// it for three services (never during a service), and any time from Settings → Account. Sent with the statistics
// account (js/core/cloud.js cloud.story); without internet it waits on this device.
import { h } from '../core/util.js';
import { toast, modal, select, modalOpen } from '../core/ui.js';
import { settings } from '../core/settings.js';
import { cloud } from '../core/cloud.js';
import { lsKey } from '../core/storens.js';
import { inServiceHold } from '../core/readiness.js';

const APP_NAME = cloud.APP === 'church-service' ? 'Church Service' : 'SDA Sabbath';
export const REFERRALS = [
  ['', 'Choose…'], ['church', 'Another church'], ['conference', 'Our conference or union'], ['pastor', 'A pastor or elder'],
  ['whatsapp', 'WhatsApp'], ['facebook', 'Facebook or other social media'], ['search', 'An internet search'],
  ['event', 'A camp meeting, workshop or event'], ['other', 'Something else'],
];
const K = lsKey('stats.story');
const DAY = 86400000;
const state = () => { try { return JSON.parse(localStorage.getItem(K) || '{}') || {}; } catch (e) { return {}; } };
const save = (o) => { try { localStorage.setItem(K, JSON.stringify(Object.assign(state(), o))); } catch (e) { /* */ } };

/** The dialog. */
export function openStory() {
  let referral = '';
  const other = h('input.field', { type: 'text', maxlength: 200, placeholder: 'Where did you hear about it?', hidden: true, style: { width: '100%' } });
  const pick = select(REFERRALS, '', (v) => { referral = v; other.hidden = v !== 'other'; if (v === 'other') other.focus(); });
  pick.setAttribute('aria-label', 'How did you hear about ' + APP_NAME + '?');
  const story = h('textarea.field', { rows: 6, maxlength: 3000, style: { width: '100%' },
    placeholder: 'For example: our deacons run the screen without stress now; the service keeps going during load-shedding; visitors follow along in their own language…',
    'aria-label': 'How has ' + APP_NAME + ' changed your services?' });
  const quote = h('input', { type: 'checkbox' });
  const body = h('div.col', { style: { gap: '10px' } },
    h('label.muted', 'How did you hear about ' + APP_NAME + '?'), pick, other,
    h('label.muted', 'How has ' + APP_NAME + ' changed your services? (optional)'), story,
    h('label.switch', quote, h('span', 'You may quote this, with our church’s name, to tell other churches about ' + APP_NAME)),
    h('p.note', 'Only the maintainer of ' + APP_NAME + ' reads this. Nothing is shared unless you tick the box above.'));
  modal({ title: 'Tell us your story', body, onclose: () => { if (!state().sent) save({ asks: (state().asks || 0) + 1, askedAt: Date.now() }); },
    actions: [{ label: 'Not now' }, { label: 'Send', primary: true, onclick: async () => {
      const text = story.value.trim();
      if (!referral && !text) { toast('Choose how you heard of ' + APP_NAME + ', or write a few words.', 'err'); return false; }
      try {
        const r = await cloud.story({ referral, referralOther: referral === 'other' ? other.value.trim() : '', story: text, mayQuote: quote.checked });
        save({ sent: Date.now() });
        toast(r === 'queued' ? 'Thank you! It is sent when this device is online.' : 'Thank you for sharing!', 'ok', 4000);
      } catch (e) { toast('Could not send: ' + e.message, 'err', 5000); return false; }
      return true;
    } }] });
}

/** Counts the days this church presented (15 minutes or more) and asks once, after the third, outside services. */
export function startStoryPrompt(ctx) {
  const K_DAYS = lsKey('stats.serviceDays');
  const today = () => new Date().toISOString().slice(0, 10);
  cloud.on('minute', ({ presenting }) => {
    if (!presenting || !cloud.statsOn()) return;
    let d; try { d = JSON.parse(localStorage.getItem(K_DAYS) || '{}') || {}; } catch (e) { d = {}; }
    const t = today();
    if (d.day === t) d.min = (d.min || 0) + 1; else { d.day = t; d.min = 1; }
    if (d.min === 15) d.n = (d.n || 0) + 1; // a service: 15 minutes or more presenting on one day
    try { localStorage.setItem(K_DAYS, JSON.stringify(d)); } catch (e) { /* */ }
  });
  const due = () => {
    if (!cloud.statsOn() || document.hidden || modalOpen() || inServiceHold()) return false;
    const live = ctx.live;
    if (live && (live.cue || live.staged)) return false;
    let n = 0; try { n = (JSON.parse(localStorage.getItem(K_DAYS) || '{}') || {}).n || 0; } catch (e) { /* */ }
    const s = state();
    return n >= 3 && !s.sent && (s.asks || 0) < 2 && Date.now() - (s.askedAt || 0) > 30 * DAY;
  };
  const check = () => { if (due() && settings.v.app.setupDone) openStory(); };
  setTimeout(check, 20000);
  setInterval(check, 10 * 60000);
}
