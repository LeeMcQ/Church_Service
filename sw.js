// SDA Sabbath service worker: installs the whole app (Bibles, hymns, fonts, pdf.js) in one go
// so it runs with no internet. VERSION is rewritten by tools/build.py on every build.
const VERSION = 'ce2fcfdd359d';
const CACHE = 'selah-' + VERSION; // prefix kept from the first name so old caches are found and removed
const NETWORK_ONLY = /\/(api|media|ws)(\/|$)/;

async function broadcast(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  cs.forEach((c) => c.postMessage(msg));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** fetch() that tries again a few times: church Wi-Fi and phone hotspots drop requests. */
async function fetchRetry(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, opts); if (r.ok) return r; last = new Error('HTTP ' + r.status); if (r.status === 404) break; }
    catch (e) { last = e; }
    await sleep(400 * (i + 1));
  }
  throw last || new Error('fetch failed');
}
const appCaches = async () => (await caches.keys()).filter((k) => k.startsWith('selah-'));
/** The file from any stored version (newest first): an older copy is far better than nothing offline. */
async function fromAnyCache(req, except) {
  const keys = (await appCaches()).filter((k) => k !== except).reverse();
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
    const older = (await appCaches()).filter((k) => k !== CACHE);
    // A file whose content did not change is copied from the previous version's cache, so an
    // update only downloads what is new (the instruments and hymn music are 18 MB).
    async function unchanged(f) {
      const want = hashes[f];
      if (!want) return null;
      for (const k of older) {
        const r = await (await caches.open(k)).match(f);
        if (r && r.headers.get('x-selah-hash') === want) return r;
      }
      return null;
    }
    async function stamp(f, r) {
      if (!hashes[f]) return r;
      const hd = new Headers(r.headers);
      hd.set('x-selah-hash', hashes[f]);
      return new Response(await r.blob(), { status: 200, statusText: 'OK', headers: hd });
    }
    let done = 0;
    const missing = [];
    // Small batches keep memory and connections low on weak devices.
    for (let i = 0; i < files.length; i += 6) {
      await Promise.all(files.slice(i, i + 6).map(async (f) => {
        try {
          if (await cache.match(f)) { done++; return; } // already there (an earlier, interrupted attempt)
          const old = await unchanged(f);
          if (old) await cache.put(f, old);
          else await cache.put(f, await stamp(f, await fetchRetry(f, { cache: 'no-cache' })));
        } catch (e) { missing.push(f); }
        done++;
      }));
      broadcast({ t: 'progress', done, total: files.length });
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
    const keys = await appCaches();
    const cache = await caches.open(CACHE);
    const man = await getManifest();
    // Before an old version is removed, anything the new one lacks is copied across.
    if (man) {
      for (const f of man.files) {
        if (await cache.match(f)) continue;
        const r = await fromAnyCache(f, CACHE);
        if (r) await cache.put(f, r);
      }
    }
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    broadcast({ t: 'progress', done: 1, total: 1 });
  })());
});

/** Is every app file stored? Missing files are downloaded again when there is internet. */
async function checkAndRepair(repair) {
  const man = await getManifest();
  if (!man) return { total: 0, have: 0, missing: [] };
  const cache = await caches.open(CACHE);
  const missing = [];
  for (const f of man.files) if (!(await cache.match(f))) missing.push(f);
  let fixed = 0;
  if (repair && missing.length) {
    for (const f of missing.slice()) {
      try {
        const r = await fetchRetry(f, { cache: 'no-cache' }, 2);
        await cache.put(f, r); fixed++; missing.splice(missing.indexOf(f), 1);
      } catch (e) {
        const old = await fromAnyCache(f, CACHE);
        if (old) { await cache.put(f, old); fixed++; missing.splice(missing.indexOf(f), 1); }
      }
    }
  }
  return { total: man.files.length, have: man.files.length - missing.length, missing: missing.slice(0, 20), missingCount: missing.length, fixed, version: VERSION };
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
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const isPage = req.mode === 'navigate' || /\.html$/.test(url.pathname);
    // The short address for phones (…/stage) is the stage screen page.
    const isStage = /\/stage$/.test(url.pathname) || /\/stage\.html$/.test(url.pathname);
    let hit = await cache.match(req, { ignoreSearch: isPage });
    if (!hit && isStage) hit = await cache.match('stage.html', { ignoreSearch: true });
    if (!hit && isPage) hit = await cache.match(req, { ignoreSearch: true });
    if (!hit && /[?&](v|r)=/.test(url.search)) hit = await cache.match(req, { ignoreSearch: true }); // cache-busting retries
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // Keep a copy of app files that were missing, and of extra data added later (licensed Bibles).
      if (res.ok && res.type === 'basic' && /\/(js|css|data|vendor|fonts|icons)\/|\.(html|webmanifest)$/.test(url.pathname)) {
        const copy = res.clone();
        event.waitUntil(cache.put(isPage ? new Request(url.pathname) : req, copy).catch(() => {}));
      }
      return res;
    } catch (e) {
      // No internet: an older stored copy, then the app's start page for any page.
      const old = await fromAnyCache(req, CACHE);
      if (old) return old;
      if (isPage) {
        const page = await cache.match(/display\.html/.test(url.pathname) ? 'display.html' : isStage ? 'stage.html' : 'index.html', { ignoreSearch: true }) || await fromAnyCache('index.html', CACHE);
        if (page) return page;
      }
      return new Response('Offline and not stored on this device: ' + url.pathname, { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
