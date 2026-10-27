// admin.html: statistics and feedback for the Church Service maintainer (people listed in public.admins).
import { cloud } from './core/cloud.js';

const $ = (s) => document.querySelector(s);
const app = $('#app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hrs = (m) => (m / 60 >= 100 ? Math.round(m / 60) : (m / 60).toFixed(1)) + ' h';
const ago = (t) => { const d = (Date.now() - new Date(t)) / 86400000; return d < 1 ? 'today' : d < 2 ? 'yesterday' : Math.floor(d) + ' days ago'; };
const LABEL = { bible: 'Bible', hymns: 'Hymns', slides: 'Slides', video: 'Video', ai: 'Banners', web: 'Web & PC', plan: 'Plan', stream: 'Stream', stage: 'Stage' };
const LAYOUT = { p: 'Projector only', ps: 'Projector + stage', pp: 'Two projectors', pps: 'Two projectors + stage', pss: 'Projector + two stage', ppss: 'Two projectors + two stage', '': '—', '?': '—' };

function signIn(msg) {
  app.innerHTML = '<div class="card" style="max-width:460px"><h2>Sign in</h2><p class="muted">' + esc(msg || 'For the maintainer of Church Service. We email you a code.') + '</p>' +
    '<div class="row"><input id="em" type="email" placeholder="you@example.com" style="flex:1"><button class="primary" id="send" type="button">Send code</button></div>' +
    '<div class="row" id="coderow" hidden style="margin-top:10px"><input id="code" inputmode="numeric" placeholder="6-digit code"><button class="primary" id="ok" type="button">Sign in</button></div><p id="err" class="muted"></p></div>';
  const err = (t) => { $('#err').textContent = t; };
  $('#send').onclick = async () => { try { await cloud.sendCode($('#em').value); $('#coderow').hidden = false; err('Code sent. Check your email.'); $('#code').focus(); } catch (e) { err(e.message); } };
  $('#ok').onclick = async () => { try { await cloud.verifyCode($('#em').value, $('#code').value); load(); } catch (e) { err(e.message); } };
}

function bars(rows, key, { h = 140, color = 'var(--bar)', fmt = (v) => v } = {}) {
  if (!rows.length) return '<p class="muted">No data yet.</p>';
  const W = 760, max = Math.max(1, ...rows.map((r) => +r[key] || 0)), bw = W / rows.length;
  let s = '<svg viewBox="0 0 ' + W + ' ' + (h + 18) + '" width="100%" role="img">';
  rows.forEach((r, i) => {
    const v = +r[key] || 0, bh = Math.round((v / max) * h);
    s += '<rect x="' + (i * bw + 1).toFixed(1) + '" y="' + (h - bh) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + bh + '" fill="' + color + '"><title>' + esc((r.day || r.week) + ': ' + fmt(v)) + '</title></rect>';
  });
  const first = rows[0].day || rows[0].week, last = rows[rows.length - 1].day || rows[rows.length - 1].week;
  s += '<text x="0" y="' + (h + 14) + '">' + esc(first) + '</text><text x="' + W + '" y="' + (h + 14) + '" text-anchor="end">' + esc(last) + '</text>';
  s += '<text x="' + W + '" y="10" text-anchor="end">max ' + esc(fmt(max)) + '</text></svg>';
  return s;
}
function hbars(obj, names) {
  const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  if (!e.length) return '<p class="muted">No data yet.</p>';
  const max = Math.max(...e.map((x) => +x[1]));
  return e.map(([k, v]) => '<div class="hbar"><span>' + esc((names && names[k]) || k) + '</span><i style="width:' + Math.max(2, Math.round((v / max) * 260)) + 'px"></i><span>' + esc(v) + '</span></div>').join('');
}

let fbFilter = 'new';
async function feedbackBox() {
  const box = $('#fb');
  box.innerHTML = '<p class="muted">Loading…</p>';
  let rows = [];
  try { rows = await cloud.rpc('admin_feedback', { p_status: fbFilter === 'all' ? null : fbFilter }); } catch (e) { box.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; return; }
  if (!rows.length) { box.innerHTML = '<p class="muted">Nothing here.</p>'; return; }
  box.innerHTML = rows.map((r) => '<div class="fb" data-id="' + r.id + '"><div class="row"><span class="tag ' + esc(r.status) + '">' + esc(r.status) + '</span><b>' + esc(r.kind) + '</b><span class="muted">' +
    esc(new Date(r.created_at).toLocaleString()) + (r.email ? ' · ' + esc(r.email) : '') + (r.app_version ? ' · v ' + esc(r.app_version) : '') + (r.page ? ' · ' + esc(r.page) : '') + '</span></div>' +
    '<p>' + esc(r.message) + '</p>' + (r.info ? '<details><summary class="muted">Technical details</summary><pre style="white-space:pre-wrap">' + esc(JSON.stringify(r.info, null, 1)) + '</pre></details>' : '') +
    '<div class="row"><select>' + ['new', 'seen', 'planned', 'done', 'wontfix'].map((s) => '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
    '<textarea rows="1" placeholder="Reply (the sender sees it in the app when signed in)" style="flex:1;min-width:220px">' + esc(r.reply || '') + '</textarea><button type="button">Save</button></div></div>').join('');
  box.querySelectorAll('.fb button').forEach((b) => b.onclick = async () => {
    const d = b.closest('.fb');
    try { await cloud.rpc('admin_update_feedback', { p_id: +d.dataset.id, p_status: d.querySelector('select').value, p_reply: d.querySelector('textarea').value }); b.textContent = 'Saved'; setTimeout(() => { b.textContent = 'Save'; }, 1500); }
    catch (e) { alert(e.message); }
  });
}

async function load() {
  if (!cloud.enabled()) { app.innerHTML = '<p>The Church Service cloud is not set up yet (js/core/cloud-config.js). See supabase/SETUP.md.</p>'; return; }
  await cloud.ready;
  if (!cloud.user) { signIn(); return; }
  $('#who').textContent = 'Signed in as ' + (cloud.user.email || '');
  $('#out').hidden = false;
  let s;
  try { s = await cloud.rpc('admin_stats'); } catch (e) {
    if (/not allowed/i.test(e.message)) { app.innerHTML = '<p>This account is not a maintainer. Add it in Supabase: <code>insert into public.admins (email) values (\'' + esc(cloud.user.email) + '\');</code></p>'; return; }
    app.innerHTML = '<p>' + esc(e.message) + '</p>'; return;
  }
  const k = (v, label) => '<div class="kpi"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
  app.innerHTML =
    '<div class="kpis">' + k(s.installs, 'installs (devices)') + k(s.accounts, 'signed-in accounts') + k(s.active_1, 'active today') + k(s.active_7, 'active this week') +
    k(s.active_30, 'active in 30 days') + k(s.new_30, 'new in 30 days') + k(hrs(s.minutes_total), 'used in total') + k(hrs(s.minutes_30), 'used in 30 days') +
    k(hrs(s.presenting_30), 'presenting in 30 days') + k(s.feedback_new, 'new messages') + '</div>' +
    '<div class="grid2"><div class="card"><h2>Hours used per day (90 days)</h2>' + bars(s.days, 'minutes', { fmt: hrs }) + '</div>' +
    '<div class="card"><h2>Devices in use per day</h2>' + bars(s.days, 'installs', { color: 'var(--accent)' }) + '</div></div>' +
    '<div class="grid2"><div class="card"><h2>New installs per week</h2>' + bars(s.weeks, 'n', { color: 'var(--accent)' }) + '</div>' +
    '<div class="card"><h2>What goes on screen (30 days)</h2>' + hbars(s.features, LABEL) + '</div></div>' +
    '<div class="grid2"><div class="card"><h2>Screen layouts</h2>' + hbars(s.layouts, LAYOUT) + '</div><div class="card"><h2>Systems</h2>' + hbars(s.platforms) +
    '<h2 style="margin-top:12px">App versions</h2>' + hbars(s.versions) + '</div></div>' +
    '<div class="card" style="margin-bottom:12px"><h2>Churches and devices</h2><div class="scroll"><table><thead><tr><th>Church</th><th>Town</th><th>System</th><th>Layout</th><th>Version</th><th>First seen</th><th>Last seen</th><th class="n">Hours</th></tr></thead><tbody>' +
    s.churches.map((c) => '<tr><td>' + esc(c.church || '—') + (c.signed_in ? ' ✓' : '') + '</td><td>' + esc(c.town || '') + '</td><td>' + esc(c.platform || '') + '</td><td>' + esc(LAYOUT[c.layout] || c.layout || '') + '</td><td>' + esc(c.app_version || '') +
      '</td><td>' + esc(new Date(c.first_seen).toLocaleDateString()) + '</td><td>' + esc(ago(c.last_seen)) + '</td><td class="n">' + esc((c.minutes / 60).toFixed(1)) + '</td></tr>').join('') +
    '</tbody></table></div><p class="muted">✓ = someone signed in on that device.</p></div>' +
    '<div class="card"><div class="row" style="justify-content:space-between"><h2>Comments and suggestions</h2><select id="fbf">' +
    ['new', 'seen', 'planned', 'done', 'wontfix', 'all'].map((x) => '<option' + (x === fbFilter ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div><div id="fb"></div></div>';
  $('#fbf').onchange = (e) => { fbFilter = e.target.value; feedbackBox(); };
  feedbackBox();
}
$('#reload').onclick = load;
$('#out').onclick = async () => { await cloud.signOut(); location.reload(); };
load();
