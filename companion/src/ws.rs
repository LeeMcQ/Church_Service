//! WebSocket (RFC 6455) server side: handshake, frame read/write. Includes the SHA-1 and
//! Base64 needed for the handshake so the companion has no external dependencies.
use std::io::{self, Read, Write};

pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 { msg.push(0); }
    msg.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..80 { w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1); }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d; d = c; c = b.rotate_left(30); b = a; a = t;
        }
        h[0] = h[0].wrapping_add(a); h[1] = h[1].wrapping_add(b); h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d); h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() { out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes()); }
    out
}

pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity((data.len() + 2) / 3 * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}

pub fn accept_key(client_key: &str) -> String {
    let mut k = client_key.trim().as_bytes().to_vec();
    k.extend_from_slice(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    base64(&sha1(&k))
}

pub enum Msg { Text(Vec<u8>), Binary(Vec<u8>), Ping(Vec<u8>), Pong, Close }

/// Read one complete message (joins continuation frames).
pub fn read_msg<R: Read>(r: &mut R, max: usize) -> io::Result<Msg> {
    let mut data: Vec<u8> = Vec::new();
    let mut first_op: Option<u8> = None;
    loop {
        let mut hdr = [0u8; 2];
        r.read_exact(&mut hdr)?;
        let fin = hdr[0] & 0x80 != 0;
        let op = hdr[0] & 0x0f;
        let masked = hdr[1] & 0x80 != 0;
        let mut len = (hdr[1] & 0x7f) as u64;
        if len == 126 { let mut b = [0u8; 2]; r.read_exact(&mut b)?; len = u16::from_be_bytes(b) as u64; }
        else if len == 127 { let mut b = [0u8; 8]; r.read_exact(&mut b)?; len = u64::from_be_bytes(b); }
        if data.len() as u64 + len > max as u64 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "message too large"));
        }
        let mut mask = [0u8; 4];
        if masked { r.read_exact(&mut mask)?; }
        let mut payload = vec![0u8; len as usize];
        r.read_exact(&mut payload)?;
        if masked { for (i, b) in payload.iter_mut().enumerate() { *b ^= mask[i & 3]; } }
        match op {
            0x8 => return Ok(Msg::Close),
            0x9 => return Ok(Msg::Ping(payload)),
            0xA => return Ok(Msg::Pong),
            0x0 | 0x1 | 0x2 => {
                if op != 0 { first_op = Some(op); }
                data.extend_from_slice(&payload);
                if fin {
                    return Ok(match first_op { Some(0x1) => Msg::Text(data), _ => Msg::Binary(data) });
                }
            }
            _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "bad opcode")),
        }
    }
}

pub fn write_frame<W: Write>(w: &mut W, op: u8, payload: &[u8]) -> io::Result<()> {
    let mut hdr = Vec::with_capacity(10);
    hdr.push(0x80 | op);
    let n = payload.len();
    if n < 126 { hdr.push(n as u8); }
    else if n <= 0xffff { hdr.push(126); hdr.extend_from_slice(&(n as u16).to_be_bytes()); }
    else { hdr.push(127); hdr.extend_from_slice(&(n as u64).to_be_bytes()); }
    w.write_all(&hdr)?;
    w.write_all(payload)?;
    w.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rfc6455_example_key() {
        assert_eq!(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }
    #[test]
    fn sha1_abc() {
        let h = sha1(b"abc");
        let hex: String = h.iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(hex, "a9993e364706816aba3e25717850c26c9cd0d89d");
    }
    #[test]
    fn frame_roundtrip() {
        let mut buf = Vec::new();
        write_frame(&mut buf, 0x2, &vec![7u8; 70000]).unwrap();
        // server frames are unmasked; read_msg accepts both
        match read_msg(&mut &buf[..], 1 << 20).unwrap() { Msg::Binary(d) => assert_eq!(d.len(), 70000), _ => panic!() }
    }
}
