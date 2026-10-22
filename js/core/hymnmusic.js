// Hymn music controller: what the Hymns tab and control bar talk to. Plays on this device, or
// on the display (the church PC) when this device is a phone remote connected through the companion.
import { emitter, debounce } from './util.js';
import { settings } from './settings.js';
import { link } from './link.js';
import { db } from './db.js';
import { MusicEngine, loadIndex, planSegments, INSTRUMENTS } from './musicengine.js';

export { INSTRUMENTS, planSegments };

// ------------------------------------------------------------------ controller (UI side)
export const music = emitter({ state: { playing: false }, where: 'here', hymnKey: null, entryInfo: null });
let local = null;

function wantRemote() {
  const o = settings.v.hymns.musicOutput || 'auto';
  if (o === 'here') return false;
  if (o === 'display') return !!link.ready;
  return link.kind === 'socket' && link.ready; // a phone controlling the church PC: sound comes from the PC
}

function bindLocal() {
  if (local) return local;
  local = new MusicEngine();
  local.on('state', (s) => { if (music.where === 'here') setState(s); });
  local.on('slide', (i) => { if (music.where === 'here') music.emit('slide', { key: music.hymnKey, slide: i }); });
  local.on('ended', () => { if (music.where === 'here') music.emit('ended'); });
  return local;
}
link.on('msg', (m) => {
  if (music.where !== 'display') return;
  if (m.t === 'music-state') setState(m.s);
  else if (m.t === 'music-slide') music.emit('slide', { key: music.hymnKey, slide: m.slide });
  else if (m.t === 'music-ended') music.emit('ended');
  else if (m.t === 'music-error') { setState({ playing: false }); music.emit('error', new Error(m.text)); }
});

function setState(s) { music.state = s; music.emit('state', s); }

let extraP = null;
const extraIndex = () => extraP || (extraP = fetch('data/music/extra.json').then((r) => (r.ok ? r.json() : null)).catch(() => null));

/** Index entry for a hymn (or null when there is no music for it). Checks custom MIDI first. */
music.entry = async (book, n) => {
  // Custom MIDI assigned via the lyrics finder takes priority.
  const custom = await db.get('files', 'midi:' + book + ':' + n).catch(() => null);
  if (custom && custom.blob) {
    return { f: 'custom', tune: custom.name || 'Custom', ok: false, custom: true, blob: custom.blob };
  }
  const idx = await loadIndex();
  const b = idx && idx.books[book];
  const found = (b && b.hymns[String(n)]) || null;
  if (found) return found;
  // Single MIDI files shipped with the app for hymns the main packs don't cover (data/music/extra.json).
  const ex = await extraIndex();
  const x = ex && ex[book] && ex[book][String(n)];
  if (x) {
    if (!x.blob) { try { const r = await fetch('data/music/' + x.f); if (r.ok) x.blob = await r.blob(); } catch (e) { /* offline and not cached yet */ } }
    if (x.blob) return { f: 'custom', tune: x.tune, ok: false, custom: true, bundled: true, blob: x.blob };
  }
  return null;
};
music.hasBook = async (book) => { const idx = await loadIndex(); return !!(idx && idx.books[book]); };

/** Call first thing in a click/tap handler: browsers only allow sound to start from a user action. */
music.unlock = () => { if (!wantRemote()) { try { bindLocal().unlock(); } catch (e) { /* reported on play */ } } };

/** Start the music for a hymn. opts: {book, hy, sung, cards, hymnKey, title} */
music.play = async (opts) => {
  music.unlock();
  const m = settings.v.hymns;
  const entry = await music.entry(opts.book, opts.hy.n);
  if (!entry) throw new Error('There is no music for hymn ' + opts.hy.n + ' yet.');
  const segs = planSegments(entry, opts.hy, opts.sung, opts.cards, { intro: m.musicIntro !== false });
  const req = {
    book: opts.book, n: opts.hy.n, title: opts.title || opts.hy.t, segs,
    instrument: m.musicInstrument || 'arranged', rate: (m.musicTempo || 100) / 100, key: m.musicKey || 0,
    volume: m.musicVolume == null ? 1.3 : m.musicVolume,
    fx: { reverb: m.musicReverb == null ? 59 : m.musicReverb, chorus: m.musicChorus == null ? 43 : m.musicChorus },
    light: settings.lowPower(),
    entry: entry.custom ? entry : null,   // a MIDI file added by the user or shipped in data/music/extra
  };
  music.hymnKey = opts.hymnKey;
  music.entryInfo = entry;
  music.structured = !!segs;
  if (wantRemote()) {
    music.where = 'display';
    if (local && local.playing) local.stop();
    link.send({ t: 'music', op: 'play', req });
    setState({ playing: true, paused: false, time: 0, dur: 0, n: req.n, title: req.title, loading: true, section: null, sections: [] });
    return;
  }
  if (music.where === 'display' && music.state.playing) link.send({ t: 'music', op: 'stop' });
  music.where = 'here';
  const eng = bindLocal();
  eng.unlock(); // inside the click
  setState(Object.assign({}, music.state, { playing: true, loading: true, n: req.n, title: req.title }));
  try {
    await eng.play(req, (msg) => music.emit('progress', msg));
  } catch (e) {
    setState({ playing: false });
    throw e;
  }
};

const send = (op, v) => {
  if (music.where === 'display') link.send({ t: 'music', op, v });
  else if (local) local.command(op, v);
};
music.toggle = () => { if (music.where === 'here' && local) local.unlock(); send('toggle'); };
music.stop = () => send('stop');
music.fade = (ms = 3000) => send('fade', ms);
music.seek = (i) => send('seek', i);
const saveSoon = debounce((k, v) => settings.set('hymns.' + k, v), 400);
music.setRate = (r) => { send('rate', r); saveSoon('musicTempo', Math.round(r * 100)); };
music.setKey = (k) => { send('key', k); saveSoon('musicKey', k); };
music.setVolume = (v) => { send('volume', v); saveSoon('musicVolume', v); };
music.applyEffects = () => { const m = settings.v.hymns; send('effects', { reverb: m.musicReverb == null ? 59 : m.musicReverb, chorus: m.musicChorus == null ? 43 : m.musicChorus }); };
music.isPlaying = () => !!(music.state && music.state.playing);
/** For diagnostics and tests. */
music.engine = () => local;
