// Builds data/music/hymnal.sf2: a lossless subset of GeneralUser GS (S. Christian Collins)
// containing every instrument the hymn MIDI files use, plus a few for the instrument choice
// in the app (piano, organs, strings, choir). Whole presets are kept (all keys and
// velocities), samples stay uncompressed 16-bit, so playback is identical to the full bank.
//
//   npm i spessasynth_core      (once, in any folder on your PATH for node)
//   node tools/build_hymn_soundfont.mjs <GeneralUser-GS.sf2> <folder with .mid files> [out.sf2]
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BasicMIDI, SoundBankLoader } from 'spessasynth_core';

const [sfPath, midDir, outPath = 'data/music/hymnal.sf2'] = process.argv.slice(2);
if (!sfPath || !midDir) { console.log('usage: node tools/build_hymn_soundfont.mjs <GeneralUser-GS.sf2> <midi folder> [out.sf2]'); process.exit(1); }

// Instruments offered by the app's "Instrument" choice (General MIDI programs).
const EXTRA = [0, 16, 19, 20, 48, 49, 52, 53];

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else if (/\.midi?$/i.test(e.name)) out.push(p);
  }
  return out;
}

const buf = await fs.readFile(sfPath);
const bank = SoundBankLoader.fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const keep = new Set();
const files = await walk(midDir);
for (const f of files) {
  const b = await fs.readFile(f);
  const midi = BasicMIDI.fromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), path.basename(f));
  for (const preset of midi.getUsedProgramsAndKeys(bank).keys()) keep.add(preset);
}
for (const p of bank.presets) {
  if (!p.isGMGSDrum && p.bankMSB === 0 && p.bankLSB === 0 && EXTRA.includes(p.program)) keep.add(p);
  if (p.isGMGSDrum && p.program === 0) keep.add(p); // Standard kit (GS default)
}
for (const p of bank.presets.slice()) if (!keep.has(p)) bank.deletePreset(p);
bank.removeUnusedElements();
bank.flush();
bank.soundBankInfo.name = 'GeneralUser GS 2.0.3 — hymnal subset';
bank.soundBankInfo.comment = (bank.soundBankInfo.comment || '') +
  '\n\nSubset for the Selah church presenter: only the presets used by the SDA Hymnal MIDI files, plus piano, organ, strings and choir. Samples unchanged (lossless).';
const out = bank.writeSF2({ writeDefaultModulators: true, writeExtendedLimits: true });
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, new Uint8Array(out));
console.log(`${files.length} MIDI files scanned; kept ${bank.presets.length} presets, ${bank.instruments.length} instruments, ${bank.samples.length} samples`);
console.log(bank.presets.map((p) => (p.isGMGSDrum ? 'drums:' : '') + p.program + ' ' + p.name).sort().join(' | '));
console.log(`wrote ${outPath}: ${(out.byteLength / 1048576).toFixed(2)} MB (full bank ${(buf.byteLength / 1048576).toFixed(1)} MB)`);
