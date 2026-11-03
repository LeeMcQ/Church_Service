// admin.html: the church statistics dashboard and feedback for the maintainer (people listed in public.admins).
// The numbers come from public.stats_report (supabase/schema.sql); the same report feeds the monthly email
// (tools/monthly_report.py).
import { cloud } from './core/cloud.js';
import { esc } from './core/util.js';
// Never shown inside another website's frame (clickjacking). The app's own pages may frame each other.
try { if (window.top !== window.self) { var sameTop = false; try { sameTop = window.top.location.origin === location.origin; } catch (e) { /* cross-origin */ } if (!sameTop) { document.documentElement.style.display = 'none'; try { window.top.location.replace(location.href); } catch (e) { /* */ } } } } catch (e) { /* */ }

const $ = (s) => document.querySelector(s);
const app = $('#app');
const APP_NAME = document.title.replace(/^.*– /, '') || 'Church Service';
const hrs = (m) => (m / 60 >= 100 ? Math.round(m / 60) : (m / 60).toFixed(1)) + ' h';
const ago = (t) => { if (!t) return '—'; const d = (Date.now() - new Date(t)) / 86400000; return d < 1 ? 'today' : d < 2 ? 'yesterday' : Math.floor(d) + ' days ago'; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const LABEL = { bible: 'Bible', hymns: 'Hymns', slides: 'Slides', video: 'Video', ai: 'Banners', web: 'Web & PC', plan: 'Plan', stream: 'Stream', stage: 'Stage' };
const LAYOUT = { p: 'Projector only', ps: 'Projector + stage', pp: 'Two projectors', pps: 'Two projectors + stage', pss: 'Projector + two stage', ppss: 'Two projectors + two stage', '': '—', '?': '—' };
const FEATURE = {
  plan_basic: 'Plan – Basic view', plan_advanced: 'Plan – Advanced view', listen: 'Listen (verse and hymn suggestions)', translate: 'Live translation',
  music: 'Hymn music', two_projectors: 'Two projectors', stage_screens: 'Stage screens', phones: 'Translation on phones',
  display_window: 'Projector window', display_cast: 'Cast (Chromecast)', display_socket: 'TV through the companion', display_self: 'This screen',
};
const LANG = { en: 'English', af: 'Afrikaans', both: 'English and Afrikaans', two: 'Two Bibles side by side', '?': 'Not known' };
const REFERRAL = { church: 'Another church', conference: 'Conference or union', pastor: 'A pastor or elder', whatsapp: 'WhatsApp', facebook: 'Facebook / social media',
  search: 'Internet search', event: 'Camp meeting or event', other: 'Something else', 'not said': 'Not said' };
const DISPLAY = { window: 'Projector window', cast: 'Cast', socket: 'TV via companion', self: 'This screen', none: 'Nothing connected' };
const ROLE = { pc: 'Church PC', laptop: 'Laptop', phone: 'Phone or tablet', '?': 'Not chosen' };
const SPEAKERS = { pa: 'Sound desk / PA', small: 'Small speakers', tv: 'TV or projector speakers', '?': 'Not chosen' };
const HALL = { small: 'Small', church: 'Medium', large: 'Large', off: 'No echo', '?': 'Not chosen' };
const SOUND = { auto: 'Chosen automatically', off: 'Standard', standard: 'Standard', hq: 'High quality (piano and organ)', studio: 'Studio', '?': 'Not chosen' };

// ------------------------------------------------------------ small drawing helpers
function bars(rows, key, { h = 140, color = 'var(--bar)', fmt = (v) => v, label = (r) => r.day || r.week } = {}) {
  if (!rows || !rows.length) return '<p class="muted">No data yet.</p>';
  const W = 760, max = Math.max(1, ...rows.map((r) => +r[key] || 0)), bw = W / rows.length;
  let s = '<svg viewBox="0 0 ' + W + ' ' + (h + 18) + '" width="100%" role="img" aria-label="Chart">';
  rows.forEach((r, i) => {
    const v = +r[key] || 0, bh = Math.round((v / max) * h);
    s += '<rect x="' + (i * bw + 1).toFixed(1) + '" y="' + (h - bh) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + bh + '" fill="' + color + '"><title>' + esc(label(r) + ': ' + fmt(v)) + '</title></rect>';
  });
  s += '<text x="0" y="' + (h + 14) + '">' + esc(label(rows[0])) + '</text><text x="' + W + '" y="' + (h + 14) + '" text-anchor="end">' + esc(label(rows[rows.length - 1])) + '</text>';
  return s + '<text x="' + W + '" y="10" text-anchor="end">most ' + esc(fmt(max)) + '</text></svg>';
}
function hbars(obj, names, fmt = (v) => v) {
  const e = Object.entries(obj || {}).filter((x) => +x[1] > 0).sort((a, b) => b[1] - a[1]);
  if (!e.length) return '<p class="muted">No data yet.</p>';
  const max = Math.max(...e.map((x) => +x[1]));
  return e.map(([k, v]) => '<div class="hbar"><span title="' + esc((names && names[k]) || k) + '">' + esc((names && names[k]) || k) + '</span><i style="width:' + Math.max(2, Math.round((v / max) * 240)) + 'px"></i><span>' + esc(fmt(v)) + '</span></div>').join('');
}
/** "+12 %" / "−3" in green or amber; nothing when there is no earlier figure. */
function change(cur, prev, { asPct = true } = {}) {
  cur = +cur || 0; prev = +prev || 0;
  if (!prev && !cur) return '<small class="muted">no change</small>';
  if (!prev) return '<small class="up">new this period</small>';
  const d = cur - prev;
  if (!d) return '<small class="muted">same as before</small>';
  const t = asPct ? Math.round((d / prev) * 100) + ' %' : String(Math.abs(d));
  return '<small class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + esc(asPct ? t.replace('-', '') : t) + ' vs before</small>';
}
const kpi = (value, label, extra = '') => '<div class="kpi"><b>' + esc(value) + '</b><span>' + esc(label) + '</span>' + extra + '</div>';
const card = (title, html, extra = '') => '<div class="card"' + extra + '><h2>' + esc(title) + '</h2>' + html + '</div>';
const hymnName = (h) => (h.n ? h.n + ' · ' : '') + (h.title || 'Hymn ' + h.n);

// ------------------------------------------------------------ sign in
function signIn(msg) {
  app.innerHTML = '<div class="card" style="max-width:460px"><h2>Sign in</h2><p class="muted">' + esc(msg || 'For the maintainer of ' + APP_NAME + '. We email you a code.') + '</p>' +
    '<div class="row"><input id="em" type="email" placeholder="you@example.com" style="flex:1" aria-label="Email"><button class="primary" id="send" type="button">Send code</button></div>' +
    '<div class="row" id="coderow" hidden style="margin-top:10px"><input id="code" inputmode="numeric" placeholder="6-digit code" aria-label="Code"><button class="primary" id="ok" type="button">Sign in</button></div><p id="err" class="muted"></p></div>';
  const err = (t) => { $('#err').textContent = t; };
  $('#send').onclick = async () => { try { await cloud.sendCode($('#em').value); $('#coderow').hidden = false; err('Code sent. Check your email.'); $('#code').focus(); } catch (e) { err(e.message); } };
  $('#ok').onclick = async () => { try { await cloud.verifyCode($('#em').value, $('#code').value); load(); } catch (e) { err(e.message); } };
}

// ------------------------------------------------------------ period and app filter
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function periodOf(key) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  const back = (n) => { const d = new Date(t); d.setDate(d.getDate() - n); return d; };
  if (key === 'month') return [new Date(t.getFullYear(), t.getMonth(), 1, 12), t];
  if (key === 'lastmonth') return [new Date(t.getFullYear(), t.getMonth() - 1, 1, 12), new Date(t.getFullYear(), t.getMonth(), 0, 12)];
  if (key === '90') return [back(89), t];
  if (key === '365') return [back(364), t];
  return [back(29), t];
}
let periodKey = '30', appKey = '', view = 'overview';
let report = null, stats = null;

// ------------------------------------------------------------ plain-language summary (the same ideas as the email)
function summary(r) {
  const c = r.totals.cur || {}, p = r.totals.prev || {}, out = [];
  const diff = (a, b, one, many) => {
    const d = (+a || 0) - (+b || 0);
    return d > 0 ? ' — ' + d + ' more than the period before' : d < 0 ? ' — ' + -d + ' fewer than the period before' : (b ? ' — the same as the period before' : '');
  };
  out.push('<b>' + c.churches + '</b> ' + (c.churches === 1 ? 'church' : 'churches') + ' presented with ' + esc(APP_NAME) + diff(c.churches, p.churches) + '.');
  if (c.services) out.push('<b>' + c.services + '</b> services were run' + (c.offline_services ? ', <b>' + c.offline_services + '</b> of them (' + pct(c.offline_services, c.services) + ' %) without internet' : '') + '.');
  if (r.new_churches && r.new_churches.length) out.push('New: ' + r.new_churches.slice(0, 5).map((x) => '<b>' + esc(x.church || 'a church') + '</b>' + (x.town ? ' (' + esc(x.town) + ')' : '')).join(', ') + (r.new_churches.length > 5 ? ' and ' + (r.new_churches.length - 5) + ' more' : '') + '.');
  if (r.hymn_of_week) out.push('Hymn of the week: <b>' + esc(hymnName(r.hymn_of_week)) + '</b>, sung by ' + r.hymn_of_week.churches + ' ' + (r.hymn_of_week.churches === 1 ? 'church' : 'churches') + '.');
  const rel = r.reliability || {};
  if (rel.not_ready) out.push('<span class="down">' + rel.not_ready + ' ' + (rel.not_ready === 1 ? 'device is' : 'devices are') + ' not fully stored for offline use.</span>');
  if (r.empty && r.empty.length) out.push('Most-searched with no result: “' + esc(r.empty[0].q) + '” (' + r.empty[0].churches + ' ' + (r.empty[0].churches === 1 ? 'church' : 'churches') + ').');
  return '<ul class="lead">' + out.map((x) => '<li>' + x + '</li>').join('') + '</ul>';
}

// ------------------------------------------------------------ views
function overview(r) {
  const c = r.totals.cur || {}, p = r.totals.prev || {}, rel = r.reliability || {};
  const feats = Object.entries(r.features || {}).sort((a, b) => b[1].churches - a[1].churches || b[1].minutes - a[1].minutes);
  const top = feats[0];
  const setupRate = c.setup_started ? pct(c.setup_done, c.setup_started) + ' %' : '—';
  return summary(r) + '<div class="kpis">' +
    kpi(c.churches, 'churches presenting', change(c.churches, p.churches)) +
    kpi(c.services, 'services', change(c.services, p.services) + '<small class="muted">' + pct(c.offline_services, c.services) + ' % without internet</small>') +
    kpi(c.new_churches, 'new churches', change(c.new_churches, p.new_churches, { asPct: false })) +
    kpi(setupRate, 'finished the setup', '<small class="muted">' + (c.first_present_min != null ? Math.round(c.first_present_min) + ' min to first presentation' : 'no new devices yet') + '</small>') +
    kpi(r.hymn_of_week ? r.hymn_of_week.n : '—', 'hymn of the week', '<small class="muted">' + esc(r.hymn_of_week ? r.hymn_of_week.title || '' : 'nothing sung yet') + '</small>') +
    kpi(Object.keys(r.languages || {}).length ? LANG[Object.entries(r.languages).sort((a, b) => b[1] - a[1])[0][0]] || '—' : '—', 'most common service language') +
    kpi(top ? (FEATURE[top[0]] || top[0]) : '—', 'most used feature', top ? '<small class="muted">' + top[1].churches + ' churches</small>' : '') +
    kpi(rel.devices ? pct(rel.ready, rel.devices) + ' %' : '—', 'devices ready offline', '<small class="muted">' + (rel.devices ? pct(rel.on_latest, rel.devices) + ' % on the latest version' : '') + '</small>') +
    '</div>' +
    '<div class="grid2">' + card('Churches presenting per week (6 months)', bars(r.weeks, 'churches', { color: 'var(--accent)', label: (x) => 'week of ' + x.week })) +
    card('Service languages (churches)', hbars(r.languages, LANG)) + '</div>' +
    '<div class="grid2">' + card('Features (churches using each)', hbars(Object.fromEntries(feats.map(([k, v]) => [k, v.churches])), FEATURE)) +
    card('What goes on screen (times)', hbars(r.kinds, LABEL)) + '</div>' +
    '<div class="grid2">' + card('Searches that found nothing', r.empty && r.empty.length
      ? '<table><thead><tr><th>Typed</th><th class="n">Times</th><th class="n">Churches</th></tr></thead><tbody>' + r.empty.map((x) => '<tr><td>' + esc(x.q) + '</td><td class="n">' + x.times + '</td><td class="n">' + x.churches + '</td></tr>').join('') + '</tbody></table><p class="muted">A hymn number a book lacks, or a reference the app did not understand: candidates to add or fix.</p>'
      : '<p class="muted">None. Every search found something.</p>') +
    card('Reliability', '<table><tbody>' +
      '<tr><td>Devices in use</td><td class="n">' + (rel.devices || 0) + '</td></tr>' +
      '<tr><td>Fully stored for offline use</td><td class="n">' + (rel.ready || 0) + ' (' + pct(rel.ready, rel.devices) + ' %)</td></tr>' +
      '<tr><td>On the latest version' + (rel.latest_version ? ' (' + esc(rel.latest_version) + ')' : '') + '</td><td class="n">' + (rel.on_latest || 0) + '</td></tr>' +
      '<tr><td>Errors per 100 hours of use</td><td class="n">' + (rel.hours ? Math.round((rel.errors / rel.hours) * 100) : 0) + '</td></tr>' +
      '<tr><td>Hours used / presenting</td><td class="n">' + hrs(c.minutes || 0) + ' / ' + hrs(c.presenting_min || 0) + '</td></tr></tbody></table>') + '</div>';
}

function hymnsView(r) {
  const w = r.hymn_of_week;
  const arrow = (cur, prev) => (!prev ? '<span class="pill">new</span>' : cur > prev ? '<span class="up">▲</span>' : cur < prev ? '<span class="down">▼</span>' : '');
  return '<div class="grid2">' + card('Hymn of the week', w
    ? '<div class="hymnweek"><div class="num">' + esc(w.n) + '</div><div><b>' + esc(w.title || '') + '</b><br><span class="muted">' + w.churches + ' ' + (w.churches === 1 ? 'church' : 'churches') + ' sang it in the last 7 days (' + esc(w.book) + ')</span></div></div><p class="muted">Share it: “This week ' + w.churches + ' churches sang ' + esc(w.title || 'hymn ' + w.n) + '.”</p>'
    : '<p class="muted">No hymns sung in the last 7 days of this period.</p>') +
    card('How to read this', '<p class="muted">Ranked by how many churches showed each hymn or passage, then by how often. ▲▼ compare with the period before. A church counts once, however many devices it uses.</p>') + '</div>' +
    '<div class="grid2">' + card('Most-sung hymns', r.hymns && r.hymns.length ? '<div class="scroll"><table><thead><tr><th>Hymn</th><th class="n">Churches</th><th class="n">Times</th><th></th></tr></thead><tbody>' +
      r.hymns.map((x) => '<tr><td>' + esc(hymnName(x)) + '<br><span class="muted">' + esc(x.book) + '</span></td><td class="n">' + x.churches + '</td><td class="n">' + x.times + '</td><td>' + arrow(x.churches, x.prev_churches) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">No data yet.</p>') +
    card('Most-shown Bible passages', r.texts && r.texts.length ? '<div class="scroll"><table><thead><tr><th>Passage</th><th class="n">Churches</th><th class="n">Times</th><th></th></tr></thead><tbody>' +
      r.texts.map((x) => '<tr><td>' + esc(x.ref) + '</td><td class="n">' + x.churches + '</td><td class="n">' + x.times + '</td><td>' + arrow(x.times, x.prev_times) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">No data yet.</p>') + '</div>';
}

// The map: country outlines (admin/world.json, Natural Earth, public domain) and one dot per church.
let world = null;
async function mapView(r, el) {
  const pts = (r.map || []).filter((m) => m.lat != null && m.lon != null);
  const noPlace = (r.map || []).filter((m) => (m.lat == null || m.lon == null) && m.church);
  el.innerHTML = '<div class="card map"><div class="row" style="justify-content:space-between"><h2>Churches on the map</h2><div class="row"><button type="button" data-fit="churches">Fit the churches</button><button type="button" data-fit="za">Southern Africa</button><button type="button" data-fit="world">World</button></div></div><div id="mapbox"><p class="muted">Loading the map…</p></div>' +
    '<div class="legend"><span><i style="background:var(--accent)"></i>presented in the last 14 days</span><span><i style="background:var(--warn)"></i>quieter (no service in 14 days)</span><span>Larger dot = more services in this period. Places are rounded to about 10 km.</span></div></div>' +
    '<div class="card" style="margin-top:12px"><h2>Churches</h2><div class="scroll"><table><thead><tr><th>Church</th><th>Town</th><th>Conference</th><th class="n">Services</th><th>Last service</th></tr></thead><tbody>' +
    (r.map || []).filter((m) => m.church || m.services).sort((a, b) => b.services - a.services).map((m) => '<tr><td>' + esc(m.church || '(no name set)') + '</td><td>' + esc(m.town || '') + '</td><td>' + esc(m.conference || '') + '</td><td class="n">' + m.services + '</td><td>' + esc(m.last_service ? ago(m.last_service) : '—') + '</td></tr>').join('') +
    '</tbody></table></div>' + (noPlace.length ? '<p class="muted">' + noPlace.length + ' churches have not set their location (Settings → Church), so they are not on the map.</p>' : '') + '</div>';
  try { world = world || await (await fetch('admin/world.json')).json(); } catch (e) { $('#mapbox').innerHTML = '<p class="muted">Could not load the map outlines.</p>'; return; }
  const draw = (fit) => {
    let b;
    if (fit === 'world') b = [-170, -58, 190, 80];
    else if (fit === 'za' || !pts.length) b = [10, -36, 41, -16];
    else {
      const la = pts.map((p) => +p.lat), lo = pts.map((p) => +p.lon);
      b = [Math.min(...lo), Math.min(...la), Math.max(...lo), Math.max(...la)];
      const padX = Math.max(1.5, (b[2] - b[0]) * 0.15), padY = Math.max(1, (b[3] - b[1]) * 0.15);
      b = [b[0] - padX, b[1] - padY, b[2] + padX, b[3] + padY];
    }
    const k = Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180);
    const W = 1000, sx = W / ((b[2] - b[0]) * k), H = Math.round((b[3] - b[1]) * sx);
    const X = (lon) => ((lon - b[0]) * k * sx).toFixed(1), Y = (lat) => ((b[3] - lat) * sx).toFixed(1);
    let paths = '';
    for (const c of world.countries) for (const ring of c.r) {
      let minx = 999, maxx = -999, miny = 999, maxy = -999;
      for (let i = 0; i < ring.length; i += 2) { const x = ring[i], y = ring[i + 1]; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
      if (maxx < b[0] || minx > b[2] || maxy < b[1] || miny > b[3]) continue;
      let d = '';
      for (let i = 0; i < ring.length; i += 2) d += (i ? 'L' : 'M') + X(ring[i]) + ' ' + Y(ring[i + 1]);
      paths += '<path d="' + d + 'Z"><title>' + esc(c.n) + '</title></path>';
    }
    const maxS = Math.max(1, ...pts.map((p) => p.services || 0));
    const dots = pts.slice().sort((a, b2) => (b2.services || 0) - (a.services || 0)).map((p) => {
      const recent = p.last_service && (Date.now() - new Date(p.last_service)) / 86400000 <= 14;
      const rad = 5 + Math.sqrt((p.services || 0) / maxS) * 11;
      return '<circle cx="' + X(+p.lon) + '" cy="' + Y(+p.lat) + '" r="' + rad.toFixed(1) + '" fill="' + (recent ? 'var(--accent)' : 'var(--warn)') + '" fill-opacity=".8"><title>' +
        esc((p.church || 'Church') + (p.town ? ', ' + p.town : '') + ' — ' + (p.services || 0) + ' services this period' + (p.last_service ? ', last ' + ago(p.last_service) : '')) + '</title></circle>';
    }).join('');
    $('#mapbox').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Map of ' + pts.length + ' churches">' + paths + dots + '</svg>' +
      (pts.length ? '' : '<p class="muted">No church has its location set yet.</p>');
  };
  el.querySelectorAll('[data-fit]').forEach((bt) => { bt.onclick = () => draw(bt.dataset.fit); });
  draw('churches');
}

function equipmentView(r) {
  const e = r.equipment || {}, n = e.with_equip || 0;
  const share = (v) => (n ? pct(v, n) + ' %' : '—');
  return '<div class="kpis">' + kpi(share(e.installed), 'installed as an app') + kpi(share(e.extended), 'with an extended second screen') +
    kpi(share(e.touch), 'touch screens') + kpi(share(e.companion), 'using the companion') + kpi(e.peak_stage || 0, 'most stage screens at once') + kpi(e.peak_phones || 0, 'most phones on translation at once') + '</div>' +
    '<div class="grid2">' + card('Systems', hbars(e.systems)) + card('Browsers', hbars(e.browsers)) + '</div>' +
    '<div class="grid2">' + card('Projector connection', hbars(e.display, DISPLAY)) + card('Screen layouts', hbars(e.layouts, LAYOUT)) + '</div>' +
    '<div class="grid2">' + card('Device used on Sabbath', hbars(e.role, ROLE)) + card('Sound goes through', hbars(e.speakers, SPEAKERS)) + '</div>' +
    '<div class="grid2">' + card('Church hall size', hbars(e.hall, HALL)) + card('Hymn instruments', hbars(e.sound, SOUND)) + '</div>' +
    '<div class="grid2">' + card('Screen sizes', hbars(e.screens)) + card('Memory (where the browser says)', hbars(e.memory)) + '</div>' +
    '<p class="muted">Devices in use in this period that reported their equipment: ' + n + '.</p>';
}

function storiesView(r) {
  const st = r.stories || [];
  return '<div class="grid2">' + card('How churches heard of ' + APP_NAME + ' (all time)', hbars(r.referrals, REFERRAL)) +
    card('… in this period', hbars(r.referrals_period, REFERRAL)) + '</div>' +
    card('How it changed their services', st.length ? st.map((s) => '<div class="quote"><p>' + esc(s.story) + '</p><span class="muted">' + esc(s.church || 'A church') + (s.town ? ', ' + esc(s.town) : '') + ' · ' + esc(new Date(s.created_at).toLocaleDateString()) +
      (s.referral ? ' · heard via ' + esc(REFERRAL[s.referral] || s.referral) + (s.referral_other ? ' (' + esc(s.referral_other) + ')' : '') : '') + '</span> ' +
      (s.may_quote ? '<span class="pill">may be quoted</span>' : '<span class="tag">private</span>') + '</div>').join('') : '<p class="muted">No stories yet. Churches are asked once, after their third service, and can write any time in Settings → Account.</p>');
}

let fbFilter = 'new';
async function feedbackView(el) {
  el.innerHTML = '<div class="card"><div class="row" style="justify-content:space-between"><h2>Comments and suggestions</h2><select id="fbf" aria-label="Show">' +
    ['new', 'seen', 'planned', 'done', 'wontfix', 'all'].map((x) => '<option' + (x === fbFilter ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div><div id="fb"><p class="muted">Loading…</p></div></div>';
  $('#fbf').onchange = (e) => { fbFilter = e.target.value; feedbackView(el); };
  const box = $('#fb');
  let rows = [];
  try { rows = await cloud.rpc('admin_feedback', { p_status: fbFilter === 'all' ? null : fbFilter }); } catch (e) { box.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; return; }
  if (!rows.length) { box.innerHTML = '<p class="muted">Nothing here.</p>'; return; }
  box.innerHTML = rows.map((r) => '<div class="fb" data-id="' + r.id + '"><div class="row"><span class="tag ' + esc(r.status) + '">' + esc(r.status) + '</span><b>' + esc(r.kind) + '</b><span class="muted">' +
    esc(new Date(r.created_at).toLocaleString()) + (r.email ? ' · ' + esc(r.email) : '') + (r.app_version ? ' · v ' + esc(r.app_version) : '') + (r.page ? ' · ' + esc(r.page) : '') + '</span></div>' +
    '<p>' + esc(r.message) + '</p>' + (r.info ? '<details><summary class="muted">Technical details</summary><pre style="white-space:pre-wrap">' + esc(JSON.stringify(r.info, null, 1)) + '</pre></details>' : '') +
    '<div class="row"><select aria-label="Status">' + ['new', 'seen', 'planned', 'done', 'wontfix'].map((s) => '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
    '<textarea rows="1" placeholder="Reply (the sender sees it in the app when signed in)" style="flex:1;min-width:220px" aria-label="Reply">' + esc(r.reply || '') + '</textarea><button type="button">Save</button></div></div>').join('');
  box.querySelectorAll('.fb button').forEach((b) => { b.onclick = async () => {
    const d = b.closest('.fb');
    try { await cloud.rpc('admin_update_feedback', { p_id: +d.dataset.id, p_status: d.querySelector('select').value, p_reply: d.querySelector('textarea').value }); b.textContent = 'Saved'; setTimeout(() => { b.textContent = 'Save'; }, 1500); }
    catch (e) { b.textContent = 'Not saved: ' + e.message; }
  }; });
}

function devicesView(s) {
  if (!s) return '<p class="muted">Loading…</p>';
  return '<div class="kpis">' + kpi(s.installs, 'devices ever') + kpi(s.accounts, 'signed-in accounts') + kpi(s.active_7, 'devices active this week') + kpi(s.new_30, 'new devices in 30 days') + '</div>' +
    '<div class="grid2">' + card('Hours used per day (90 days)', bars(s.days, 'minutes', { fmt: hrs })) + card('New devices per week', bars(s.weeks, 'n', { color: 'var(--accent)' })) + '</div>' +
    card('Every device', '<div class="scroll"><table><thead><tr><th>Church</th><th>Town</th><th>System</th><th>Layout</th><th>Version</th><th>First seen</th><th>Last seen</th><th class="n">Hours</th></tr></thead><tbody>' +
      s.churches.map((c) => '<tr><td>' + esc(c.church || '—') + (c.signed_in ? ' ✓' : '') + '</td><td>' + esc(c.town || '') + '</td><td>' + esc(c.platform || '') + '</td><td>' + esc(LAYOUT[c.layout] || c.layout || '') + '</td><td>' + esc(c.app_version || '') +
        '</td><td>' + esc(new Date(c.first_seen).toLocaleDateString()) + '</td><td>' + esc(ago(c.last_seen)) + '</td><td class="n">' + esc((c.minutes / 60).toFixed(1)) + '</td></tr>').join('') +
      '</tbody></table></div><p class="muted">✓ = someone signed in on that device.</p>');
}

// ------------------------------------------------------------ page
const VIEWS = [['overview', 'Overview'], ['hymns', 'Hymns and texts'], ['map', 'Map'], ['equipment', 'Equipment'], ['stories', 'Stories'], ['feedback', 'Feedback'], ['devices', 'Devices']];
async function render() {
  const body = $('#view');
  if (view === 'feedback') { feedbackView(body); return; }
  if (view === 'devices') { body.innerHTML = devicesView(stats); if (!stats) { try { stats = await cloud.rpc('admin_stats'); } catch (e) { body.innerHTML = '<p>' + esc(e.message) + '</p>'; return; } body.innerHTML = devicesView(stats); } return; }
  if (!report) { body.innerHTML = '<p class="muted">Loading…</p>'; return; }
  if (view === 'map') { mapView(report, body); return; }
  body.innerHTML = view === 'hymns' ? hymnsView(report) : view === 'equipment' ? equipmentView(report) : view === 'stories' ? storiesView(report) : overview(report);
}
async function fetchReport() {
  const [f, t] = periodOf(periodKey);
  report = null; render();
  try { report = await cloud.rpc('stats_report', { p_from: iso(f), p_to: iso(t), p_app: appKey || null }, { timeout: 60000 }); }
  catch (e) {
    $('#view').innerHTML = /not allowed/i.test(e.message) ? '<p>This account is not a maintainer.</p>'
      : /stats_report|function/i.test(e.message) ? '<p>The statistics need the latest database rules: run <code>supabase/schema.sql</code> again in Supabase → SQL Editor. (' + esc(e.message) + ')</p>'
        : '<p>' + esc(e.message) + '</p>';
    return;
  }
  $('#when').textContent = 'From ' + report.period.from + ' to ' + report.period.to + ', compared with ' + report.period.prev_from + ' to ' + report.period.prev_to + '.';
  render();
}

async function load() {
  if (!cloud.enabled()) { app.innerHTML = '<p>The ' + esc(APP_NAME) + ' cloud is not set up yet (js/core/cloud-config.js). See supabase/SETUP.md.</p>'; return; }
  await cloud.ready;
  if (!cloud.user) { signIn(); return; }
  $('#who').textContent = 'Signed in as ' + (cloud.user.email || '');
  $('#out').hidden = false;
  if (!(await cloud.checkAdmin())) { app.innerHTML = '<p>This account is not a maintainer. Add it in Supabase → SQL Editor: <code>insert into public.admins (email) values (\'' + esc(cloud.user.email) + '\');</code></p>'; return; }
  app.innerHTML = '<div class="filters"><label class="muted" for="per">Period</label><select id="per">' +
    [['30', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['90', 'Last 3 months'], ['365', 'Last 12 months']].map(([k, l]) => '<option value="' + k + '"' + (k === periodKey ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    '<label class="muted" for="appf">App</label><select id="appf"><option value="">Both apps</option><option value="sda-sabbath">SDA Sabbath</option><option value="church-service">Church Service</option></select>' +
    '<span class="muted" id="when"></span></div>' +
    '<nav class="tabs" aria-label="Sections">' + VIEWS.map(([k, l]) => '<button type="button" data-v="' + k + '" aria-pressed="' + (k === view) + '">' + l + '</button>').join('') + '</nav><div id="view"></div>';
  $('#appf').value = appKey;
  $('#per').onchange = (e) => { periodKey = e.target.value; fetchReport(); };
  $('#appf').onchange = (e) => { appKey = e.target.value; fetchReport(); };
  app.querySelectorAll('nav.tabs button').forEach((b) => { b.onclick = () => { view = b.dataset.v; app.querySelectorAll('nav.tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); }; });
  fetchReport();
}
$('#reload').onclick = () => { stats = null; if (cloud.user) fetchReport(); else load(); };
$('#out').onclick = async () => { await cloud.signOut(); location.reload(); };
load();
