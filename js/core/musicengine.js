// Hymn music engine: plays the SDA Hymnal accompaniment MIDI files through a SoundFont synthesizer.
//
// Sound quality: GeneralUser GS 2.0.3 (S. Christian Collins, uncompressed samples) played by
// SpessaSynth, a full SoundFont 2 synthesizer that GeneralUser GS's author rates "Excellent",
// with the effect levels he recommends for Falcosoft MIDI Player / BASSMIDI (GS reverb level 59,
// chorus level 43). Everything is local: it works with no internet.
//
// Used on the control device, or inside the display window when a phone controls the church PC
// through the companion (so the sound comes out of the PC). No dependency on the control UI.
import { emitter } from './util.js';
import { buildArrangement, parseSMF, syllables } from '../lib/smf.js';
import { ROOMS, churchImpulse } from './churchreverb.js';
import { CACHE_NS } from './storens.js';

const ROOT = new URL('../../', import.meta.url).href;
const url = (p) => new URL(p, ROOT).href;

// GS SysEx (Roland, device 0x10, model 0x42): address + data, with checksum. No leading F0.
function gs(addr, data) {
  const body = [0x40, addr[0], addr[1], ...data];
  const sum = (128 - (body.reduce((a, b) => a + b, 0) % 128)) % 128;
  return [0x41, 0x10, 0x42, 0x12, ...body, sum, 0xf7];
}

// Instrument choices. "arranged" keeps the hymnal's own orchestration (piano, strings, winds,
// bass). The others play the four-part keyboard score (channels 0 and 1 hold S A T B).
export const INSTRUMENTS = {
  arranged: { label: 'As arranged' },
  piano: { label: 'Piano', map: { 0: 0, 1: 0 } },
  organ: { label: 'Organ', map: { 0: 19, 1: 19, 4: 19 } },
  strings: { label: 'Strings', map: { 0: 49, 1: 48, 4: 48 } },
  choir: { label: 'Choir', map: { 0: 52, 1: 52 } },
};
function channelMap(instrument) {
  const inst = INSTRUMENTS[instrument];
  if (!inst || !inst.map) return null;
  const out = {};
  for (let ch = 0; ch < 16; ch++) if (ch !== 9) out[ch] = inst.map[ch] != null ? { program: inst.map[ch] } : { mute: true };
  return out;
}

// ------------------------------------------------------------------ library (index + MIDI pack)
let indexP = null;
const packs = new Map();
export function loadIndex() {
  if (!indexP) indexP = fetch(url('data/music/index.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return indexP;
}
async function midiBytes(book, entry) {
  // Custom MIDI stored in the database (assigned via lyrics finder).
  if (entry.custom && entry.blob) {
    return new Uint8Array(await entry.blob.arrayBuffer());
  }
  const idx = await loadIndex();
  const b = idx && idx.books[book];
  if (!b) throw new Error('No music for this hymnbook');
  if (!packs.has(b.pack)) {
    packs.set(b.pack, (async () => {
      const r = await fetch(url('data/music/' + b.pack));
      if (!r.ok) throw new Error('Music library missing (' + r.status + ')');
      return new Uint8Array(await r.arrayBuffer());
    })());
  }
  const zip = await packs.get(b.pack);
  const { unzipSync } = await import('../../vendor/fflate-unzip.min.js');
  const files = unzipSync(zip, { filter: (f) => f.name === entry.f });
  if (!files[entry.f]) throw new Error('Tune ' + entry.f + ' not found');
  return files[entry.f];
}

// ------------------------------------------------------------------ high-quality sound pack
// data/music/hq.sf3 (18 MB): a recorded concert grand (Salamander) and a recorded pipe organ (GrandOrgue demo).
// It is not part of the offline install; it downloads the first time it is switched on and is kept in its own
// cache, which app updates leave alone, so it downloads once per device.
const HQ_FILE = 'data/music/hq.sf3';
const HQ_CACHE = CACHE_NS + 'sounds-v1';           // this app's own name (storens.js)
const HQ_CACHE_OLD = 'sda-sabbath-sounds-v1';      // its first name: moved over once
export const HQ_MB = 18;
/** 'on' / 'off', or 'auto': on for PCs and laptops, off for phones and slow devices (decided by the device that plays). */
export function hqFor(v) {
  if (v === true || v === 'on') return true;
  if (v === false || v === 'off' || v == null) return false;
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return !phone && mem > 2 && cores > 2;
}
export async function hqStored() {
  try { if ((await caches.keys()).includes(HQ_CACHE_OLD)) return true; } catch (e) { /* */ }
  try { return !!(await (await caches.open(HQ_CACHE)).match(url(HQ_FILE))); } catch (e) { return false; }
}
export async function hqRemove() { try { await caches.delete(HQ_CACHE); await caches.delete(HQ_CACHE_OLD); } catch (e) { /* */ } }
async function hqBytes(onProgress) {
  let cache = null;
  try {   // a download kept under the first name: move it (no second 18 MB download)
    if ((await caches.keys()).includes(HQ_CACHE_OLD)) {
      const hit = await (await caches.open(HQ_CACHE_OLD)).match(url(HQ_FILE));
      if (hit) await (await caches.open(HQ_CACHE)).put(url(HQ_FILE), hit);
      await caches.delete(HQ_CACHE_OLD);
    }
  } catch (e) { /* */ }
  try { cache = await caches.open(HQ_CACHE); const hit = await cache.match(url(HQ_FILE)); if (hit) return hit.arrayBuffer(); } catch (e) { /* no Cache API: download each time */ }
  const res = await fetch(url(HQ_FILE), { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not download the high-quality sounds (' + res.status + ').');
  const total = +res.headers.get('content-length') || HQ_MB * 1048576;
  const parts = []; let got = 0;
  const rd = res.body && res.body.getReader ? res.body.getReader() : null;
  if (rd) {
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length;
      onProgress && onProgress('Downloading high-quality instruments (once): ' + Math.min(99, Math.round(got / total * 100)) + '%');
    }
  } else parts.push(new Uint8Array(await res.arrayBuffer()));
  const buf = await new Blob(parts).arrayBuffer();
  if (cache) { try { await cache.put(url(HQ_FILE), new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) { /* storage full: still plays this time */ } }
  return buf;
}

/** Download the high-quality instruments in the background (once; nothing plays). Resolves true when stored. */
let prefetchP = null;
export function hqPrefetch() {
  if (prefetchP) return prefetchP;
  prefetchP = (async () => {
    if (await hqStored()) return true;
    if (navigator.onLine === false) return false;
    await hqBytes();
    return hqStored();
  })().catch(() => false).finally(() => { setTimeout(() => { prefetchP = null; }, 1000); });
  return prefetchP;
}

// ------------------------------------------------------------------ engine
export class MusicEngine {
  constructor() {
    Object.assign(this, emitter({}));
    this.ctx = null; this.synth = null; this.seq = null; this.gain = null;
    this.playing = false; this.paused = false; this.arr = null; this.req = null;
    this.volume = 1.3; this.rate = 1; this.key = 0; this._idleT = null; this._tick = null; this._fadeT = null;
  }

  /** Must start inside a click/tap (browsers only allow sound after a user gesture). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('This browser cannot play music.');
      // "playback" asks for larger audio buffers: fewer dropouts on slow PCs and phones.
      this.ctx = new AC({ latencyHint: 'playback' });
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  async init(onProgress) {
    if (this.synth) return;
    if (this._initP) return this._initP;
    this._initP = (async () => {
      this.unlock();
      const ctx = this.ctx;
      if (!ctx.audioWorklet) {
        throw new Error(window.isSecureContext ? 'This browser is too old for the music engine. Use a current Chrome, Edge, Firefox or Safari.'
          : 'Browsers only allow music on a secure page. On the church PC open http://localhost:7777/display (not the network address), or use the https web address.');
      }
      onProgress && onProgress('Loading the music engine…');
      await ctx.audioWorklet.addModule(url('vendor/spessasynth/spessasynth_processor.min.js'));
      const lib = await import('../../vendor/spessasynth/spessasynth_lib.min.js');
      const synth = new lib.WorkletSynthesizer(ctx);
      // Output chain: synth → volume/fade → safety limiter (only acts on rare peaks) → speakers.
      this.gain = ctx.createGain(); this.gain.gain.value = this.volume;
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.2;
      synth.connect(this.gain); this.gain.connect(lim); lim.connect(ctx.destination);
      // Church echo: synth → convolver (the room) → wet level → the same volume control, beside the dry sound.
      this.conv = ctx.createConvolver();
      this.wet = ctx.createGain(); this.wet.gain.value = 0;
      synth.connect(this.conv); this.conv.connect(this.wet); this.wet.connect(this.gain);
      onProgress && onProgress('Loading instruments (GeneralUser GS)…');
      const idx = await loadIndex();
      const sf = await (await fetch(url('data/music/' + ((idx && idx.soundfont) || 'hymnal.sf3')))).arrayBuffer();
      await synth.soundBankManager.addSoundBank(sf, 'main');
      await synth.isReady;
      synth.setSystemParameter('interpolationType', 2); // Hermite: SpessaSynth's highest quality
      synth.setSystemParameter('deviceID', -1);
      this.synth = synth;
      this.applyEffects();
      const seq = new lib.Sequencer(synth, { skipToFirstNoteOn: false });
      seq.loopCount = 0;
      seq.eventHandler.timeDelay = Math.max(0, (ctx.baseLatency || 0) + (ctx.outputLatency || 0));
      seq.eventHandler.addEvent('metaEvent', 'selah', (d) => this._meta(d));
      seq.eventHandler.addEvent('songEnded', 'selah', () => this._ended());
      this.seq = seq;
    })();
    try { await this._initP; } catch (e) { this._initP = null; throw e; }
  }

  /** fx: {reverb, chorus} GS levels 0-127 (Falcosoft recommendation 59 / 43), room: 'off' | 'small' | 'church' |
   *  'large' (the church echo replaces the synthesizer's own reverb), hq: high-quality instruments, natural: bool. */
  applyEffects(fx) {
    if (fx) this.fx = Object.assign({}, this.fx || {}, fx);
    const s = this.synth;
    if (!s) return;
    const room = ROOMS[(this.fx && this.fx.room) || 'off'] || null;
    if (room && this.conv) {
      const key = this.fx.room + '@' + this.ctx.sampleRate;
      if (this._roomKey !== key) {
        const [l, r] = churchImpulse(this.ctx.sampleRate, room);
        const b = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
        b.copyToChannel(l, 0); b.copyToChannel(r, 1);
        this.conv.buffer = b; this._roomKey = key;
      }
      this.wet.gain.setTargetAtTime(room.wet, this.ctx.currentTime, 0.05);
    } else if (this.wet) this.wet.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    const rev = room ? 0 : this.fx && this.fx.reverb != null ? this.fx.reverb : 59;
    const cho = this.fx && this.fx.chorus != null ? (room ? Math.round(this.fx.chorus / 2) : this.fx.chorus) : 43;
    s.setSystemParameter('reverbLock', false); s.setSystemParameter('chorusLock', false);
    s.systemExclusive(gs([0x01, 0x30], [0x04]));   // reverb: Hall 2 (GS default)
    s.systemExclusive(gs([0x01, 0x33], [rev]));    // reverb level (Falcosoft recommendation: 59)
    s.systemExclusive(gs([0x01, 0x38], [0x02]));   // chorus: Chorus 3 (GS default)
    s.systemExclusive(gs([0x01, 0x3a], [cho]));    // chorus level (Falcosoft recommendation: 43)
    // Lock them: otherwise each new song's reset would restore the GS defaults (64 / 64).
    s.setSystemParameter('reverbLock', true); s.setSystemParameter('chorusLock', true);
    if (this.fx && this.fx.hq != null) this._wantHQ(hqFor(this.fx.hq), false).catch(() => {});
  }

  /** Switch the high-quality instruments on or off (downloads them the first time). */
  async setHQ(on, onProgress) {
    if (!this.synth) return;
    if (this._hqP) await this._hqP.catch(() => {});
    if (on === !!this._hq) return;
    this._hqP = (async () => {
      const mgr = this.synth.soundBankManager;
      if (on) {
        const buf = await hqBytes(onProgress);
        await mgr.addSoundBank(buf, 'hq');
        mgr.priorityOrder = ['hq', 'main'];   // its piano and organ win over GeneralUser GS's
        this._hq = true;
      } else {
        await mgr.deleteSoundBank('hq');
        this._hq = false;
      }
    })();
    try { await this._hqP; } finally { this._hqP = null; }
  }
  get hq() { return !!this._hq; }
  /** Use the high-quality instruments if they are already on this device; otherwise start their download in the
   *  background and keep the standard sounds for now (a hymn never waits for an 18 MB download). */
  async _wantHQ(want, onProgress) {
    if (!want) { if (this._hq) await this.setHQ(false); return; }
    if (this._hq) return;
    if (await hqStored()) { await this.setHQ(true, onProgress); return; }
    hqPrefetch();
  }

  _meta(d) {
    const ev = d && d.event;
    if (!ev || !ev.data) return;
    const txt = new TextDecoder().decode(ev.data);
    const m = /^selah:(\d+)$/.exec(txt);
    if (m) this.emit('slide', +m[1]);
  }

  _ended() {
    if (!this.playing) return;
    this.playing = false; this.paused = false;
    this._state();
    this.emit('ended');
    this._sleepSoon();
  }

  _sleepSoon() {
    clearTimeout(this._idleT);
    // Let the reverb tail ring, then suspend the audio engine so an idle PC/phone uses no CPU.
    this._idleT = setTimeout(() => { if (!this.playing && this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }, 6000);
  }

  /** req: { book, n, segs, instrument, rate, key, volume, title } */
  async play(req, onProgress) {
    await this.init(onProgress);
    const idx = await loadIndex();
    const entry = (req.entry && req.entry.blob ? req.entry : null) || (idx && idx.books[req.book] && idx.books[req.book].hymns[String(req.n)]);
    if (!entry) throw new Error('No music for hymn ' + req.n);
    clearTimeout(this._idleT); clearTimeout(this._fadeT);
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const smf = parseSMF(await midiBytes(req.book, entry));
    const segs = req.segs && req.segs.length ? req.segs : [{ from: 0, to: entry.last != null ? entry.last + 1 : smf.events.reduce((m, e) => Math.max(m, e.tick), 0) + 1, label: 'Hymn', kind: 'all', slide: null }];
    this.arr = buildArrangement(smf, segs, { channels: channelMap(req.instrument), humanize: !(req.fx && req.fx.natural === false) });
    this.req = req;
    if (req.fx) {
      const { hq, ...rest } = req.fx;
      this.applyEffects(rest);
      this.fx.hq = hq;
      // High-quality instruments when they are stored (loads in about a second); never wait for their download.
      try { await this._wantHQ(hqFor(hq), onProgress); } catch (e) { /* the standard sounds play */ }
    }
    // Light mode (old PCs, 1–2 GB phones): linear interpolation and fewer voices, ~25% less CPU.
    this.synth.setSystemParameter('interpolationType', req.light ? 0 : 2);
    this.synth.setSystemParameter('voiceCap', req.light ? 96 : 256);
    const seq = this.seq;
    if (this.playing) { seq.pause(); this.synth.stopAll(true); }
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.volume = req.volume != null ? req.volume : this.volume;
    this.gain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    this.setKey(req.key || 0);
    seq.loadNewSongList([{ binary: this.arr.bytes.buffer.slice(0), fileName: 'hymn-' + req.n + '.mid' }]);
    seq.playbackRate = this.rate = req.rate || 1;
    seq.currentTime = 0;
    seq.play();
    this.playing = true; this.paused = false;
    this._startTicker();
    this._state();
  }

  /** Play any MIDI file (banner background music) with the same instruments. bytes: Uint8Array. */
  async playMidi(bytes, { title = 'MIDI', volume } = {}, onProgress) {
    await this.init(onProgress);
    clearTimeout(this._idleT); clearTimeout(this._fadeT); this._fadeT = null;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const seq = this.seq;
    if (this.playing) { seq.pause(); this.synth.stopAll(true); }
    this.arr = { sections: [], duration: 0 };
    this.req = { title, n: null, book: null };
    this.synth.setSystemParameter('interpolationType', 2);
    this.synth.setSystemParameter('voiceCap', 256);
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    if (volume != null) this.volume = volume;
    this.gain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    this.setKey(0);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    seq.loadNewSongList([{ binary: buf, fileName: title + '.mid' }]);
    seq.playbackRate = this.rate = 1;
    seq.currentTime = 0;
    seq.play();
    this.playing = true; this.paused = false;
    const arr = this.arr;
    const grab = () => { if (this.arr === arr && isFinite(seq.duration) && seq.duration > 0) arr.duration = seq.duration; };
    setTimeout(grab, 200); setTimeout(grab, 1200);
    this._startTicker();
    this._state();
  }

  _startTicker() {
    clearInterval(this._tick);
    this._tick = setInterval(() => { if (this.playing) this._state(); else clearInterval(this._tick); }, 250);
  }

  _state() {
    const t = this.seq ? Math.max(0, this.seq.currentTime) : 0;
    const arr = this.arr;
    let sec = null;
    if (arr) for (let i = 0; i < arr.sections.length; i++) if (t >= arr.sections[i].start - 0.05) sec = i;
    this.emit('state', {
      playing: this.playing, paused: this.paused, time: Math.min(t, arr ? arr.duration : t), dur: arr ? arr.duration : 0,
      section: sec, sections: arr ? arr.sections.map((s) => ({ label: s.label, start: s.start })) : [],
      rate: this.rate, key: this.key, volume: this.volume, n: this.req && this.req.n, book: this.req && this.req.book,
      title: this.req && this.req.title,
    });
  }

  pause() { if (!this.playing || this.paused) return; this.seq.pause(); this.paused = true; this._state(); }
  resume() {
    if (!this.playing || !this.paused) return;
    this.unlock();
    this.seq.play(); this.paused = false; this._startTicker(); this._state();
  }
  toggle() { if (this.paused) this.resume(); else this.pause(); }

  stop() {
    clearTimeout(this._fadeT);
    if (this.seq && this.playing) { this.seq.pause(); this.synth.stopAll(true); }
    this.playing = false; this.paused = false;
    this._state(); this.emit('ended'); this._sleepSoon();
  }

  /** Fade to silence over `ms`, then stop. */
  fade(ms = 3000) {
    if (!this.playing) return;
    const g = this.gain.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0.0001, now + ms / 1000);
    clearTimeout(this._fadeT);
    this._fadeT = setTimeout(() => this.stop(), ms + 50);
  }

  setRate(r) { this.rate = Math.max(0.5, Math.min(1.5, r)); if (this.seq) this.seq.playbackRate = this.rate; this._state(); }
  setKey(k) { this.key = Math.max(-6, Math.min(6, Math.round(k))); if (this.synth) this.synth.setSystemParameter('keyShift', this.key); this._state(); }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(2, v));
    if (this.gain && !this._fadeT) { const now = this.ctx.currentTime; this.gain.gain.cancelScheduledValues(now); this.gain.gain.setTargetAtTime(this.volume, now, 0.03); }
    this._state();
  }
  seekSection(i) {
    if (!this.arr || !this.arr.sections[i]) return;
    const s = this.arr.sections[i];
    this.seq.currentTime = Math.max(0, s.start - 0.02);
    // the slide that belongs to this section
    const mk = this.arr.marks.filter((m) => m.sec <= s.start + 0.05).pop();
    if (mk) this.emit('slide', mk.slide);
    this._state();
  }
  /** One command from a remote controller. */
  command(op, v) {
    switch (op) {
      case 'pause': this.pause(); break;
      case 'resume': this.resume(); break;
      case 'toggle': this.toggle(); break;
      case 'stop': this.stop(); break;
      case 'fade': this.fade(v); break;
      case 'rate': this.setRate(v); break;
      case 'key': this.setKey(v); break;
      case 'volume': this.setVolume(v); break;
      case 'seek': this.seekSection(v); break;
      case 'effects': this.applyEffects(v); break;
    }
  }
}


/**
 * Sections to play for the stanzas being sung, with the slide to show for each part.
 * hy: hymn {n, v, c}; sung: [stanza indexes]; cards: the hymn cue's cards; intro: bool.
 */
export function planSegments(entry, hy, sung, cards, { intro = true } = {}) {
  if (!entry.ok || !entry.v.length) return null; // through-composed: play as recorded
  const M = entry.v.length;
  const segs = [];
  const titleIdx = cards ? cards.findIndex((c) => c.p.kind === 'title') : -1;
  if (intro && entry.intro > entry.first + entry.tpq) segs.push({ from: entry.first, to: entry.intro, label: 'Intro', kind: 'intro', slide: titleIdx >= 0 ? titleIdx : null });
  const K = sung.length;
  sung.forEach((st, k) => {
    // The last stanza sung always uses the arrangement's real ending; earlier ones use the
    // matching verse when the file has it, otherwise a middle verse (all verses share the music).
    let sec;
    if (k === K - 1) sec = M - 1;
    else if (M === 1) sec = 0;
    else sec = Math.min(st, M - 2);
    const [from, to] = entry.v[sec];
    // Slides for this stanza: its verse chunks, then the chorus chunks that follow it.
    let slide = null; const splits = [];
    if (cards) {
      const idxs = [];
      let i = cards.findIndex((c) => c.p.kind === 'verse' && c.p.n === st + 1);
      if (i >= 0) {
        idxs.push(i);
        for (let j = i + 1; j < cards.length && cards[j].p.kind !== 'title' && !(cards[j].p.kind === 'verse' && cards[j].p.n !== st + 1); j++) idxs.push(j);
      }
      if (idxs.length) {
        slide = idxs[0];
        // Time each later chunk by how much of the sung text comes before it (syllables ≈ notes).
        const sungText = hy.v[st].join(' ') + (hy.c ? ' ' + hy.c.join(' ') : '');
        const total = Math.max(1, syllables(sungText));
        let before = 0;
        idxs.forEach((ci, m) => {
          if (m > 0) splits.push({ frac: Math.min(0.98, before / total), slide: ci });
          before += syllables(cards[ci].lines.join(' '));
        });
        // a chorus that is sung but not shown again (chorus "once" setting): nothing to change
      }
    }
    segs.push({ from, to, label: 'Verse ' + (st + 1), kind: 'verse', stanza: st, slide, splits });
  });
  return segs;
}

