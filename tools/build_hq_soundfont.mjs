// Builds data/music/hq.sf3, the optional "High-quality sound" pack: a recorded concert grand piano and a recorded
// pipe organ that replace the matching GeneralUser GS sounds (the pack is loaded on top of hymnal.sf3).
//
//   Piano: Salamander Grand Piano V3 by Alexander Holm (Yamaha C5), CC BY 3.0
//          https://github.com/sfzinstruments/SalamanderGrandPiano  (FLAC samples)
//   Organ: GrandOrgue demo sample set, recordings by Lars Palo, CC BY-SA 2.5 (or GPL-2+)
//          Ubuntu/Debian package "grandorgue-demo" (.orgue file = zip of WavPack samples)
//
//   npm i spessasynth_core; apt install ffmpeg wavpack
//   node tools/build_hq_soundfont.mjs <SalamanderGrandPiano dir> <GrandOrgue demo dir> [out.sf3]
//
// The pack holds presets 0 (grand piano), 4 and 5 (the hymnal arrangements' electric pianos, played on the grand
// piano instead) and 19 (church organ: Montre 8' + Prestant 4' + Bourdon 8'). Everything else still comes from
// GeneralUser GS. Samples are stored as Ogg Vorbis (SF3), like hymnal.sf3.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BasicSoundBank, BasicSample, BasicInstrument, BasicPreset, Modulator, ModulatorSource, GeneratorTypes as G, SampleTypes } from 'spessasynth_core';

const run = promisify(execFile);
const [salDir, orgDir, outPath = 'data/music/hq.sf3'] = process.argv.slice(2);
if (!salDir || !orgDir) { console.error('usage: node tools/build_hq_soundfont.mjs <Salamander dir> <GrandOrgue demo dir> [out.sf3]'); process.exit(1); }
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-'));
const QUALITY = process.env.Q || '4';   // Vorbis quality 4 ≈ 128 kbit/s stereo
let n = 0;

async function decode(file, rate) {   // any audio file -> { l, r } Float32 at `rate`
  const raw = path.join(tmp, (n++) + '.f32');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ac', '2', '-ar', String(rate), '-f', 'f32le', raw], { maxBuffer: 1 << 26 });
  const b = await fs.readFile(raw); await fs.rm(raw);
  const all = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const len = all.length / 2, l = new Float32Array(len), r = new Float32Array(len);
  for (let i = 0; i < len; i++) { l[i] = all[2 * i]; r[i] = all[2 * i + 1]; }
  return { l, r };
}
async function vorbis(data, rate) {
  const id = n++;
  const raw = path.join(tmp, id + '.f32'), ogg = path.join(tmp, id + '.ogg');
  await fs.writeFile(raw, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', raw, '-c:a', 'libvorbis', '-q:a', QUALITY, ogg]);
  const out = new Uint8Array(await fs.readFile(ogg));
  await fs.rm(raw); await fs.rm(ogg);
  return out;
}

const bank = new BasicSoundBank();
bank.soundBankInfo.name = 'Church Service high-quality hymn sounds';
bank.soundBankInfo.engineer = 'Salamander Grand Piano V3: Alexander Holm (CC BY 3.0). Pipe organ: GrandOrgue demo, recordings by Lars Palo (CC BY-SA 2.5).';
bank.soundBankInfo.copyright = 'Piano samples CC BY 3.0 (Alexander Holm); organ samples CC BY-SA 2.5 (Lars Palo / GrandOrgue contributors). This pack: CC BY-SA 2.5.';
bank.soundBankInfo.comment = 'Built by tools/build_hq_soundfont.mjs for Church Service. Samples in Ogg Vorbis (SF3).';

/** Adds a stereo pair; returns [left, right]. */
function stereo(name, rate, key, cents, l, r, loopStart = 0, loopEnd = 0) {
  const L = new BasicSample(name + 'L', rate, key, cents, SampleTypes.leftSample, loopStart, loopEnd);
  const R = new BasicSample(name + 'R', rate, key, cents, SampleTypes.rightSample, loopStart, loopEnd);
  L.setAudioData(l, rate); R.setAudioData(r, rate);
  L.setLinkedSample(R, SampleTypes.leftSample);
  bank.addSamples(L, R);
  return [L, R];
}
const tc = (sec) => Math.round(1200 * Math.log2(sec));   // seconds -> timecents
const VEL_SRC = ModulatorSource.fromSourceEnum(0x0502);  // note-on velocity, negative, concave (the SF2 default)
const NONE = ModulatorSource.fromSourceEnum(0);

// ------------------------------------------------------------ piano
const NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8'];
const KEY0 = 21;   // A0
// Five of the sixteen recorded layers, spread over the velocities the hymnal files use most (40-104).
const LAYERS = [[5, 1, 52], [8, 53, 70], [10, 71, 86], [12, 87, 102], [14, 103, 127]];
const piano = new BasicInstrument(); piano.name = 'Salamander Grand';
// Recorded layers already carry the loudness change, so velocity lowers the volume half as much as the default.
piano.globalZone.addModulators(new Modulator(VEL_SRC, NONE, G.initialAttenuation, 480, 0));
piano.globalZone.setGenerator(G.reverbEffectsSend, 0);   // room sound comes from the app's church reverb
piano.globalZone.setGenerator(G.chorusEffectsSend, 0);
const PIANO_RATE = 44100;
for (const [v, lo, hi] of LAYERS) {
  for (let i = 0; i < NOTES.length; i++) {
    const key = KEY0 + (i === NOTES.length - 1 ? 87 : i * 3);   // A0 + minor thirds; C8 = 108
    const file = path.join(salDir, 'Samples', NOTES[i] + 'v' + v + '.flac');
    const { l, r } = await decode(file, PIANO_RATE);
    // Low notes ring long, high notes die away fast: keep 13 s at the bottom down to 3.5 s at the top, then fade.
    const keepS = 13 - (key - 21) / 87 * 9.5;
    const len = Math.min(l.length, Math.round(keepS * PIANO_RATE));
    const fade = Math.round(0.6 * PIANO_RATE);
    const L = l.slice(0, len), R = r.slice(0, len);
    for (let k = 0; k < fade && k < len; k++) { const g = k / fade; L[len - 1 - k] *= g; R[len - 1 - k] *= g; }
    const [sl, sr] = stereo('Sal ' + NOTES[i] + ' v' + v + ' ', PIANO_RATE, key, 0, L, R);
    const keyLo = i === 0 ? 0 : key - 1, keyHi = i === NOTES.length - 1 ? 127 : (i === NOTES.length - 2 ? 107 : key + 1);
    for (const [s, pan] of [[sl, -500], [sr, 500]]) {
      const z = piano.createZone(s);
      z.keyRange = { min: keyLo, max: keyHi }; z.velRange = { min: lo, max: hi };
      z.setGenerator(G.pan, pan);
      z.setGenerator(G.sampleModes, 0);
      // Dampers stop the string quickly; the top notes have no dampers and ring on.
      z.setGenerator(G.releaseVolEnv, key >= 89 ? tc(2.5) : tc(0.45));
    }
    process.stdout.write('.');
  }
}
bank.addInstruments(piano);
console.log('\npiano: ' + piano.zones.length + ' zones');

// ------------------------------------------------------------ organ
async function readWav(file) {   // WavPack -> WAV with its smpl (loop) and cue (release) chunks
  const wav = path.join(tmp, (n++) + '.wav');
  await run('wvunpack', ['-q', '-y', file, '-o', wav]);
  const d = await fs.readFile(wav); await fs.rm(wav);
  const ch = {}; let i = 12;
  while (i < d.length - 8) { const id = d.toString('latin1', i, i + 4); const L = d.readUInt32LE(i + 4); ch[id] = d.subarray(i + 8, i + 8 + L); i += 8 + L + (L & 1); }
  const rate = ch['fmt '].readUInt32LE(4), nch = ch['fmt '].readUInt16LE(2), bits = ch['fmt '].readUInt16LE(14);
  if (bits !== 16 || nch !== 2) throw new Error(file + ': expected 16-bit stereo');
  const frames = ch.data.length / 4, l = new Float32Array(frames), r = new Float32Array(frames);
  for (let k = 0; k < frames; k++) { l[k] = ch.data.readInt16LE(4 * k) / 32768; r[k] = ch.data.readInt16LE(4 * k + 2) / 32768; }
  const smpl = ch.smpl; const loopStart = smpl.readUInt32LE(36 + 8), loopEnd = smpl.readUInt32LE(36 + 12);
  const cue = ch['cue '] ? ch['cue '].readUInt32LE(4 + 20) : frames;
  return { rate, l, r, loopStart, loopEnd, cue };
}
/** Attack + loop, then the recorded release (with the church's echo) straight after the loop. */
function splice(x) {
  const xf = Math.round(0.03 * x.rate);
  const end = x.loopEnd + 1, rel = Math.min(x.cue, x.l.length - xf - 1);
  const tail = x.l.length - rel;
  const L = new Float32Array(end + tail), R = new Float32Array(end + tail);
  L.set(x.l.subarray(0, end)); R.set(x.r.subarray(0, end));
  for (let k = 0; k < tail; k++) {
    // crossfade from the looped sound into the release over 30 ms
    const g = k < xf ? k / xf : 1;
    const a = end + k < x.l.length ? x.l[(x.loopStart + ((end + k - x.loopStart) % (end - x.loopStart)))] : 0;
    const b = end + k < x.r.length ? x.r[(x.loopStart + ((end + k - x.loopStart) % (end - x.loopStart)))] : 0;
    L[end + k] = (1 - g) * a + g * x.l[rel + k]; R[end + k] = (1 - g) * b + g * x.r[rel + k];
  }
  return { L, R };
}
/** How far a recorded pipe is from equal temperament at A = 440 Hz, in cents (the demo organ is tuned a little sharp). */
function centsOff(x, key) {
  const f0 = 440 * Math.pow(2, (key - 69) / 12);
  const from = x.loopStart, len = Math.min(x.loopEnd - x.loopStart, Math.round(x.rate * 1.5));
  const power = (f) => {   // Goertzel: energy of one frequency over the held (looped) part of the note
    const w = 2 * Math.PI * f / x.rate, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
    for (let i = 0; i < len; i++) { const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / len); const s = x.l[from + i] * win + c * s1 - s2; s2 = s1; s1 = s; }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  };
  let best = { p: -1, cents: 0 };
  for (let h = 1; h <= 4; h++) {
    if (h * f0 > x.rate / 2.5) break;
    for (let ct = -45; ct <= 45; ct += 1) { const p = power(h * f0 * Math.pow(2, ct / 1200)); if (p > best.p) best = { p, cents: ct, h }; }
  }
  let fine = best.cents;   // refine to 0.25 cent around the strongest harmonic
  let bp = -1;
  for (let ct = best.cents - 1; ct <= best.cents + 1; ct += 0.25) { const p = power(best.h * f0 * Math.pow(2, ct / 1200)); if (p > bp) { bp = p; fine = ct; } }
  return fine;
}
const loudness = (x) => {   // dB of the held (looped) part
  let e = 0; for (let i = x.loopStart; i < x.loopEnd; i++) e += x.l[i] * x.l[i] + x.r[i] * x.r[i];
  return 10 * Math.log10(e / (2 * (x.loopEnd - x.loopStart)));
};
async function rank(dir, label) {
  const files = (await fs.readdir(path.join(orgDir, dir))).filter((f) => /^\d+-.*\.wav$/i.test(f)).sort();
  const out = [];
  const xs = [];
  for (const f of files) xs.push({ key: parseInt(f, 10), x: await readWav(path.join(orgDir, dir, f)) });
  // Even out the recordings: each pipe is set to a straight line fitted through the rank's loudness, so no note
  // suddenly drops out of a chord (a few demo samples are recorded 4-6 dB softer than their neighbours).
  const pts = xs.map(({ key, x }) => [key, loudness(x)]);
  const mk = pts.reduce((a, p) => a + p[0], 0) / pts.length, md = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const slope = pts.reduce((a, p) => a + (p[0] - mk) * (p[1] - md), 0) / pts.reduce((a, p) => a + (p[0] - mk) ** 2, 0);
  for (const { key, x } of xs) {
    const g = Math.pow(10, ((md + slope * (key - mk)) - loudness(x)) / 20);
    for (let i = 0; i < x.l.length; i++) { x.l[i] *= g; x.r[i] *= g; }
    const { L, R } = splice(x);
    const off = centsOff(x, key);
    const [sl, sr] = stereo(label + ' ' + key + ' ', x.rate, key, -Math.round(off), L, R, x.loopStart, x.loopEnd);
    console.log(label, key, 'tuned', (-off).toFixed(1), 'cents, level', (20 * Math.log10(g)).toFixed(1), 'dB');
    out.push({ key, sl, sr });
  }
  return out;
}
function addRank(inst, samples, { shift = 0, atten = 0 }) {
  samples.forEach((s, i) => {
    const lo = i === 0 ? 0 : Math.floor((samples[i - 1].key + s.key) / 2) + 1;
    const hi = i === samples.length - 1 ? 127 : Math.floor((s.key + samples[i + 1].key) / 2);
    for (const [smp, pan] of [[s.sl, -500], [s.sr, 500]]) {
      // shift -12: the key an octave below plays this pipe, so the rank sounds an octave higher (a 4' stop)
      const z = inst.createZone(smp);
      z.keyRange = { min: Math.max(0, lo + shift), max: Math.min(127, hi + shift) };
      z.setGenerator(G.overridingRootKey, s.key + shift);
      z.setGenerator(G.pan, pan);
      z.setGenerator(G.sampleModes, 3);            // loop while held, then play the recorded release
      z.setGenerator(G.initialAttenuation, atten);
      z.setGenerator(G.releaseVolEnv, tc(2.5));
    }
  });
}
const montre = await rank('Montre8', 'Montre8');
const bourdon = await rank('Bourdon8', 'Bourdon8');
const organ = new BasicInstrument(); organ.name = 'Church Organ (Montre 8, Prestant 4, Bourdon 8)';
organ.globalZone.addModulators(new Modulator(VEL_SRC, NONE, G.initialAttenuation, 0, 0));   // organs ignore how hard a key is hit
organ.globalZone.setGenerator(G.reverbEffectsSend, 0);
organ.globalZone.setGenerator(G.chorusEffectsSend, 0);
addRank(organ, montre, { atten: 30 });                  // Montre 8'
addRank(organ, montre, { shift: -12, atten: 90 });      // Prestant 4' (the Montre pipes an octave up)
addRank(organ, bourdon, { atten: 70 });                 // Bourdon 8': warmth
bank.addInstruments(organ);
console.log('organ: ' + organ.zones.length + ' zones');

// ------------------------------------------------------------ presets
function preset(program, name, inst) {
  const p = new BasicPreset(bank); p.name = name; p.program = program; p.bankMSB = 0; p.bankLSB = 0;
  p.createZone(inst);
  bank.addPresets(p);
}
preset(0, 'Grand Piano (Salamander)', piano);
preset(4, 'Grand Piano (for E.Piano 1)', piano);
preset(5, 'Grand Piano (for E.Piano 2)', piano);
preset(19, 'Church Organ', organ);
bank.flush();

await bank.setSampleFormat({ format: 'compressed', compressionFunction: vorbis });
const out = bank.writeSF2({ writeDefaultModulators: true, writeExtendedLimits: true });
await fs.writeFile(outPath, new Uint8Array(out));
await fs.rm(tmp, { recursive: true, force: true });
console.log(`${bank.samples.length} samples -> ${(out.byteLength / 1048576).toFixed(1)} MB (${outPath})`);
