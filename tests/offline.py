#!/usr/bin/env python3
"""
Church Service offline tests: proves the app keeps working with no internet. Runs on GitHub before every
deploy (after tests/smoke.py); a failure stops the deploy and the website keeps the last version that passed.

    pip install playwright && python -m playwright install chromium
    python tests/offline.py              # tests the folder this file is in
    python tests/offline.py path/to/site # tests another copy (e.g. the minified deploy folder)

What it checks:
  1. Start-up loads nothing from other websites (only optional online features may, and they must not be needed).
  2. Installing stores every file in asset-manifest.json.
  3. With the network cut: a cold start (all windows closed, then opened again), every tab, every page, a Bible
     verse, a hymn and the hymn music all work, with no failed request and no script error.
  4. A broken update (a file that cannot be downloaded) is refused: the working version stays in charge offline.
  5. Updates are held during the Sabbath and while anything is on screen.
  6. The readiness badge shows "Ready offline" once everything is stored.
  7. Bad networks (stress test 31 Oct 2026): a Wi-Fi login page in place of files is never stored, and one stored
     by an older version is repaired; a file that hangs never blocks the install or the start page; a first install
     without the app's own files never takes over; deep or odd addresses open the app offline.

Each check prints PASS or FAIL; the exit code is the number of failures.
"""
import json, os, socket, sys, threading, time, traceback
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..'))
PAGES = ['index.html', 'display.html', 'stage.html', 'obs.html', 'privacy.html', 'terms.html']
TABS = ['bible', 'hymns', 'ai', 'slides', 'video', 'web', 'plan', 'tools', 'settings']
# Other websites the app may contact for optional online extras. They must never be needed: the offline part of
# this test proves the app works with all of them unreachable.
OPTIONAL_HOSTS = ('leemcq.github.io', 'raw.githubusercontent.com')
OVERRIDES = {}  # path -> bytes: lets a test publish a pretend new version without touching the files
# path (or a 'folder/' prefix, or '*') -> 'portal' (a Wi-Fi login page with status 200) | 'hang' (never answers) |
# 'down' (the connection is dropped): the bad networks churches meet.
FAULTS = {}
PORTAL = b'<!doctype html><html><head><title>Hotel Wi-Fi</title></head><body><h1>Hotel Wi-Fi login</h1><form>Room number <input></form></body></html>'


def fault_for(path):
    if path in FAULTS: return FAULTS[path]
    for k, v in FAULTS.items():
        if k.endswith('/') and path.startswith(k): return v
    return FAULTS.get('*')

results = []


def check(name):
    def deco(fn):
        def run(*a):
            t = time.time()
            try:
                fn(*a)
                results.append((name, True, ''))
                print('PASS  %-56s %.1fs' % (name, time.time() - t), flush=True)
            except Exception as e:
                results.append((name, False, str(e)))
                print('FAIL  %-56s %s' % (name, e), flush=True)
                if os.environ.get('VERBOSE'): traceback.print_exc()
        return run
    return deco


def serve():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass

        def do_GET(self):
            path = urlparse(self.path).path.lstrip('/')
            f = fault_for(path)
            if f == 'portal':
                self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(PORTAL)))
                self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(PORTAL); return
            if f == 'hang':
                time.sleep(240); self.close_connection = True; return   # longer than any test waits: it never answers
            if f == 'down':
                self.close_connection = True; return
            if path in OVERRIDES:
                body = OVERRIDES[path]
                if body is None:
                    self.send_error(404); return
                self.send_response(200)
                self.send_header('Content-Type', 'application/javascript' if path.endswith('.js') else 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body); return
            return super().do_GET()

        def end_headers(self):
            if urlparse(self.path).path.endswith('sw.js'):
                self.send_header('Cache-Control', 'no-store')
            super().end_headers()

    httpd = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, 'http://127.0.0.1:%d/' % port


SETUP_DONE = "import('./js/core/settings.js').then(m => (m.settings.set('app.setupDone', true), m.settings.set('backup', Object.assign({}, m.settings.v.backup, { remindAt: Date.now() }))))"
CACHED = """async () => { const m = await (await fetch('asset-manifest.json', { cache: 'no-store' })).json();
  const ks = (await caches.keys()).filter((k) => k.startsWith('selah-/'));
  if (!ks.length) return { have: 0, total: m.files.length, missing: m.files.slice(0, 5) };
  const c = await caches.open(ks[ks.length - 1]); const missing = [];
  for (const f of m.files) if (!(await c.match(f))) missing.push(f);
  return { have: m.files.length - missing.length, total: m.files.length, missing: missing.slice(0, 5), cache: ks[ks.length - 1] }; }"""
# The self-check (with or without repair) of the service worker in charge.
HEALTH = """async (repair) => { const c = navigator.serviceWorker.controller; if (!c) return { error: 'not controlled' };
  return await new Promise((res) => { const ch = (e) => { if (e.data && e.data.t === 'health' && e.data.version) { navigator.serviceWorker.removeEventListener('message', ch); res(e.data); } };
    navigator.serviceWorker.addEventListener('message', ch); c.postMessage({ t: 'check', repair }); setTimeout(() => res({ error: 'no answer' }), 90000); }); }"""
# What is stored for one file: its first characters, or null.
STORED = """async (f) => { const ks = (await caches.keys()).filter((k) => k.startsWith('selah-/')); if (!ks.length) return null;
  const r = await (await caches.open(ks[ks.length - 1])).match(f); return r ? (await r.text()).slice(0, 40) : null; }"""
# Wait until a service worker is in charge, or the install gave up: 'active', 'redundant' or 'timeout:…'.
SW_SETTLED = """async (ms) => { const t0 = Date.now(); for (;;) { const r = await navigator.serviceWorker.getRegistration();
  if (r && r.active) return 'active'; const n = r && (r.installing || r.waiting);
  if (!n && Date.now() - t0 > 3000) return 'redundant';
  if (Date.now() - t0 > ms) return 'timeout:' + (n ? n.state : 'none'); await new Promise((x) => setTimeout(x, 500)); } }"""
# An older version stored a login page as Genesis (stamped as if it were the real file).
POISON_OLD = """async () => { const ks = (await caches.keys()).filter((k) => k.startsWith('selah-/')); const c = await caches.open(ks[ks.length - 1]);
  const m = await (await c.match('asset-manifest.json')).json();
  await c.put('data/bibles/kjv/01.json', new Response('<html>Hotel Wi-Fi login</html>', { headers: { 'content-type': 'text/html', 'x-selah-hash': m.hashes['data/bibles/kjv/01.json'] } })); }"""
# The version of the service worker in charge, asked through its self-check message.
SW_VERSION = """async () => { const r = await navigator.serviceWorker.getRegistration(); if (!r || !r.active) return { active: false };
  const v = await new Promise((res) => { const ch = (e) => { if (e.data && e.data.t === 'health' && e.data.version) { navigator.serviceWorker.removeEventListener('message', ch); res(e.data.version); } };  // a refused update also announces its health, without a version
    navigator.serviceWorker.addEventListener('message', ch); navigator.serviceWorker.controller.postMessage({ t: 'check', repair: false }); setTimeout(() => res(null), 10000); });
  return { active: true, version: v }; }"""


def main():
    from playwright.sync_api import sync_playwright
    httpd, base = serve()
    host = urlparse(base).netloc
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={'width': 1280, 'height': 800})
            outside, failed, errs = [], [], []

            def watch(pg):
                pg.on('pageerror', lambda e: errs.append('%s: %s' % (pg.url.split('/')[-1], str(e)[:160])))
                pg.on('request', lambda r: outside.append(r.url) if urlparse(r.url).scheme in ('http', 'https') and urlparse(r.url).netloc != host else None)
                pg.on('requestfailed', lambda r: failed.append('%s %s' % (r.failure, r.url)) if urlparse(r.url).netloc == host and '/api/' not in r.url else None)  # /api/ is the companion's, only there when it runs
                pg.on('response', lambda r: failed.append('%d %s' % (r.status, r.url)) if r.status >= 400 and urlparse(r.url).netloc == host and '/api/' not in r.url else None)
                return pg

            pg = watch(ctx.new_page())
            pg.goto(base + 'index.html'); pg.wait_for_timeout(800)
            pg.evaluate(SETUP_DONE)
            pg.reload(); pg.wait_for_selector('#presentBtn'); pg.wait_for_timeout(1000)

            @check('install stores every file in the offline list')
            def t_install():
                st = None
                for _ in range(180):
                    st = pg.evaluate(CACHED)
                    if st['have'] >= st['total']: break
                    pg.wait_for_timeout(1000)
                assert st and st['have'] >= st['total'], 'stored %d of %d, e.g. missing %s' % (st['have'], st['total'], st['missing'])
            t_install()

            pg.reload(); pg.wait_for_selector('#presentBtn'); pg.wait_for_timeout(1500)
            for t in TABS:
                pg.evaluate('id => window.selah.showTab(id)', t); pg.wait_for_timeout(300)

            @check('start-up and every tab load nothing from other websites')
            def t_outside():
                needed = [u for u in outside if not any(h in u for h in OPTIONAL_HOSTS)]
                assert not needed, 'loads from the internet: ' + ', '.join(sorted(set(needed))[:5])
            t_outside()

            @check('readiness badge says "Ready offline"')
            def t_badge():
                txt = ''
                for _ in range(30):
                    txt = pg.evaluate("(document.querySelector('.ready-mark') || {}).textContent || ''")
                    if 'Ready offline' in txt: break
                    pg.wait_for_timeout(500)
                assert 'Ready offline' in txt, 'badge shows: %r' % txt
                pg.click('.ready-mark'); pg.wait_for_timeout(1200)
                panel = pg.evaluate("(document.querySelector('.rm-panel') || {}).innerText || ''")
                assert panel.startswith('✔') and 'App files stored' in panel, 'panel: %r' % panel[:200]
                pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            t_badge()

            # ---------------------------------------------------------------- no internet from here on
            failed.clear(); errs.clear(); outside.clear()
            ctx.set_offline(True)

            @check('cold start with no internet (all windows closed first)')
            def t_cold():
                global pg2
                pg.close()
                q = watch(ctx.new_page())
                q.goto(base + 'index.html', timeout=20000); q.wait_for_selector('#presentBtn', timeout=20000); q.wait_for_timeout(1500)
                assert q.evaluate('!!window.__selahBooted'), 'app did not finish starting'
                txt = q.evaluate("(document.querySelector('.ready-mark') || {}).textContent || ''")
                assert 'files missing' not in txt and 'Not stored' not in txt, 'badge offline: %r' % txt
                globals()['pg2'] = q
            t_cold()
            q = globals().get('pg2')

            @check('every tab opens offline')
            def t_tabs():
                bad = []
                for t in TABS:
                    q.evaluate('id => window.selah.showTab(id)', t); q.wait_for_timeout(450)
                    if q.evaluate("!!document.querySelector('.tabpanel:not([hidden]) .tab-error')"): bad.append(t)
                assert not bad, 'tabs failed to load: ' + ', '.join(bad)
            if q: t_tabs()

            @check('Bible verse, hymn list and hymn music offline')
            def t_content():
                r = q.evaluate("""async () => {
                  const b = await window.selah.tab('bible'); await b.open({ ref: 'John 3:16' });
                  const { live } = await import('./js/core/live.js');
                  const staged = live.staged && live.staged.title;
                  window.selah.showTab('hymns'); await new Promise((r) => setTimeout(r, 800));
                  const rows = document.querySelectorAll('.tabpanel:not([hidden]) .list > button').length;
                  const midi = await (await fetch('data/music/sda-online-midi.zip')).arrayBuffer();
                  return { staged, rows, midi: midi.byteLength }; }""")
                assert r['staged'] == 'John 3:16' and r['rows'] > 100 and r['midi'] > 100000, 'offline: %r' % r
            if q: t_content()

            @check('audio and video byte ranges are answered offline')
            def t_range():
                r = q.evaluate("""async () => { const a = await fetch('data/music/hymnal.sf3', { headers: { Range: 'bytes=100-199' } });
                  const z = await fetch('data/music/hymnal.sf3', { headers: { Range: 'bytes=-50' } });
                  return [a.status, (await a.arrayBuffer()).byteLength, a.headers.get('content-range'), z.status, (await z.arrayBuffer()).byteLength]; }""")
                assert r[0] == 206 and r[1] == 100 and r[2].startswith('bytes 100-199/') and r[3] == 206 and r[4] == 50, 'range offline: %r' % r
            if q: t_range()

            @check('every page opens offline')
            def t_pages():
                bad = []
                for name in PAGES:
                    w = watch(ctx.new_page())
                    try:
                        w.goto(base + name, timeout=15000); w.wait_for_timeout(700)
                        if 'Church Service' not in w.title(): bad.append(name + ' (' + w.title() + ')')
                    except Exception as e:
                        bad.append(name + ' (' + str(e)[:60] + ')')
                    w.close()
                assert not bad, ', '.join(bad)
            t_pages()

            @check('offline: no failed request and no script error')
            def t_clean():
                assert not failed, 'failed: ' + '; '.join(failed[:4])
                assert not errs, 'errors: ' + '; '.join(errs[:3])
            t_clean()

            ctx.set_offline(False)

            # ---------------------------------------------------------------- updates
            @check('a broken update is refused; the working version stays')
            def t_bad_update():
                w = watch(ctx.new_page())
                w.goto(base + 'index.html'); w.wait_for_selector('#presentBtn'); w.wait_for_timeout(1000)
                before = w.evaluate(SW_VERSION)
                man = json.load(open(os.path.join(ROOT, 'asset-manifest.json')))
                man['version'] = 'broken000001'
                man['files'] = man['files'] + ['js/this-file-does-not-exist.js']
                sw = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
                import re
                sw = re.sub(r"const VERSION = '[^']*';", "const VERSION = 'broken000001';", sw, count=1)
                OVERRIDES['asset-manifest.json'] = json.dumps(man).encode()
                OVERRIDES['sw.js'] = sw.encode()
                OVERRIDES['js/this-file-does-not-exist.js'] = None
                try:
                    state = w.evaluate("""async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update().catch(() => {});
                      const n = r.installing || r.waiting; if (!n) return 'no-update';
                      if (n.state === 'installed') return 'installed';
                      return await new Promise((res) => { n.addEventListener('statechange', () => { if (n.state === 'redundant' || n.state === 'installed') res(n.state); }); setTimeout(() => res('timeout:' + n.state), 120000); }); }""")
                finally:
                    OVERRIDES.clear()
                assert state == 'redundant', 'broken update was not refused: ' + state
                after = w.evaluate(SW_VERSION)
                assert before['version'] and after['active'] and after['version'] == before['version'], 'working version changed: %r -> %r' % (before, after)
                ctx.set_offline(True)
                w.reload(); w.wait_for_selector('#presentBtn', timeout=20000)
                ok = w.evaluate("(async () => { const b = await window.selah.tab('bible'); await b.open({ ref: 'Ps 23:1' }); const { live } = await import('./js/core/live.js'); return live.staged && live.staged.title; })()")
                ctx.set_offline(False)
                assert ok == 'Psalm 23:1' or (ok and '23:1' in ok), 'offline after refused update: %r' % ok
                w.close()
            t_bad_update()

            # ---------------------------------------------------------------- bad networks (each in a fresh browser profile)
            def fresh():
                c = b.new_context(viewport={'width': 1280, 'height': 800})
                w = watch(c.new_page())
                failed.clear(); errs.clear()
                return c, w

            def first_visit(w):
                w.goto(base + 'index.html', timeout=30000); w.wait_for_timeout(800)
                w.evaluate(SETUP_DONE)

            @check('a Wi-Fi login page is never stored as app files')
            def t_portal():
                FAULTS.update({'data/bibles/kjv/01.json': 'portal', 'data/hymns/sda-online.json': 'portal', 'js/tabs/plan.js': 'portal'})
                c, w = fresh()
                try:
                    first_visit(w)
                    st = w.evaluate(SW_SETTLED, 120000)
                    # One of the app's own files (plan.js) was a login page: the first install must not take over.
                    assert st == 'redundant', 'install with a login page in place of an app file: %s' % st
                    FAULTS.clear()                                 # real internet again
                    w.reload(); st = w.evaluate(SW_SETTLED, 180000)
                    assert st == 'active', 'install with real internet: %s' % st
                    w.reload(); w.wait_for_selector('#presentBtn', timeout=20000)
                    h = w.evaluate(HEALTH, True)
                    assert h.get('missingCount') == 0, 'after repair: %r' % h
                    for f in ('data/bibles/kjv/01.json', 'data/hymns/sda-online.json', 'js/tabs/plan.js'):
                        v = w.evaluate(STORED, f)
                        assert v and 'Hotel' not in v and not v.lstrip().startswith('<'), '%s stored as: %r' % (f, v)
                    # An older version stored a login page as Genesis: the self-check finds and repairs it.
                    w.evaluate(POISON_OLD)
                    h = w.evaluate(HEALTH, True)
                    v = w.evaluate(STORED, 'data/bibles/kjv/01.json')
                    assert h.get('bad', 0) >= 1 and v and v.lstrip().startswith('['), 'old login page not repaired: %r %r' % (h, v)
                finally:
                    FAULTS.clear(); c.close()
            t_portal()

            @check('a hanging file never blocks the first install')
            def t_hang_install():
                FAULTS.update({'data/bibles/kjv/05.json': 'hang'})
                c, w = fresh()
                try:
                    first_visit(w)
                    t0 = time.time(); st = w.evaluate(SW_SETTLED, 120000)
                    assert st == 'active', 'install with one file that never answers: %s after %.0f s' % (st, time.time() - t0)
                    FAULTS.clear()
                    w.reload(); w.wait_for_selector('#presentBtn', timeout=20000)
                    h = w.evaluate(HEALTH, True)
                    assert h.get('missingCount') == 0, 'the hanging file was not fetched later: %r' % h
                finally:
                    FAULTS.clear(); c.close()
            t_hang_install()

            @check('first install: the app itself comes first and must be complete')
            def t_shell_first():
                # One of the app's own files cannot be downloaded: the install must not take over.
                FAULTS.update({'data/': 'down', 'js/app.js': 'down'})
                c, w = fresh()
                try:
                    first_visit(w)
                    st = w.evaluate(SW_SETTLED, 90000)
                    assert st == 'redundant', 'install without js/app.js: %s' % st
                finally:
                    FAULTS.clear(); c.close()
                # The data cannot be downloaded, the app can: it installs quickly and starts offline.
                FAULTS.update({'data/': 'down', 'vendor/': 'down'})
                c, w = fresh()
                try:
                    first_visit(w)
                    t0 = time.time(); st = w.evaluate(SW_SETTLED, 150000)
                    assert st == 'active' and time.time() - t0 < 60, 'install with the data unreachable: %s after %.0f s' % (st, time.time() - t0)
                    FAULTS.clear()
                    c.set_offline(True)
                    w.reload(); w.wait_for_selector('#presentBtn', timeout=20000); w.wait_for_timeout(1500)
                    assert w.evaluate('!!window.__selahBooted'), 'the app did not start offline'
                    c.set_offline(False)
                finally:
                    FAULTS.clear(); c.close()
            t_shell_first()

            @check('Wi-Fi with no internet: the start page opens at once')
            def t_liefi():
                FAULTS['*'] = 'hang'
                try:
                    bad = []
                    for u in ('', 'index.html?tab=hymns'):
                        w = watch(ctx.new_page())
                        t0 = time.time()
                        try:
                            w.goto(base + u, timeout=15000); w.wait_for_selector('#presentBtn', timeout=15000)
                            if time.time() - t0 > 6: bad.append('%r took %.1f s' % (u or '(folder)', time.time() - t0))
                        except Exception as e:
                            bad.append('%r: %s' % (u or '(folder)', str(e)[:80]))
                        w.close()
                    assert not bad, '; '.join(bad)
                finally:
                    FAULTS.clear()
            t_liefi()

            @check('deep or odd addresses open the app offline')
            def t_deep():
                ctx.set_offline(True)
                try:
                    bad = []
                    for u, want in (('stage/', 'stage.html'), ('index.html/', 'index.html'), ('some/deep/path', 'index.html'), ('tab/bible', 'index.html')):
                        w = ctx.new_page()
                        try:
                            w.goto(base + u, timeout=15000); w.wait_for_timeout(1500)
                            styled = w.evaluate("[...document.styleSheets].some((s) => { try { return s.cssRules.length > 20; } catch (e) { return false; } })")
                            ok = w.url.split('?')[0].endswith(want) and styled
                            if want == 'index.html': ok = ok and w.evaluate('!!window.__selahBooted')
                            if not ok: bad.append('%s -> %s (styled %s)' % (u, w.url.replace(base, ''), styled))
                        except Exception as e:
                            bad.append('%s: %s' % (u, str(e)[:80]))
                        w.close()
                    assert not bad, '; '.join(bad)
                finally:
                    ctx.set_offline(False)
            t_deep()

            @check('updates are held during the Sabbath and while on screen')
            def t_hold():
                w = ctx.new_page(); w.goto(base + 'index.html'); w.wait_for_timeout(800)
                r = w.evaluate("""async () => { const m = await import('./js/core/readiness.js');
                  const fri = new Date(2026, 9, 30, 18, 0), sat = new Date(2026, 9, 31, 10, 0), sun = new Date(2026, 10, 1, 10, 0), friam = new Date(2026, 9, 30, 9, 0);
                  const idle = { cue: null, staged: null }, busy = { cue: { t: 'x' }, staged: null };
                  return [m.autoUpdateAllowed('sabbath', idle, fri), m.autoUpdateAllowed('sabbath', idle, sat), m.autoUpdateAllowed('sabbath', idle, sun),
                          m.autoUpdateAllowed('sabbath', idle, friam), m.autoUpdateAllowed('ask', idle, sun), m.autoUpdateAllowed('auto', idle, sat),
                          m.autoUpdateAllowed('auto', busy, sun)]; }""")
                assert r == [False, False, True, True, False, True, False], 'hold rules: %r' % r
                w.close()
            t_hold()
            b.close()
    finally:
        httpd.shutdown()
    fails = [r for r in results if not r[1]]
    print('\n%d passed, %d failed' % (len(results) - len(fails), len(fails)))
    sys.exit(len(fails))


if __name__ == '__main__':
    main()
