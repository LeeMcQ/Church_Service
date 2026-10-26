#!/usr/bin/env python3
"""
SDA Sabbath smoke tests. They run on GitHub before every deploy: if one fails, the deploy stops and the
website keeps the last working version.

    pip install playwright && python -m playwright install chromium
    python tests/smoke.py              # tests the folder this file is in
    python tests/smoke.py path/to/site # tests another copy (e.g. the minified deploy folder)

Each check prints PASS or FAIL; the exit code is the number of failures.
"""
import json, os, socket, subprocess, sys, threading, time, traceback
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = ['index.html', 'display.html', 'stage.html', 'obs.html', 'privacy.html', 'terms.html', 'companion.html', 'feedback.html', 'admin.html']
TABS = ['bible', 'hymns', 'ai', 'slides', 'video', 'web', 'plan', 'tools', 'settings']
# Requests that are allowed to fail on a plain web server (the companion's /api is only there when it runs).
OK_404 = ('/api/', 'favicon')

results = []


def check(name):
    def deco(fn):
        def run(*a):
            t = time.time()
            try:
                fn(*a)
                results.append((name, True, ''))
                print('PASS  %-46s %.1fs' % (name, time.time() - t), flush=True)
            except Exception as e:
                results.append((name, False, str(e)))
                print('FAIL  %-46s %s' % (name, e), flush=True)
                if os.environ.get('VERBOSE'): traceback.print_exc()
        return run
    return deco


def serve():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    httpd = ThreadingHTTPServer(('127.0.0.1', port), partial(Quiet, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, 'http://127.0.0.1:%d/' % port


# ------------------------------------------------------------------ files
@check('offline list: every file exists')
def t_manifest():
    m = json.load(open(os.path.join(ROOT, 'asset-manifest.json')))
    missing = [f for f in m['files'] if not os.path.isfile(os.path.join(ROOT, f))]
    assert not missing, 'missing: ' + ', '.join(missing[:5])
    assert len(m['files']) > 100, 'only %d files listed' % len(m['files'])


@check('service worker parses')
def t_sw():
    r = subprocess.run(['node', '--check', os.path.join(ROOT, 'sw.js')], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr.strip()[:200]


# ------------------------------------------------------------------ browser
def new_page(ctx, errs, bad):
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.on('response', lambda r: bad.append('%d %s' % (r.status, r.url)) if r.status >= 400 and not any(x in r.url for x in OK_404) else None)
    return pg


def wait_text(pg, text, timeout=10000):
    """Poll the page text from here (the app's security policy blocks Playwright's own waiting code)."""
    end = time.time() + timeout / 1000
    while time.time() < end:
        if text in pg.inner_text('body'): return
        pg.wait_for_timeout(250)
    raise AssertionError('%r not shown' % text)


def main():
    from playwright.sync_api import sync_playwright
    t_manifest(); t_sw()
    httpd, base = serve()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
            ctx = b.new_context(viewport={'width': 1400, 'height': 900}, service_workers='block')

            @check('every page opens without errors')
            def t_pages():
                errs, bad = [], []
                pg = new_page(ctx, errs, bad)
                for u in PAGES:
                    pg.goto(base + u); pg.wait_for_timeout(800)
                pg.close()
                assert not errs, '; '.join(errs[:3])
                assert not bad, '; '.join(bad[:3])
            t_pages()

            errs, bad = [], []
            pg = new_page(ctx, errs, bad)
            pg.goto(base + 'index.html'); pg.wait_for_timeout(1000)
            pg.evaluate("import('./js/core/settings.js').then(m => m.settings.set('app.setupDone', true))")
            pg.reload(); pg.wait_for_selector('#presentBtn'); pg.wait_for_timeout(1500)

            @check('every tab opens')
            def t_tabs():
                for t in TABS:
                    pg.evaluate('id => window.selah.showTab(id)', t); pg.wait_for_timeout(500)
                    assert not pg.locator('.tab-error').count(), t + ' shows an error panel'
                assert not errs, '; '.join(errs[:3])
            t_tabs()

            def present(q):
                go = pg.locator('input[placeholder^="Go to"]').first
                go.fill(q); pg.wait_for_timeout(900); go.press('Enter'); pg.wait_for_timeout(900)
                pg.click('#presentBtn'); pg.wait_for_timeout(1200)
                return pg.evaluate("import('./js/core/live.js').then(m => m.live.cue && (m.live.cue.title + ' | ' + (m.live.cue.sub || '')))")

            @check('a Bible verse goes live')
            def t_bible():
                title = present('John 3:16')
                assert title and 'John 3' in title, 'live is %r' % title
                wait_text(pg, 'God so loved')
            t_bible()

            @check('a hymn goes live')
            def t_hymn():
                title = present('hymn 73')
                assert title and ('73' in title or 'Holy' in title), 'live is %r' % title
            t_hymn()

            @check('next / previous step through a hymn')
            def t_steps():
                i0 = pg.evaluate("import('./js/core/live.js').then(m => m.live.index)")
                pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(500)
                i1 = pg.evaluate("import('./js/core/live.js').then(m => m.live.index)")
                assert i1 == i0 + 1, 'index %s -> %s' % (i0, i1)
            t_steps()

            @check('the stage screen opens and follows live')
            def t_stage():
                with ctx.expect_page(timeout=10000) as pop:
                    pg.evaluate("import('./js/core/stagehub.js').then(m => m.hub.openWindow(1))")
                st = pop.value
                st.on('pageerror', lambda e: errs.append('stage: ' + str(e)[:200]))
                st.wait_for_load_state()
                present('John 3:16')
                wait_text(st, 'God so loved')
                st.close()
            t_stage()

            @check('black screen toggles')
            def t_black():
                pg.keyboard.press('b'); pg.wait_for_timeout(400)
                on = pg.evaluate("import('./js/core/live.js').then(m => m.live.blank)")
                pg.keyboard.press('b'); pg.wait_for_timeout(400)
                off = pg.evaluate("import('./js/core/live.js').then(m => m.live.blank)")
                assert on and not off, 'blank %r then %r' % (on, off)
            t_black()

            @check('a shared plan file opens')
            def t_plan():
                data = list(open(os.path.join(HERE, 'fixtures', 'sample.sdaplan'), 'rb').read())
                n = pg.evaluate("""async (bytes) => {
                  const m = await import('./js/core/planpack.js');
                  const f = new File([new Uint8Array(bytes)], 'sample.sdaplan');
                  const pkg = await m.openPackage(f);
                  return pkg.manifest.items.length;
                }""", data)
                assert n > 0, 'no items in the plan'
            t_plan()

            @check('a Bible file imports (helloao format, NT only)')
            def t_import():
                bk = {'translation': {'shortName': 'TST', 'englishName': 'Test', 'language': 'zul'}, 'books': [{'id': 'JHN', 'name': 'UJohane', 'chapters': [
                    {'chapter': {'number': 3, 'content': [{'type': 'verse', 'number': n, 'content': ['Ivesi %d' % n]} for n in range(1, 120)]}}]}]}
                r = pg.evaluate("""async (txt) => {
                  const m = await import('./js/core/bibledata.js');
                  const p = await m.parseBibleFile(new File([txt], 't.json'));
                  return [...p.books.keys()];
                }""", json.dumps(bk))
                assert r == [43], 'books %r' % r
            t_import()

            @check('Bible formats of all three sources read correctly')
            def t_formats():
                vs = range(1, 120)
                # bible.helloao.org complete.simple.json (verse text in "text")
                simple = {'translation': {'shortName': 'S', 'englishName': 'S', 'language': 'eng'}, 'books': [{'id': 'JHN', 'name': 'John', 'order': 43, 'chapters': [
                    {'chapter': {'number': 3, 'content': [{'type': 'heading', 'text': 'H'}, {'type': 'line_break'}] + [{'type': 'verse', 'number': n, 'text': 'Simple %d' % n, 'footnotes': []} for n in vs]}}]}]}
                # bible.helloao.org complete.json (verse content[] with formatted text and footnote markers)
                full = {'translation': {'shortName': 'F', 'englishName': 'F', 'language': 'eng'}, 'books': [{'id': 'JHN', 'name': 'John', 'order': 43, 'chapters': [
                    {'chapter': {'number': 3, 'content': [{'type': 'verse', 'number': n, 'content': ['Full', {'text': str(n), 'wordsOfJesus': True}, {'noteId': 1}]} for n in vs]}}]}]}
                # getBible v2 {abbr}.json
                gb = {'translation': 'G', 'abbreviation': 'g', 'lang': 'en', 'language': 'English', 'books': [{'nr': 43, 'name': 'John', 'chapters': [
                    {'chapter': 3, 'name': 'John 3', 'verses': [{'chapter': 3, 'verse': n, 'name': 'John 3:%d' % n, 'text': 'Get %d ' % n} for n in vs]}]}]}
                r = pg.evaluate("""async (files) => {
                  const m = await import('./js/core/bibledata.js');
                  const out = [];
                  for (const f of files) { const p = await m.parseBibleFile(new File([f], 'x.json')); out.push([[...p.books.keys()], p.books.get(43)[2][15]]); }
                  return out;
                }""", [json.dumps(simple), json.dumps(full), json.dumps(gb)])
                assert r[0] == [[43], 'Simple 16'], 'helloao simple %r' % r[0]
                assert r[1] == [[43], 'Full 16'], 'helloao complete %r' % r[1]
                assert r[2] == [[43], 'Get 16'], 'getBible %r' % r[2]
            t_formats()

            @check('Bible corpus: Xhosa listed and CES XML imports')
            def t_corpus():
                xml = ('<?xml version="1.0" ?><cesDoc version="4"><cesHeader><fileDesc><titleStmt><h.title>Bible(XHO)</h.title></titleStmt></fileDesc>'
                       '<profileDesc><langUsage><language id="xh" iso639="xho">Xhosa</language></langUsage></profileDesc></cesHeader><text><body>'
                       '<div id="b.JOH" type="book"><div id="b.JOH.3" type="chapter">'
                       + ''.join("<seg id='b.JOH.3.%d' type='verse'>Ivesi %d</seg>" % (n, n) for n in range(1, 120))
                       + '</div></div></body></text></cesDoc>')
                r = pg.evaluate("""async (txt) => {
                  const m = await import('./js/core/bibledata.js');
                  const c = await import('./js/core/biblecorpus.js');
                  const p = await m.parseBibleFile(new File([txt], 't.xml'));
                  return { books: [...p.books.keys()], v16: p.books.get(43)[2][15], xho: c.CORPUS.some((x) => x[1] === 'xho') };
                }""", xml)
                assert r['books'] == [43] and r['v16'] == 'Ivesi 16', 'parsed %r' % r
                assert r['xho'], 'Xhosa missing from the corpus list'
            t_corpus()

            @check('remote buttons (Stream Deck) control the app')
            def t_remote():
                L = lambda: pg.evaluate("import('./js/core/live.js').then(m => ({ live: m.live.cue && m.live.cue.title, i: m.live.index, staged: m.live.staged && m.live.staged.title, blank: m.live.blank }))")
                pg.evaluate("window.selah.remoteCommand('goto', { q: 'Psalm 23' })"); pg.wait_for_timeout(1200)
                s1 = L(); assert s1['staged'] and 'Psalm' in s1['staged'], 'goto staged %r' % s1
                pg.evaluate("window.selah.remoteCommand('present')"); pg.wait_for_timeout(1000)
                s2 = L(); assert s2['live'] and 'Psalm' in s2['live'], 'present: live %r' % s2
                pg.evaluate("window.selah.remoteCommand('next')"); pg.wait_for_timeout(500)
                assert L()['i'] == s2['i'] + 1, 'next did not move'
                pg.evaluate("window.selah.remoteCommand('black')"); pg.wait_for_timeout(300)
                assert L()['blank'] == 'black', 'black did not switch on'
                pg.evaluate("window.selah.remoteCommand('black')"); pg.wait_for_timeout(300)
                assert not L()['blank'], 'black did not switch off'
            t_remote()

            @check('a PDF opens on Next and taps never present')
            def t_pdf():
                L = lambda: pg.evaluate("import('./js/core/live.js').then(m => ({ live: m.live.cue && m.live.cue.title, i: m.live.index, staged: m.live.staged && m.live.staged.title }))")
                before = L()['live']
                pg.evaluate("window.selah.showTab('slides')"); pg.wait_for_timeout(600)
                pg.locator('.tabpanel:not([hidden]) input[type=file]').first.set_input_files(os.path.join(HERE, 'fixtures', 'deck.pdf'))
                for _ in range(40):
                    if L()['staged'] == 'deck': break
                    pg.wait_for_timeout(250)
                s = L(); assert s['staged'] == 'deck' and s['live'] == before, 'opening the PDF changed live: %r' % s
                th = pg.locator('.tabpanel:not([hidden]) button.thumb')
                th.nth(1).click(); pg.wait_for_timeout(300); th.nth(1).dblclick(); pg.wait_for_timeout(500)
                assert L()['live'] == before, 'tapping a slide presented it'
                pg.click('#presentBtn'); pg.wait_for_timeout(1000)
                s = L(); assert s['live'] == 'deck' and s['i'] == 1, 'Present showed %r' % s
            t_pdf()

            @check('a backup file can be made and read back')
            def t_backup():
                r = pg.evaluate("""async () => {
                  const { db } = await import('./js/core/db.js');
                  await db.put('plans', 'smoke-plan', { id: 'smoke-plan', name: 'Smoke test plan', items: [], updated: Date.now() });
                  const b = await import('./js/core/backup.js');
                  const { blob, stats } = await b.buildBackup({ slides: true, videos: false, device: 'test' });
                  const pkg = await b.readBackup(new File([blob], 'x' + b.EXT));
                  return { plans: pkg.manifest.stores.plans.map((x) => x[0]), slides: stats.slides, size: blob.size };
                }""")
                assert 'smoke-plan' in r['plans'], 'plan missing from the backup: %r' % r
                assert r['slides'] >= 1, 'slides missing from the backup: %r' % r
            t_backup()

            @check('hymn music plays (SoundFont loads)')
            def t_music():
                r = pg.evaluate("""async () => {
                  const { MusicEngine } = await import('./js/core/musicengine.js');
                  const e = new MusicEngine(); e.unlock(); await e.init();
                  const an = e.ctx.createAnalyser(); an.fftSize = 2048; e.gain.connect(an);
                  await e.play({ book: 'sda-online', n: 73 });
                  await new Promise((r) => setTimeout(r, 5000));
                  const buf = new Float32Array(an.fftSize); let peak = 0;
                  for (let k = 0; k < 20; k++) { an.getFloatTimeDomainData(buf); for (const x of buf) peak = Math.max(peak, Math.abs(x)); await new Promise((r) => setTimeout(r, 50)); }
                  e.stop(); return peak;
                }""")
                assert r > 0.05, 'no sound (peak %.3f)' % r
            t_music()

            @check('phones: nothing runs off the screen (portrait and landscape)')
            def t_phone():
                bad_tabs = []
                for (w, hh) in [(360, 740), (844, 390), (740, 360)]:
                    c2 = b.new_context(viewport={'width': w, 'height': hh}, is_mobile=True, has_touch=True, service_workers='block')
                    p2 = c2.new_page(); e2 = []
                    p2.on('pageerror', lambda e: e2.append(str(e)[:120]))
                    p2.goto(base + 'index.html'); p2.wait_for_timeout(800)
                    p2.evaluate("import('./js/core/settings.js').then(m => m.settings.set('app.setupDone', true))")
                    p2.reload(); p2.wait_for_selector('#presentBtn'); p2.wait_for_timeout(1200)
                    for t in TABS:
                        p2.evaluate('id => window.selah.showTab(id)', t); p2.wait_for_timeout(350)
                        over = p2.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
                        present = p2.evaluate("(() => { const r = document.getElementById('presentBtn').getBoundingClientRect(); return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; })()")
                        if over > 1 or not present: bad_tabs.append('%dx%d %s (%dpx wider%s)' % (w, hh, t, over, '' if present else ', Present off screen'))
                    assert not e2, '%dx%d: %s' % (w, hh, e2[0])
                    c2.close()
                assert not bad_tabs, '; '.join(bad_tabs[:4])
            t_phone()

            @check('no errors on the main page')
            def t_clean():
                assert not errs, '; '.join(errs[:3])
                assert not bad, '; '.join(bad[:3])
            t_clean()
            b.close()
    finally:
        httpd.shutdown()
    fails = [r for r in results if not r[1]]
    print('\n%d passed, %d failed' % (len(results) - len(fails), len(fails)))
    sys.exit(len(fails))


if __name__ == '__main__':
    main()
