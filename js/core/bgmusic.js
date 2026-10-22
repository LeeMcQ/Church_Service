// Banner music: background music that plays with banners and the pre-service loop.
//
// The list lives in the app's database (music files are stored offline). Each piece is one of:
//   file  – an audio file kept on this device (MP3, M4A/AAC, WAV, OGG, Opus, FLAC, WebM, the sound of MP4
//           videos …; AIFF is converted to WAV when it is added)
//   midi  – a MIDI file, played by the app's own synthesizer (the hymn instruments)
//   url   – an online audio file or an internet radio stream (Icecast / Shoutcast / direct MP3 or AAC)
//   hls   – an HLS stream (.m3u8)
//   list  – a radio playlist file (.m3u / .pls) that points to a stream
//   youtube / soundcloud – played in a small player window (their own player, as their terms require)
//   web   – Spotify, Apple Music, Deezer … : opened in their own window (they cannot be played inside apps)
//
// Rules (Settings in Banners & Music → Music): music starts when a banner or the pre-service loop goes on
// screen, and fades out when something else (hymn, Bible, video …) goes on screen.
import { emitter, uid } from './util.js';
import { db } from './db.js';
import { settings } from './settings.js';
import { live } from './live.js';
import { bgAudio } from './audio.js';

export const bgMusic = emitter({ tracks: [], current: null, ready: null });

const OWNER = 'music';
const save = () => db.put('kv', 'banner-music', bgMusic.tracks).catch(() => {});
const S = () => settings.v.bannerMusic || {};

export const KIND_LABEL = {
  file: 'Music file', midi: 'MIDI', url: 'Online audio', hls: 'Live stream (HLS)', list: 'Radio playlist',
  youtube: 'YouTube', soundcloud: 'SoundCloud', web: 'Opens in its own window',
};
/** Pieces that can play by themselves in the background (not Spotify & co.). */
export const playable = (t) => t && t.kind !== 'web';

bgMusic.ready = (async () => {
  const raw = await db.get('kv', 'banner-music').catch(() => null);
  bgMusic.tracks = Array.isArray(raw) ? raw.filter((t) => t && t.id && KIND_LABEL[t.kind]) : [];
  bgMusic.emit('change');
})();

// ------------------------------------------------------------------ adding music
const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|wav|wave|ogg|oga|opus|flac|webm|weba|mp4|m4v|mov|mkv|3gp|caf|aif|aiff|aifc|mid|midi|kar|wma|amr|ape|ra|rm|ac3|dts|alac)$/i;
export const ACCEPT = 'audio/*,video/mp4,video/webm,video/quicktime,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm,.mp4,.mov,.mkv,.aif,.aiff,.mid,.midi,.kar,.wma,.amr';

/** AIFF (big-endian PCM) → WAV, which every browser plays. */
async function aiffToWav(blob) {
  const b = new DataView(await blob.arrayBuffer());
  const tag = (o) => String.fromCharCode(b.getUint8(o), b.getUint8(o + 1), b.getUint8(o + 2), b.getUint8(o + 3));
  if (tag(0) !== 'FORM' || !/^AIF[FC]$/.test(tag(8))) throw new Error('not an AIFF file');
  let ch = 0, bits = 0, rate = 0, data = null, len = 0, o = 12;
  while (o + 8 <= b.byteLength) {
    const id = tag(o), size = b.getUint32(o + 4);
    if (id === 'COMM') {
      ch = b.getUint16(o + 8); bits = b.getUint16(o + 14);
      // 80-bit extended float sample rate
      const exp = b.getUint16(o + 16) & 0x7fff, hi = b.getUint32(o + 18);
      rate = Math.round(hi * Math.pow(2, exp - 16383 - 31));
      if (tag(8) === 'AIFC' && size >= 22 && !/^(NONE|sowt)$/.test(tag(o + 26))) throw new Error('compressed AIFF is not supported');
      if (tag(8) === 'AIFC' && size >= 22 && tag(o + 26) === 'sowt') bits = -bits; // already little-endian
    } else if (id === 'SSND') { const off = b.getUint32(o + 8); data = o + 16 + off; len = size - 8 - off; }
    o += 8 + size + (size & 1);
  }
  const bytesPer = Math.abs(bits) / 8;
  if (!ch || !rate || data == null || ![1, 2, 3, 4].includes(bytesPer)) throw new Error('unsupported AIFF');
  const out = new DataView(new ArrayBuffer(44 + len));
  const w = (p, s) => { for (let i = 0; i < 4; i++) out.setUint8(p + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * ch * bytesPer, true); out.setUint16(32, ch * bytesPer, true); out.setUint16(34, bytesPer * 8, true);
  w(36, 'data'); out.setUint32(40, len, true);
  for (let i = 0; i < len; i += bytesPer) {
    for (let k = 0; k < bytesPer; k++) {
      let v = b.getUint8(data + i + (bits < 0 ? k : bytesPer - 1 - k));
      if (bytesPer === 1 && k === 0) v ^= 0x80; // 8-bit AIFF is signed, 8-bit WAV unsigned
      out.setUint8(44 + i + k, v);
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/** Can this browser play the file? Resolves with its duration, or rejects with a reason. */
function probe(src, ms = 9000) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = 'metadata';
    let done = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(t); a.removeAttribute('src'); a.load(); fn(v); };
    const t = setTimeout(() => end(reject, new Error('timeout')), ms);
    a.onloadedmetadata = () => end(resolve, isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => end(reject, new Error('format'));
    a.src = src;
  });
}

const titleOf = (name) => String(name || 'Music').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Music';

/** Add music files. Returns {added, failed: [{name, why}]}. */
bgMusic.addFiles = async (files, onProgress) => {
  await bgMusic.ready;
  const added = [], failed = [];
  let i = 0;
  for (const f of files) {
    i++;
    if (onProgress) onProgress(f.name, i, files.length);
    const isMidi = /\.(mid|midi|kar)$/i.test(f.name) || /midi/.test(f.type);
    if (!isMidi && !/^(audio|video)\//.test(f.type) && !AUDIO_EXT.test(f.name)) { failed.push({ name: f.name, why: 'not a music file' }); continue; }
    let blob = f, type = f.type || '', dur = 0;
    try {
      if (/\.(aif|aiff|aifc)$/i.test(f.name) || /aiff/.test(type)) { blob = await aiffToWav(f); type = 'audio/wav'; }
      if (!isMidi) {
        const u = URL.createObjectURL(blob);
        try { dur = await probe(u); } finally { URL.revokeObjectURL(u); }
      }
    } catch (e) {
      const ext = (f.name.match(/\.([^.]+)$/) || [])[1] || '';
      failed.push({ name: f.name, why: e.message === 'format' || e.message === 'timeout'
        ? (ext ? ext.toUpperCase() + ' files' : 'This file') + ' cannot be played by web browsers. Save it as MP3, M4A or WAV first (for example with the free Audacity or VLC).'
        : e.message });
      continue;
    }
    const fileId = 'mus-' + uid();
    await db.put('files', fileId, { id: fileId, kind: 'music-file', name: f.name, type: type || (isMidi ? 'audio/midi' : ''), size: blob.size, blob, added: Date.now() });
    const t = { id: 'm-' + uid(), kind: isMidi ? 'midi' : 'file', title: titleOf(f.name), fileId, size: blob.size, type, dur, on: true, added: Date.now() };
    bgMusic.tracks.push(t);
    added.push(t);
  }
  await save();
  bgMusic.emit('change');
  return { added, failed };
};

/** What kind of link is this? {kind, url, ytId, ytList, why} */
export function linkInfo(raw) {
  let s = String(raw || '').trim();
  if (!s) return { why: 'Paste a link.' };
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return { why: 'That is not a web link.' }; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (/(^|\.)youtube\.com$|^youtu\.be$|^youtube-nocookie\.com$/.test(host)) {
    let id = u.searchParams.get('v') || '';
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/) || (host === 'youtu.be' && u.pathname.match(/^\/([\w-]{11})/));
    if (m) id = m[1];
    const list = u.searchParams.get('list') || '';
    if (!id && !list) return { why: 'That YouTube link has no video or playlist in it.' };
    return { kind: 'youtube', url: u.href, ytId: /^[\w-]{11}$/.test(id) ? id : '', ytList: /^[\w-]+$/.test(list) ? list : '' };
  }
  if (/(^|\.)soundcloud\.com$|^on\.soundcloud\.com$/.test(host)) return { kind: 'soundcloud', url: u.href };
  if (/(^|\.)spotify\.com$|(^|\.)apple\.com$|(^|\.)deezer\.com$|(^|\.)tidal\.com$|(^|\.)amazon\.[a-z.]+$|(^|\.)audiomack\.com$|(^|\.)boomplay\.com$/.test(host)) return { kind: 'web', url: u.href };
  if (/\.m3u8(\?|$)/i.test(u.pathname + u.search)) return { kind: 'hls', url: u.href };
  if (/\.(m3u|pls)$/i.test(u.pathname)) return { kind: 'list', url: u.href };
  return { kind: 'url', url: u.href };
}

/** Add an online link. Checks plain audio links and streams before keeping them. */
bgMusic.addLink = async (raw, title) => {
  await bgMusic.ready;
  const info = linkInfo(raw);
  if (!info.kind) throw new Error(info.why);
  if (/^http:/i.test(info.url) && location.protocol === 'https:') {
    throw new Error('This link starts with http://. Browsers block it on a secure page. Use the https:// address of the stream (most radio stations have one).');
  }
  let dur = 0;
  if (info.kind === 'url') {
    try { dur = await probe(info.url, 12000); }
    catch (e) { throw new Error(e.message === 'timeout' ? 'The link did not answer. Check the internet connection and the address.' : 'That link is not music the browser can play (it may be a web page). Use the direct audio or stream address, or a YouTube / SoundCloud link.'); }
  }
  let name = (title || '').trim();
  if (!name) {
    const u = new URL(info.url);
    name = info.kind === 'youtube' ? 'YouTube ' + (info.ytList && !info.ytId ? 'playlist' : 'music')
      : info.kind === 'soundcloud' ? 'SoundCloud: ' + decodeURIComponent(u.pathname.split('/').filter(Boolean).slice(-1)[0] || '').replace(/-/g, ' ')
        : titleOf(decodeURIComponent(u.pathname.split('/').filter(Boolean).slice(-1)[0] || u.hostname));
  }
  const t = { id: 'm-' + uid(), kind: info.kind, title: name, url: info.url, ytId: info.ytId || '', ytList: info.ytList || '', dur, on: info.kind !== 'web', added: Date.now() };
  bgMusic.tracks.push(t);
  await save();
  bgMusic.emit('change');
  return t;
};

bgMusic.update = async (id, patch) => {
  const t = bgMusic.tracks.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  await save(); bgMusic.emit('change');
};
bgMusic.remove = async (id) => {
  const t = bgMusic.tracks.find((x) => x.id === id);
  if (!t) return;
  if (bgMusic.current && bgMusic.current.id === id) bgAudio.stop();
  bgMusic.tracks = bgMusic.tracks.filter((x) => x !== t);
  if (t.fileId) await db.del('files', t.fileId).catch(() => {});
  await save(); bgMusic.emit('change');
};
bgMusic.move = async (id, to) => {
  const i = bgMusic.tracks.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [t] = bgMusic.tracks.splice(i, 1);
  bgMusic.tracks.splice(Math.max(0, Math.min(to, bgMusic.tracks.length)), 0, t);
  await save(); bgMusic.emit('change');
};

// ------------------------------------------------------------------ players
let midiEng = null;
async function midiEngine() {
  if (!midiEng) {
    const { MusicEngine } = await import('./musicengine.js');
    midiEng = new MusicEngine();
  }
  return midiEng;
}

let hls = null;
function dropHls() { if (hls) { try { hls.destroy(); } catch (e) { /* */ } hls = null; } }

/** Radio playlist (.m3u / .pls) → the first stream address in it. */
async function resolveList(url) {
  let text;
  try { text = await (await fetch(url)).text(); }
  catch (e) { throw new Error('Could not read the radio playlist. Open it in Notepad and add the stream address (https://…) instead.'); }
  const m = text.match(/^(?:File\d+=)?\s*(https?:\/\/\S+)/im);
  if (!m) throw new Error('No stream address found in that playlist.');
  return m[1].trim();
}

// The small floating player for YouTube / SoundCloud (their players must stay visible).
let mini = null;
function miniPlayer() {
  if (mini) return mini;
  const head = document.createElement('div'); head.className = 'emb-head';
  const ttl = document.createElement('span'); ttl.className = 'emb-title';
  const small = document.createElement('button'); small.type = 'button'; small.className = 'emb-btn'; small.title = 'Smaller / larger'; small.textContent = '▭';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'emb-btn'; close.title = 'Stop the music'; close.textContent = '✕';
  head.append(ttl, small, close);
  const box = document.createElement('div'); box.className = 'emb-mini'; box.hidden = true;
  const frameBox = document.createElement('div'); frameBox.className = 'emb-frame';
  box.append(head, frameBox);
  document.body.appendChild(box);
  small.onclick = () => box.classList.toggle('tiny');
  close.onclick = () => bgAudio.stop();
  mini = { box, ttl, frameBox };
  return mini;
}

/** YouTube / SoundCloud player controlled with postMessage (no outside scripts needed). */
function embedPlayer(t, vol) {
  const m = miniPlayer();
  m.frameBox.textContent = '';
  m.ttl.textContent = t.title;
  const fr = document.createElement('iframe');
  fr.allow = 'autoplay; encrypted-media';
  fr.referrerPolicy = 'strict-origin-when-cross-origin';
  fr.title = t.title;
  let src, origin;
  if (t.kind === 'youtube') {
    origin = 'https://www.youtube-nocookie.com';
    const q = 'enablejsapi=1&autoplay=1&playsinline=1&rel=0&origin=' + encodeURIComponent(location.origin) + (t.ytList ? '&list=' + t.ytList : '');
    src = origin + '/embed/' + (t.ytId || 'videoseries') + '?' + q;
  } else {
    origin = 'https://w.soundcloud.com';
    src = origin + '/player/?url=' + encodeURIComponent(t.url) + '&auto_play=true&visual=false&show_comments=false&hide_related=true&show_teaser=false';
  }
  fr.src = src;
  m.frameBox.appendChild(fr);
  m.box.hidden = false;
  const st = { paused: false, time: 0, dur: 0, vol, fading: false, gone: false };
  const send = (o) => { try { fr.contentWindow.postMessage(t.kind === 'youtube' ? JSON.stringify(o) : JSON.stringify(o), origin); } catch (e) { /* */ } };
  const yt = (func, args = []) => send({ event: 'command', func, args });
  const sc = (method, value) => send(value == null ? { method } : { method, value });
  const setVol = (v) => { st.vol = v; if (t.kind === 'youtube') yt('setVolume', [Math.round(v * 100)]); else sc('setVolume', Math.round(v * 100)); };
  let failT = null;
  const onMsg = (e) => {
    if (e.source !== fr.contentWindow) return;
    let d = e.data;
    try { if (typeof d === 'string') d = JSON.parse(d); } catch (er) { return; }
    if (!d) return;
    if (t.kind === 'youtube') {
      if (d.event === 'onReady' || d.event === 'initialDelivery') setVol(st.vol);
      if (d.event === 'onError') { clearTimeout(failT); failed('YouTube will not play this one inside other apps (the owner blocked it).'); return; }
      const inf = d.info || {};
      if (typeof inf.currentTime === 'number') st.time = inf.currentTime;
      if (typeof inf.duration === 'number' && inf.duration > 0) st.dur = inf.duration;
      if (typeof inf.playerState === 'number') {
        if (inf.playerState === 1) { st.paused = false; clearTimeout(failT); }
        if (inf.playerState === 2) st.paused = true;
        if (inf.playerState === 0 && !st.fading) { player.stop(); bgAudio.externalEnded(player); }
      }
    } else {
      if (d.method === 'ready') { ['finish', 'playProgress', 'play', 'pause', 'error'].forEach((ev) => sc('addEventListener', ev)); setVol(st.vol); sc('play'); sc('getDuration'); }
      if (d.method === 'getDuration' && d.value) st.dur = d.value / 1000;
      if (d.method === 'playProgress' && d.value) { st.time = d.value.currentPosition / 1000; clearTimeout(failT); }
      if (d.method === 'play') { st.paused = false; clearTimeout(failT); }
      if (d.method === 'pause') st.paused = true;
      if (d.method === 'error') { failed('SoundCloud could not play this link.'); return; }
      if (d.method === 'finish' && !st.fading) { player.stop(); bgAudio.externalEnded(player); }
    }
    bgAudio.refresh();
  };
  const failed = (why) => { if (st.gone) return; bgMusic.emit('error', { track: t, why }); player.stop(); bgAudio.externalEnded(player); };
  window.addEventListener('message', onMsg);
  fr.onload = () => { if (t.kind === 'youtube') { send({ event: 'listening', id: 1, channel: 'widget' }); setTimeout(() => setVol(st.vol), 600); } };
  // Nothing heard after a while (blocked, offline …): say so, so the playlist can carry on.
  failT = setTimeout(() => { if (!st.time && !st.paused) bgMusic.emit('notice', { track: t, text: 'Still loading ' + t.title + '… If nothing plays, press play in the small player, or check the internet connection.' }); }, 9000);
  let fadeT = null;
  const player = {
    toggle() { st.paused = !st.paused; if (t.kind === 'youtube') yt(st.paused ? 'pauseVideo' : 'playVideo'); else sc(st.paused ? 'pause' : 'play'); },
    stop() {
      if (st.gone) return;
      st.gone = true; clearInterval(fadeT); clearTimeout(failT);
      window.removeEventListener('message', onMsg);
      fr.src = 'about:blank'; fr.remove();
      if (mini && !mini.frameBox.querySelector('iframe')) mini.box.hidden = true;
    },
    fade(ms) {
      st.fading = true;
      const from = st.vol, t0 = Date.now();
      clearInterval(fadeT);
      fadeT = setInterval(() => { const k = Math.min(1, (Date.now() - t0) / ms); setVol(from * (1 - k)); if (k >= 1) clearInterval(fadeT); }, 120);
    },
    paused: () => st.paused, time: () => st.time, dur: () => st.dur, volume: () => st.vol, setVolume: setVol,
  };
  return player;
}

const MIDI_GAIN = 1.6; // the synthesizer's level that matches ordinary music files
/** MIDI through the synthesizer, wrapped for bgAudio. */
async function midiPlayer(t, vol, bytes) {
  const eng = await midiEngine();
  eng.unlock();
  let st = { paused: false, time: 0, dur: 0 }, fading = false, gone = false;
  const offS = eng.on('state', (s) => { st = { paused: !!s.paused, time: s.time || 0, dur: s.dur || 0 }; bgAudio.refresh(); });
  const offE = eng.on('ended', () => { if (!fading && !gone) { cleanup(); bgAudio.externalEnded(player); } });
  const cleanup = () => { gone = true; offS(); offE(); };
  const player = {
    toggle: () => eng.toggle(), stop: () => { if (!gone) { cleanup(); eng.stop(); } }, fade: (ms) => { fading = true; eng.fade(ms); },
    paused: () => st.paused, time: () => st.time, dur: () => st.dur, volume: () => eng.volume / MIDI_GAIN, setVolume: (v) => eng.setVolume(v * MIDI_GAIN),
  };
  await eng.playMidi(bytes, { title: t.title, volume: vol * MIDI_GAIN });
  return player;
}

// ------------------------------------------------------------------ playlist
let order = [], pos = -1, fails = 0, playToken = null, hlsToken = null;
const queue = { next: () => bgMusic.next(), prev: () => bgMusic.prev() };

function buildOrder(startId) {
  const list = bgMusic.tracks.filter((t) => t.on !== false && playable(t));
  if (S().shuffle) for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  if (startId) {
    const t = bgMusic.tracks.find((x) => x.id === startId);
    if (t) { const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); list.unshift(t); }
  }
  order = list; pos = 0;
}

bgMusic.isPlaying = () => bgAudio.active && bgAudio.owner === OWNER;

/** Start banner music (the list, or one piece first). fadeIn: start softly (with a banner). */
bgMusic.start = async (startId, { fadeIn = false } = {}) => {
  await bgMusic.ready;
  const t0 = startId && bgMusic.tracks.find((x) => x.id === startId);
  if (t0 && t0.kind === 'web') { window.open(t0.url, 'selah-music', 'noopener'); bgMusic.emit('notice', { track: t0, text: t0.title + ' opened in its own window. Control it there (these services do not allow other apps to play their music).' }); return false; }
  buildOrder(startId);
  if (!order.length) { bgMusic.emit('notice', { text: 'No banner music yet. Add music in Banners & Music → Music.' }); return false; }
  fails = 0;
  return playAt(0, fadeIn);
};

async function playAt(i, fadeIn) {
  pos = i;
  const t = order[i];
  if (!t) return false;
  const vol = S().volume != null ? S().volume : 0.7;
  const token = {};
  playToken = token;
  // Runs when something else takes over the speakers (or Stop): only this playback's own tidy-up.
  const release = () => { if (hlsToken === token) dropHls(); if (playToken === token) { playToken = null; bgMusic.current = null; bgMusic.emit('now', null); } };
  bgMusic.current = t;
  bgMusic.emit('now', t);
  try {
    if (t.kind === 'youtube' || t.kind === 'soundcloud') {
      bgAudio.useExternal(embedPlayer(t, vol), t.title, { owner: OWNER, onRelease: release, queue });
    } else if (t.kind === 'midi') {
      const rec = await db.get('files', t.fileId);
      if (!rec || !rec.blob) throw new Error('The MIDI file is missing on this device.');
      const p = await midiPlayer(t, vol, new Uint8Array(await rec.blob.arrayBuffer()));
      if (playToken !== token) { p.stop(); return false; }
      bgAudio.useExternal(p, t.title, { owner: OWNER, onRelease: release, queue });
    } else {
      let src = null, attach = null, isLive = false;
      if (t.kind === 'file') {
        const rec = await db.get('files', t.fileId);
        if (!rec || !rec.blob) throw new Error('The music file is missing on this device.');
        src = rec.blob;
      } else {
        let url = t.url;
        if (t.kind === 'list') url = await resolveList(url);
        isLive = !t.dur;
        const needHls = t.kind === 'hls' || /\.m3u8(\?|$)/i.test(url);
        if (needHls && !bgAudio.el.canPlayType('application/vnd.apple.mpegurl')) {
          const Hls = (await import('../../vendor/hls/hls.light.min.js')).default;
          if (!Hls.isSupported()) throw new Error('This browser cannot play HLS streams.');
          attach = (el) => { dropHls(); hlsToken = token; hls = new Hls({ lowLatencyMode: false }); hls.loadSource(url); hls.attachMedia(el); hls.on(Hls.Events.ERROR, (ev, d) => { if (d && d.fatal) bgMusic.emit('error', { track: t, why: 'The stream stopped (' + (d.details || 'network') + ').' }); }); };
          isLive = true;
        } else src = url;
      }
      await bgAudio.play(src, t.title, { owner: OWNER, onRelease: release, queue, live: isLive, attach, volume: fadeIn ? 0 : vol }).catch((e) => {
        if (e && e.name === 'NotAllowedError') throw new Error('The browser wants a click first: press Play in Banners & Music → Music.');
        if (e && e.name !== 'AbortError') throw e;
      });
      if (fadeIn) bgAudio.fadeIn(vol, 2000);
    }
    fails = 0;
    return true;
  } catch (e) {
    bgMusic.emit('error', { track: t, why: e.message || String(e) });
    if (++fails < order.length && playToken === token) setTimeout(() => { if (playToken === token) advance(1); }, 800);
    else if (playToken === token) { playToken = null; bgMusic.current = null; bgMusic.emit('now', null); }
    return false;
  }
}

function advance(dir) {
  if (!order.length) return;
  const rep = S().repeat || 'all';
  let i = pos + dir;
  if (i >= order.length) { if (rep !== 'all') { bgAudio.stop(); return; } if (S().shuffle) buildOrder(); i = 0; }
  if (i < 0) i = rep === 'all' ? order.length - 1 : 0;
  playAt(i, false);
}
bgMusic.next = () => { if (bgMusic.isPlaying() || order.length) advance(1); };
bgMusic.prev = () => { if (bgMusic.isPlaying() || order.length) advance(-1); };

bgAudio.on('ended', (owner) => {
  if (owner !== OWNER) return;
  if ((S().repeat || 'all') === 'one' && order[pos]) { playAt(pos, false); return; }
  advance(1);
});
bgAudio.on('error', () => {
  if (bgAudio.owner !== OWNER || !bgMusic.current) return;
  const t = bgMusic.current;
  bgMusic.emit('error', { track: t, why: 'This one could not be played' + (t.kind === 'file' ? '.' : ' (the link may be offline).') });
  if (++fails < order.length) setTimeout(() => { if (bgMusic.current === t) advance(1); }, 800);
});
bgAudio.on('state', () => bgMusic.emit('state'));
bgAudio.on('stopped', () => { order = []; pos = -1; });

bgMusic.setVolume = (v) => {
  settings.set('bannerMusic.volume', Math.max(0, Math.min(1, v)));
  if (bgMusic.isPlaying()) bgAudio.volume(v);
};
bgMusic.stop = () => { if (bgMusic.isPlaying()) bgAudio.stop(); };
bgMusic.fadeOut = () => { if (bgMusic.isPlaying()) bgAudio.fadeOut((S().fadeSec || 3) * 1000); };

// ------------------------------------------------------------------ with the banners
// A banner or the pre-service loop going on screen starts the music; anything else fades it out.
live.on('live', (cue) => {
  const s = S();
  if (cue && cue.withMusic) {
    if (s.auto && !bgMusic.isPlaying() && !(bgAudio.active && bgAudio.owner === 'video')) bgMusic.start(null, { fadeIn: true });
  } else if (cue && s.fade && bgMusic.isPlaying()) bgMusic.fadeOut();
});
