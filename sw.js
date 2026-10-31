// Church Service service worker: installs the whole app (Bibles, hymns, fonts, pdf.js) in one go
// so it runs with no internet. VERSION is rewritten by tools/build.py on every build.
const VERSION = '4830d2f15772';
// Caches are named per address ('selah-/Church_Service/|<version>'), so two apps on the same site
// (for example this one and an older copy under another folder) never delete each other's offline files.
const SCOPE = new URL(self.registration.scope).pathname;
const PREFIX = 'selah-' + SCOPE + '|';
const CACHE = PREFIX + VERSION;
const LEGACY = /^selah-[0-9a-f]{6,}$/; // the first versions: one shared name, 'selah-<hash>'
const NETWORK_ONLY = /\/(api|media|ws|download)(\/|$)|\/(hq|studio)\.sf3$/; // the optional sound packs keep their own cache (musicengine.js)

async function broadcast(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  cs.forEach((c) => c.postMessage(msg));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * fetch() that cannot hang: Wi-Fi with no internet ("lie-fi") leaves requests open forever. It gives up when the
 * answer does not start within headMs, or when the download stalls for stallMs (a slow line that keeps moving is
 * fine). The whole body is read here, so a file cut off half-way is an error, not a short file.
 */
async function fetchT(url, opts = {}, headMs = 15000, stallMs = 20000) {
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(), headMs);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: ctl.signal }));
    clearTimeout(timer);
    if (!r.ok || !r.body) return r;
    const reader = r.body.getReader();
    const parts = [];
    for (;;) {
      timer = setTimeout(() => ctl.abort(), stallMs);
      const { done, value } = await reader.read();
      clearTimeout(timer);
      if (done) break;
      parts.push(value);
    }
    return new Response(new Blob(parts, { type: r.headers.get('content-type') || '' }), { status: r.status, statusText: r.statusText, headers: r.headers });
  } finally { clearTimeout(timer); }
}
/** fetch() that tries again a few times: church Wi-Fi and phone hotspots drop requests. */
async function fetchRetry(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetchT(url, opts); if (r.ok) return r; last = new Error('HTTP ' + r.status); if (r.status === 404) break; }
    catch (e) { last = e; }
    if (i < tries - 1) await sleep(400 * (i + 1));
  }
  throw last || new Error('fetch failed');
}
/** First 16 hex digits of the SHA-256 of a body: the same fingerprint tools/build.py writes into the file list. */
async function sha16(blob) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  let s = '';
  for (let i = 0; i < 8; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}
// A Wi-Fi login page ("captive portal") or a proxy error answers with an HTML page and status 200 in place of the
// file. Such an answer is never stored as an app file.
const htmlInstead = (f, r) => !/\.html?$/.test(f) && /text\/html/i.test(r.headers.get('content-type') || '');
/**
 * The response with its content checked against the file list: returns a stored-ready copy stamped as checked,
 * or null when it is not the real file (wrong content, a login page, a stale copy from a cache).
 */
async function verified(f, r, want) {
  if (!r || htmlInstead(f, r)) return null;
  const blob = await r.blob();
  if (want && (await sha16(blob)) !== want) return null;
  const hd = new Headers(r.headers);
  if (want) { hd.set('x-selah-hash', want); hd.set('x-selah-ok', want); }
  return new Response(blob, { status: 200, statusText: 'OK', headers: hd });
}
/** A stored copy that was checked against this fingerprint already (cheap: a header). */
const checkedFor = (r, want) => !!(r && want && r.headers.get('x-selah-ok') === want);
// The app itself: without these nothing starts. The first install must store all of them before it takes over;
// Bibles, hymns, music and the rest may follow later (the self-check fetches what is missing).
const SHELL = (f) => /\.(html|webmanifest)$/.test(f) || /^(js|css|fonts|icons)\//.test(f);
const appCaches = async () => (await caches.keys()).filter((k) => k.startsWith(PREFIX));
/** Old-style caches whose files all belong to this app's address: they are ours to reuse and then remove.
 *  A cache holding another app's files (or nothing we can recognise) is left alone. */
async function legacyOwn() {
  const mine = [];
  for (const k of (await caches.keys()).filter((n) => LEGACY.test(n))) {
    try {
      const reqs = await (await caches.open(k)).keys();
      if (reqs.length && reqs.every((r) => new URL(r.url).pathname.startsWith(SCOPE))) mine.push(k);
    } catch (e) { /* unreadable: leave it */ }
  }
  return mine;
}
/** The file from any stored version (newest first): an older copy is far better than nothing offline. */
async function fromAnyCache(req, except) {
  const keys = (await appCaches()).concat(await legacyOwn()).filter((k) => k !== except).reverse();
  for (const k of keys) { const r = await (await caches.open(k)).match(req, { ignoreSearch: true }); if (r) return r; }
  return null;
}

let manifest = null;
async function getManifest() {
  if (manifest) return manifest;
  const r = await (await caches.open(CACHE)).match('asset-manifest.json');
  if (r) manifest = await r.json();
  return manifest;
}

self.addEventListener('install', (event) => {
  // First install: take over at once. Updates wait until the operator presses "Update now"
  // (the page sends {t:'skip'}), so a running service is never switched mid-way.
  const first = !self.registration.active;
  if (first) self.skipWaiting();
  event.waitUntil((async () => {
    const manRes = await fetchRetry('asset-manifest.json?v=' + VERSION, { cache: 'no-store' });
    const cache = await caches.open(CACHE);
    // Keep the file list too: the app reads it offline (offline status, optional licensed Bibles).
    await cache.put('asset-manifest.json', manRes.clone());
    const man = await manRes.json();
    manifest = man;
    const files = man.files;
    const hashes = man.hashes || {};
    const older = (await appCaches()).filter((k) => k !== CACHE).concat(await legacyOwn());
    // A file whose content did not change is copied from the previous version's cache, so an
    // update only downloads what is new (the instruments and hymn music are about 6 MB). Its content is checked
    // (once), so a login page stored by an older version is never carried over.
    async function unchanged(f) {
      const want = hashes[f];
      if (!want) return null;
      for (const k of older) {
        const r = await (await caches.open(k)).match(f);
        if (!r || r.headers.get('x-selah-hash') !== want) continue;
        if (checkedFor(r, want)) return r;
        const ok = await verified(f, r, want);
        if (ok) return ok;
      }
      return null;
    }
    /** Download one file and store it only if it is the real file (checked against the file list). */
    async function getOne(f) {
      const here = await cache.match(f);                 // an earlier, interrupted attempt
      if (here && (checkedFor(here, hashes[f]) || !hashes[f]) && !htmlInstead(f, here)) return;
      const old = await unchanged(f);
      if (old) { await cache.put(f, old); return; }
      const ok = await verified(f, await fetchRetry(f, { cache: 'no-cache' }), hashes[f]);
      if (!ok) throw new Error('not the real file: ' + f);
      await cache.put(f, ok);
    }
    let done = 0, streak = 0;
    const missing = [];
    const shell = files.filter(SHELL), rest = files.filter((f) => !SHELL(f));
    // Small batches keep memory and connections low on weak devices. The app itself comes first.
    for (const [group, isShell] of [[shell, true], [rest, false]]) {
      for (let i = 0; i < group.length; i += 6) {
        const batch = group.slice(i, i + 6);
        // No answers at all for a while (no internet): stop trying the data now; the self-check fetches it later.
        if (!isShell && !older.length && streak >= 12) { batch.forEach((f) => missing.push(f)); done += batch.length; continue; }
        await Promise.all(batch.map(async (f) => {
          try { await getOne(f); streak = 0; } catch (e) { missing.push(f); streak++; }
          done++;
        }));
        broadcast({ t: 'progress', done, total: files.length });
      }
      // Without the app itself, a first install never takes over: the next visit tries again.
      if (isShell && !older.length && missing.length) {
        broadcast({ t: 'health', total: files.length, missing: missing.length, install: 'failed' });
        throw new Error('First install incomplete: ' + missing.length + ' app files');
      }
    }
    if (missing.length && older.length) {
      // An update that could not download everything is not used: the working version stays in
      // charge (fully offline) and the update is tried again later. Nothing is ever half-updated.
      broadcast({ t: 'health', total: files.length, missing: missing.length, update: 'failed' });
      throw new Error('Update incomplete: ' + missing.length + ' files');
    }
    if (missing.length) broadcast({ t: 'health', total: files.length, missing: missing.length });
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = (await appCaches()).concat(await legacyOwn());
    const cache = await caches.open(CACHE);
    const man = await getManifest();
    // Before an old version is removed, anything the new one lacks is copied across.
    if (man) {
      const hashes = man.hashes || {};
      for (const f of man.files) {
        if (await cache.match(f)) continue;
        const r = await fromAnyCache(f, CACHE);
        const ok = r && (checkedFor(r, hashes[f]) ? r : await verified(f, r, hashes[f]));
        if (ok) await cache.put(f, ok);
      }
    }
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    broadcast({ t: 'progress', done: 1, total: 1 });
  })());
});

/** Is every app file stored, and is each one the real file? Missing files are downloaded again when there is
 *  internet. One check at a time (the first one reads every file once to check it; later ones are quick). */
let checking = Promise.resolve();
function checkAndRepair(repair) {
  const run = checking.then(() => checkOnce(repair));
  checking = run.catch(() => {});
  return run;
}
async function checkOnce(repair) {
  const man = await getManifest();
  if (!man) return { total: 0, have: 0, missing: [] };
  const cache = await caches.open(CACHE);
  const hashes = man.hashes || {};
  const missing = [];
  let bad = 0;
  for (const f of man.files) {
    const r = await cache.match(f);
    if (!r) { missing.push(f); continue; }
    if (checkedFor(r, hashes[f]) || (!hashes[f] && !htmlInstead(f, r))) continue;
    // Not checked yet (stored by an older version): check it once; a wrong file counts as missing.
    const ok = await verified(f, r, hashes[f]).catch(() => null);
    if (ok) await cache.put(f, ok);
    else { await cache.delete(f); missing.push(f); bad++; }
  }
  let fixed = 0;
  if (repair && missing.length) {
    for (const f of missing.slice()) {
      try {
        const ok = await verified(f, await fetchRetry(f, { cache: 'no-cache' }, 2), hashes[f]);
        if (!ok) throw new Error('not the real file');
        await cache.put(f, ok); fixed++; missing.splice(missing.indexOf(f), 1);
      } catch (e) {
        const old = await fromAnyCache(f, CACHE);
        const ok = old && (checkedFor(old, hashes[f]) ? old : await verified(f, old, hashes[f]).catch(() => null));
        if (ok) { await cache.put(f, ok); fixed++; missing.splice(missing.indexOf(f), 1); }
      }
    }
  }
  return { total: man.files.length, have: man.files.length - missing.length, missing: missing.slice(0, 20), missingCount: missing.length, fixed, bad, version: VERSION };
}

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.t === 'skip') self.skipWaiting();
  if (d.t === 'check') {
    const reply = (m) => { try { e.source && e.source.postMessage(m); } catch (er) { /* */ } };
    e.waitUntil(checkAndRepair(!!d.repair).then((r) => reply(Object.assign({ t: 'health' }, r))).catch((er) => reply({ t: 'health', error: String(er) })));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || NETWORK_ONLY.test(url.pathname)) return;
  if (req.headers.get('range')) return; // media byte ranges go to the network / companion
  const rel = url.pathname.startsWith(SCOPE) ? url.pathname.slice(SCOPE.length) : url.pathname.replace(/^\//, '');
  const nav = req.mode === 'navigate';
  // A deep or odd address (…/index.html/, …/some/path, …/tab/bible): the page's own files would be looked for in
  // the wrong folder, so send it to the start page in the app's folder. (…/stage/ is the stage screen.)
  if (nav && rel.includes('/')) {
    const to = /^stage\/$/.test(rel) ? 'stage.html' : 'index.html';
    event.respondWith(Response.redirect(new URL(to + url.search + url.hash, self.registration.scope).href, 302));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const isPage = nav || /\.html$/.test(url.pathname);
    // The short address for phones (…/stage or …/stage/) is the stage screen page.
    const isStage = /\/stage\/?$/.test(url.pathname) || /\/stage\.html$/.test(url.pathname);
    let hit = await cache.match(req, { ignoreSearch: isPage });
    if (!hit && isPage && rel === '') hit = await cache.match('index.html'); // the folder address people bookmark
    if (!hit && isStage) hit = await cache.match('stage.html', { ignoreSearch: true });
    if (!hit && isPage) hit = await cache.match(req, { ignoreSearch: true });
    if (!hit && /[?&](v|r)=/.test(url.search)) hit = await cache.match(req, { ignoreSearch: true }); // cache-busting retries
    if (hit && htmlInstead(url.pathname, hit)) { event.waitUntil(cache.delete(req).catch(() => {})); hit = null; } // a stored login page
    if (hit) return hit;
    try {
      // Never wait forever (Wi-Fi with no internet): pages give up after 4 s, other files after 8 s.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), isPage ? 4000 : 8000);
      let res;
      try { res = await fetch(req, { signal: ctl.signal }); } finally { clearTimeout(timer); }
      if (!res.ok && isPage) throw new Error('HTTP ' + res.status);
      // Keep a copy of app files that were missing, and of extra data added later (licensed Bibles) — only
      // the real file: checked against the file list, and never a login page in place of data.
      if (res.ok && res.type === 'basic' && /\/(js|css|data|vendor|fonts|icons)\/|\.(html|webmanifest)$/.test(url.pathname) && !htmlInstead(url.pathname, res)) {
        const copy = res.clone();
        event.waitUntil((async () => {
          const man = await getManifest();
          const want = man && man.hashes && man.hashes[rel];
          const ok = await verified(url.pathname, copy, want);
          if (ok) await cache.put(isPage ? new Request(url.pathname) : req, ok);
        })().catch(() => {}));
      }
      return res;
    } catch (e) {
      // No internet: an older stored copy, then the app's start page for any page.
      const old = await fromAnyCache(req, CACHE);
      if (old) return old;
      if (isPage) {
        const page = await cache.match(/display\.html/.test(url.pathname) ? 'display.html' : isStage ? 'stage.html' : /\.html$/.test(url.pathname) ? url.pathname.split('/').pop() : 'index.html', { ignoreSearch: true })
          || await cache.match('index.html', { ignoreSearch: true }) || await fromAnyCache('index.html', CACHE);
        if (page) return page;
      }
      return new Response('Offline and not stored on this device: ' + url.pathname, { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
