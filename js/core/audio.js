// Background audio (offering music, backing tracks, banner music). Plays on the control device so the
// display can keep showing lyrics or announcements at the same time.
//
// One player at a time. An owner ('video' or 'music') plays through the built-in <audio> element, or
// hands over an external player (MIDI synthesizer, YouTube / SoundCloud player) with useExternal().
// The control bar shows whichever is playing, with Next / Previous when the owner has a playlist.
import { emitter } from './util.js';

const el = new Audio();
el.preload = 'auto';
let url = null, fadeT = null, ext = null, release = null, fadingOut = false;

export const bgAudio = emitter({ el, title: '', active: false, owner: null, queue: null, live: false });

function state() {
  const x = ext;
  bgAudio.emit('state', {
    title: bgAudio.title, owner: bgAudio.owner, active: bgAudio.active, live: bgAudio.live,
    time: x ? x.time() : el.currentTime, dur: x ? x.dur() : (isFinite(el.duration) ? el.duration : 0),
    paused: x ? x.paused() : el.paused, vol: x ? x.volume() : el.volume, loop: el.loop, queue: !!bgAudio.queue,
  });
}
bgAudio.refresh = state;
['play', 'pause', 'ended', 'volumechange', 'loadedmetadata'].forEach((e) => el.addEventListener(e, () => { if (!ext) state(); }));
let last = 0;
el.addEventListener('timeupdate', () => { const n = Date.now(); if (!ext && n - last > 400) { last = n; state(); } });
el.addEventListener('ended', () => {
  if (ext || el.loop) return;
  if (fadingOut) { bgAudio.stop(); return; } // finished while fading out: just stop, no next piece
  bgAudio.active = false; state(); bgAudio.emit('ended', bgAudio.owner);
});
el.addEventListener('error', () => { if (!ext && bgAudio.active) bgAudio.emit('error', el.error); });

/** Another owner (or Stop) takes over: let the previous one tidy up (HLS, playlists …). */
function handOver() {
  clearInterval(fadeT); fadeT = null; fadingOut = false;
  if (release) { const r = release; release = null; try { r(); } catch (e) { /* */ } }
  if (ext) { const x = ext; ext = null; try { x.stop(); } catch (e) { /* */ } }
  if (url) { URL.revokeObjectURL(url); url = null; }
}

/**
 * src: URL or Blob. opts.owner names who plays (its 'ended' / Next go back to it); opts.onRelease runs when
 * something else takes over; opts.queue = {next, prev} shows Next / Previous in the control bar;
 * opts.attach(el) attaches a source itself (HLS) instead of setting el.src.
 */
bgAudio.play = (src, title, { loop = false, volume, owner = 'video', onRelease = null, queue = null, live = false, attach = null } = {}) => {
  handOver();
  el.pause();
  if (attach) attach(el);
  else el.src = typeof src === 'string' ? src : (url = URL.createObjectURL(src));
  el.loop = loop;
  if (volume != null) el.volume = Math.max(0, Math.min(1, volume));
  bgAudio.title = title || 'Audio';
  bgAudio.owner = owner; bgAudio.queue = queue; bgAudio.live = !!live;
  release = onRelease;
  bgAudio.active = true;
  const p = el.play();
  state();
  return p;
};

/** An external player: {toggle, stop, fade(ms), paused(), time(), dur(), volume(), setVolume(v)}. */
bgAudio.useExternal = (player, title, { owner = 'music', onRelease = null, queue = null, live = false } = {}) => {
  handOver();
  el.pause(); el.removeAttribute('src'); el.load();
  ext = player; release = onRelease;
  bgAudio.title = title || 'Audio'; bgAudio.owner = owner; bgAudio.queue = queue; bgAudio.live = !!live;
  bgAudio.active = true;
  state();
};
/** The external player finished its piece. */
bgAudio.externalEnded = (player) => { if (ext !== player) return; bgAudio.active = false; state(); bgAudio.emit('ended', bgAudio.owner); };
bgAudio.isExternal = (player) => ext === player;

bgAudio.toggle = () => { if (ext) { ext.toggle(); state(); return; } if (el.paused) el.play().catch(() => {}); else el.pause(); };
bgAudio.pause = () => { if (ext) { if (!ext.paused()) ext.toggle(); state(); return; } el.pause(); };
bgAudio.stop = () => {
  handOver();
  el.pause(); bgAudio.active = false; bgAudio.queue = null; bgAudio.live = false;
  el.removeAttribute('src'); el.load(); state();
  bgAudio.emit('stopped');
};
bgAudio.seek = (t) => { if (!ext) el.currentTime = t; };
bgAudio.volume = (v) => { v = Math.max(0, Math.min(1, v)); if (ext) ext.setVolume(v); else el.volume = v; state(); };
bgAudio.getVolume = () => (ext ? ext.volume() : el.volume);
bgAudio.loop = (on) => { el.loop = !!on; state(); };
bgAudio.fadeOut = (ms = 3000) => {
  if (!bgAudio.active) return;
  if (ext) { const x = ext; x.fade(ms); setTimeout(() => { if (ext === x) bgAudio.stop(); }, ms + 80); return; }
  clearInterval(fadeT);
  fadingOut = true;
  const start = el.volume, t0 = Date.now();
  fadeT = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / ms);
    el.volume = start * (1 - k);
    if (k >= 1) { clearInterval(fadeT); fadeT = null; el.pause(); el.volume = start; fadingOut = false; bgAudio.stop(); }
  }, 50);
};
/** Fade the built-in element up from silence (music starting with a banner). */
bgAudio.fadeIn = (to, ms = 1500) => {
  if (ext) { ext.setVolume(to); return; }
  clearInterval(fadeT);
  el.volume = 0;
  const t0 = Date.now();
  fadeT = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / ms);
    el.volume = to * k;
    if (k >= 1) { clearInterval(fadeT); fadeT = null; }
  }, 50);
};
