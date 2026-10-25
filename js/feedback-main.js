// feedback.html: the comments and suggestions form on the website (same as Feedback in the app).
import { cloud } from './core/cloud.js';

const f = document.getElementById('f'), msg = document.getElementById('msg');
cloud.ready.then(() => { if (cloud.user && cloud.user.email) document.getElementById('email').value = cloud.user.email; });
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = document.getElementById('text').value.trim();
  if (text.length < 3) { msg.textContent = 'Please write a few words first.'; return; }
  const kind = (f.querySelector('input[name=kind]:checked') || {}).value || 'idea';
  const email = document.getElementById('email').value.trim();
  if (!cloud.enabled()) {
    location.href = 'https://github.com/LeeMcQ/Church_Service/issues/new?' + new URLSearchParams({ title: text.slice(0, 70), body: text + (email ? '\n\nFrom: ' + email : '') });
    return;
  }
  msg.textContent = 'Sending…';
  try {
    const r = await cloud.feedback({ kind, message: text, email, page: 'website', info: { ua: navigator.userAgent.slice(0, 200) } });
    msg.textContent = r === 'queued' ? 'Saved — it will be sent when you are online.' : 'Thank you! Your message was sent.';
    if (r === 'sent') f.reset();
  } catch (er) { msg.textContent = 'Could not send: ' + er.message; }
});
