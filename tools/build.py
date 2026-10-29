#!/usr/bin/env python3
"""
Prepare Church Service for deployment.

  python tools/build.py              # list every app file in asset-manifest.json and stamp sw.js
  python tools/build.py --bibles     # also rebuild data/bibles from ./sources (and ./licensed)
  python tools/build.py --minify     # deploy builds only: shrink js/ and css/ IN PLACE first (needs esbuild)

The service worker downloads everything listed in asset-manifest.json in one go when the app
is installed, so the whole app (Bibles, hymns, fonts, pdf.js) works offline afterwards.
Licensed Bibles in data/bibles-private/ are included only in builds made on your own machine
(that folder is git-ignored, so it never reaches a public repository).
"""
import hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE_DIRS = ['css', 'js', 'vendor', 'fonts', 'icons', 'data']
INCLUDE_FILES = ['index.html', 'display.html', 'stage.html', 'obs.html', 'privacy.html', 'terms.html', 'companion.html', 'feedback.html', 'admin.html', 'oauth.html', 'manifest.webmanifest']
SKIP = re.compile(r'(\.map$|\.md$|LICENSE|\.txt$|\.DS_Store|music/(hq|studio)\.sf3$)')  # optional sound packs (18 MB / Studio), downloaded only when switched on


def collect():
    files = list(INCLUDE_FILES)
    for d in INCLUDE_DIRS:
        for base, dirs, names in os.walk(os.path.join(ROOT, d)):
            dirs.sort()
            for n in sorted(names):
                rel = os.path.relpath(os.path.join(base, n), ROOT).replace(os.sep, '/')
                if not SKIP.search(rel):
                    files.append(rel)
    return files


# The oldest js/app.js this repository accepts. Editing an old copy of the app (for example in another
# tool or session) and pushing it would silently undo newer work, so the build stops instead.
MIN_APP_VERSION = (1, 3, 0)


def check_app_version():
    src = open(os.path.join(ROOT, 'js', 'app.js'), encoding='utf-8').read()
    m = re.search(r"export const VERSION = '(\d+)\.(\d+)\.(\d+)'", src)
    v = tuple(int(x) for x in m.groups()) if m else (0, 0, 0)
    if v < MIN_APP_VERSION:
        raise SystemExit('js/app.js is an older copy (version %s, this repository is at %s or newer).\n'
                         'Get the latest main (git pull) and make the change on top of it.' % ('.'.join(map(str, v)), '.'.join(map(str, MIN_APP_VERSION))))


def check_offline_safe(files):
    """Everything the app loads must be stored for offline use: every import points at a real file that is
    in the offline list, and the pages load nothing from the internet."""
    import re as _re
    listed = set(files)
    bad = []
    imp = _re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}/[^'"?#]+)['"]""")
    for base, _, names in os.walk(os.path.join(ROOT, 'js')):
        for n in names:
            if not n.endswith('.js'):
                continue
            path = os.path.join(base, n)
            src = open(path, encoding='utf-8').read()
            for m in imp.finditer(src):
                if m.group(1).endswith('/'):
                    continue  # built at run time (a tab file name is added)
                target = os.path.normpath(os.path.join(os.path.dirname(path), m.group(1)))
                rel = os.path.relpath(target, ROOT).replace(os.sep, '/')
                if not os.path.exists(target):
                    bad.append(os.path.relpath(path, ROOT) + ' imports a missing file: ' + m.group(1))
                elif rel not in listed:
                    bad.append(os.path.relpath(path, ROOT) + ' imports ' + rel + ', which is not in the offline list')
    for page in ('index.html', 'display.html', 'stage.html', 'obs.html'):
        html = open(os.path.join(ROOT, page), encoding='utf-8').read()
        for m in _re.finditer(r"""<(?:script|link)[^>]+(?:src|href)=["'](https?:)?//""", html):
            if _re.search(r'rel=["\'](?:canonical|alternate|me)["\']', m.group(0)) or 'rel="canonical"' in html[m.start():m.start() + 60]:
                continue  # page metadata, not something the page loads
            bad.append(page + ' loads something from the internet: ' + m.group(0)[:80])
        for m in _re.finditer(r"""<(?:script|link)[^>]+(?:src|href)=["']([^"':]+)["']""", html):
            f = m.group(1).split('?')[0]
            if f and not f.startswith('#') and f not in listed:
                bad.append(page + ' uses ' + f + ', which is not in the offline list')
    if bad:
        raise SystemExit('Offline check failed, build stopped:\n  ' + '\n  '.join(bad))


def check_syntax():
    """Refuse to stamp a build when any app script has a syntax error (it would break a tab for everyone)."""
    import shutil
    node = shutil.which('node')
    if not node:
        return
    bad = []
    # sw.js and every app file: leftover merge-conflict markers break the app (and the offline service worker).
    for base, _, names in os.walk(ROOT):
        if any(x in base for x in ('.git', 'node_modules', 'vendor', 'companion')): continue
        for n in names:
            if n.endswith(('.js', '.css', '.html', '.json')):
                try: txt = open(os.path.join(base, n), encoding='utf-8').read()
                except Exception: continue
                if re.search(r'^(<<<<<<< |>>>>>>> )', txt, re.M): bad.append(os.path.join(base, n) + ': merge conflict markers')
    sw = os.path.join(ROOT, 'sw.js')
    r = subprocess.run([node, '--check', sw], capture_output=True, text=True)
    if r.returncode: bad.append('sw.js: ' + r.stderr.strip().splitlines()[0])
    for base, _, names in os.walk(os.path.join(ROOT, 'js')):
        for n in names:
            if n.endswith('.js'):
                path = os.path.join(base, n)
                r = subprocess.run([node, '--input-type=module', '--check'], stdin=open(path, 'rb'), capture_output=True, text=True)
                if r.returncode:
                    bad.append(os.path.relpath(path, ROOT) + ': ' + (r.stderr.strip().splitlines() or ['syntax error'])[-1 if False else 0])
    if bad:
        raise SystemExit('Syntax error, build stopped:\n  ' + '\n  '.join(bad))


def stamp_build():
    try:
        build = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, text=True).strip()
    except Exception:
        build = 'dev'
    app = os.path.join(ROOT, 'js', 'app.js')
    asrc = open(app, encoding='utf-8').read()
    asrc = re.sub(r"export const BUILD = '[^']*';", "export const BUILD = '%s';" % build, asrc, count=1)
    open(app, 'w', encoding='utf-8', newline='\n').write(asrc)
    return build


def minify():
    """Shrink every app script and stylesheet in place with esbuild (about 60% smaller). Used by the
    GitHub deploy on its throw-away copy; never run it on your working folder (the code becomes unreadable)."""
    import shutil
    esb = shutil.which('esbuild') or os.path.join(ROOT, 'node_modules', '.bin', 'esbuild')
    if not os.path.exists(esb):
        raise SystemExit('--minify needs esbuild: npm install --no-save esbuild')
    if not os.environ.get('CI') and '--force' not in sys.argv:
        raise SystemExit('--minify rewrites js/ and css/ in place. It runs in the GitHub deploy; add --force to run it here anyway.')
    before = after = 0
    for d, ext in (('js', '.js'), ('css', '.css')):
        for base, _, names in os.walk(os.path.join(ROOT, d)):
            for n in names:
                if not n.endswith(ext): continue
                path = os.path.join(base, n)
                before += os.path.getsize(path)
                # One file at a time, no bundling: import paths, file names and the offline list stay the same.
                # Scripts with import/export are modules; the few classic ones keep their global names.
                subprocess.check_call([esb, path, '--minify', '--target=es2020', '--legal-comments=none', '--log-level=warning',
                                       '--allow-overwrite', '--outfile=' + path])
                after += os.path.getsize(path)
    print('Minified js/ and css/: %.0f KB -> %.0f KB' % (before / 1024, after / 1024))


def main():
    check_app_version()
    check_syntax()
    if '--bibles' in sys.argv:
        subprocess.check_call([sys.executable, os.path.join(ROOT, 'tools', 'build_bibles.py'), '--licensed'])
    # Stamp the main commit hash into app.js so Settings shows it under the version. This happens before
    # the files are hashed: otherwise app.js keeps the same hash when only the stamp changes, the service
    # worker reuses the old copy, and About shows the previous build.
    build = stamp_build()
    if '--minify' in sys.argv:
        minify()
    files = collect()
    check_offline_safe(files)
    h = hashlib.sha256()
    total = 0
    hashes = {}
    for f in files:
        with open(os.path.join(ROOT, f), 'rb') as fh:
            b = fh.read()
        total += len(b)
        h.update(f.encode()); h.update(b)
        # Per-file hash: on an update the service worker reuses unchanged files from the
        # previous version instead of downloading everything (the music library alone is 18 MB).
        hashes[f] = hashlib.sha256(b).hexdigest()[:16]
    version = h.hexdigest()[:12]
    with open(os.path.join(ROOT, 'asset-manifest.json'), 'w') as fh:
        json.dump({'version': version, 'bytes': total, 'files': files, 'hashes': hashes}, fh, indent=0)
    sw = os.path.join(ROOT, 'sw.js')
    src = open(sw, encoding='utf-8').read()
    src = re.sub(r"const VERSION = '[^']*';", "const VERSION = '%s';" % version, src, count=1)
    open(sw, 'w', encoding='utf-8', newline='\n').write(src)
    print('Church Service build %s (%s): %d files, %.1f MB to cache offline' % (version, build, len(files), total / 1048576))
    # Pre-compressed copies for the companion (smaller .exe, faster loads over church Wi-Fi).
    import gzip, shutil
    emb = os.path.join(ROOT, 'companion', 'embed')
    shutil.rmtree(emb, ignore_errors=True)
    gz_total = 0
    for f in files + ['asset-manifest.json', 'sw.js']:
        if not re.search(r'\.(json|js|mjs|css|html|webmanifest|svg|txt)$', f):
            continue
        src = os.path.join(ROOT, f)
        dst = os.path.join(emb, f + '.gz')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(src, 'rb') as a:
            data = gzip.compress(a.read(), compresslevel=9, mtime=0)
        with open(dst, 'wb') as b:
            b.write(data)
        gz_total += len(data)
    print('Companion: compressed text assets to %.1f MB' % (gz_total / 1048576))


if __name__ == '__main__':
    main()
