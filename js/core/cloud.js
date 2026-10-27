// SDA Sabbath cloud (Supabase, see cloud-config.js and supabase/): the person's account, install and usage
// statistics, and feedback. Everything here is optional and best-effort: without internet (or without a cloud
// set up) the app works as before; counts and messages wait on this device and are sent later.
//
// What is counted (only while "Help improve SDA Sabbath" is on): minutes the app is in use, minutes a
// projector is connected, how often each kind of item goes on screen (Bible, hymn, slides …), the app version,
// browser, screen layout, and the church name and town from Settings → Church. Never what is shown.
import { CLOUD } from './cloud-config.js';
import { emitter } from './util.js';
import { lsKey } from './storens.js';
import { settings } from './settings.js';

const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private window */ } return null; };
const K_SESSION = lsKey('cloud.session'), K_INSTALL = lsKey('cloud.install'), K_PENDING = lsKey('cloud.pending'), K_OUTBOX = lsKey('cloud.outbox');

export const cloud = emitter({ user: null, session: null, admin: false, lastError: '' });
cloud.enabled = () => !!(CLOUD.url && CLOUD.anonKey);
cloud.config = CLOUD;
cloud.requireSignIn = () => cloud.enabled() && CLOUD.requireSignIn !== false;
cloud.google = () => cloud.enabled() && !!CLOUD.google;

/** A random id for this copy of the app (one per browser), kept on this device. */
cloud.installId = () => {
  let id = LS(K_INSTALL);
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15); return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
    LS(K_INSTALL, id);
  }
  return id;
};

// ------------------------------------------------------------ requests
async function call(path, { method = 'GET', body, auth = true, keepalive = false, raw = false, timeout = 15000 } = {}) {
  if (!cloud.enabled()) throw new Error('The SDA Sabbath cloud is not set up.');
  if (auth) await freshSession();
  const token = auth && cloud.session ? cloud.session.access_token : CLOUD.anonKey;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(CLOUD.url.replace(/\/+$/, '') + path, {
      method, keepalive, signal: ctl.signal,
      headers: Object.assign({ apikey: CLOUD.anonKey, Authorization: 'Bearer ' + token }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (raw) { if (!r.ok) throw new Error(await errorText(r)); return r; }
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw new Error((data && (data.msg || data.message || data.error_description || data.error)) || ('HTTP ' + r.status));
    return data;
  } finally { clearTimeout(t); }
}
async function errorText(r) { try { const j = await r.json(); return j.error || j.message || 'HTTP ' + r.status; } catch (e) { return 'HTTP ' + r.status; } }
cloud.rpc = (name, args, opts) => call('/rest/v1/rpc/' + name, Object.assign({ method: 'POST', body: args || {} }, opts || {}));

// ------------------------------------------------------------ account
function saveSession(s) {
  if (s && s.access_token) {
    s.expires_at = s.expires_at || Math.floor(Date.now() / 1000) + (+s.expires_in || 3600);
    cloud.session = s; cloud.user = s.user || cloud.user;
    LS(K_SESSION, JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, user: cloud.user }));
  } else { cloud.session = null; cloud.user = null; cloud.admin = false; LS(K_SESSION, null); }
  cloud.emit('user', cloud.user);
}
let refreshing = null;
async function freshSession() {
  const s = cloud.session;
  if (!s || !s.refresh_token) return;
  if (s.expires_at - 60 > Date.now() / 1000) return;
  if (navigator.onLine === false) return;
  if (!refreshing) {
    refreshing = fetch(CLOUD.url.replace(/\/+$/, '') + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { apikey: CLOUD.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }),
    }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (r.ok && j && j.access_token) saveSession(j);
      else if (r.status === 400 || r.status === 401) saveSession(null); // signed out elsewhere or deleted
    }).catch(() => {}).finally(() => { refreshing = null; });
  }
  await refreshing;
}

/** Email a 6-digit sign-in code (the same email has a link that also works). */
cloud.sendCode = (email) => call('/auth/v1/otp?redirect_to=' + encodeURIComponent(location.origin + location.pathname), {
  method: 'POST', auth: false, body: { email: String(email || '').trim(), create_user: true },
});
cloud.verifyCode = async (email, code) => {
  const s = await call('/auth/v1/verify', { method: 'POST', auth: false, body: { type: 'email', email: String(email || '').trim(), token: String(code || '').replace(/\D/g, '') } });
  saveSession(s);
  checkAdmin();
  cloud.ping(true);
  return cloud.user;
};
cloud.signInGoogle = () => {
  location.href = CLOUD.url.replace(/\/+$/, '') + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(location.origin + location.pathname);
};
cloud.signOut = async () => {
  try { await call('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* signed out here anyway */ }
  saveSession(null);
};
cloud.forgetMe = async () => { await cloud.rpc('forget_me'); saveSession(null); };
async function checkAdmin() {
  if (!cloud.user) { cloud.admin = false; return false; }
  try { cloud.admin = !!(await cloud.rpc('is_admin')); } catch (e) { cloud.admin = false; }
  cloud.emit('user', cloud.user);
  return cloud.admin;
}
cloud.checkAdmin = checkAdmin;

/** After the Google sign-in or the link in the email, the tokens come back in the address (#access_token=…). */
async function fromRedirect() {
  const hs = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (hs.get('error_description')) { cloud.lastError = hs.get('error_description'); history.replaceState(null, '', location.pathname + location.search); return; }
  const at = hs.get('access_token');
  if (!at) return;
  history.replaceState(null, '', location.pathname + location.search);
  const s = { access_token: at, refresh_token: hs.get('refresh_token'), expires_in: +hs.get('expires_in') || 3600 };
  try {
    const r = await fetch(CLOUD.url.replace(/\/+$/, '') + '/auth/v1/user', { headers: { apikey: CLOUD.anonKey, Authorization: 'Bearer ' + at } });
    s.user = r.ok ? await r.json() : null;
  } catch (e) { s.user = null; }
  saveSession(s);
}

// ------------------------------------------------------------ usage statistics
cloud.statsOn = () => cloud.enabled() && settings.v.app.stats !== false;
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function pending() { try { return JSON.parse(LS(K_PENDING) || '{}') || {}; } catch (e) { return {}; } }
function addUsage(fn) {
  if (!cloud.statsOn()) return;
  const p = pending();
  const d = today();
  p[d] = p[d] || { minutes: 0, presenting: 0, items: {} };
  fn(p[d]);
  Object.keys(p).sort().slice(0, -60).forEach((k) => { delete p[k]; }); // keep at most 60 days waiting
  LS(K_PENDING, JSON.stringify(p));
}
/** Something went on screen (only the kind is counted: bible, hymns, slides, video, ai, web, …). */
cloud.count = (kind) => addUsage((day) => { if (kind) day.items[kind] = (day.items[kind] || 0) + 1; });

let lastInput = Date.now();
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
let presentingFn = () => false, layoutFn = () => '';
/** Start counting minutes (called once by app.js). */
cloud.track = ({ presenting, layout } = {}) => {
  if (presenting) presentingFn = presenting;
  if (layout) layoutFn = layout;
  setInterval(() => {
    const pres = !!presentingFn();
    const using = pres || (document.visibilityState === 'visible' && Date.now() - lastInput < 10 * 60000);
    if (using) addUsage((d) => { d.minutes++; if (pres) d.presenting++; });
  }, 60000);
  setTimeout(() => cloud.ping(), 20000);
  setInterval(() => cloud.ping(), 15 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') cloud.ping(false, true); });
  window.addEventListener('online', () => setTimeout(() => { cloud.ping(); flushOutbox(); }, 4000));
};

function platform() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  return { os, br };
}
cloud.version = '';
let pinging = false;
/** Send the counts waiting on this device. force: even if stats are off (just "this install exists" after sign-in). */
cloud.ping = async (force, leaving) => {
  if (!cloud.enabled() || pinging || navigator.onLine === false) return;
  if (!cloud.statsOn() && !(force && cloud.user)) return;
  const p = cloud.statsOn() ? pending() : {};
  const days = Object.keys(p).map((day) => Object.assign({ day }, p[day]));
  const c = settings.v.church || {};
  const { os, br } = platform();
  const info = cloud.statsOn() ? { church: (c.name || '').trim(), town: (c.town || '').trim(), country: (c.country || '').trim(), platform: os, browser: br,
    version: cloud.version, layout: layoutFn() || '', lang: (navigator.language || '').slice(0, 5) } : { version: cloud.version };
  pinging = true;
  try {
    await cloud.rpc('ping', { p_install: cloud.installId(), p_info: info, p_days: days }, { keepalive: !!leaving, timeout: leaving ? 5000 : 15000 });
    // Sent: take off what was sent (minutes counted meanwhile stay).
    const now = pending();
    days.forEach((d) => {
      const n = now[d.day];
      if (!n) return;
      n.minutes = Math.max(0, n.minutes - d.minutes); n.presenting = Math.max(0, n.presenting - d.presenting);
      Object.keys(d.items || {}).forEach((k) => { n.items[k] = Math.max(0, (n.items[k] || 0) - d.items[k]); if (!n.items[k]) delete n.items[k]; });
      if (!n.minutes && !n.presenting && !Object.keys(n.items).length) delete now[d.day];
    });
    LS(K_PENDING, JSON.stringify(now));
    cloud.lastPing = Date.now();
  } catch (e) { cloud.lastError = e.message; } finally { pinging = false; }
};

// ------------------------------------------------------------ feedback
function outbox() { try { return JSON.parse(LS(K_OUTBOX) || '[]') || []; } catch (e) { return []; } }
async function flushOutbox() {
  const box = outbox();
  if (!box.length || !cloud.enabled() || navigator.onLine === false) return;
  const left = [];
  for (const m of box) { try { await cloud.rpc('send_feedback', m); } catch (e) { if (!/3 to 4000|Too many/.test(e.message)) left.push(m); } }
  LS(K_OUTBOX, left.length ? JSON.stringify(left) : null);
}
/** Send a comment or suggestion. Without internet it waits on this device. Returns 'sent' | 'queued'. */
cloud.feedback = async ({ kind, message, email, page, info }) => {
  const m = { p_install: cloud.installId(), p_kind: kind, p_message: message, p_email: email || (cloud.user && cloud.user.email) || '', p_page: page || '', p_version: cloud.version, p_info: info || null };
  if (navigator.onLine === false) { LS(K_OUTBOX, JSON.stringify(outbox().concat([m]))); return 'queued'; }
  try { await cloud.rpc('send_feedback', m); return 'sent'; }
  catch (e) {
    if (/Failed to fetch|NetworkError|abort/i.test(e.message)) { LS(K_OUTBOX, JSON.stringify(outbox().concat([m]))); return 'queued'; }
    throw e;
  }
};
/** The signed-in person's own messages, with the maintainer's replies. */
cloud.myFeedback = () => call('/rest/v1/feedback?select=id,kind,message,status,reply,created_at,updated_at&order=created_at.desc&limit=50');

// ------------------------------------------------------------ Google Slides (download through the cloud)
cloud.slidesExport = async (id, format = 'pdf') => {
  const r = await call('/functions/v1/gslides?id=' + encodeURIComponent(id) + '&format=' + format, { raw: true, auth: false, timeout: 120000 });
  return r.blob();
};

// ------------------------------------------------------------ start
cloud.ready = (async () => {
  if (!cloud.enabled()) return;
  try { const s = JSON.parse(LS(K_SESSION) || 'null'); if (s && s.access_token) { cloud.session = s; cloud.user = s.user || null; } } catch (e) { /* */ }
  await fromRedirect();
  try { const m = await fetch('asset-manifest.json', { cache: 'no-store' }).then((r) => r.json()); cloud.version = String(m.version || '').slice(0, 12); } catch (e) { cloud.version = ''; }
  if (cloud.user) { freshSession().then(checkAdmin); }
  setTimeout(flushOutbox, 8000);
  cloud.emit('user', cloud.user);
})();
