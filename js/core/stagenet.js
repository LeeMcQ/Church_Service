// Stage link over the internet: phones and laptops that join with the room code (or QR code)
// connect straight to the operator's app over WebRTC data channels. Public Nostr relays are only
// used to find each other (Trystero); after that every byte goes device to device, and on the
// church Wi-Fi it never leaves the building. The room code is also the password that encrypts
// the handshake, so the relays never see who connects or what is sent.
//
// The operator's app joins as the host; stage devices join "passive", so they connect only to the
// host and never to each other (a star, not a mesh: 20 phones are 20 connections, not 190).
// Messages use the same wire format as the projector link (wire.js): pictures are sent once per
// device and referenced afterwards.
import { createEncoder, createDecoder } from './wire.js';

export const APP_ID = 'sda-sabbath-stage-v1';
// No 0/O, 1/I/L, 2/Z, 5/S, 8/B: easy to read out loud and to type on a phone.
const CODE_CHARS = 'ACDEFGHJKMNPQRTUVWXY34679';
export const CODE_LEN = 6;

function rand(n) {
  const a = new Uint32Array(n);
  (self.crypto || window.crypto).getRandomValues(a);
  return Array.from(a);
}
export function newCode() { return rand(CODE_LEN).map((x) => CODE_CHARS[x % CODE_CHARS.length]).join(''); }
export function newPin() { return rand(4).map((x) => String(x % 10)).join(''); }
/** What someone typed ("k7f q2m", "K7F-Q2M") → "K7FQ2M"; null when it cannot be a code. */
export function normCode(s) {
  const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== CODE_LEN) return null;
  for (const ch of c) if (!CODE_CHARS.includes(ch)) return null;
  return c;
}
export const fmtCode = (c) => (c ? c.slice(0, 3) + ' ' + c.slice(3) : '');

let lib = null;
const load = () => (lib = lib || import('../../vendor/trystero/trystero-nostr.min.js'));

/** TURN server from settings ({url, user, pass}); needed only when a phone on mobile data cannot reach the church PC directly. */
export function turnFrom(s) {
  const url = String((s && s.turnUrl) || '').trim();
  if (!/^turns?:/i.test(url)) return null;
  return [{ urls: url.split(/[\s,]+/).filter(Boolean), username: s.turnUser || undefined, credential: s.turnPass || undefined }];
}

/** Own Nostr relays (wss://…, comma or space separated), for a church that runs its own; empty = the public ones. */
export function relaysFrom(s) {
  const list = String(s || '').split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^wss?:\/\/[^\s]+$/i.test(x));
  return list.length ? list.slice(0, 8) : null;
}

const frame = (kind, bytes) => { const out = new Uint8Array(bytes.length + 1); out[0] = kind; out.set(bytes, 1); return out; };

/**
 * Join the stage room for a code.
 *   host: true for the operator's app; stage devices join passive.
 *   onMessage(msg, peerId), onJoin(peerId), onLeave(peerId), onError(err)
 * Returns { send(peerId, msg), reset(peerId), peers(), ping(peerId), close() }.
 */
export async function joinStageRoom(code, { host = false, turn = null, relays = null, onMessage, onJoin, onLeave, onError } = {}) {
  const { joinRoom, selfId } = await load();
  const cfg = { appId: APP_ID, password: 'sda-sabbath-stage:' + code };
  if (!host) cfg.passive = true;
  if (turn) cfg.turnConfig = turn;
  if (relays) cfg.relayConfig = { urls: relays, redundancy: relays.length };
  const room = joinRoom(cfg, 'stage-' + code, { onJoinError: (e) => { if (onError) onError(e); } });
  const act = room.makeAction('w');
  const peers = new Map(); // peerId -> {enc, dec, chain}
  const te = new TextEncoder(), td = new TextDecoder();
  function peer(id) {
    let p = peers.get(id);
    if (p) return p;
    p = { chain: Promise.resolve() };
    // One send at a time per device: a picture must arrive before the message that refers to it.
    const put = (kind, bytes) => {
      p.chain = p.chain.then(() => act.send(frame(kind, bytes), { target: id })).catch((e) => console.warn('stage link send', e));
    };
    p.enc = createEncoder((s) => put(0, te.encode(s)), (b) => put(1, new Uint8Array(b)));
    p.dec = createDecoder((m) => { if (onMessage) onMessage(m, id); });
    peers.set(id, p);
    return p;
  }
  act.onMessage = (data, ctx) => {
    const id = ctx && ctx.peerId;
    if (!id) return;
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (!u8.length) return;
    const p = peer(id);
    if (u8[0] === 0) p.dec.text(td.decode(u8.subarray(1)));
    else p.dec.binary(u8.slice(1).buffer);
  };
  room.onPeerJoin = (id) => { peer(id); if (onJoin) onJoin(id); };
  room.onPeerLeave = (id) => { peers.delete(id); if (onLeave) onLeave(id); };
  return {
    selfId,
    send(id, msg) { return peer(id).enc(msg); },
    /** That device starts afresh (reloaded page): send every picture again. */
    reset(id) { const p = peers.get(id); if (p) p.enc.reset(); },
    peers: () => Array.from(peers.keys()),
    ping: (id) => room.ping(id).catch(() => null),
    close() { peers.clear(); try { return room.leave(); } catch (e) { return Promise.resolve(); } },
  };
}
