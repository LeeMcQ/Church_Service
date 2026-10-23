//! SDA Sabbath companion (formerly "Selah") — one small program for the church PC.
//!
//! * Serves the whole SDA Sabbath app (embedded in this file) at http://localhost:7777 and on the LAN.
//! * Relays commands from a phone remote to the display, and from the display back.
//! * Streams videos and pictures (with seeking) from the media folder (Videos/Selah; folder name kept for existing installs).
//! * Converts PowerPoint to PDF with LibreOffice for pixel-exact slides.
//!
//! No third-party crates, no installer framework: copy the one file and run it.
mod ws;
include!(concat!(env!("OUT_DIR"), "/assets.rs"));

use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_WS_MSG: usize = 200 * 1024 * 1024;
const MAX_UPLOAD: usize = 300 * 1024 * 1024;

#[derive(Clone)]
struct Config {
    port: u16,
    media_dir: PathBuf,
    app_dir: Option<PathBuf>,
    pin: String,
    open_browser: bool,
    soffice: Option<PathBuf>,
}

#[derive(PartialEq, Clone, Copy, Debug)]
enum Role { Control, Display }

struct Client { id: u64, role: Role, room: String, writer: Mutex<TcpStream> }

struct State {
    cfg: Config,
    port: u16,
    clients: Mutex<Vec<Arc<Client>>>,
    next_id: AtomicU64,
    assets: HashMap<&'static str, (&'static [u8], bool)>,
    etags: Mutex<HashMap<String, String>>,
}

struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    raw_query: String,
    headers: HashMap<String, String>,
}

// ------------------------------------------------------------------ helpers
fn fnv(data: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in data { h ^= *b as u64; h = h.wrapping_mul(0x100000001b3); }
    format!("\"{:016x}\"", h)
}

fn url_decode_impl(s: &str, plus: bool) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if plus && b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
fn url_decode(s: &str) -> String { url_decode_impl(s, true) }
fn path_decode(s: &str) -> String { url_decode_impl(s, false) }

fn json_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""), '\\' => o.push_str("\\\\"), '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"), '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn mime(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8", "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8", "json" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json", "svg" => "image/svg+xml", "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "ico" => "image/x-icon",
        "woff2" => "font/woff2", "woff" => "font/woff", "pdf" => "application/pdf", "txt" => "text/plain; charset=utf-8",
        "mp4" | "m4v" => "video/mp4", "webm" => "video/webm", "mkv" => "video/x-matroska", "mov" => "video/quicktime",
        "ogv" => "video/ogg", "mp3" => "audio/mpeg", "m4a" | "aac" => "audio/mp4", "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg", "flac" => "audio/flac", "opus" => "audio/opus", "vtt" => "text/vtt",
        _ => "application/octet-stream",
    }
}

fn now_ms() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0) }

fn lan_ips() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for target in ["10.254.254.254:1", "192.168.255.255:1", "8.8.8.8:80"] {
        if let Ok(s) = UdpSocket::bind("0.0.0.0:0") {
            if s.connect(target).is_ok() {
                if let Ok(a) = s.local_addr() {
                    let ip = a.ip();
                    if !ip.is_loopback() && !ip.is_unspecified() {
                        let t = ip.to_string();
                        if !out.contains(&t) { out.push(t); }
                    }
                }
            }
        }
    }
    out
}

fn config_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(env::var("APPDATA").unwrap_or_else(|_| ".".into())).join("Selah").join("companion.txt")
    } else {
        let home = env::var("HOME").unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".config").join("selah").join("companion.txt")
    }
}

fn default_media_dir() -> PathBuf {
    let home = env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap_or_else(|_| ".".into());
    let videos = if cfg!(target_os = "macos") { "Movies" } else { "Videos" };
    PathBuf::from(home).join(videos).join("Selah")
}

fn which(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for dir in env::split_paths(&path) {
        for cand in [name.to_string(), format!("{}.exe", name)] {
            let p = dir.join(&cand);
            if p.is_file() { return Some(p); }
        }
    }
    None
}

fn find_soffice() -> Option<PathBuf> {
    if let Ok(p) = env::var("SELAH_SOFFICE") { let p = PathBuf::from(p); if p.is_file() { return Some(p); } }
    let fixed = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice", "/snap/bin/libreoffice",
        "/opt/libreoffice/program/soffice",
    ];
    for f in fixed { let p = PathBuf::from(f); if p.is_file() { return Some(p); } }
    which("soffice").or_else(|| which("libreoffice"))
}

fn make_pin() -> String {
    let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(7) as u64;
    let x = n ^ (std::process::id() as u64).wrapping_mul(2654435761);
    format!("{:04}", (x.wrapping_mul(0x9E3779B97F4A7C15) >> 32) % 10000)
}

fn open_browser(url: &str) {
    let r = if cfg!(windows) {
        Command::new("cmd").args(["/C", "start", "", url]).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).spawn()
    } else {
        Command::new("xdg-open").arg(url).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    };
    if r.is_err() { println!("  Open {} in Chrome or Edge.", url); }
}

// ------------------------------------------------------------------ HTTP
fn read_request<R: BufRead>(r: &mut R) -> io::Result<Option<Request>> {
    let mut line = String::new();
    if r.read_line(&mut line)? == 0 { return Ok(None); }
    let line = line.trim_end().to_string();
    if line.is_empty() { return read_request(r); }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let mut headers = HashMap::new();
    let mut total = 0usize;
    loop {
        let mut h = String::new();
        let n = r.read_line(&mut h)?;
        if n == 0 { return Ok(None); }
        total += n;
        if total > 32 * 1024 { return Err(io::Error::new(io::ErrorKind::InvalidData, "headers too large")); }
        let h = h.trim_end();
        if h.is_empty() { break; }
        if let Some((k, v)) = h.split_once(':') { headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string()); }
    }
    let (path, qs) = match target.split_once('?') { Some((p, q)) => (p.to_string(), q.to_string()), None => (target.clone(), String::new()) };
    let mut query = HashMap::new();
    for pair in qs.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        query.insert(url_decode(k), url_decode(v));
    }
    Ok(Some(Request { method, path: path_decode(&path), query, raw_query: qs, headers }))
}

// ------------------------------------------------------------------ who may do what
// Any website open in a browser on this PC can make the browser talk to http://localhost:7777 (pages may open
// WebSockets anywhere, and a DNS-rebinding site can even read the answers). So "this PC" alone is not enough
// to skip the PIN: only the companion's own pages count — requests whose Origin is this companion — and the
// Host header must name this machine (a rebinding site's own domain name is refused).

/// The host name without the port ("192.168.1.5:7777" → "192.168.1.5", "[::1]:7777" → "::1").
fn host_name(host: &str) -> String {
    let h = host.trim().to_ascii_lowercase();
    if let Some(rest) = h.strip_prefix('[') { return rest.split(']').next().unwrap_or("").to_string(); }
    h.rsplit_once(':').map(|(a, p)| if p.chars().all(|c| c.is_ascii_digit()) { a.to_string() } else { h.clone() }).unwrap_or(h)
}
fn machine_name() -> String {
    env::var("COMPUTERNAME").or_else(|_| env::var("HOSTNAME")).ok()
        .or_else(|| fs::read_to_string("/etc/hostname").ok())
        .unwrap_or_default().trim().to_ascii_lowercase()
}
/// The Host header names this machine: an IP address, localhost, the computer's name, or a local-network name
/// (.local / .lan / .home / .internal, or a single word). A public domain name (DNS rebinding) is refused.
fn host_ok(req: &Request) -> bool {
    let Some(h) = req.headers.get("host") else { return true }; // HTTP/1.0 tools
    let n = host_name(h);
    if n.is_empty() { return false; }
    if n.parse::<std::net::IpAddr>().is_ok() || n == "localhost" || n.ends_with(".localhost") { return true; }
    let me = machine_name();
    if !me.is_empty() && (n == me || n == format!("{}.local", me)) { return true; }
    !n.contains('.') || n.ends_with(".local") || n.ends_with(".lan") || n.ends_with(".home") || n.ends_with(".internal") || n.ends_with(".home.arpa")
}
/// The request comes from one of the companion's own pages (or from a program, which sends no Origin).
fn same_origin(req: &Request) -> bool {
    match req.headers.get("origin") {
        None => true,
        Some(o) => {
            let o = o.trim().to_ascii_lowercase();
            let host = req.headers.get("host").map(|h| h.trim().to_ascii_lowercase()).unwrap_or_default();
            !host.is_empty() && (o == format!("http://{}", host) || o == format!("https://{}", host))
        }
    }
}

fn send(w: &mut TcpStream, status: &str, ctype: &str, extra: &[(&str, String)], body: &[u8], head: bool) -> io::Result<()> {
    let mut h = format!("HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: keep-alive\r\nX-Content-Type-Options: nosniff\r\n", status, ctype, body.len());
    for (k, v) in extra { h.push_str(&format!("{}: {}\r\n", k, v)); }
    h.push_str("\r\n");
    w.write_all(h.as_bytes())?;
    if !head { w.write_all(body)?; }
    w.flush()
}

fn text(w: &mut TcpStream, status: &str, msg: &str) -> io::Result<()> {
    send(w, status, "text/plain; charset=utf-8", &[], msg.as_bytes(), false)
}

impl State {
    /// Returns (bytes, gzipped).
    fn asset(&self, path: &str) -> Option<(Vec<u8>, bool)> {
        if let Some(dir) = &self.cfg.app_dir {
            let p = safe_join(dir, path)?;
            return fs::read(p).ok().map(|b| (b, false));
        }
        self.assets.get(path).map(|(b, gz)| (b.to_vec(), *gz))
    }
    fn pin_ok(&self, req: &Request, local: bool) -> bool {
        local || req.query.get("pin").map(|p| p == &self.cfg.pin).unwrap_or(false)
            || req.headers.get("x-selah-pin").map(|p| p == &self.cfg.pin).unwrap_or(false)
    }
}

/// Join a URL path onto a base directory, refusing anything that escapes it.
fn safe_join(base: &Path, rel: &str) -> Option<PathBuf> {
    let mut p = base.to_path_buf();
    for comp in rel.split('/') {
        if comp.is_empty() || comp == "." { continue; }
        if comp == ".." || comp.contains('\\') || comp.contains(':') || comp.contains('\0') { return None; }
        p.push(comp);
    }
    let canon_base = fs::canonicalize(base).ok()?;
    let canon = fs::canonicalize(&p).ok()?;
    if canon.starts_with(&canon_base) { Some(canon) } else { None }
}

fn serve_static(st: &State, w: &mut TcpStream, req: &Request) -> io::Result<()> {
    let mut path = req.path.trim_start_matches('/').to_string();
    if path.is_empty() { path = "index.html".into(); }
    if path == "display" || path == "display/" {
        let q = if req.raw_query.is_empty() { String::new() } else { format!("&{}", req.raw_query) };
        return send(w, "302 Found", "text/plain", &[("Location", format!("/display.html?via=ws{}", q))], b"", false);
    }
    if path == "remote" || path == "remote/" {
        let q = if req.raw_query.is_empty() { String::new() } else { format!("&{}", req.raw_query) };
        return send(w, "302 Found", "text/plain", &[("Location", format!("/index.html?remote=1{}", q))], b"", false);
    }
    let (body, gz) = match st.asset(&path) {
        Some(b) => b,
        None => return text(w, "404 Not Found", "Not found"),
    };
    if gz && !req.headers.get("accept-encoding").map(|a| a.contains("gzip")).unwrap_or(false) {
        return text(w, "406 Not Acceptable", "This browser does not accept compressed files");
    }
    let etag = {
        let mut cache = st.etags.lock().unwrap();
        cache.entry(path.clone()).or_insert_with(|| fnv(&body)).clone()
    };
    if req.headers.get("if-none-match").map(|v| v == &etag).unwrap_or(false) {
        return send(w, "304 Not Modified", mime(&path), &[("ETag", etag)], b"", true);
    }
    let mut hdrs = vec![("ETag", etag), ("Cache-Control", "no-cache".into()), ("Vary", "Accept-Encoding".into())];
    if gz { hdrs.push(("Content-Encoding", "gzip".into())); }
    send(w, "200 OK", mime(&path), &hdrs, &body, req.method == "HEAD")
}

fn serve_media(st: &State, w: &mut TcpStream, req: &Request) -> io::Result<()> {
    let rel = req.path.trim_start_matches("/media/");
    let p = match safe_join(&st.cfg.media_dir, rel) { Some(p) if p.is_file() => p, _ => return text(w, "404 Not Found", "Not found") };
    let mut f = File::open(&p)?;
    let len = f.metadata()?.len();
    let ctype = mime(&p.to_string_lossy());
    let (mut start, mut end, mut partial) = (0u64, len.saturating_sub(1), false);
    if let Some(r) = req.headers.get("range") {
        if let Some(spec) = r.strip_prefix("bytes=") {
            let spec = spec.split(',').next().unwrap_or("");
            if let Some((a, b)) = spec.split_once('-') {
                if a.is_empty() {
                    let n: u64 = b.parse().unwrap_or(0);
                    start = len.saturating_sub(n);
                } else {
                    start = a.parse().unwrap_or(0);
                    if !b.is_empty() { end = b.parse().unwrap_or(end).min(len.saturating_sub(1)); }
                }
                partial = true;
            }
        }
    }
    if partial && (start >= len || start > end) {
        return send(w, "416 Range Not Satisfiable", "text/plain", &[("Content-Range", format!("bytes */{}", len))], b"", false);
    }
    let count = if len == 0 { 0 } else { end - start + 1 };
    let mut h = format!("HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: keep-alive\r\nCache-Control: no-cache\r\n",
        if partial { "206 Partial Content" } else { "200 OK" }, ctype, count);
    if partial { h.push_str(&format!("Content-Range: bytes {}-{}/{}\r\n", start, end, len)); }
    h.push_str("\r\n");
    w.write_all(h.as_bytes())?;
    if req.method == "HEAD" { return w.flush(); }
    f.seek(SeekFrom::Start(start))?;
    let mut left = count;
    let mut buf = vec![0u8; 256 * 1024];
    while left > 0 {
        let want = left.min(buf.len() as u64) as usize;
        let n = f.read(&mut buf[..want])?;
        if n == 0 { break; }
        w.write_all(&buf[..n])?;
        left -= n as u64;
    }
    w.flush()
}

const MEDIA_EXT: &[&str] = &["mp4", "m4v", "webm", "mkv", "mov", "ogv", "mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "opus", "jpg", "jpeg", "png", "webp", "gif", "pdf"];

fn list_media(dir: &Path, base: &Path, depth: u32, out: &mut Vec<String>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        if p.is_dir() { if depth < 2 { list_media(&p, base, depth + 1, out); } continue; }
        let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        if !MEDIA_EXT.contains(&ext.as_str()) { continue; }
        let rel = p.strip_prefix(base).unwrap_or(&p).to_string_lossy().replace('\\', "/");
        let md = e.metadata().ok();
        let size = md.as_ref().map(|m| m.len()).unwrap_or(0);
        let mtime = md.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
        out.push(format!("{{\"name\":{},\"size\":{},\"mtime\":{},\"type\":{}}}", json_str(&rel), size, mtime, json_str(mime(&name))));
    }
}

fn convert(st: &State, w: &mut TcpStream, req: &Request, reader: &mut BufReader<TcpStream>) -> io::Result<()> {
    let len: usize = req.headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if len == 0 || len > MAX_UPLOAD { return text(w, "413 Payload Too Large", "File missing or too large"); }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body)?;
    let Some(soffice) = st.cfg.soffice.clone() else { return text(w, "501 Not Implemented", "LibreOffice is not installed on this PC") };
    let name = url_decode(req.headers.get("x-filename").map(|s| s.as_str()).unwrap_or("slides.pptx"));
    let ext = name.rsplit('.').next().unwrap_or("pptx").to_ascii_lowercase();
    let ext = if ["pptx", "ppt", "odp", "pps", "ppsx"].contains(&ext.as_str()) { ext } else { "pptx".to_string() };
    let dir = env::temp_dir().join(format!("selah-convert-{}", now_ms()));
    fs::create_dir_all(&dir)?;
    let input = dir.join(format!("slides.{}", ext));
    fs::write(&input, &body)?;
    let profile = env::temp_dir().join("selah-lo-profile");
    let profile_url = format!("file://{}{}", if cfg!(windows) { "/" } else { "" }, profile.to_string_lossy().replace('\\', "/"));
    let mut child = Command::new(&soffice)
        .arg(format!("-env:UserInstallation={}", profile_url))
        .args(["--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir"])
        .arg(&dir).arg(&input)
        .stdout(Stdio::null()).stderr(Stdio::null()).spawn()?;
    let t0 = Instant::now();
    loop {
        if let Some(_) = child.try_wait()? { break; }
        if t0.elapsed() > Duration::from_secs(180) { let _ = child.kill(); break; }
        thread::sleep(Duration::from_millis(150));
    }
    let pdf = dir.join("slides.pdf");
    let res = fs::read(&pdf);
    let _ = fs::remove_dir_all(&dir);
    match res {
        Ok(b) => { println!("  Converted {} ({} KB → PDF {} KB)", name, len / 1024, b.len() / 1024); send(w, "200 OK", "application/pdf", &[], &b, false) }
        Err(_) => text(w, "500 Internal Server Error", "LibreOffice could not convert this file"),
    }
}

fn api_info(st: &State, w: &mut TcpStream, local: bool) -> io::Result<()> {
    let urls: Vec<String> = lan_ips().iter().map(|ip| json_str(&format!("http://{}:{}", ip, st.port))).collect();
    let body = format!(
        "{{\"app\":\"selah-companion\",\"version\":{},\"urls\":[{}],\"converter\":{},\"mediaDir\":{},\"pin\":{},\"local\":{}}}",
        json_str(VERSION), urls.join(","), st.cfg.soffice.is_some(),
        json_str(&if local { st.cfg.media_dir.to_string_lossy().to_string() } else { String::new() }),
        if local { json_str(&st.cfg.pin) } else { "null".into() }, local);
    send(w, "200 OK", "application/json", &[("Cache-Control", "no-store".into())], body.as_bytes(), false)
}

// ------------------------------------------------------------------ WebSocket relay
fn handle_ws(st: Arc<State>, mut stream: TcpStream, mut reader: BufReader<TcpStream>, req: Request, local: bool) {
    let Some(key) = req.headers.get("sec-websocket-key") else { let _ = text(&mut stream, "400 Bad Request", "Not a WebSocket request"); return };
    let role = if req.query.get("role").map(|r| r == "display").unwrap_or(false) { Role::Display } else { Role::Control };
    let room = req.query.get("room").cloned().unwrap_or_else(|| "main".into());
    let resp = format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n", ws::accept_key(key));
    if stream.write_all(resp.as_bytes()).is_err() { return; }
    // Controllers on other devices need the PIN; displays only receive what is shown publicly. A page from
    // another website (its Origin is not this companion) always needs the PIN, whatever it asks to be.
    let foreign = !same_origin(&req);
    if (role == Role::Control || foreign) && !st.pin_ok(&req, local) {
        let mut p = vec![0x0F, 0xA1];
        p.extend_from_slice(b"wrong pin");
        let _ = ws::write_frame(&mut stream, 0x8, &p);
        return;
    }
    let _ = stream.set_read_timeout(None);
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let Ok(wr) = stream.try_clone() else { return };
    let id = st.next_id.fetch_add(1, Ordering::SeqCst);
    let me = Arc::new(Client { id, role, room: room.clone(), writer: Mutex::new(wr) });
    st.clients.lock().unwrap().push(me.clone());
    println!("  {} connected ({:?}, room {})", if role == Role::Display { "Display" } else { "Controller" }, stream.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default(), room);
    loop {
        match ws::read_msg(&mut reader, MAX_WS_MSG) {
            Ok(ws::Msg::Text(d)) => relay(&st, &me, 0x1, &d),
            Ok(ws::Msg::Binary(d)) => relay(&st, &me, 0x2, &d),
            Ok(ws::Msg::Ping(p)) => { let _ = ws::write_frame(&mut *me.writer.lock().unwrap(), 0xA, &p); }
            Ok(ws::Msg::Pong) => {}
            Ok(ws::Msg::Close) | Err(_) => break,
        }
    }
    st.clients.lock().unwrap().retain(|c| c.id != id);
    let _ = ws::write_frame(&mut *me.writer.lock().unwrap(), 0x8, &[0x03, 0xE8]);
    println!("  {} disconnected", if role == Role::Display { "Display" } else { "Controller" });
}

fn relay(st: &State, from: &Client, op: u8, data: &[u8]) {
    let targets: Vec<Arc<Client>> = st.clients.lock().unwrap().iter()
        .filter(|c| c.id != from.id && c.room == from.room && c.role != from.role).cloned().collect();
    let mut dead = Vec::new();
    for t in targets {
        let mut w = t.writer.lock().unwrap();
        if ws::write_frame(&mut *w, op, data).is_err() { dead.push(t.id); }
    }
    if !dead.is_empty() { st.clients.lock().unwrap().retain(|c| !dead.contains(&c.id)); }
}

// ------------------------------------------------------------------ connection loop
fn handle_conn(st: Arc<State>, stream: TcpStream) {
    let from_this_pc = stream.peer_addr().map(|a| a.ip().is_loopback()).unwrap_or(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
    let _ = stream.set_nodelay(true);
    let Ok(rs) = stream.try_clone() else { return };
    let mut reader = BufReader::with_capacity(64 * 1024, rs);
    let mut w = stream;
    loop {
        let req = match read_request(&mut reader) { Ok(Some(r)) => r, _ => return };
        if !host_ok(&req) { let _ = text(&mut w, "421 Misdirected Request", "Unknown host name"); return; }
        // No PIN only for the companion's own pages on this PC (see same_origin).
        let local = from_this_pc && same_origin(&req);
        let upgrade = req.headers.get("upgrade").map(|u| u.eq_ignore_ascii_case("websocket")).unwrap_or(false);
        if upgrade && req.path == "/ws" { handle_ws(st, w, reader, req, local); return; }
        let res = match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/api/info") => api_info(&st, &mut w, local),
            ("GET", "/api/media") => {
                if !st.pin_ok(&req, local) { text(&mut w, "403 Forbidden", "PIN required") }
                else {
                    let _ = fs::create_dir_all(&st.cfg.media_dir);
                    let mut items = Vec::new();
                    list_media(&st.cfg.media_dir, &st.cfg.media_dir, 0, &mut items);
                    send(&mut w, "200 OK", "application/json", &[("Cache-Control", "no-store".into())], format!("[{}]", items.join(",")).as_bytes(), false)
                }
            }
            ("POST", "/api/convert") => {
                if !st.pin_ok(&req, local) { text(&mut w, "403 Forbidden", "PIN required") } else { convert(&st, &mut w, &req, &mut reader) }
            }
            ("GET", p) | ("HEAD", p) if p.starts_with("/media/") => serve_media(&st, &mut w, &req),
            ("GET", _) | ("HEAD", _) => serve_static(&st, &mut w, &req),
            ("OPTIONS", _) => send(&mut w, "204 No Content", "text/plain", &[("Allow", "GET, HEAD, POST".into())], b"", false),
            _ => text(&mut w, "405 Method Not Allowed", "Method not allowed"),
        };
        if res.is_err() { return; }
        if req.headers.get("connection").map(|c| c.eq_ignore_ascii_case("close")).unwrap_or(false) { return; }
    }
}

// ------------------------------------------------------------------ install (one go)
fn install() -> io::Result<()> {
    let exe = env::current_exe()?;
    if cfg!(windows) {
        let dir = PathBuf::from(env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into())).join("Selah");
        fs::create_dir_all(&dir)?;
        let target = dir.join("selah.exe");
        if exe != target { fs::copy(&exe, &target)?; }
        let t = target.to_string_lossy().replace('\'', "''");
        let script = format!(
            "$w=New-Object -ComObject WScript.Shell;\
             foreach($p in @([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('Desktop'))){{\
             Remove-Item -ErrorAction SilentlyContinue (Join-Path $p 'Selah.lnk');$s=$w.CreateShortcut((Join-Path $p 'SDA Sabbath.lnk'));$s.TargetPath='{0}';$s.WorkingDirectory='{1}';$s.IconLocation='{0}';$s.Description='SDA Sabbath church presenter';$s.Save()}}",
            t, dir.to_string_lossy().replace('\'', "''"));
        let ok = Command::new("powershell").args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script]).status().map(|s| s.success()).unwrap_or(false);
        println!("Installed to {}", target.display());
        println!("{}", if ok { "Shortcuts added to the Start menu and the desktop." } else { "Could not create shortcuts; run selah.exe from that folder." });
    } else {
        let home = PathBuf::from(env::var("HOME").unwrap_or_else(|_| ".".into()));
        let bin = home.join(".local").join("bin");
        fs::create_dir_all(&bin)?;
        let target = bin.join("selah");
        if exe != target { fs::copy(&exe, &target)?; }
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&target, fs::Permissions::from_mode(0o755))?; }
        if cfg!(target_os = "linux") {
            let apps = home.join(".local").join("share").join("applications");
            fs::create_dir_all(&apps)?;
            fs::write(apps.join("selah.desktop"), format!("[Desktop Entry]\nType=Application\nName=SDA Sabbath\nComment=Church presenter\nExec={}\nTerminal=true\nCategories=Office;Presentation;\n", target.display()))?;
        }
        println!("Installed to {}", target.display());
    }
    Ok(())
}

fn load_config() -> Config {
    let mut kv: HashMap<String, String> = HashMap::new();
    let path = config_path();
    if let Ok(s) = fs::read_to_string(&path) {
        for line in s.lines() { if let Some((k, v)) = line.split_once('=') { kv.insert(k.trim().into(), v.trim().into()); } }
    }
    let mut cfg = Config {
        port: kv.get("port").and_then(|p| p.parse().ok()).unwrap_or(7777),
        media_dir: kv.get("media").map(PathBuf::from).unwrap_or_else(default_media_dir),
        app_dir: None,
        pin: kv.get("pin").cloned().unwrap_or_else(make_pin),
        open_browser: true,
        soffice: None,
    };
    let args: Vec<String> = env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        let next = args.get(i + 1).cloned();
        match a {
            "--port" | "-p" => { if let Some(v) = next { cfg.port = v.parse().unwrap_or(7777); i += 1; } }
            "--media" | "-m" => { if let Some(v) = next { cfg.media_dir = PathBuf::from(v); i += 1; } }
            "--app-dir" => { if let Some(v) = next { cfg.app_dir = Some(PathBuf::from(v)); i += 1; } }
            "--pin" => { if let Some(v) = next { cfg.pin = v; i += 1; } }
            "--no-browser" => cfg.open_browser = false,
            "--install" => { match install() { Ok(_) => {}, Err(e) => eprintln!("Install failed: {}", e) } std::process::exit(0); }
            "--version" | "-V" => { println!("selah-companion {}", VERSION); std::process::exit(0); }
            "--help" | "-h" => {
                println!("SDA Sabbath companion {}\n\nUsage: selah [options]\n  --port N        port to use (default 7777)\n  --media DIR     folder with videos/pictures to share (default ~/Videos/Selah)\n  --pin NNNN      PIN phones must enter to control the screen\n  --no-browser    do not open the browser\n  --install       copy SDA Sabbath into your user folder and add shortcuts\n  --app-dir DIR   serve app files from DIR instead of the built-in copy\n\nSettings are kept in {}", VERSION, config_path().display());
                std::process::exit(0);
            }
            _ => {}
        }
        i += 1;
    }
    let _ = fs::create_dir_all(path.parent().unwrap_or(Path::new(".")));
    let _ = fs::write(&path, format!("port={}\npin={}\nmedia={}\n", cfg.port, cfg.pin, cfg.media_dir.display()));
    cfg.soffice = find_soffice();
    cfg
}

fn main() {
    let cfg = load_config();
    let _ = fs::create_dir_all(&cfg.media_dir);
    let mut listener = None;
    let mut port = cfg.port;
    for p in cfg.port..cfg.port + 10 {
        if let Ok(l) = TcpListener::bind(("0.0.0.0", p)) { listener = Some(l); port = p; break; }
    }
    let Some(listener) = listener else { eprintln!("Could not open port {}. Is SDA Sabbath already running?", cfg.port); std::process::exit(1) };
    let assets: HashMap<&'static str, (&'static [u8], bool)> = ASSETS.iter().map(|(k, v, g)| (*k, (*v, *g))).collect();
    let st = Arc::new(State { cfg: cfg.clone(), port, clients: Mutex::new(Vec::new()), next_id: AtomicU64::new(1), assets, etags: Mutex::new(HashMap::new()) });

    let local_url = format!("http://localhost:{}/", port);
    println!("\n  SDA Sabbath companion {}  ({} files, {:.1} MB built in)", VERSION, ASSETS.len(), ASSET_BYTES as f64 / 1048576.0);
    println!("  ------------------------------------------------------------");
    println!("  On this PC:        {}", local_url);
    for ip in lan_ips() {
        println!("  Phone remote:      http://{}:{}/remote      PIN {}", ip, port, cfg.pin);
        println!("  TV / 2nd screen:   http://{}:{}/display", ip, port);
    }
    println!("  Media folder:      {}", cfg.media_dir.display());
    println!("  PowerPoint → PDF:  {}", match &cfg.soffice { Some(p) => format!("LibreOffice ({})", p.display()), None => "not available (install LibreOffice for exact slides)".into() });
    println!("  ------------------------------------------------------------");
    println!("  Keep this window open during the service. Close it to stop SDA Sabbath's network features.\n");
    if cfg.open_browser { open_browser(&local_url); }

    for conn in listener.incoming() {
        match conn {
            Ok(s) => { let st = st.clone(); thread::spawn(move || handle_conn(st, s)); }
            Err(e) => eprintln!("  connection error: {}", e),
        }
    }
}
