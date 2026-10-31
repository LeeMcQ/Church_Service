// The backup reminder: at start-up the app asks to sign in to Google and back up, and asks again whenever it is
// opened more than 24 hours after the last time it asked. Never during a service (nothing may be on screen), never
// over another dialog, and not when a backup to Google Drive was made in the last 24 hours. "Remind me every day"
// in Settings → Backup switches it off.
// Without a Google client id (js/core/cloud-config.js) Google sign-in is not possible yet: the reminder then offers
// a backup file, which always works.
import { h } from './core/util.js';
import { icon } from './core/icons.js';
import { settings } from './core/settings.js';
import { gdrive } from './core/gdrive.js';
import { live } from './core/live.js';
import { buildBackup, backupName } from './core/backup.js';

const DAY = 24 * 60 * 60 * 1000;
const appName = () => { const m = document.querySelector('meta[name=application-name]'); return (m && m.content) || 'this app'; };
const B = () => Object.assign({ slides: true, videos: false, remind: true, remindAt: 0 }, settings.v.backup || {});
const setB = (o) => settings.set('backup', Object.assign(B(), o));
const fmt = (n) => (n >= 1048576 ? Math.max(1, Math.round(n / 1048576)) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB');
const device = () => {
  const s = settings.v, ua = navigator.userAgent;
  const kind = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows PC' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux PC' : 'device';
  return ((s.church && s.church.name) ? s.church.name + ', ' : '') + kind;
};
function ago(iso) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  if (!(d >= 0)) return '';
  const days = Math.floor(d / DAY);
  if (days >= 2) return days + ' days ago';
  if (days === 1) return 'yesterday';
  const hrs = Math.floor(d / 3600000);
  return hrs >= 1 ? hrs + ' hour' + (hrs === 1 ? '' : 's') + ' ago' : 'less than an hour ago';
}

/** Is a reminder due now? */
export function reminderDue(now = Date.now()) {
  const b = B();
  if (b.remind === false || !settings.v.app.setupDone) return false;
  if (now - (+b.remindAt || 0) < DAY) return false;
  const lastDrive = b.lastDrive ? new Date(b.lastDrive).getTime() : 0;
  if (gdrive.account() && now - lastDrive < DAY) return false; // signed in and backed up today
  return true;
}

export function startBackupReminder({ ui }) {
  let shown = false;
  async function backUpDrive(btn, status) {
    btn.disabled = true;
    try {
      status.textContent = 'Signing in to Google…';
      await gdrive.signIn();                       // from this click, so the Google window may open
      const b = B();
      status.textContent = 'Preparing the backup…';
      const { blob } = await buildBackup({ slides: b.slides, videos: b.videos, device: device() }, (p) => { if (p && p.text) status.textContent = p.text; });
      const name = backupName(device());
      await gdrive.upload(blob, name, (f) => { status.textContent = 'Uploading to Google Drive… ' + Math.round(f * 100) + '% of ' + fmt(blob.size); });
      setB({ lastDrive: new Date().toISOString() });
      ui.closeModal();
      ui.toast('Backed up to Google Drive (' + fmt(blob.size) + '). The next reminder comes in 24 hours.', 'ok', 6000);
    } catch (e) { status.textContent = ''; btn.disabled = false; ui.toast(e.message, 'err', 8000); }
  }
  async function backUpFile(btn, status) {
    btn.disabled = true;
    try {
      const b = B();
      status.textContent = 'Preparing the backup…';
      const { blob } = await buildBackup({ slides: b.slides, videos: b.videos, device: device() }, (p) => { if (p && p.text) status.textContent = p.text; });
      const name = backupName(device());
      const u = URL.createObjectURL(blob);
      const a = h('a', { href: u, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      setB({ lastFile: new Date().toISOString() });
      ui.closeModal();
      ui.toast('Saved ' + name + ' (' + fmt(blob.size) + ') to Downloads. Keep it on a USB stick or in the cloud.', 'ok', 7000);
    } catch (e) { status.textContent = ''; btn.disabled = false; ui.toast(e.message, 'err', 8000); }
  }

  function show() {
    if (shown) return;
    shown = true;
    setB({ remindAt: Date.now() });               // "every time it is opened after 24 hours": counted from now
    const b = B();
    const acc = gdrive.account();
    const status = h('p.note.bn-status', { role: 'status', 'aria-live': 'polite' });
    const last = b.lastDrive ? 'Last backup to Google Drive: ' + ago(b.lastDrive) + '.' : b.lastFile ? 'Last backup file: ' + ago(b.lastFile) + '.' : 'There is no backup of this device yet.';
    const goBtn = h('button.btn.primary', { type: 'button' }, icon('upload'), h('span', gdrive.enabled() ? (acc ? 'Back up now' : 'Sign in with Google & back up') : 'Save a backup file'));
    goBtn.onclick = () => (gdrive.enabled() ? backUpDrive(goBtn, status) : backUpFile(goBtn, status));
    const body = h('div.col.bn', { style: { gap: '10px' } },
      h('p', 'Back up your plans, hymnbooks, Bibles, banners, slides and settings, so nothing is lost if this ' + (/Android|iPhone|iPad/i.test(navigator.userAgent) || matchMedia('(max-width: 760px)').matches ? 'phone' : 'PC') + ' breaks or is replaced. You can restore the backup on any other device.'),
      gdrive.enabled()
        ? h('p.bn-acc', acc ? h('span', icon('check'), ' Signed in to Google' + (acc.email ? ' as ' + acc.email : '') + '.') : h('span', 'Sign in with your Google account (or the church’s). ' + appName() + ' only sees the backups it makes, never the rest of your Drive.'))
        : h('p.note', 'Google sign-in is not switched on for this copy yet, so the backup is saved as a file. Keep it on a USB stick, OneDrive or WhatsApp.'),
      h('p.note', last),
      h('div.row.wrap', goBtn),
      status,
      h('p.note', 'This reminder comes once a day. Switch it off in Settings → Backup.'));
    ui.modal({ title: gdrive.enabled() ? 'Sign in to back up' : 'Back up this device', body, actions: [{ label: 'Not now' }] });
  }

  // Ask once the app has settled, and only while nothing is on screen and no other dialog is open.
  let timer = 0;
  function tryShow(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (shown || !reminderDue()) return;
      if (live.cue || ui.modalOpen() || document.hidden) { tryShow(30000); return; }
      show();
    }, delay);
  }
  if (settings.v.app.setupDone) tryShow(2500);
  else settings.on('change:app', (p) => { if (p === 'app.setupDone' && settings.v.app.setupDone) tryShow(2500); });
  // A PC left open for days: ask again when it is next looked at after 24 hours.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && reminderDue()) { shown = false; tryShow(1500); } });
  return { show: () => { shown = false; show(); }, due: reminderDue };
}
