// Standard MIDI File reader/writer and the hymn "arrangement" builder.
//
// The SDA Hymnal MIDI files are: [intro] [verse 1] … [last verse with the ending]. The music
// index (tools/build_hymn_music.py) stores those boundaries in ticks. buildArrangement() joins
// the sections the congregation will actually sing into a new MIDI file, so the music plays
// exactly the chosen stanzas, and adds marker events where the words on screen should change.

/** Parse an SMF into { format, tpq, events: [{tick, order, type, …}] } (all tracks merged). */
export function parseSMF(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let p = 0;
  const u32 = () => { const v = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0; p += 4; return v; };
  const u16 = () => { const v = b[p] << 8 | b[p + 1]; p += 2; return v; };
  const str4 = () => { const s = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]); p += 4; return s; };
  const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < b.length); return v; };
  if (str4() !== 'MThd') throw new Error('Not a MIDI file');
  const hl = u32();
  const format = u16(), ntrk = u16(), div = u16();
  p = 8 + hl;
  if (div & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  const events = [];
  let order = 0;
  for (let t = 0; t < ntrk && p < b.length; t++) {
    const id = str4(); const len = u32(); const end = p + len;
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0, run = 0;
    while (p < end) {
      tick += vlq();
      let st = b[p];
      if (st & 0x80) p++; else st = run;
      if (st === 0xff) {
        const type = b[p++]; const l = vlq();
        events.push({ tick, order: order++, track: t, type: 'meta', meta: type, data: b.slice(p, p + l) });
        p += l;
      } else if (st === 0xf0 || st === 0xf7) {
        const l = vlq();
        events.push({ tick, order: order++, track: t, type: 'sysex', status: st, data: b.slice(p, p + l) });
        p += l;
      } else {
        run = st;
        const hi = st & 0xf0, ch = st & 0x0f;
        const d1 = b[p++];
        const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : b[p++];
        events.push({ tick, order: order++, track: t, type: 'ch', hi, ch, d1, d2 });
      }
    }
    p = end;
  }
  events.sort((x, y) => x.tick - y.tick || x.order - y.order);
  return { format, tpq: div, events };
}

function vlqBytes(v) {
  const out = [v & 0x7f];
  while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80);
  return out;
}

/** Write events (absolute ticks, any order) as a format-0 SMF. */
export function writeSMF(tpq, events) {
  const ev = events.slice().sort((x, y) => x.tick - y.tick || (x.prio || 0) - (y.prio || 0) || (x.order || 0) - (y.order || 0));
  const body = [];
  let last = 0;
  for (const e of ev) {
    body.push(...vlqBytes(Math.max(0, e.tick - last)));
    last = Math.max(last, e.tick);
    if (e.type === 'meta') body.push(0xff, e.meta, ...vlqBytes(e.data.length), ...e.data);
    else if (e.type === 'sysex') body.push(e.status, ...vlqBytes(e.data.length), ...e.data);
    else if (e.hi === 0xc0 || e.hi === 0xd0) body.push(e.hi | e.ch, e.d1);
    else body.push(e.hi | e.ch, e.d1, e.d2);
  }
  body.push(0, 0xff, 0x2f, 0);
  const out = new Uint8Array(14 + 8 + body.length);
  const dv = new DataView(out.buffer);
  out.set([0x4d, 0x54, 0x68, 0x64], 0); dv.setUint32(4, 6); dv.setUint16(8, 0); dv.setUint16(10, 1); dv.setUint16(12, tpq);
  out.set([0x4d, 0x54, 0x72, 0x6b], 14); dv.setUint32(18, body.length);
  out.set(body, 22);
  return out;
}

const tempoOf = (e) => (e.data[0] << 16) | (e.data[1] << 8) | e.data[2];

/** Melody (top note of channel 0 at each onset) between two ticks: [{tick, key, len}]. */
export function melodyOnsets(smf, from, to, channel = 0) {
  const top = new Map();
  const open = new Map();
  const ends = new Map();
  for (const e of smf.events) {
    if (e.type !== 'ch' || e.ch !== channel) continue;
    const on = e.hi === 0x90 && e.d2 > 0;
    const off = e.hi === 0x80 || (e.hi === 0x90 && e.d2 === 0);
    if (on) {
      if (e.tick >= from && e.tick < to && (!top.has(e.tick) || e.d1 > top.get(e.tick))) top.set(e.tick, e.d1);
      open.set(e.d1, e.tick);
    } else if (off && open.has(e.d1)) {
      const s = open.get(e.d1); open.delete(e.d1);
      if (top.get(s) === e.d1) ends.set(s, e.tick);
    }
  }
  const ticks = Array.from(top.keys()).sort((a, b) => a - b);
  return ticks.map((t, i) => ({ tick: t, key: top.get(t), end: ends.get(t) || ticks[i + 1] || to }));
}

/** Seconds at each tick, given tempo events [{tick, uspq}]. */
export function makeClock(tempos, tpq) {
  const pts = [];
  let sec = 0, lt = 0, us = 500000;
  for (const t of tempos) { sec += (t.tick - lt) / tpq * us / 1e6; pts.push({ tick: t.tick, sec, us: t.uspq }); lt = t.tick; us = t.uspq; }
  return (tick) => {
    let lo = 0, hi = pts.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (pts[m].tick <= tick) { k = m; lo = m + 1; } else hi = m - 1; }
    if (k < 0) return tick / tpq * 0.5;
    return pts[k].sec + (tick - pts[k].tick) / tpq * pts[k].us / 1e6;
  };
}

/**
 * Join sections of a hymn into one sequence.
 * segs:    [{from, to, label, kind, stanza, splits:[{frac, slide}], slide}]
 *          `slide` = slide shown when this section starts; `splits` = later changes inside it,
 *          as a fraction of the sung text (syllables) — mapped to the melody note at that point.
 * channels: optional {ch: {program}|{mute:true}} instrument override.
 * Returns { bytes, duration, sections:[{label, start, end}], marks:[{sec, slide}] }.
 */
export function buildArrangement(smf, segs, { channels = null, leadBeats = 1, splitLeadBeats = 0.5, humanize = false } = {}) {
  const tpq = smf.tpq;
  const ev = smf.events;
  const out = [];
  const outTempos = [];
  const marks = [];
  const sections = [];
  let pos = 0;
  let order = 0;
  const push = (e, tick, prio = 1) => out.push(Object.assign({}, e, { tick, prio, order: order++ }));
  const override = (e) => {
    if (!channels || e.type !== 'ch' || e.ch === 9) return e;
    const c = channels[e.ch];
    if (!c) return e;
    if (c.mute) return null;
    if (e.hi === 0xc0 && c.program != null) return Object.assign({}, e, { d1: c.program });
    if (e.hi === 0xb0 && (e.d1 === 0 || e.d1 === 32) && c.program != null) return Object.assign({}, e, { d2: 0 });
    return e;
  };
  // Make sure overridden channels get their program even if the file never sends one.
  if (channels) for (const ch in channels) if (channels[ch].program != null) push({ type: 'ch', hi: 0xc0, ch: +ch, d1: channels[ch].program, d2: 0 }, 0, 0);

  segs.forEach((sg, si) => {
    const { from, to } = sg;
    // State at `from`: last tempo, program and every controller per channel.
    let tempo = null;
    const prog = new Map(), ccs = new Map();
    for (const e of ev) {
      if (e.tick >= from) break;
      if (e.type === 'meta' && e.meta === 0x51) tempo = e;
      else if (e.type === 'ch' && e.hi === 0xc0) prog.set(e.ch, e);
      else if (e.type === 'ch' && e.hi === 0xb0 && e.d1 !== 64 && e.d1 < 120) ccs.set(e.ch * 128 + e.d1, e);
    }
    if (tempo) { push(tempo, pos, 0); outTempos.push({ tick: pos, uspq: tempoOf(tempo) }); }
    for (const e of prog.values()) { const o = override(e); if (o) push(o, pos, 0); }
    for (const e of ccs.values()) { const o = override(e); if (o) push(o, pos, 0); }
    const active = new Map();
    for (const e of ev) {
      if (e.tick < from) continue;
      if (e.tick >= to) break;
      const t = pos + (e.tick - from);
      if (e.type === 'meta') {
        if (e.meta === 0x51) { push(e, t, 0); outTempos.push({ tick: t, uspq: tempoOf(e) }); }
        continue; // names, text, key/time signatures are not needed for playback
      }
      if (e.type === 'sysex') { push(e, t, 0); continue; }
      const o = override(e);
      if (!o) continue;
      const k = e.ch * 128 + e.d1;
      if (e.hi === 0x90 && e.d2 > 0) { active.set(k, (active.get(k) || 0) + 1); push(o, t, 2); }
      else if (e.hi === 0x80 || e.hi === 0x90) {
        const n = active.get(k) || 0;
        if (!n) continue; // its note-on belongs to a section we did not copy
        active.set(k, n - 1); push(o, t, 1);
      } else push(o, t, 1);
    }
    const end = pos + (to - from);
    for (const [k, n] of active) for (let i = 0; i < n; i++) push({ type: 'ch', hi: 0x80, ch: (k / 128) | 0, d1: k % 128, d2: 0 }, end, 1);
    // Markers: the slide for this section (a beat early, during the held chord before it) and
    // changes inside it, placed on the melody note where that part of the text begins.
    const lead = Math.round(leadBeats * tpq);
    if (sg.slide != null) marks.push({ tick: Math.max(0, pos - (si ? lead : 0)), slide: sg.slide });
    if (sg.splits && sg.splits.length) {
      const mel = melodyOnsets(smf, from, to);
      if (mel.length) {
        // phrase starts: after a long note or a rest
        const isPhraseStart = (i) => i > 0 && ((mel[i].tick - mel[i - 1].tick) >= 1.5 * tpq || (mel[i].tick - mel[i - 1].end) >= tpq / 2);
        for (const sp of sg.splits) {
          let i = Math.min(mel.length - 1, Math.max(1, Math.round(sp.frac * mel.length)));
          let best = i;
          for (let d = 0; d <= 3; d++) {
            if (i - d > 0 && isPhraseStart(i - d)) { best = i - d; break; }
            if (i + d < mel.length && isPhraseStart(i + d)) { best = i + d; break; }
          }
          marks.push({ tick: pos + (mel[best].tick - from) - Math.round(splitLeadBeats * tpq), slide: sp.slide });
        }
      }
    }
    sections.push({ label: sg.label, kind: sg.kind, stanza: sg.stanza, startTick: pos, endTick: end });
    pos = end;
  });
  for (const m of marks) out.push({ type: 'meta', meta: 0x06, data: Array.from(new TextEncoder().encode('selah:' + m.slide)), tick: Math.max(0, m.tick), prio: 0, order: order++ });
  // a little room for the last chord's release and the reverb tail
  const tail = Math.round(tpq * 1.5);
  out.push({ type: 'meta', meta: 0x01, data: [0x20], tick: pos + tail, prio: 3, order: order++ });
  if (humanize) humanizeNotes(out, tpq);
  const bytes = writeSMF(tpq, out);
  outTempos.sort((a, b) => a.tick - b.tick);
  const clock = makeClock(outTempos, tpq);
  return {
    bytes,
    duration: clock(pos),
    sections: sections.map((s) => ({ label: s.label, kind: s.kind, stanza: s.stanza, start: clock(s.startTick), end: clock(s.endTick) })),
    marks: marks.map((m) => ({ sec: clock(Math.max(0, m.tick)), slide: m.slide })).sort((a, b) => a.sec - b.sec),
  };
}

/**
 * Makes the files sound played rather than typed in: hymn MIDI files often strike every note of a chord equally hard.
 * On the keyboard part (channels 0 and 1, which hold soprano, alto, tenor and bass) the melody (top note of each chord)
 * sings out, the bass stays firm and the inner voices sit back; every note also gets a small, repeatable variation.
 * Timing is not touched, so the words on screen stay in step.
 */
export function humanizeNotes(events, tpq) {
  const win = Math.max(1, Math.round(tpq / 24));
  const ons = events.filter((e) => e.type === 'ch' && e.hi === 0x90 && e.d2 > 0 && e.ch !== 9);
  const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const kb = ons.filter((e) => e.ch === 0 || e.ch === 1).sort((a, b) => a.tick - b.tick);
  for (let i = 0; i < kb.length;) {
    let j = i; while (j < kb.length && kb[j].tick - kb[i].tick <= win) j++;
    const chord = kb.slice(i, j);
    if (chord.length > 1) {
      let top = chord[0], low = chord[0];
      for (const e of chord) { if (e.d1 > top.d1) top = e; if (e.d1 < low.d1) low = e; }
      for (const e of chord) e.d2 += e === top ? 10 : e === low ? 2 : -8;
    }
    i = j;
  }
  for (const e of ons) e.d2 = Math.max(1, Math.min(127, Math.round(e.d2 + (hash(e.tick, e.d1 + 128 * e.ch) - 0.5) * 8)));
}

/** Rough English/Afrikaans syllable count, used to place slide changes inside a section. */
export function syllables(text) {
  const words = String(text || '').toLowerCase().replace(/[^a-zà-ÿ\s'-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  let n = 0;
  for (let w of words) {
    w = w.replace(/'s$|'/g, '');
    if (w.length <= 3) { n += 1; continue; }
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const m = w.match(/[aeiouyà-ÿ]{1,2}/g);
    n += m ? m.length : 1;
  }
  return n;
}
