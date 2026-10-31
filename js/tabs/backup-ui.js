// Settings → Backup: back up to Google Drive (or a file) and restore on another device.
import { h, clear } from '../core/util.js';
import { icon } from '../core/icons.js';
import { toggle, toast, modal, closeModal, confirmBox } from '../core/ui.js';
import { settings } from '../core/settings.js';
import { gdrive } from '../core/gdrive.js';
import { measure, buildBackup, readBackup, restoreBackup, backupName, EXT } from '../core/backup.js';

const fmt = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? Math.max(1, Math.round(n / 1048576)) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB');
const device = () => {
  const s = settings.v;
  const ua = navigator.userAgent;
  const kind = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows PC' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux PC' : 'device';
  return ((s.church && s.church.name) ? s.church.name + ', ' : '') + kind;
};

export function backupSection(box) {
  const B = () => Object.assign({ slides: true, videos: false }, settings.v.backup || {});
  const setB = (k, v) => settings.set('backup', Object.assign(B(), { [k]: v }));
  const prog = h('div.note', { role: 'status', 'aria-live': 'polite' });
  const say = (p) => { prog.textContent = p && p.text ? p.text : ''; };
  let busy = false;

  async function make() {
    const b = B();
    return buildBackup({ slides: b.slides, videos: b.videos, device: device() }, say);
  }
  const skippedNote = (st) => (st.skipped && st.skipped.length ? ' Left out (only a link to a file on this PC): ' + st.skipped.slice(0, 3).join(', ') + (st.skipped.length > 3 ? '…' : '') + '.' : '');

  async function toDrive(btn) {
    if (busy) return; busy = true; btn.disabled = true;
    try {
      await gdrive.signIn();
      paint();
      const { blob, stats } = await make();
      const name = backupName(device());
      await gdrive.upload(blob, name, (f) => say({ text: 'Uploading to Google Drive… ' + Math.round(f * 100) + '% of ' + fmt(blob.size) }));
      const at = new Date().toISOString();
      settings.set('backup', Object.assign(B(), { lastDrive: at }));
      say({ text: 'Backed up to Google Drive (' + fmt(blob.size) + ').' + skippedNote(stats) });
      toast('Backed up to Google Drive: ' + name, 'ok', 6000);
    } catch (e) { say({ text: '' }); toast(e.message, 'err', 8000); }
    busy = false; btn.disabled = false; paint(true);
  }

  async function toFile(btn) {
    if (busy) return; busy = true; btn.disabled = true;
    try {
      const { blob, stats } = await make();
      const name = backupName(device());
      const u = URL.createObjectURL(blob);
      const a = h('a', { href: u, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      settings.set('backup', Object.assign(B(), { lastFile: new Date().toISOString() }));
      say({ text: 'Saved ' + name + ' (' + fmt(blob.size) + ') to Downloads.' + skippedNote(stats) });
    } catch (e) { say({ text: '' }); toast(e.message, 'err', 8000); }
    busy = false; btn.disabled = false;
  }

  async function restore(fileOrBlob, label) {
    let pkg;
    try { pkg = await readBackup(fileOrBlob); } catch (e) { toast(e.message, 'err', 7000); return; }
    const m = pkg.manifest, st = m.stats || {};
    const what = [st.plans + ' plans', st.hymnbooks + ' hymnbooks', st.bibles + ' Bibles', st.banners + ' banners',
      m.includes && m.includes.slides ? st.slides + ' slide decks' : 'no slides', m.includes && m.includes.videos ? st.videos + ' videos' : 'no videos'].join(', ');
    const ok = await confirmBox('Restore this backup?',
      label + ' — made ' + new Date(m.made).toLocaleString() + (m.device ? ' on ' + m.device : '') + '. It holds ' + what + ', and the settings. '
      + 'Items with the same name here are replaced; everything else on this device stays. This device keeps its own screen settings. The app restarts afterwards.',
      'Restore', false);
    if (!ok) return;
    try {
      const r = await restoreBackup(pkg, say);
      toast('Restored: ' + r.plans + ' plans, ' + r.hymnbooks + ' hymnbooks, ' + r.files + ' files. Restarting…', 'ok', 4000);
      setTimeout(() => location.reload(), 1500);
    } catch (e) { toast('Could not restore: ' + e.message, 'err', 8000); }
  }

  async function fromDrive(btn) {
    if (busy) return; busy = true; btn.disabled = true;
    try {
      await gdrive.signIn();
      paint();
      const files = await gdrive.list();
      busy = false; btn.disabled = false;
      if (!files.length) { toast('No Church Service backups in this Google Drive yet. Back up on the other device first.', 'err', 7000); return; }
      const listEl = h('div.col', { style: { gap: '6px' } }, files.map((f) => h('div.row', { style: { gap: '8px', alignItems: 'center' } },
        h('span.grow', h('b', f.name.replace(EXT, '')), h('span.note', '  ' + fmt(f.size) + ' · ' + new Date(f.modifiedTime).toLocaleString())),
        h('button.btn.sm.primary', { type: 'button', onclick: async (e) => {
          e.target.disabled = true;
          try {
            const blob = await gdrive.download(f.id, (x) => say({ text: 'Downloading… ' + Math.round(x * 100) + '% of ' + fmt(f.size) }));
            closeModal();
            await restore(blob, f.name.replace(EXT, ''));
          } catch (er) { toast(er.message, 'err', 7000); e.target.disabled = false; }
        } }, 'Restore'),
        h('button.btn.sm', { type: 'button', title: 'Delete this backup from Google Drive', 'aria-label': 'Delete ' + f.name, onclick: async (e) => {
          if (!(await confirmBox('Delete this backup?', f.name + ' is removed from Google Drive.', 'Delete', true))) return;
          try { await gdrive.remove(f.id); e.target.closest('.row').remove(); } catch (er) { toast(er.message, 'err'); }
        } }, icon('trash')))));
      modal({ title: 'Restore from Google Drive', wide: true, body: h('div.col', { style: { gap: '10px' } }, h('p.note', 'Backups in “Church Service backup” in your Google Drive, newest first.'), listEl, prog), actions: [{ label: 'Close' }] });
    } catch (e) { toast(e.message, 'err', 8000); }
    busy = false; btn.disabled = false;
  }

  function paint() {
    clear(box);
    const b = B();
    const acc = gdrive.account();
    const slideSize = h('span.note'), videoSize = h('span.note');
    const slidesT = h('div', toggle('Include slides (PDF, PowerPoint, pictures)', b.slides, (v) => setB('slides', v)), slideSize);
    const videosT = h('div', toggle('Include videos and audio (can be large)', b.videos, (v) => setB('videos', v)), videoSize);
    measure().then((m) => {
      slideSize.textContent = m.slides ? m.slides + ' slide decks, about ' + fmt(m.slideBytes) : 'No slides on this device yet.';
      videoSize.textContent = m.videos ? m.videos + ' videos/audio, about ' + fmt(m.videoBytes) + (m.videosOnPc ? ' (' + m.videosOnPc + ' linked from this PC: the browser asks to read them)' : '') : 'No videos on this device yet.';
    }).catch(() => {});
    const driveBtn = h('button.btn.primary', { type: 'button' }, icon('upload'), h('span', 'Back up to Google Drive'));
    driveBtn.onclick = () => toDrive(driveBtn);
    const restoreBtn = h('button.btn', { type: 'button' }, icon('download'), h('span', 'Restore from Google Drive'));
    restoreBtn.onclick = () => fromDrive(restoreBtn);
    const fileBtn = h('button.btn', { type: 'button' }, icon('download'), h('span', 'Save a backup file'));
    fileBtn.onclick = () => toFile(fileBtn);
    const pick = h('input', { type: 'file', accept: EXT + ',.zip', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restore(f, f.name.replace(EXT, '')); } });
    const openBtn = h('button.btn', { type: 'button', onclick: () => pick.click() }, icon('upload'), h('span', 'Restore from a file'));

    box.append(
      h('p', 'Keep a copy of your settings, plans, templates, hymnbooks, imported Bibles and banners, and move them to another PC, laptop or phone.'),
      h('div.col', { style: { gap: '6px' } }, h('b', 'Always included: settings, plans, templates, hymnbooks, Bibles you added, banners and their pictures.'), slidesT, videosT),
      h('div', { style: { marginTop: '8px' } }, toggle('Remind me every day to sign in and back up (when the app is opened)', b.remind !== false, (v) => setB('remind', v))),
      gdrive.enabled()
        ? h('div.col', { style: { gap: '8px', marginTop: '10px' } },
          h('b', 'Google Drive'),
          acc ? h('p.note', 'Signed in to Google' + (acc.email ? ' as ' + acc.email : '') + '. ', h('button.btn.ghost.sm', { type: 'button', onclick: () => { gdrive.signOut(); paint(); } }, 'Sign out of Google')) : h('p.note', 'The first time, a Google window asks which account to use. Church Service only sees the backups it made, never the rest of your Drive.'),
          h('div.row.wrap', driveBtn, restoreBtn),
          b.lastDrive ? h('p.note', 'Last backup to Google Drive: ' + new Date(b.lastDrive).toLocaleString()) : null)
        : h('p.note', { style: { marginTop: '10px' } }, 'Google Drive backup is not switched on for this copy of Church Service yet (the maintainer adds a Google client id: docs/backup.md). Backup files work already.'),
      h('div.col', { style: { gap: '8px', marginTop: '10px' } },
        h('b', 'Backup file'),
        h('p.note', 'Without Google: save one ' + EXT + ' file (to a USB stick, OneDrive, WhatsApp …) and open it on the other device.'),
        h('div.row.wrap', fileBtn, openBtn, pick)),
      prog);
  }
  paint();
}

/** For the first-start setup: one button that restores from Google Drive or a file. */
export function restoreButtons() {
  const wrap = h('div.row.wrap');
  const box = h('div');
  wrap.append(h('button.btn.wrap-text', { type: 'button', onclick: () => { modal({ title: 'Restore a backup', wide: true, body: box, actions: [{ label: 'Close' }] }); backupSection(box); } },
    icon('download'), h('span', 'Moving from another device? Restore a backup')));
  return wrap;
}
