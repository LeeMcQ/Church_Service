// Offline readiness: one badge in the top bar that always says whether Church Service can run with no internet,
// and a panel (tap the badge) with the self-check, storage protection, the waiting update and the USB fallback.
//
//   ✔ Ready offline      every app file is stored (green)
//   Saving… 45 %         the first download or an update is still running (amber)
//   ⚠ 12 files missing    something is not stored; tap to repair (red)
//   Update ready         a complete new version is waiting; it is put in place only when allowed (blue dot)
//
// Updates are held during the Sabbath (Friday midday to Saturday night) unless the operator applies them, so a
// new version can never change the app in the middle of a service.
import { h, clear } from './util.js';
import { icon } from './icons.js';

/** Friday 12:00 until Saturday 23:59, local time: the hours an update must never arrive on its own. */
export function inServiceHold(now = new Date()) {
  const d = now.getDay();
  return (d === 5 && now.getHours() >= 12) || d === 6;
}

/** May a waiting update be put in place without asking? mode: 'sabbath' (default) | 'ask' | 'auto'. */
export function autoUpdateAllowed(mode, live, now = new Date()) {
  if (live && (live.cue || live.staged)) return false; // never with something on screen or ready to show
  if (mode === 'ask') return false;
  if (mode === 'auto') return true;
  return !inServiceHold(now);
}

async function persisted() {
  try { return !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); } catch (e) { return false; }
}

/**
 * deps: { ui, settings, persistStorage, checkOffline(repair), applyUpdate(), getWaiting() }
 * Returns { el, paint, open } — el goes into the top bar.
 */
export function readinessBadge(ctx, deps) {
  const { ui } = deps;
  const el = h('button.ready-mark', { type: 'button', 'aria-live': 'polite', title: 'Offline readiness: tap for details' });
  let lastCheck = 0;
  let state = 'checking';

  function compute() {
    const prog = ctx.cacheProgress;
    const hh = ctx.offlineHealth;
    const waiting = deps.getWaiting();
    if (prog && prog.total > 1 && prog.done < prog.total) return { s: 'saving', t: 'Saving… ' + Math.floor(prog.done / prog.total * 100) + ' %' };
    if (hh && hh.missingCount > 0) return { s: 'bad', t: '⚠ ' + hh.missingCount + ' files missing' };
    if (waiting) return { s: 'update', t: 'Update ready' };
    if (hh && hh.total) return { s: 'ok', t: navigator.onLine ? '✔ Ready offline' : '✔ Offline · all stored' };
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return { s: 'bad', t: 'Not stored offline' };
    return { s: 'checking', t: navigator.onLine ? 'Checking…' : 'Offline' };
  }
  function paint() {
    const c = compute();
    state = c.s;
    el.className = 'ready-mark rm-' + c.s;
    el.textContent = c.t;
  }

  async function open() {
    deps.checkOffline(navigator.onLine);
    lastCheck = Date.now();
    const body = h('div.rm-panel');
    const fill = async () => {
      const hh = ctx.offlineHealth;
      const waiting = deps.getWaiting();
      const prot = await persisted();
      const hold = inServiceHold();
      const mode = (deps.settings.v.app.updates) || 'sabbath';
      const row = (ok, title, text, action) => h('div.rm-row', h('span.rm-ic' + (ok === true ? '.ok' : ok === false ? '.bad' : '.wait'), ok === true ? '✔' : ok === false ? '✖' : ok === 'info' ? 'i' : '…'),
        h('div', h('b', title), h('div.note', text)), action || null);
      clear(body);
      body.append(
        row(hh ? hh.missingCount === 0 : null, 'App files stored on this device',
          hh ? (hh.have + ' of ' + hh.total + ' files' + (hh.version ? ' · version ' + hh.version : '') + (hh.missingCount ? ' — ' + hh.missingCount + ' missing' + (navigator.onLine ? ', fetching them now' : '. Connect to the internet once to finish') : ''))
            : 'Checking…',
          h('button.btn.sm', { type: 'button', onclick: () => { deps.checkOffline(true); lastCheck = Date.now(); setTimeout(fill, 1500); } }, icon('check'), 'Check & repair')),
        row(prot, 'Protected from automatic clean-up', prot ? 'The browser will not delete Church Service’s files when the disk gets full.' : 'The browser may delete stored files when the disk is nearly full. Installing Church Service usually allows protection.',
          prot ? null : h('button.btn.sm', { type: 'button', onclick: async () => { const ok = await deps.persistStorage(); ui.toast(ok ? 'Protected.' : 'The browser has not allowed it yet. Install Church Service first.', ok ? 'ok' : ''); fill(); } }, 'Protect')),
        row(true, navigator.onLine ? 'Internet: connected' : 'Internet: offline', navigator.onLine ? 'Not needed for the service. Only online Bibles and lyrics, AI, YouTube and sharing over the internet use it.' : 'Everything stored on this device keeps working.'),
        row(waiting ? null : true, waiting ? 'An update is ready' : 'No update waiting',
          waiting ? (hold && mode !== 'auto' ? 'It is held until after the Sabbath so nothing changes during a service. Apply it now only if nothing is on screen.' : 'It is fully downloaded. Applying it restarts the app (a second or two).')
            : 'Updates download completely in the background and never replace a working version half-way.',
          waiting ? h('button.btn.sm' + (hold ? '' : '.primary'), { type: 'button', onclick: async () => {
            if (hold && !(await ui.confirmBox('Apply the update now?', 'It is the Sabbath. Only apply it if nothing is being shown and the service has not started.', 'Apply now'))) return;
            deps.applyUpdate();
          } }, icon('reload'), 'Apply now') : null),
        row('info', 'Emergency copy on a USB stick', 'Put the Windows companion program on a USB stick: it contains the whole app and runs on any PC without internet or the browser’s stored copy.',
          h('a.btn.sm', { href: 'companion.html#usb', target: '_blank', rel: 'noopener' }, icon('download'), 'How')),
        h('p.note', { style: { marginTop: '8px' } }, 'Checked ' + new Date(lastCheck).toLocaleTimeString() + '. Before every Sabbath: open the app, check this panel shows all ticks, then test it once with the internet switched off.'));
    };
    fill();
    const onH = () => fill();
    window.addEventListener('selah-health', onH);
    ui.modal({ title: 'Offline readiness', body, onclose: () => window.removeEventListener('selah-health', onH) });
  }

  el.addEventListener('click', open);
  ['selah-health', 'selah-cache', 'selah-update', 'online', 'offline'].forEach((e) => window.addEventListener(e, paint));
  paint();
  return { el, paint, open, state: () => state };
}
