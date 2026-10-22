// OBS Studio remote control through obs-websocket 5 (built into OBS 28 and newer: Tools → WebSocket Server
// Settings). Used for the one-click set-up of the stream outputs, switching scenes with what is on screen,
// and showing / starting the stream and the recording from SDA Sabbath. Nothing here is needed for the
// outputs themselves: they also work when OBS is set up by hand (copy the address into a Browser Source).
import { emitter, debounce } from './util.js';
import { settings } from './settings.js';
import { live } from './live.js';
import { hub } from './stagehub.js';

export const LOWER_NAME = 'SDA Sabbath · Lower third';
export const FULL_NAME = 'SDA Sabbath · Slides';

export const obs = emitter({
  state: 'off',          // off | connecting | on | error | auth
  error: '', version: '',
  scenes: [], program: '',
  streaming: false, recording: false, streamSince: 0, recordSince: 0,
  base: { w: 1920, h: 1080 },
});

let ws = null, want = false, retryT = null, wait = 3000, quiet = false;
const pending = new Map();
let reqNo = 0;

function setState(state, error) {
  obs.state = state; obs.error = error || '';
  obs.emit('state', obs);
}
async function sha256b64(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  let s = ''; new Uint8Array(d).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

/** Send one request; resolves with responseData, rejects with OBS's own explanation. */
obs.call = (requestType, requestData) => new Promise((resolve, reject) => {
  if (!ws || ws.readyState !== 1 || obs.state !== 'on') { reject(new Error('Not connected to OBS')); return; }
  const requestId = 'r' + (++reqNo);
  const t = setTimeout(() => { pending.delete(requestId); reject(new Error(requestType + ': OBS did not answer')); }, 8000);
  pending.set(requestId, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
  ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData || {} } }));
});

/** Connect (url like ws://127.0.0.1:4455). opts.quiet: an automatic reconnect that should not report errors. */
obs.connect = (opts = {}) => new Promise((resolve) => {
  obs.disconnect(true);
  const url = String(opts.url || settings.v.stream.obsUrl || 'ws://127.0.0.1:4455').trim();
  const pass = opts.pass != null ? opts.pass : settings.v.stream.obsPass || '';
  want = true; quiet = !!opts.quiet;
  setState('connecting');
  let sock;
  try { sock = new WebSocket(url, 'obswebsocket.json'); }
  catch (e) { setState('error', 'That address is not valid (example: ws://127.0.0.1:4455).'); want = false; resolve(false); return; }
  ws = sock;
  let opened = false, done = false;
  const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
  sock.onopen = () => { opened = true; };
  sock.onmessage = async (e) => {
    let m; try { m = JSON.parse(e.data); } catch (er) { return; }
    const d = m.d || {};
    if (m.op === 0) { // Hello
      const ident = { rpcVersion: 1, eventSubscriptions: (1 << 0) | (1 << 2) | (1 << 6) }; // General, Scenes, Outputs
      if (d.authentication) {
        if (!pass) { setState('auth', 'OBS asks for a password: OBS → Tools → WebSocket Server Settings → Show Connect Info.'); want = false; sock.close(); finish(false); return; }
        const secret = await sha256b64(pass + d.authentication.salt);
        ident.authentication = await sha256b64(secret + d.authentication.challenge);
      }
      obs.version = d.obsWebSocketVersion || '';
      sock.send(JSON.stringify({ op: 1, d: ident }));
    } else if (m.op === 2) { // Identified
      wait = 3000;
      setState('on');
      settings.set('stream.obsAuto', true);
      await obs.refresh().catch(() => {});
      finish(true);
    } else if (m.op === 7) { // RequestResponse
      const p = pending.get(d.requestId);
      if (!p) return;
      pending.delete(d.requestId);
      if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {});
      else p.reject(new Error((d.requestStatus && (d.requestStatus.comment || 'code ' + d.requestStatus.code)) || 'OBS refused the request'));
    } else if (m.op === 5) onEvent(d.eventType, d.eventData || {});
  };
  sock.onclose = (e) => {
    if (ws !== sock) return;
    ws = null;
    pending.forEach((p) => p.reject(new Error('OBS connection closed'))); pending.clear();
    if (e.code === 4009) { setState('auth', 'The OBS WebSocket password is not right.'); want = false; finish(false); return; }
    if (!opened && !quiet) setState('error', 'OBS did not answer at ' + url + '. Is OBS open, and is “Enable WebSocket server” ticked (OBS → Tools → WebSocket Server Settings)?');
    else setState(want ? 'connecting' : 'off', want && opened ? 'Connection to OBS lost — trying again…' : '');
    finish(false);
    if (want) { clearTimeout(retryT); retryT = setTimeout(() => obs.connect({ quiet: true }), wait); wait = Math.min(wait * 2, 30000); }
  };
});
obs.disconnect = (keepWanted) => {
  if (!keepWanted) { want = false; settings.set('stream.obsAuto', false); }
  clearTimeout(retryT);
  const s = ws; ws = null;
  if (s) { try { s.close(); } catch (e) { /* */ } }
  if (!keepWanted) setState('off');
};

obs.refresh = async () => {
  const v = await obs.call('GetVideoSettings').catch(() => null);
  if (v && v.baseWidth) obs.base = { w: v.baseWidth, h: v.baseHeight };
  const sl = await obs.call('GetSceneList');
  obs.scenes = (sl.scenes || []).slice().sort((a, b) => b.sceneIndex - a.sceneIndex).map((x) => x.sceneName);
  obs.program = sl.currentProgramSceneName || '';
  const st = await obs.call('GetStreamStatus').catch(() => null);
  if (st) { obs.streaming = !!st.outputActive; obs.streamSince = st.outputActive ? Date.now() - (st.outputDuration || 0) : 0; }
  const rc = await obs.call('GetRecordStatus').catch(() => null);
  if (rc) { obs.recording = !!rc.outputActive; obs.recordSince = rc.outputActive ? Date.now() - (rc.outputDuration || 0) : 0; }
  obs.emit('change', obs);
};
const refreshSoon = debounce(() => obs.refresh().catch(() => {}), 200);

function onEvent(type, d) {
  if (type === 'CurrentProgramSceneChanged') { obs.program = d.sceneName || ''; obs.emit('change', obs); }
  else if (/^Scene(ListChanged|Created|Removed|NameChanged)$/.test(type)) refreshSoon();
  else if (type === 'StreamStateChanged') { obs.streaming = !!d.outputActive; obs.streamSince = d.outputActive ? (obs.streamSince || Date.now()) : 0; obs.emit('change', obs); }
  else if (type === 'RecordStateChanged') { obs.recording = !!d.outputActive; obs.recordSince = d.outputActive ? (obs.recordSince || Date.now()) : 0; obs.emit('change', obs); }
  else if (type === 'ExitStarted') { setState(want ? 'connecting' : 'off', 'OBS was closed.'); }
}

obs.setScene = (name) => obs.call('SetCurrentProgramScene', { sceneName: name });
obs.toggleStream = () => obs.call('ToggleStream');
obs.toggleRecord = () => obs.call('ToggleRecord');

// ------------------------------------------------------------ one-click set-up
const browserSettings = (url) => ({
  url, width: obs.base.w || 1920, height: obs.base.h || 1080, fps_custom: false, reroute_audio: false,
  restart_when_active: false, shutdown: false, css: 'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }',
});
async function ensureItem(sceneName, sourceName) {
  let id;
  try { id = (await obs.call('GetSceneItemId', { sceneName, sourceName })).sceneItemId; }
  catch (e) { id = (await obs.call('CreateSceneItem', { sceneName, sourceName, sceneItemEnabled: true })).sceneItemId; }
  // Overlays go on top of everything else in the scene.
  try {
    const items = (await obs.call('GetSceneItemList', { sceneName })).sceneItems || [];
    await obs.call('SetSceneItemIndex', { sceneName, sceneItemId: id, sceneItemIndex: Math.max(0, items.length - 1) });
  } catch (e) { /* order is cosmetic */ }
  return id;
}
async function ensureInput(sceneName, inputName, url, inputs) {
  if (!inputs.includes(inputName)) {
    await obs.call('CreateInput', { sceneName, inputName, inputKind: 'browser_source', inputSettings: browserSettings(url), sceneItemEnabled: true });
    await ensureItem(sceneName, inputName); // moves it to the top
  } else {
    await obs.call('SetInputSettings', { inputName, inputSettings: browserSettings(url), overlay: true });
    await ensureItem(sceneName, inputName);
  }
}
/**
 * Create (or update) everything in OBS:
 *   "SDA Sabbath · Lower third"  browser source on the camera scene (and on the presentation scene)
 *   "SDA Sabbath · Presentation"  scene with "SDA Sabbath · Slides" (the slides, full screen)
 * camScene: the scene with the camera ('' = the scene showing now).
 */
obs.setup = async ({ lowerUrl, fullUrl, camScene }) => {
  await obs.refresh();
  const s = settings.v.stream;
  const pres = (s.presScene || 'SDA Sabbath · Presentation').trim();
  const inputs = ((await obs.call('GetInputList')).inputs || []).map((i) => i.inputName);
  let scenes = obs.scenes.slice();
  if (!scenes.includes(pres)) { await obs.call('CreateScene', { sceneName: pres }); scenes.push(pres); }
  let cam = camScene && scenes.includes(camScene) ? camScene : (s.camScene && scenes.includes(s.camScene) ? s.camScene : obs.program !== pres ? obs.program : scenes.find((x) => x !== pres));
  if (!cam) { cam = 'Camera'; await obs.call('CreateScene', { sceneName: cam }); }
  await ensureInput(pres, FULL_NAME, fullUrl, inputs);
  await ensureInput(cam, LOWER_NAME, lowerUrl, inputs);
  await ensureItem(pres, LOWER_NAME); // names and the ticker also show over slides
  settings.set('stream.camScene', cam);
  settings.set('stream.presScene', pres);
  await obs.refresh();
  return { cam, pres };
};

// ------------------------------------------------------------ switching scenes with what is on screen
// Slides, pictures and banners → the presentation scene. Bible verses, hymns and other text → the camera
// scene (the lower third carries the words). Black or nothing → the camera scene. Videos and screen
// sharing leave the scene as it is. Only switches between those two scenes: any other scene chosen in
// OBS (a pre-service loop, an ending card) is never taken off air.
function wantedScene() {
  const s = settings.v.stream;
  const c = live.cue;
  if (!c || live.blank) return s.camScene;
  const d = c.deck || {};
  const f = d.frames ? d.frames[Math.max(0, Math.min(live.index || 0, d.frames.length - 1))] : d.frame;
  const k = (f && f.kind) || d.kind;
  if (k === 'text') return s.camScene;
  if (k === 'image' || k === 'html' || k === 'banner') return s.presScene;
  return null;
}
const autoSwitch = debounce(() => {
  const s = settings.v.stream;
  if (!s.autoScene || obs.state !== 'on' || !s.camScene || !s.presScene) return;
  const target = wantedScene();
  if (!target || target === obs.program || !obs.scenes.includes(target)) return;
  if (obs.program !== s.camScene && obs.program !== s.presScene) return;
  obs.setScene(target).catch((e) => console.warn('OBS scene', e));
}, 120);
live.on('live', autoSwitch);
live.on('go', autoSwitch);
live.on('blank', autoSwitch);

/** Reconnect to OBS when the app starts, if it was connected last time. */
obs.start = () => { if (settings.v.stream.obsAuto) obs.connect({ quiet: true }); };

/** Addresses of the two OBS browser sources. */
obs.urls = (ctx) => ({ lower: hub.obsUrl('lower', ctx), full: hub.obsUrl('full', ctx) });
