// Wire format for byte-stream links (Cast/Presentation API and the LAN companion).
// Text frames carry JSON; Blobs travel first as binary frames:
//   [uint32 header length][header JSON {id,type}][bytes]
// and are referenced from JSON as {"$blob": id}. Sends are queued so order is kept.
//
// Pictures are sent once and remembered by both ends. Both ends keep the same budget (count and
// bytes) and forget the oldest pictures in the same order, so the sender always knows what the
// display still has: a slide deck shown again later is simply sent again. Pictures belonging to the
// message being sent are never forgotten half-way. reset() forgets everything (a new display).
import { isBlob, uid } from './util.js';

export const WIRE_MAX_COUNT = 300;
export const WIRE_MAX_BYTES = 96 * 1048576;

/** Insertion-ordered picture budget shared by encoder and decoder. */
function budget() {
  const items = new Map(); // id -> {size, batch}
  let bytes = 0;
  return {
    add(id, size, batch) { items.set(id, { size, batch }); bytes += size; },
    has: (id) => items.has(id),
    /** A picture used again by the current message: keep it, and treat it as the newest. */
    touch(id, batch) { const it = items.get(id); if (it) { items.delete(id); it.batch = batch; items.set(id, it); } },
    /** Forget oldest entries (not of the current batch) while over budget; returns the ids forgotten. */
    trim(batch) {
      const gone = [];
      for (const [id, it] of items) {
        if (items.size <= WIRE_MAX_COUNT && bytes <= WIRE_MAX_BYTES) break;
        if (it.batch === batch) continue;
        items.delete(id); bytes -= it.size; gone.push(id);
      }
      return gone;
    },
    clear() { items.clear(); bytes = 0; },
  };
}

export function createEncoder(sendText, sendBinary) {
  let sent = new WeakMap(); // Blob -> id
  const kept = budget();
  let batchNo = 0;
  let q = Promise.resolve();
  function collect(v, out, seen) {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (isBlob(v)) { out.push(v); return; }
    if (Array.isArray(v)) v.forEach((x) => collect(x, out, seen));
    else for (const k in v) collect(v[k], out, seen);
  }
  async function doSend(msg) {
    const blobs = [];
    collect(msg, blobs, new Set());
    const batch = ++batchNo;
    // Pictures the display already has, used again by this message, must survive this message's trims.
    const reuse = [], fresh = [];
    blobs.forEach((b) => { const known = sent.get(b); if (known && kept.has(known)) reuse.push(known); else fresh.push(b); });
    if (fresh.length) reuse.forEach((id) => kept.touch(id, batch));
    let first = true;
    for (const b of fresh) {
      const id = uid();
      const head = new TextEncoder().encode(JSON.stringify(Object.assign({ id, type: b.type || 'application/octet-stream', batch }, first && reuse.length ? { keep: reuse } : {})));
      first = false;
      const body = new Uint8Array(await b.arrayBuffer());
      const buf = new Uint8Array(4 + head.length + body.length);
      new DataView(buf.buffer).setUint32(0, head.length);
      buf.set(head, 4); buf.set(body, 4 + head.length);
      sendBinary(buf.buffer);
      sent.set(b, id);
      kept.add(id, body.length, batch);
      kept.trim(batch);
    }
    sendText(JSON.stringify(msg, (k, v) => (isBlob(v) ? { $blob: sent.get(v) } : v)));
  }
  const send = (msg) => { q = q.then(() => doSend(msg)).catch((e) => console.warn('wire send', e)); return q; };
  /** The display started afresh (new page or reconnect): send every picture again when needed. */
  send.reset = () => { sent = new WeakMap(); kept.clear(); };
  return send;
}

export function createDecoder(onMessage) {
  const store = new Map();
  const kept = budget();
  return {
    text(str) {
      let msg;
      try { msg = JSON.parse(str, (k, v) => (v && typeof v === 'object' && v.$blob ? store.get(v.$blob) || null : v)); }
      catch (e) { return; }
      try { onMessage(msg); } catch (e) { console.error('display message', e); }
    },
    binary(ab) {
      try {
        const dv = new DataView(ab);
        const n = dv.getUint32(0);
        const head = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, n)));
        const blob = new Blob([new Uint8Array(ab, 4 + n)], { type: head.type });
        if (Array.isArray(head.keep)) head.keep.forEach((id) => kept.touch(id, head.batch));
        store.set(head.id, blob);
        kept.add(head.id, blob.size, head.batch);
        kept.trim(head.batch).forEach((id) => store.delete(id));
      } catch (e) { console.warn('wire: bad binary frame', e); }
    },
  };
}
