// Account, feedback and usage-statistics screens (used by the first-start setup, Settings → Account and the
// Feedback button). The cloud itself is js/core/cloud.js.
import { h, clear } from '../core/util.js';
import { icon } from '../core/icons.js';
import { seg, toggle, toast, modal, closeModal, confirmBox } from '../core/ui.js';
import { settings } from '../core/settings.js';
import { cloud } from '../core/cloud.js';
import { feedbackUrl, FEEDBACK_PUBLIC_NOTE } from '../core/community.js';

const okEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());

/** Sign in with a code sent by email (or Google). onDone(user) is called once signed in. */
export function signInBox({ onDone, compact = false } = {}) {
  const box = h('div.col.signin', { style: { gap: '10px', maxWidth: '440px' } });
  let email = (cloud.user && cloud.user.email) || '';
  const paint = (step) => {
    clear(box);
    if (!cloud.enabled()) { box.append(h('p.note', 'Accounts are not switched on for this copy of Church Service.')); return; }
    if (navigator.onLine === false) { box.append(h('p.note', 'No internet connection now. You can sign in later in Settings → Account; everything else works without it.')); return; }
    if (step === 'code') {
      const code = h('input.field', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 10, placeholder: '6-digit code', 'aria-label': 'Code from the email', style: { fontSize: '22px', letterSpacing: '.2em', maxWidth: '220px' } });
      const go = async () => {
        if (code.value.replace(/\D/g, '').length < 6) { toast('Type the 6-digit code from the email.', 'err'); return; }
        btn.disabled = true;
        try { const u = await cloud.verifyCode(email, code.value); toast('Signed in as ' + (u && u.email ? u.email : email) + '.', 'ok'); if (onDone) onDone(u); }
        catch (e) { toast(/expired|invalid/i.test(e.message) ? 'That code is wrong or has expired. Ask for a new one.' : 'Could not sign in: ' + e.message, 'err', 6000); btn.disabled = false; }
      };
      const btn = h('button.btn.primary', { type: 'button', onclick: go }, icon('check'), h('span', 'Sign in'));
      code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      box.append(h('p', 'We sent a code to ', h('b', email), '. Type it here (or open the link in the email on this device).'), code,
        h('div.row.wrap', btn, h('button.btn', { type: 'button', onclick: () => paint('email') }, 'Use another email'),
          h('button.btn.ghost', { type: 'button', onclick: () => send(true) }, 'Send the code again')),
        h('p.note', 'No email after a minute? Look in the spam folder.'));
      setTimeout(() => code.focus(), 50);
      return;
    }
    const inp = h('input.field', { type: 'email', autocomplete: 'email', value: email, placeholder: 'you@example.com', 'aria-label': 'Email address', style: { maxWidth: '360px' } });
    const send = async (again) => {
      if (!again) email = inp.value.trim();
      if (!okEmail(email)) { toast('Type your email address.', 'err'); return; }
      try { await cloud.sendCode(email); if (!again) paint('code'); else toast('A new code is on its way.', 'ok'); }
      catch (e) { toast(/rate|seconds/i.test(e.message) ? 'Please wait a minute before asking for another code.' : 'Could not send the code: ' + e.message, 'err', 6000); }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    box.append(...[
      compact ? null : h('p', 'Sign in with your email: we send you a code, no password needed.'),
      inp, h('div.row.wrap', h('button.btn.primary', { type: 'button', onclick: () => send() }, icon('send'), h('span', 'Send me a code')),
        cloud.google() ? h('button.btn', { type: 'button', onclick: () => cloud.signInGoogle() }, h('b', { style: { fontFamily: 'Arial, sans-serif', color: '#4285f4' } }, 'G'), h('span', 'Continue with Google')) : null),
      cloud.lastError ? h('p.note', { style: { color: 'var(--live)' } }, cloud.lastError) : null].filter(Boolean));
    setTimeout(() => inp.focus(), 50);
  };
  paint('email');
  return box;
}

/** The "Help improve Church Service" switch with what it means. */
export function statsToggle() {
  return h('div.col', { style: { gap: '6px' } },
    toggle('Help improve Church Service: send usage statistics', settings.v.app.stats === true, (v) => { settings.set('app.stats', v); if (v) cloud.ping(); }),
    h('p.note', 'Counts only: how many minutes the app is used and presenting, how often Bible verses, hymns, slides and videos go on screen, the app version, browser and screen layout, and your church’s name and town. Never what you show. ',
      h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy notice')));
}

/** Comments and suggestions. */
export function openFeedback(ctx, { kind = 'idea', page = '' } = {}) {
  let k = kind;
  const msg = h('textarea.field', { rows: 7, maxlength: 4000, placeholder: 'What would make Church Service better for your church? Or what went wrong, and what were you doing?', style: { width: '100%' } });
  // An email address only goes to the cloud (kept private); without it the message becomes a public GitHub issue.
  const email = cloud.enabled() ? h('input.field', { type: 'email', value: (cloud.user && cloud.user.email) || '', placeholder: 'Your email (optional, for an answer)', style: { width: '100%' } }) : null;
  let withInfo = true;
  const tech = () => ({ tab: page || (ctx && ctx.currentTab) || settings.v.app.lastTab || '', ua: navigator.userAgent.slice(0, 200), screen: screen.width + 'x' + screen.height,
    layout: settings.v.display.mirror ? 'two projectors' : 'one projector', stage: settings.v.stage.useWindow ? (settings.v.stage.second ? 'two stage screens' : 'stage screen') : 'none',
    online: navigator.onLine, lang: navigator.language });
  const send = async () => {
    const text = msg.value.trim();
    if (text.length < 3) { toast('Write a few words first.', 'err'); return false; }
    if (!cloud.enabled()) { window.open(feedbackUrl(k, text, withInfo ? tech() : null), '_blank', 'noopener'); return true; }
    try {
      const r = await cloud.feedback({ kind: k, message: text, email: email.value.trim(), page: page || (ctx && ctx.currentTab) || settings.v.app.lastTab || '', info: withInfo ? tech() : null });
      toast(r === 'queued' ? 'Saved. It will be sent when this device is online.' : 'Thank you! Your message was sent.', 'ok', 5000);
      return true;
    } catch (e) { toast('Could not send: ' + e.message, 'err', 6000); return false; }
  };
  modal({ title: 'Comments and suggestions', wide: true, body: h('div.col', { style: { gap: '10px' } },
    h('p.note', 'Tell us how Church Service can be better. Every message is read.'),
    seg([['idea', 'Idea'], ['problem', 'Something is wrong'], ['praise', 'Thanks'], ['other', 'Other']], k, (v) => { k = v; }),
    msg, email,
    toggle('Add technical details (app version, browser, screen layout)', true, (v) => { withInfo = v; }),
    cloud.enabled() ? null : h('p.note', FEEDBACK_PUBLIC_NOTE),
    cloud.user ? h('button.btn.ghost.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => { closeModal(); myFeedback(); } }, icon('msg'), h('span', 'My earlier messages and replies')) : null),
    actions: [{ label: 'Cancel' }, { label: 'Send', primary: true, onclick: send }] });
  setTimeout(() => msg.focus(), 50);
}

const STATUS = { new: 'Received', seen: 'Read', planned: 'Planned', done: 'Done', wontfix: 'Not planned' };
export async function myFeedback() {
  const list = h('div.col', { style: { gap: '10px' } }, h('p.note', 'Loading…'));
  modal({ title: 'My messages', wide: true, body: list, actions: [{ label: 'Close' }] });
  try {
    const rows = await cloud.myFeedback();
    clear(list);
    if (!rows || !rows.length) { list.append(h('p.note', 'You have not sent any messages while signed in.')); return; }
    rows.forEach((r) => list.append(h('div.card', { style: { padding: '10px 12px' } },
      h('div.row.wrap', h('b', STATUS[r.status] || r.status), h('span.note', new Date(r.created_at).toLocaleDateString())),
      h('p', { style: { whiteSpace: 'pre-wrap', margin: '6px 0' } }, r.message),
      r.reply ? h('p', { style: { whiteSpace: 'pre-wrap', borderLeft: '3px solid var(--next)', paddingLeft: '10px', margin: '0' } }, h('b', 'Reply: '), r.reply) : null)));
  } catch (e) { clear(list); list.append(h('p.note', 'Could not load your messages: ' + e.message)); }
}

/** Settings → Account. */
export function accountSection(box, ctx) {
  const paint = () => {
    clear(box);
    if (!cloud.enabled()) {
      box.append(h('p', 'Accounts and statistics are not switched on for this copy of Church Service.'),
        h('div.row.wrap', h('button.btn', { type: 'button', onclick: () => openFeedback(ctx) }, icon('msg'), h('span', 'Send a comment or suggestion'))));
      return;
    }
    if (cloud.user) {
      box.append(h('p', 'Signed in as ', h('b', cloud.user.email || 'you'), cloud.admin ? h('span.pi-badge.next', { style: { marginLeft: '8px' } }, 'Maintainer') : null),
        h('div.row.wrap',
          h('button.btn', { type: 'button', onclick: () => openFeedback(ctx) }, icon('msg'), h('span', 'Send a comment or suggestion')),
          h('button.btn', { type: 'button', onclick: myFeedback }, icon('info'), h('span', 'My messages and replies')),
          cloud.admin ? h('a.btn.primary', { href: 'admin.html', target: '_blank', rel: 'noopener' }, icon('grid'), h('span', 'Statistics and feedback (maintainer)')) : null,
          h('button.btn', { type: 'button', onclick: async () => { await cloud.signOut(); toast('Signed out.', 'ok'); } }, icon('x'), h('span', 'Sign out')),
          h('button.btn.danger', { type: 'button', onclick: async () => {
            if (!(await confirmBox('Delete your account?', 'This deletes your account, your messages and the statistics of the devices you signed in on. Church Service keeps working on this device.', 'Delete my account', true))) return;
            try { await cloud.forgetMe(); toast('Your account and its data were deleted.', 'ok', 5000); } catch (e) { toast('Could not delete: ' + e.message, 'err', 6000); }
          } }, icon('trash'), h('span', 'Delete my account'))));
    } else {
      box.append(h('p', 'Not signed in.'), signInBox({ onDone: paint }),
        h('div.row.wrap', { style: { marginTop: '8px' } }, h('button.btn', { type: 'button', onclick: () => openFeedback(ctx) }, icon('msg'), h('span', 'Send a comment or suggestion'))));
    }
    box.append(h('div', { style: { marginTop: '14px' } }, statsToggle()),
      h('p.note', { style: { marginTop: '8px' } }, 'This device’s id: ' + cloud.installId().slice(0, 8) + '…' + (cloud.lastPing ? ' · last report ' + new Date(cloud.lastPing).toLocaleTimeString() : '')));
  };
  const off = cloud.on('user', () => { if (box.isConnected) paint(); });
  box._cleanup = off;
  paint();
}
