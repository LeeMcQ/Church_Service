// Stored (uncompressed) ZIP files made of Blobs, written and read without loading big files into memory.
// Used for plan packages (.sdaplan): videos and pictures are already compressed, so storing them is
// fastest. Limits: no ZIP64, so the whole package must stay under 4 GB.
//   await zipBlobs([{ name, blob | text }], onProgress) -> Blob
//   await readZip(blob) -> Map(name -> Blob)   (stored entries only; deflated entries are refused)

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crcStep(crc, u8) { for (let i = 0; i < u8.length; i++) crc = TABLE[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8); return crc; }
async function crcOf(blob, onBytes) {
  let crc = 0xffffffff;
  if (blob.stream) {
    const r = blob.stream().getReader();
    for (;;) { const { done, value } = await r.read(); if (done) break; crc = crcStep(crc, value); if (onBytes) onBytes(value.length); }
  } else {
    const step = 8 << 20;
    for (let o = 0; o < blob.size; o += step) { const u = new Uint8Array(await blob.slice(o, o + step).arrayBuffer()); crc = crcStep(crc, u); if (onBytes) onBytes(u.length); }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export const ZIP_MAX = 0xfffffff0;

export async function zipBlobs(entries, onProgress) {
  const enc = new TextEncoder();
  const now = new Date();
  const dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const parts = [], central = [];
  let off = 0;
  const total = entries.reduce((a, e) => a + (e.blob ? e.blob.size : (e.text || '').length), 0);
  let done = 0;
  for (const e of entries) {
    const blob = e.blob || new Blob([enc.encode(e.text || '')]);
    const name = enc.encode(e.name);
    const crc = await crcOf(blob, (n) => { done += n; if (onProgress) onProgress(done, total); });
    const size = blob.size;
    if (off + size + 30 + name.length > ZIP_MAX) throw new Error('The package would be larger than 4 GB. Leave the videos out and share them separately.');
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(ch.buffer, name);
    off += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, c) => a + c.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

export async function readZip(blob) {
  const tailLen = Math.min(blob.size, 22 + 65535);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a Church Service plan file.');
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = new Map();
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true), size = cd.getUint32(p + 20, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), lo = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
    p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const lh = new DataView(await blob.slice(lo, lo + 30).arrayBuffer());
    const start = lo + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (method !== 0) {
      // Re-zipped by another program: unpack small compressed entries with fflate.
      const { unzipSync } = await import('../../vendor/fflate-unzip.min.js');
      const all = unzipSync(new Uint8Array(await blob.arrayBuffer()));
      Object.keys(all).forEach((k) => { if (!k.endsWith('/')) out.set(k, new Blob([all[k]])); });
      return out;
    }
    out.set(name, blob.slice(start, start + size));
  }
  return out;
}
