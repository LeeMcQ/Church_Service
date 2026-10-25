// Compresses data/music/hymnal.sf2 (16-bit samples) into hymnal.sf3 (Ogg Vorbis samples), the same
// format MuseScore uses for its sounds. The app's synthesizer (SpessaSynth) plays SF3 directly.
// Presets, instruments, envelopes and loop points are unchanged; only the sample data is encoded.
//
//   npm i spessasynth_core          (once)
//   ffmpeg with libvorbis on PATH   (apt install ffmpeg)
//   node tools/compress_soundfont.mjs [in.sf2] [out.sf3] [quality 0-10, default 6]
//
// Quality 6 is about 190 kbit/s: no audible difference on piano, organ, strings and choir.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SoundBankLoader } from 'spessasynth_core';

const run = promisify(execFile);
const [inPath = 'data/music/hymnal.sf2', outPath = 'data/music/hymnal.sf3', q = '6'] = process.argv.slice(2);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sf3-'));
let n = 0;

/** Float32 mono samples -> Ogg Vorbis bytes, through ffmpeg. */
async function vorbis(data, rate) {
  const id = n++;
  const raw = path.join(tmp, id + '.f32'), ogg = path.join(tmp, id + '.ogg');
  await fs.writeFile(raw, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', raw, '-c:a', 'libvorbis', '-q:a', q, ogg]);
  const out = new Uint8Array(await fs.readFile(ogg));
  await fs.rm(raw); await fs.rm(ogg);
  return out;
}

const buf = await fs.readFile(inPath);
const bank = SoundBankLoader.fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
await bank.setSampleFormat({ format: 'compressed', compressionFunction: vorbis });
bank.soundBankInfo.comment = (bank.soundBankInfo.comment || '') + '\nSamples compressed to Ogg Vorbis (quality ' + q + ') for a smaller download.';
const out = bank.writeSF2({ writeDefaultModulators: true, writeExtendedLimits: true });
await fs.writeFile(outPath, new Uint8Array(out));
await fs.rm(tmp, { recursive: true, force: true });
console.log(`${bank.samples.length} samples: ${(buf.byteLength / 1048576).toFixed(1)} MB -> ${(out.byteLength / 1048576).toFixed(1)} MB (${outPath})`);
