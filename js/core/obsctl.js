// OBS Studio remote control through obs-websocket 5 (built into OBS 28 and newer: Tools → WebSocket Server
// Settings). Used to connect, set up the stream outputs in one click, switch scenes with what is on screen,
// and show / start the stream and the recording from SDA Sabbath. None of this is needed for the outputs
// themselves: they also work when OBS is set up by hand (copy the address into a Browser Source).
// Protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
import { emitter, debounce } from './util.js';
import { settings } from './settings.js';
import { live } from './live.js';
import { hub } from './stagehub.js';

export const LOWER_NAME = 'SDA Sabbath · Lower third';
export const FULL_NAME = 'SDA Sabbath · Slides';
const CAMERA_KINDS = /^(dshow_input|av_capture_input|macos_avcapture|v4l2_input|decklink-input|ndi_source|pipewire-camera-source)/;

export const obs = emitter({
  state: 'off',          // off | connecting | on | error | auth
  error: '', lastError: '', tries: 0, version: '',
  scenes: [], program: '', preview: '', studio: false,
  streaming: false, recording: false, streamSince: 0, recordSince: 0,
  health: null,          // {congestion, skipped, total, reconnecting}
  base: { w: 1920, h: 1080 },
  autoPaused: false,     // the operator picked a scene in OBS: following the slides pauses until the next item
});

let ws = null, want = false, retryT = null, helloT = null, wait = 3000, quiet = false;
const pending = new Map();
let reqNo = 0;

function setState(state, error) {
  obs.state = state; obs.error = error || '';
  if (error) obs.lastError = error;
  obs.emit('state', obs);
}
async function sha256b64(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  let s = ''; new Uint8Array(d).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}
const isLoopback = (host) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(host);
// Chrome (142+ for fetch, 147+ also for WebSockets) asks before a website may reach programs on this computer
// ("Local network access", called "Apps on device" from Chrome 145). If that was blocked or not answered, the
// connection fails exactly like OBS being closed — so ask the browser, and say the right thing.
async function lnaState() {
  if (location.protocol !== 'https:' || !navigator.permissions || !navigator.permissions.query) return null;
  for (const name of ['loopback-network', 'local-network-access']) {
    try { return (await navigator.permissions.query({ name })).state; } catch (e) { /* this browser does not know the name */ }
  }
  return null;
}
const LNA_BLOCKED = 'Chrome is blocking SDA Sabbath from reaching OBS on this computer. Click the site icon left of the address bar → Site settings → “Local network access” (in newer Chrome “Apps on device”) → Allow. Then press Connect again.';
const LNA_PROMPT = 'Chrome asks whether SDA Sabbath may reach programs on this computer: press Allow in the box under the address bar, then press Connect again. (Missed it? Click the site icon left of the address bar → Site settings → “Local network access” / “Apps on device” → Allow.)';

/** Send one request; resolves with responseData, rejects with OBS's own explanation. */
obs.call = (requestType, requestData) => new Promise((resolve, reject) => {
  if (!ws || ws.readyState !== 1 || obs.state !== 'on') { reject(new Error('Not connected to OBS')); return; }
  const requestId = 'r' + (++reqNo);
  const t = setTimeout(() => { pending.delete(requestId); reject(new Error(requestType + ': OBS did not answer')); }, 8000);
  pending.set(requestId, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
  ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData || {} } }));
});

/** Connect (url like ws://127.0.0.1:4455). opts.quiet: an automatic reconnect that should not report errors. */
obs.connect = (opts = {}) => new Promise(async (resolve) => { // eslint-disable-line no-async-promise-executor
  obs.disconnect(true);
  const url = String(opts.url || settings.v.stream.obsUrl || 'ws://127.0.0.1:4455').trim();
  const pass = opts.pass != null ? opts.pass : settings.v.stream.obsPass || '';
  let host = '';
  try { const u = new URL(url); host = u.hostname; if (!/^wss?:$/.test(u.protocol)) throw new Error('scheme'); }
  catch (e) { setState('error', 'That address is not valid (example: ws://127.0.0.1:4455).'); resolve(false); return; }
  // A secure page (the published site) may only open an unencrypted ws:// connection to this computer.
  if (location.protocol === 'https:' && /^ws:/i.test(url) && !isLoopback(host)) {
    setState('error', 'This page (https) cannot reach OBS on another computer directly. Either run OBS on this PC, or open SDA Sabbath from the companion on the OBS computer (http://localhost:7777) — or set OBS up by hand with the addresses below.');
    resolve(false); return;
  }
  // Android app: ws:// from https://localhost is blocked (mixed content), and 127.0.0.1 is the phone itself.
  if (window.SDA_NATIVE) { want = false; setState('error', 'Not available in the Android app yet: it cannot reach OBS on another computer (ws://). Use SDA Sabbath in Chrome on the OBS PC, or add the sources in OBS by hand with the addresses below.'); resolve(false); return; }
  want = true; quiet = !!opts.quiet;
  const lnaBefore = isLoopback(host) || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host) ? await lnaState() : null;
  if (lnaBefore === 'denied') { want = false; setState('error', LNA_BLOCKED); resolve(false); return; }
  if (!opts.quiet) obs.tries = 0;
  setState('connecting', obs.tries ? obs.lastError + ' (trying again, ' + obs.tries + ')' : '');
  let sock;
  try { sock = new WebSocket(url, 'obswebsocket.json'); }
  catch (e) { setState('error', 'Could not open ' + url + ': ' + e.message); want = false; resolve(false); return; }
  ws = sock;
  let opened = false, done = false;
  const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
  sock.onopen = () => {
    opened = true;
    // Something answered but it is not OBS 28+ (no Hello within 6 s): say so instead of waiting forever.
    clearTimeout(helloT);
    helloT = setTimeout(() => {
      if (ws !== sock || obs.state === 'on') return;
      want = false; try { sock.close(); } catch (e) { /* */ }
      setState('error', 'Something answered at ' + url + ', but it is not OBS 28+ WebSocket 5. Check the port in OBS → Tools → WebSocket Server Settings.');
      finish(false);
    }, 6000);
  };
  sock.onmessage = async (e) => {
    let m; try { m = JSON.parse(e.data); } catch (er) { return; }
    const d = m.d || {};
    try {
      if (m.op === 0) { // Hello
        clearTimeout(helloT);
        // General | Scenes | Outputs | Ui (Studio Mode)
        const ident = { rpcVersion: 1, eventSubscriptions: (1 << 0) | (1 << 2) | (1 << 6) | (1 << 10) };
        if (d.authentication) {
          if (!pass) { want = false; setState('auth', 'OBS asks for a password: OBS → Tools → WebSocket Server Settings → Show Connect Info.'); sock.close(); finish(false); return; }
          if (!(self.crypto && crypto.subtle)) { want = false; setState('error', 'This page cannot check the OBS password here (it needs https or http://localhost). Open SDA Sabbath at http://localhost on the OBS computer, or turn off authentication in OBS.'); sock.close(); finish(false); return; }
          const secret = await sha256b64(pass + d.authentication.salt);
          ident.authentication = await sha256b64(secret + d.authentication.challenge);
        }
        obs.version = d.obsWebSocketVersion || '';
        sock.send(JSON.stringify({ op: 1, d: ident }));
      } else if (m.op === 2) { // Identified
        wait = 3000; obs.tries = 0;
        setState('on');
        settings.set('stream.obsAuto', true);
        await obs.refresh().catch(() => {});
        await obs.detectSetup().catch(() => {});
        finish(true);
      } else if (m.op === 7) { // RequestResponse
        const p = pending.get(d.requestId);
        if (!p) return;
        pending.delete(d.requestId);
        if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {});
        else p.reject(new Error((d.requestStatus && (d.requestStatus.comment || 'code ' + d.requestStatus.code)) || 'OBS refused the request'));
      } else if (m.op === 5) onEvent(d.eventType, d.eventData || {});
    } catch (err) {
      want = false; try { sock.close(); } catch (x) { /* */ }
      setState('error', 'Could not talk to OBS: ' + err.message); finish(false);
    }
  };
  sock.onclose = (e) => {
    clearTimeout(helloT);
    if (ws !== sock) return;
    ws = null;
    pending.forEach((p) => p.reject(new Error('OBS connection closed'))); pending.clear();
    // 4009 wrong password; 4010 unsupported RPC version; 4011 session invalidated (kicked by OBS):
    // the spec says not to reconnect by ourselves after these.
    if (e.code === 4009) { want = false; setState('auth', 'The OBS WebSocket password is not right.'); finish(false); return; }
    if (e.code === 4010) { want = false; setState('error', 'This OBS WebSocket version is not supported (needs OBS 28 or newer).'); finish(false); return; }
    if (e.code === 4011) { want = false; setState('error', 'OBS disconnected SDA Sabbath (kicked in OBS → WebSocket Server Settings). Connect again when ready.'); finish(false); return; }
    if (!want) { setState(obs.state === 'error' || obs.state === 'auth' ? obs.state : 'off', obs.error); finish(false); return; }
    let why = opened ? 'Connection to OBS lost.' : 'OBS did not answer at ' + url + '. Is OBS open, and is “Enable WebSocket server” ticked (OBS → Tools → WebSocket Server Settings)?';
    if (!opened && lnaBefore && lnaBefore !== 'granted') why = lnaBefore === 'denied' ? LNA_BLOCKED : LNA_PROMPT;
    obs.lastError = why;
    if (!quiet && !opened) { setState('error', why); want = false; finish(false); return; }
    obs.tries++;
    setState('connecting', why + ' Trying again (' + obs.tries + ')…');
    finish(false);
    clearTimeout(retryT); retryT = setTimeout(() => obs.connect({ quiet: true }), wait); wait = Math.min(wait * 2, 30000);
  };
});
obs.disconnect = (keepWanted) => {
  if (!keepWanted) { want = false; settings.set('stream.obsAuto', false); }
  clearTimeout(retryT); clearTimeout(helloT);
  const s = ws; ws = null;
  if (s) { try { s.close(); } catch (e) { /* */ } }
  if (!keepWanted) { obs.lastError = ''; obs.tries = 0; setState('off'); }
};

obs.refresh = async () => {
  const v = await obs.call('GetVideoSettings').catch(() => null);
  if (v && v.baseWidth) obs.base = { w: v.baseWidth, h: v.baseHeight };
  const sl = await obs.call('GetSceneList');
  obs.scenes = (sl.scenes || []).slice().sort((a, b) => b.sceneIndex - a.sceneIndex).map((x) => x.sceneName);
  obs.program = sl.currentProgramSceneName || '';
  obs.preview = sl.currentPreviewSceneName || '';
  const sm = await obs.call('GetStudioModeEnabled').catch(() => null);
  obs.studio = !!(sm && sm.studioModeEnabled);
  const st = await obs.call('GetStreamStatus').catch(() => null);
  if (st) { obs.streaming = !!st.outputActive; obs.streamSince = st.outputActive ? Date.now() - (st.outputDuration || 0) : 0; }
  const rc = await obs.call('GetRecordStatus').catch(() => null);
  if (rc) { obs.recording = !!rc.outputActive; obs.recordSince = rc.outputActive ? Date.now() - (rc.outputDuration || 0) : 0; }
  pushProgram();
  obs.emit('change', obs);
};
const refreshSoon = debounce(() => obs.refresh().catch(() => {}), 200);

/** The lower third leaves out the automatic words while the presentation scene is on air (the slide already shows them). */
function pushProgram() { if (hub.setObsProgram) hub.setObsProgram(obs.state === 'on' ? obs.program : '', settings.v.stream.presScene); }

let lastAsked = '';
function onEvent(type, d) {
  if (type === 'CurrentProgramSceneChanged') {
    obs.program = d.sceneName || '';
    // A scene chosen in OBS by hand (not by us): stop following the slides until the next item goes live.
    if (obs.program && obs.program !== lastAsked && settings.v.stream.autoScene) obs.autoPaused = true;
    lastAsked = '';
    pushProgram();
    obs.emit('change', obs);
  } else if (type === 'CurrentPreviewSceneChanged') { obs.preview = d.sceneName || ''; obs.emit('change', obs); }
  else if (type === 'StudioModeStateChanged') { obs.studio = !!d.studioModeEnabled; obs.emit('change', obs); }
  else if (type === 'SceneNameChanged') {
    // Keep following a scene the operator renamed in OBS.
    const s = settings.v.stream;
    if (d.oldSceneName && d.oldSceneName === s.camScene) settings.set('stream.camScene', d.sceneName);
    if (d.oldSceneName && d.oldSceneName === s.presScene) settings.set('stream.presScene', d.sceneName);
    refreshSoon();
  } else if (/^Scene(ListChanged|Created|Removed)$/.test(type)) refreshSoon();
  else if (type === 'StreamStateChanged') { obs.streaming = !!d.outputActive; obs.streamSince = d.outputActive ? (obs.streamSince || Date.now()) : 0; if (!d.outputActive) obs.health = null; obs.emit('change', obs); }
  else if (type === 'RecordStateChanged') { obs.recording = !!d.outputActive; obs.recordSince = d.outputActive ? (obs.recordSince || Date.now()) : 0; obs.emit('change', obs); }
  else if (type === 'ExitStarted') { obs.lastError = 'OBS was closed.'; } // the connection then closes and is retried quietly
}

/** Put a scene on air. In Studio Mode it goes to Preview instead (the operator presses Transition), unless asked otherwise. */
/** Is OBS set up for SDA Sabbath (presentation scene and camera scene known)? Needed to follow the slides. */
obs.isSetUp = () => {
  const s = settings.v.stream;
  return obs.state === 'on' && !!s.camScene && !!s.presScene && obs.scenes.includes(s.camScene) && obs.scenes.includes(s.presScene);
};
/**
 * OBS was set up before (from another browser or computer): recognise it — the presentation scene exists and
 * the lower third sits in a camera scene — so following the slides works without pressing Set up again.
 */
obs.detectSetup = async () => {
  const s = settings.v.stream;
  if (!obs.scenes.includes(s.presScene)) return false;
  if (s.camScene && obs.scenes.includes(s.camScene)) return true;
  for (const sc of obs.scenes) {
    if (sc === s.presScene) continue;
    if (await itemId(sc, LOWER_NAME) != null) { settings.set('stream.camScene', sc); obs.emit('change', obs); return true; }
  }
  return false;
};

obs.setScene = (name, { program = false } = {}) => {
  if (obs.studio && !program && settings.v.stream.studioPreview !== false) return obs.call('SetCurrentPreviewScene', { sceneName: name });
  lastAsked = name;
  return obs.call('SetCurrentProgramScene', { sceneName: name });
};
obs.toggleStream = () => obs.call('ToggleStream');
obs.toggleRecord = () => obs.call('ToggleRecord');

// Stream health while live: congestion, dropped frames and reconnecting, every 5 s.
setInterval(async () => {
  if (obs.state !== 'on' || !obs.streaming) return;
  try {
    const st = await obs.call('GetStreamStatus');
    obs.health = { congestion: +st.outputCongestion || 0, skipped: st.outputSkippedFrames || 0, total: st.outputTotalFrames || 0, reconnecting: !!st.outputReconnecting };
    obs.emit('change', obs);
  } catch (e) { /* */ }
}, 5000);

// ------------------------------------------------------------ one-click set-up
/** The scene that holds a camera (webcam, capture card, NDI): the natural home for the lower third. */
obs.findCameraScene = async () => {
  for (const sc of obs.scenes) {
    if (sc === settings.v.stream.presScene) continue;
    try {
      const items = (await obs.call('GetSceneItemList', { sceneName: sc })).sceneItems || [];
      if (items.some((i) => CAMERA_KINDS.test(i.inputKind || ''))) return sc;
    } catch (e) { /* */ }
  }
  return null;
};
const newBrowserSettings = (url) => ({
  url, width: obs.base.w || 1920, height: obs.base.h || 1080, fps_custom: false, reroute_audio: false,
  restart_when_active: false, shutdown: false, css: 'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }',
});
async function itemId(sceneName, sourceName) {
  try { return (await obs.call('GetSceneItemId', { sceneName, sourceName })).sceneItemId; } catch (e) { return null; }
}
/** Make sure a source is in a scene (on top, or at the bottom), enabled or not. */
async function ensureItem(sceneName, sourceName, { bottom = false, enabled = true } = {}) {
  let id = await itemId(sceneName, sourceName);
  if (id == null) id = (await obs.call('CreateSceneItem', { sceneName, sourceName, sceneItemEnabled: enabled })).sceneItemId;
  else await obs.call('SetSceneItemEnabled', { sceneName, sceneItemId: id, sceneItemEnabled: enabled }).catch(() => {});
  try {
    const items = (await obs.call('GetSceneItemList', { sceneName })).sceneItems || [];
    await obs.call('SetSceneItemIndex', { sceneName, sceneItemId: id, sceneItemIndex: bottom ? 0 : Math.max(0, items.length - 1) }); // 0 = bottom
  } catch (e) { /* order is cosmetic */ }
  return id;
}
async function removeItem(sceneName, sourceName) {
  const id = await itemId(sceneName, sourceName);
  if (id != null) await obs.call('RemoveSceneItem', { sceneName, sceneItemId: id }).catch(() => {});
}
async function ensureInput(sceneName, inputName, url, inputs) {
  if (!inputs.includes(inputName)) {
    await obs.call('CreateInput', { sceneName, inputName, inputKind: 'browser_source', inputSettings: newBrowserSettings(url), sceneItemEnabled: true });
  } else {
    // Only the address changes: a size or custom CSS set in OBS is kept (and an unchanged page is not reloaded).
    await obs.call('SetInputSettings', { inputName, inputSettings: { url }, overlay: true });
  }
  await ensureItem(sceneName, inputName);
}
/**
 * Create (or repair) everything in OBS:
 *   "SDA Sabbath · Lower third"  browser source on top of the camera scene (and of the presentation scene)
 *   "SDA Sabbath · Presentation"  scene with "SDA Sabbath · Slides" (the slides, full screen) and — for
 *                                  "text over the camera" — the camera scene underneath.
 */
obs.setup = async ({ lowerUrl, fullUrl, camScene }) => {
  await obs.refresh();
  const s = settings.v.stream;
  const pres = (s.presScene || 'SDA Sabbath · Presentation').trim();
  const inputs = ((await obs.call('GetInputList')).inputs || []).map((i) => i.inputName);
  const scenes = obs.scenes.slice();
  if (!scenes.includes(pres)) { await obs.call('CreateScene', { sceneName: pres }); scenes.push(pres); }
  let cam = camScene && scenes.includes(camScene) && camScene !== pres ? camScene : null;
  if (!cam) { await obs.refresh(); cam = await obs.findCameraScene(); }
  if (!cam) cam = scenes.find((x) => x !== pres) || null;
  if (!cam) { cam = 'Camera'; await obs.call('CreateScene', { sceneName: cam }); }
  // The camera scene changed since last time: take the lower third out of the old one.
  if (s.camScene && s.camScene !== cam && scenes.includes(s.camScene)) await removeItem(s.camScene, LOWER_NAME);
  await ensureInput(pres, FULL_NAME, fullUrl, inputs);
  await ensureInput(cam, LOWER_NAME, lowerUrl, inputs);
  settings.set('stream.camScene', cam);
  settings.set('stream.presScene', pres);
  await obs.refresh(); // the scene list now includes the presentation scene
  await obs.applyFullBg();
  await obs.refresh();
  return { cam, pres };
};
/**
 * "Text over the camera": the camera scene goes under the slides in the presentation scene. The lower third
 * then comes along inside the camera scene, so the presentation scene's own copy is switched off (else it
 * would be drawn twice).
 */
obs.applyFullBg = async () => {
  const s = settings.v.stream;
  if (obs.state !== 'on' || !s.camScene || !s.presScene || !obs.scenes.includes(s.presScene) || !obs.scenes.includes(s.camScene)) return;
  const over = s.fullBg === 'transparent';
  await ensureItem(s.presScene, s.camScene, { bottom: true, enabled: over });
  await ensureItem(s.presScene, LOWER_NAME, { enabled: !over });
};
settings.on('change:stream', (p) => {
  if (p === 'stream.fullBg') obs.applyFullBg().catch((e) => console.warn('OBS', e));
  if (p === 'stream.presScene') pushProgram();
});

// ------------------------------------------------------------ switching scenes with what is on screen
// Slides, pictures and banners → the presentation scene. Bible verses and hymns → the camera scene, but only
// when the lower third will show their words (otherwise viewers would see neither): else the presentation
// scene. Black or nothing → the camera scene. Videos and screen sharing → as chosen (camera by default).
// Only switches between these scenes: a scene picked in OBS by hand pauses following until the next item.
function wantedScene() {
  const s = settings.v.stream;
  const c = live.cue;
  if (!c || live.blank) return s.camScene;
  const d = c.deck || {};
  const f = d.frames ? d.frames[Math.max(0, Math.min(live.index || 0, d.frames.length - 1))] : d.frame;
  const k = (f && f.kind) || d.kind;
  if (k === 'text') {
    const words = hub.overlaysOn && (c.tab === 'bible' ? s.autoBible : c.tab === 'hymns' ? s.autoHymns : s.autoOther);
    return words ? s.camScene : s.presScene;
  }
  if (k === 'image' || k === 'html' || k === 'banner') return s.presScene;
  if (k === 'video' || k === 'stream' || k === 'web' || k === 'audio') return s.mediaScene === 'presentation' ? s.presScene : s.mediaScene === 'stay' ? null : s.camScene;
  return null;
}
const autoSwitch = debounce(() => {
  const s = settings.v.stream;
  if (!s.autoScene || obs.state !== 'on' || !s.camScene || !s.presScene || obs.autoPaused) return;
  const target = wantedScene();
  const onAir = obs.studio && s.studioPreview !== false ? obs.preview : obs.program;
  if (!target || target === onAir || !obs.scenes.includes(target)) return;
  if (obs.program !== s.camScene && obs.program !== s.presScene) return;
  obs.setScene(target).catch((e) => console.warn('OBS scene', e));
}, 120);
live.on('live', () => { if (obs.autoPaused) { obs.autoPaused = false; obs.emit('change', obs); } autoSwitch(); });
live.on('go', autoSwitch);
live.on('blank', autoSwitch);
hub.on('overlay', autoSwitch);
obs.resumeAuto = () => { obs.autoPaused = false; obs.emit('change', obs); autoSwitch(); };

/** Reconnect to OBS when the app starts, if it was connected last time. */
obs.start = () => { if (settings.v.stream.obsAuto) obs.connect({ quiet: true }); };

/** Addresses of the two OBS browser sources. */
obs.urls = (ctx) => ({ lower: hub.obsUrl('lower', ctx), full: hub.obsUrl('full', ctx) });
