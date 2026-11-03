// Statistics recorder (only for a signed-in account with "Help improve …" on; see js/core/cloud.js).
// Everything is added to today's counts on this device and waits there (also without internet, up to 60 days);
// cloud.ping() sends it when the device is online again.
//
// Per day: which hymns (book, number and title) and Bible passages (the reference) went on screen; minutes with
// each feature in use; the most stage screens and translation phones at once; searches that found nothing (only
// when they look like a hymn number or a Bible reference, never other words); and errors.
// With each report: the equipment (system, screen size, extra screens, how the projector is connected, the sound
// set-up chosen in the setup), the church's place rounded to about 10 km, the language of the services, whether
// everything is stored for use offline, and when the setup was finished and something was first presented.
// Never slides, pictures, videos, sermons or anything typed.
import { cloud } from './cloud.js';
import { settings } from './settings.js';
import { live } from './live.js';
import { link } from './link.js';
import { lsKey } from './storens.js';

const K_MILES = lsKey('stats.milestones');
const MAX_KEYS = 200;
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private window */ } return null; };

/** Add 1 (or n) to a count in today's record, e.g. bump('hymns', 'sda-online|73|Holy, Holy, Holy'). */
function bump(field, key, n = 1) {
  if (!key) return;
  cloud.addDay((d) => {
    const m = d[field] = d[field] || {};
    if (!(key in m) && Object.keys(m).length >= MAX_KEYS) return;
    m[key] = (m[key] || 0) + n;
  });
}
function peak(key, v) {
  if (!(v > 0)) return;
  cloud.addDay((d) => { const p = d.peak = d.peak || {}; if (!(p[key] >= v)) p[key] = v; });
}

// ------------------------------------------------------------ milestones (setup and first presentation)
// Kept on this device from the first start (times only, nothing personal); sent only once statistics are allowed.
function miles() { try { return JSON.parse(LS(K_MILES) || 'null') || {}; } catch (e) { return {}; } }
function setMile(k, v = Date.now()) { const m = miles(); if (m[k]) return; m[k] = v; LS(K_MILES, JSON.stringify(m)); }

// ------------------------------------------------------------ the language of the services
function serviceLang() {
  const b = settings.v.bible || {}, hy = (settings.v.hymns || {}).book || '';
  const af = (x) => /^afr|^af\b|afrikaans/i.test(x || '');
  if (af(b.primary) && !b.parallel) return 'af';
  if (b.parallel && (af(b.parallel) || af(b.primary))) return 'both';
  if (af(b.primary) || af(hy)) return 'af';
  return b.primary ? (b.parallel ? 'two' : 'en') : '';
}

// ------------------------------------------------------------ equipment
function equipment(ctx) {
  const s = settings.v, sc = window.screen || {};
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  return {
    w: sc.width || 0, h: sc.height || 0, dpr: Math.round((window.devicePixelRatio || 1) * 10) / 10,
    cores: navigator.hardwareConcurrency || 0, mem: navigator.deviceMemory || 0,
    touch: !!(window.matchMedia && matchMedia('(pointer: coarse)').matches),
    installed: !!standalone, extended: sc.isExtended === true,
    display: link.kind || '', mirror: !!(link.hasMirror && link.hasMirror()),
    role: (s.app || {}).deviceRole || '', speakers: (s.app || {}).speakers || '',
    hall: (s.hymns || {}).musicRoom || '', sound: (s.hymns || {}).musicHQ || '',
    stage: !!((s.stage || {}).useWindow), companion: !!(ctx && ctx.companion),
  };
}

/** Start recording (called once by app.js). */
export function startStats(ctx) {
  // The first start of this copy (a copy that was already set up before this version: its times are unknown).
  if (!miles().firstOpen) { const m = miles(); m.firstOpen = Date.now(); m.known = !settings.v.app.setupDone; LS(K_MILES, JSON.stringify(m)); }
  if (settings.v.app.setupDone) setMile('setupDone', miles().known ? Date.now() : 0);
  settings.on('change:app', (p) => { if (p === 'app.setupDone' && settings.v.app.setupDone) setMile('setupDone'); });

  // What went on screen: each hymn and passage once per showing (not again for every stanza or a style change).
  let lastId = '', lastAt = 0;
  live.on('live', (c) => {
    if (!c) return;
    setMile('firstPresent');
    const same = c.id === lastId && Date.now() - lastAt < 10 * 60000;
    lastId = c.id; lastAt = Date.now();
    if (same) return;
    const p = c.plan || {};
    if (p.tab === 'hymns' && p.n) {
      const title = String(p.label || '').replace(/^Hymn\s+\d+\s*[—-]\s*/, '').slice(0, 60);
      bump('hymns', (p.book || '?') + '|' + p.n + '|' + title);
    } else if (p.tab === 'bible' && p.ref) bump('texts', String(p.ref).slice(0, 40));
  });

  let musicOn = false;
  window.addEventListener('selah-music', (e) => { musicOn = !!(e && e.detail); });
  // Each minute the app is in use: which features are on, and the most screens and phones at once.
  cloud.on('minute', ({ presenting }) => {
    const s = settings.v, tab = (s.app || {}).lastTab;
    const on = (k) => bump('features', k);
    if (tab === 'plan') on((s.app || {}).planView === 'advanced' ? 'plan_advanced' : 'plan_basic');
    if (ctx.listener && ctx.listener.on) on('listen');
    if (s.captions && s.captions.on) on('translate');
    if (musicOn) on('music');
    if (presenting && link.hasMirror && link.hasMirror()) on('two_projectors');
    if (presenting && link.kind) on('display_' + link.kind);
    try {
      const st = ctx.stage;
      if (st && st.screens) { const n = st.screens().length; if (n) { on('stage_screens'); peak('stage', n); } }
      if (st && st.readers) { const n = st.readers().length; if (n) { on('phones'); peak('phones', n); } }
    } catch (e) { /* */ }
  });

  // Searches in "Go to" that found nothing: a hymn number the book lacks, a reference not understood.
  window.addEventListener('selah-search-empty', (e) => {
    const q = String((e && e.detail) || '').trim().replace(/\s+/g, ' ');
    if (!q || q.length > 30 || !/\d/.test(q) || /@|https?:/i.test(q)) return;
    bump('empty', q.toLowerCase());
  });
  // Errors (counted, never their text).
  window.addEventListener('error', () => cloud.addDay((d) => { d.errors = (d.errors || 0) + 1; }));

  cloud.extraInfo = () => {
    const c = settings.v.church || {};
    const round = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : null);
    const hh = ctx.offlineHealth;
    const m = miles();
    return {
      conference: (c.conference || '').trim().slice(0, 80), union: (c.union || '').trim().slice(0, 80),
      lat: round(c.lat), lon: round(c.lon), svc_lang: serviceLang(),
      ready: hh && hh.total ? hh.missingCount === 0 : null,
      equip: equipment(ctx),
      setup: { known: !!m.known, first_open: m.firstOpen || null, setup_done: m.setupDone || null, first_present: m.firstPresent || null },
    };
  };
}
