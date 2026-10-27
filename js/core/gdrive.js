// Google Drive for backups: sign in with Google (a pop-up, no Google script loaded into the app) and keep
// backup files in an "SDA Sabbath backup" folder in the person's own Drive. The permission asked for is
// "drive.file": the app sees only the files it created itself, never the rest of the Drive.
// Needs a Google OAuth client id in js/core/cloud-config.js (googleClientId); see docs/backup.md.
import { CLOUD } from './cloud-config.js';
import { lsKey } from './storens.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = lsKey('gdrive.token');
const FOLDER = 'SDA Sabbath backup';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export const gdrive = {
  enabled: () => !!(CLOUD.googleClientId || '').trim(),
  /** The signed-in Google account, or null. */
  account: () => { const t = saved(); return t ? { email: t.email || '' } : null; },
  signIn, signOut, list, upload, download, remove,
};

function saved() {
  try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); return t && t.access_token && t.exp > Date.now() + 60000 ? t : null; } catch (e) { return null; }
}
function signOut() {
  const t = saved();
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* */ }
  if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.access_token), { method: 'POST' }).catch(() => {});
}

/** Sign in (a Google window opens). Must be called from a click. Resolves with {email}. */
function signIn() {
  const old = saved();
  if (old) return Promise.resolve({ email: old.email || '' });
  if (!gdrive.enabled()) return Promise.reject(new Error('Google Drive is not set up for this copy of SDA Sabbath yet (see docs/backup.md).'));
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const redirect = new URL('oauth.html', location.href).href.split('?')[0];
  const u = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: CLOUD.googleClientId.trim(), redirect_uri: redirect, response_type: 'token', scope: SCOPE + ' email',
    include_granted_scopes: 'true', prompt: 'select_account', state,
  });
  try { sessionStorage.setItem(lsKey('gdrive.state'), state); localStorage.setItem(lsKey('gdrive.state'), state); } catch (e) { /* */ }
  const win = window.open(u, 'sda-google', 'popup=yes,width=520,height=680');
  if (!win) return Promise.reject(new Error('The browser blocked the Google window. Allow pop-ups for this site and try again.'));
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = async (data) => {
      if (finished) return;
      if (!data || data.state !== state) return;
      finished = true; cleanup();
      if (data.error) { reject(new Error(data.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in failed: ' + data.error)); return; }
      const t = { access_token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000, email: '' };
      try {
        const r = await fetch(API + '/about?fields=user(emailAddress,displayName)', { headers: { Authorization: 'Bearer ' + t.access_token } });
        const j = await r.json();
        t.email = (j.user && (j.user.emailAddress || j.user.displayName)) || '';
      } catch (e) { /* the email is only shown, not needed */ }
      try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch (e) { /* */ }
      resolve({ email: t.email });
    };
    // oauth.html answers by postMessage (desktop pop-up) or, when the phone opened it as a separate tab,
    // through localStorage, which this page hears as a "storage" event.
    const onMsg = (e) => { if (e.origin === location.origin && e.data && e.data.t === 'google-token') finish(e.data); };
    const onStore = (e) => { if (e.key === 'selah.gdrive.reply' && e.newValue) { try { finish(JSON.parse(e.newValue)); } catch (er) { /* */ } } };
    const poll = setInterval(() => {
      try { const v = localStorage.getItem(lsKey('gdrive.reply')); if (v) finish(JSON.parse(v)); } catch (e) { /* */ }
    }, 700);
    const timeout = setTimeout(() => { if (!finished) { finished = true; cleanup(); reject(new Error('Google sign-in took too long. Try again.')); } }, 5 * 60000);
    function cleanup() {
      window.removeEventListener('message', onMsg); window.removeEventListener('storage', onStore);
      clearInterval(poll); clearTimeout(timeout);
      try { localStorage.removeItem(lsKey('gdrive.reply')); localStorage.removeItem(lsKey('gdrive.state')); } catch (e) { /* */ }
    }
    window.addEventListener('message', onMsg);
    window.addEventListener('storage', onStore);
  });
}

async function token() {
  const t = saved();
  if (t) return t.access_token;
  await signIn();
  return saved().access_token;
}
async function api(path, opts = {}) {
  const r = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + (await token()) }, opts.headers || {}) }));
  if (r.status === 401) { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* */ } throw new Error('Google sign-in expired. Press the button again.'); }
  if (!r.ok) throw new Error('Google Drive: ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return r.status === 204 ? null : r.json();
}

let folderId = null;
async function folder() {
  if (folderId) return folderId;
  const q = "mimeType='application/vnd.google-apps.folder' and name='" + FOLDER + "' and trashed=false";
  const j = await api('/files?' + new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' }));
  if (j.files && j.files.length) return (folderId = j.files[0].id);
  const f = await api('/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }) });
  return (folderId = f.id);
}

/** Backups in the Drive folder, newest first: [{id, name, size, modifiedTime}]. */
async function list() {
  const j = await api('/files?' + new URLSearchParams({ q: "name contains 'SDA Sabbath backup' and mimeType!='application/vnd.google-apps.folder' and trashed=false",
    orderBy: 'modifiedTime desc', fields: 'files(id,name,size,modifiedTime)', pageSize: '50' }));
  return (j.files || []).map((f) => Object.assign(f, { size: Number(f.size) || 0 }));
}

/** XHR for upload/download progress (fetch has none for uploads). */
function xhr(method, url, { headers = {}, body = null, type = '', onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
    if (type) x.responseType = type;
    if (onProgress) { (method === 'GET' ? x : x.upload).onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); }; }
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(x) : reject(new Error('Google Drive: ' + x.status + (x.status === 401 ? ' (sign in again)' : ''))));
    x.onerror = () => reject(new Error('The connection to Google Drive was lost.'));
    x.send(body);
  });
}

/** Upload a backup Blob into the folder (resumable upload: works for big files). Returns the file id. */
async function upload(blob, name, onProgress) {
  const tk = await token();
  const parent = await folder();
  const start = await fetch(UPLOAD + '/files?uploadType=resumable&fields=id', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(blob.size) },
    body: JSON.stringify({ name, parents: [parent], mimeType: 'application/zip', description: 'SDA Sabbath backup. Restore it in SDA Sabbath: Settings → Backup.' }),
  });
  if (!start.ok) throw new Error('Google Drive: ' + start.status + ' ' + (await start.text()).slice(0, 160));
  const loc = start.headers.get('Location');
  if (!loc) throw new Error('Google Drive did not accept the upload.');
  const x = await xhr('PUT', loc, { headers: { 'Content-Type': 'application/zip' }, body: blob, onProgress });
  try { return JSON.parse(x.responseText).id; } catch (e) { return ''; }
}

async function download(id, onProgress) {
  const x = await xhr('GET', API + '/files/' + encodeURIComponent(id) + '?alt=media', { headers: { Authorization: 'Bearer ' + (await token()) }, type: 'blob', onProgress });
  return x.response;
}

async function remove(id) { await api('/files/' + encodeURIComponent(id), { method: 'DELETE' }); }
