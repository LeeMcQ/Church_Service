// Embeds every file listed in ../asset-manifest.json (plus the service worker and the
// manifest itself) into the binary, so one .exe contains the whole app.
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let app_dir = env::var("SELAH_APP_DIR").map(PathBuf::from).unwrap_or_else(|_| {
        Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("..")
    });
    let app_dir = fs::canonicalize(&app_dir).expect("app dir");
    let manifest = app_dir.join("asset-manifest.json");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rerun-if-env-changed=SELAH_APP_DIR");

    let text = fs::read_to_string(&manifest)
        .expect("asset-manifest.json missing: run `python tools/build.py` first");
    let mut files: Vec<String> = Vec::new();
    // Minimal JSON string-array extraction for the "files" key.
    if let Some(start) = text.find("\"files\"") {
        let rest = &text[start..];
        let open = rest.find('[').expect("files array");
        let close = rest.find(']').expect("files array end");
        let mut cur = String::new();
        let mut in_str = false;
        let mut esc = false;
        for ch in rest[open + 1..close].chars() {
            if in_str {
                if esc { cur.push(ch); esc = false; }
                else if ch == '\\' { esc = true; }
                else if ch == '"' { in_str = false; files.push(std::mem::take(&mut cur)); }
                else { cur.push(ch); }
            } else if ch == '"' { in_str = true; }
        }
    }
    files.push("asset-manifest.json".into());
    files.push("sw.js".into());

    // (path, bytes, gzipped). Text files come pre-compressed from tools/build.py (companion/embed/).
    let embed = app_dir.join("companion").join("embed");
    let mut out = String::from("pub static ASSETS: &[(&str, &[u8], bool)] = &[\n");
    let mut total = 0u64;
    for f in &files {
        let gz = embed.join(format!("{}.gz", f));
        let (p, is_gz) = if gz.is_file() { (gz, true) } else { (app_dir.join(f), false) };
        if !p.is_file() { continue; }
        total += fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
        println!("cargo:rerun-if-changed={}", p.display());
        out.push_str(&format!("    ({:?}, include_bytes!({:?}), {}),\n", f, p.to_string_lossy(), is_gz));
    }
    out.push_str("];\n");
    out.push_str(&format!("pub const ASSET_BYTES: u64 = {};\n", total));
    let dest = Path::new(&env::var("OUT_DIR").unwrap()).join("assets.rs");
    fs::write(dest, out).unwrap();
}
