#!/usr/bin/env python3
"""Chorus robot (run by .github/workflows/chorus.yml on "Share a praise chorus" issues).

  check    the issue was opened or edited: read the form, tidy the words, check them (format, duplicates,
           a public lyrics database), look for a MIDI file, and write the result as a comment.
  publish  the maintainer added the label "chorus-approved" (or AUTO_PUBLISH_CHORUSES is "true" and every
           check passed): add the chorus to data/hymns/community/choruses.json (and its MIDI), push, start
           the website build, comment and close the issue. Every SDA Sabbath then gets it when online.

The issue text is untrusted: it is only parsed as text here, never run.
"""
import datetime, difflib, io, json, os, re, subprocess, sys, unicodedata, urllib.parse, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMMUNITY = os.path.join(ROOT, 'data', 'hymns', 'community', 'choruses.json')
MIDI_DIR = os.path.join(ROOT, 'data', 'hymns', 'community', 'midi')
FIRST = 501
MARK = '<!-- chorus-bot -->'
LABELS = {
    'chorus': ('6d28d9', 'A chorus shared from SDA Sabbath'),
    'chorus-checked': ('2b7f3e', 'The chorus robot found no problems'),
    'chorus-needs-attention': ('b45309', 'The chorus robot found something to look at'),
    'chorus-approved': ('1f4068', 'Maintainer: publish this chorus to every church'),
    'chorus-published': ('0e7490', 'In the shared Praise Choruses'),
}
REPO = os.environ.get('GITHUB_REPOSITORY', 'LeeMcQ/Church_Service')
TOKEN = os.environ.get('GH_TOKEN', '')
UA = 'SDA-Sabbath-chorus-robot (+https://github.com/' + REPO + ')'


# ------------------------------------------------------------ GitHub
def api(method, path, data=None):
    req = urllib.request.Request('https://api.github.com' + path, method=method,
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json',
                                          'User-Agent': UA, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read()
        return json.loads(body) if body else None


def ensure_labels():
    for name, (color, desc) in LABELS.items():
        try:
            api('POST', '/repos/%s/labels' % REPO, {'name': name, 'color': color, 'description': desc})
        except Exception:
            pass  # exists already


def set_labels(num, add=(), remove=()):
    for n in remove:
        try:
            api('DELETE', '/repos/%s/issues/%d/labels/%s' % (REPO, num, urllib.parse.quote(n)))
        except Exception:
            pass
    if add:
        api('POST', '/repos/%s/issues/%d/labels' % (REPO, num), {'labels': list(add)})


def comment(num, text):
    """Write the robot's comment, replacing its earlier one on this issue."""
    text = MARK + '\n' + text
    try:
        for c in api('GET', '/repos/%s/issues/%d/comments?per_page=100' % (REPO, num)) or []:
            if MARK in (c.get('body') or '') and (c.get('user') or {}).get('type') == 'Bot':
                api('PATCH', '/repos/%s/issues/comments/%d' % (REPO, c['id']), {'body': text})
                return
    except Exception:
        pass
    api('POST', '/repos/%s/issues/%d/comments' % (REPO, num), {'body': text})


# ------------------------------------------------------------ reading the form
FIELDS = {'song title': 'title', 'writer': 'author', 'lyrics': 'lyrics', 'may these words be shared with every church?': 'rights',
          'shared by (church)': 'church', 'midi file (optional)': 'midi', 'confirmation': 'confirm'}


def parse_form(body):
    out = {}
    parts = re.split(r'^###\s+(.+?)\s*$', body or '', flags=re.M)
    for i in range(1, len(parts) - 1, 2):
        key = FIELDS.get(parts[i].strip().lower())
        if not key:
            continue
        val = parts[i + 1].strip()
        if val == '_No response_':
            val = ''
        val = re.sub(r'^```[a-z]*\n?|\n?```$', '', val).strip('\n')
        out[key] = val
    out['confirmed'] = bool(re.search(r'-\s*\[[xX]\]', out.get('confirm', '')))
    return out


def clean_text(s, n):
    s = unicodedata.normalize('NFC', str(s or ''))
    s = re.sub(r'[\u0000-\u0008\u000b-\u001f\u007f<>]', '', s)
    return re.sub(r'\s+', ' ', s).strip()[:n]


CHORUS_RE = re.compile(r'^(chorus|refrain|koor|refrein|ikhorasi)\s*[:.]?\s*$', re.I)


def tidy_line(l):
    l = clean_text(l, 200)
    l = re.sub(r'\s+([,.;:!?])', r'\1', l)
    l = l.replace(" '", ' ‘').replace("'", '’').replace('--', ' – ')
    if l and l[0].islower():
        l = l[0].upper() + l[1:]
    return l


def parse_lyrics(text):
    """Stanzas split by empty lines; a stanza that starts with "Chorus:" is the chorus."""
    blocks = re.split(r'\n\s*\n', (text or '').replace('\r', ''))
    v, c = [], None
    for b in blocks:
        ls = [x for x in (y.strip() for y in b.split('\n')) if x]
        if not ls:
            continue
        if CHORUS_RE.match(ls[0]):
            body = [tidy_line(x) for x in ls[1:] if x]
            if body and c is None:
                c = body
            continue
        ls = [re.sub(r'^\d+[.)]\s+', '', x) for x in ls]  # "1. Line" stanza numbers
        v.append([tidy_line(x) for x in ls])
    v = [s for s in v if s]
    if not v and c:
        v, c = [c], None
    return v, c


# ------------------------------------------------------------ checks
def norm(s):
    s = unicodedata.normalize('NFKD', s or '').lower()
    return re.sub(r'[^a-z0-9 ]+', '', re.sub(r'[’‘\']', '', s)).strip()


def words(s):
    return norm(s).split()


def all_songs():
    out = []
    d = os.path.join(ROOT, 'data', 'hymns')
    for f in sorted(os.listdir(d)):
        if not f.endswith('.json') or f == 'index.json':
            continue
        try:
            j = json.load(open(os.path.join(d, f), encoding='utf-8'))
        except Exception:
            continue
        for h in j.get('hymns', []):
            out.append((j.get('short') or f, h.get('n'), h.get('t', ''), (h.get('v') or [[]])[0][:1]))
    try:
        for h in json.load(open(COMMUNITY, encoding='utf-8')).get('songs', []):
            out.append(('CHR (shared)', h.get('n'), h.get('t', ''), (h.get('v') or [[]])[0][:1]))
    except Exception:
        pass
    return out


def find_duplicates(title, first):
    nt, nf = norm(title), norm(first)
    same, near = [], []
    for book, n, t, f1 in all_songs():
        tt, ff = norm(t), norm(f1[0] if f1 else '')
        if not tt:
            continue
        r1 = difflib.SequenceMatcher(None, nt, tt).ratio()
        r2 = difflib.SequenceMatcher(None, nf, ff).ratio() if nf and ff else 0
        if nt == tt and (not nf or r2 > 0.6):
            same.append('%s %s “%s”' % (book, n, t))
        elif r1 > 0.88 or r2 > 0.9:
            near.append('%s %s “%s”' % (book, n, t))
    return same[:5], near[:5]


def get(url, limit=2 * 1048576, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError('too large')
    return data


def lyrics_check(title, author, v, c):
    """Compare with LRCLIB (a public lyrics database): returns (best ratio, source label, lines that differ)."""
    mine = [l for s in v for l in s] + (c or [])
    try:
        q = {'track_name': title}
        if author:
            q['artist_name'] = author
        res = json.loads(get('https://lrclib.net/api/search?' + urllib.parse.urlencode(q), 4 * 1048576))
        if not res and author:
            res = json.loads(get('https://lrclib.net/api/search?' + urllib.parse.urlencode({'q': title}), 4 * 1048576))
    except Exception as e:
        return None, 'not reachable (%s)' % e, []
    best, label, ref = 0.0, '', ''
    for r in (res or [])[:8]:
        txt = r.get('plainLyrics') or ''
        if not txt:
            continue
        ratio = difflib.SequenceMatcher(None, words(' '.join(mine)), words(txt)).ratio()
        if ratio > best:
            best, label, ref = ratio, '“%s” by %s' % (r.get('trackName', ''), r.get('artistName', '') or 'unknown'), txt
    if not ref:
        return None, 'not found', []
    ref_lines = [norm(x) for x in ref.split('\n') if x.strip()]
    differ = []
    for l in mine:
        nl = norm(l)
        if nl and not any(difflib.SequenceMatcher(None, nl, r).ratio() > 0.85 for r in ref_lines):
            differ.append(l)
    return best, label, differ[:6]


def midi_from_links(text):
    for url in re.findall(r'https://[^\s)>\]]+', text or ''):
        if not re.search(r'\.(mid|midi|zip)(\?|$)|/user-attachments/|/files/', url, re.I):
            continue
        try:
            data = get(url)
        except Exception:
            continue
        if data[:4] == b'MThd':
            return data, 'the file in this issue'
        if data[:2] == b'PK':
            try:
                z = zipfile.ZipFile(io.BytesIO(data))
                for n in z.namelist():
                    if n.lower().endswith(('.mid', '.midi')):
                        m = z.read(n)
                        if m[:4] == b'MThd' and len(m) < 2 * 1048576:
                            return m, 'the file in this issue (%s)' % os.path.basename(n)
            except Exception:
                pass
    return None, ''


STOP = {'the', 'a', 'an', 'of', 'to', 'and', 'in', 'my', 'is', 'o', 'oh', 'mid', 'midi'}


def midi_search(title):
    """BitMidi: the best title match, if it is a good one."""
    try:
        j = json.loads(get('https://bitmidi.com/api/midi/search?q=' + urllib.parse.quote(title)))
    except Exception:
        return None, ''
    want = [w for w in words(title) if w not in STOP]
    best = None
    for x in ((j.get('result') or {}).get('results') or [])[:10]:
        name = re.sub(r'\.mid$', '', x.get('name', ''), flags=re.I)
        have = set(words(name))
        score = (sum(1 for w in want if w in have) / len(want)) if want else 0
        extra = len([w for w in have if w not in want and w not in STOP])
        if score >= 0.8 and extra <= 3 and (not best or score > best[0]):
            best = (score, name, 'https://bitmidi.com' + (x.get('downloadUrl') or ''))
    if not best:
        return None, ''
    try:
        data = get(best[2])
        if data[:4] == b'MThd':
            return data, 'BitMidi “%s” (%s) — check that this tune is the right one and may be shared' % (best[1], best[2].replace('/uploads/', '/').replace('.mid', ''))
    except Exception:
        pass
    return None, ''


def run_checks(f):
    errors, warns, info = [], [], []
    title = clean_text(f.get('title'), 120)
    author = clean_text(f.get('author'), 120)
    v, c = parse_lyrics(f.get('lyrics', ''))
    if not title:
        errors.append('The song title is missing.')
    if not v:
        errors.append('There are no words.')
    n_lines = sum(len(s) for s in v) + len(c or [])
    if n_lines > 80:
        errors.append('The words are very long (%d lines). Praise choruses are short songs.' % n_lines)
    doubled = [l for st in v for l in st if re.search(r'\b(the|a|an|and|to|of|in|is|my)\s+\1\b', l, re.I)]
    if doubled:
        warns.append('A word may be typed twice: ' + '; '.join(doubled[:3]))
    if re.search(r'https?://|www\.', f.get('lyrics', '')):
        errors.append('The words contain a web address.')
    rights = (f.get('rights') or '').strip().lower()
    if rights not in ('public-domain', 'own', 'permission'):
        errors.append('It is not clear that the words may be shared (answer: %s). Only public-domain songs, songs your church wrote, or songs shared with the writer’s permission can go to every church.' % (rights or 'none'))
    if not f.get('confirmed'):
        errors.append('The confirmation box is not ticked.')
    if title and v:
        same, near = find_duplicates(title, v[0][0])
        if same:
            errors.append('This chorus is already in SDA Sabbath: ' + ', '.join(same) + '.')
        elif near:
            warns.append('Similar songs are already in SDA Sabbath: ' + ', '.join(near) + '. Check that this is a different song.')
        ratio, label, differ = lyrics_check(title, author, v, c)
        if ratio is None:
            info.append('Lyrics database (LRCLIB): %s — the words could not be compared.' % label)
        elif ratio >= 0.85:
            warns.append('The words match a published song in a lyrics database (%s, %d%% the same). Published songs are often under copyright: make sure this one may be shared.' % (label, round(ratio * 100)))
        elif ratio >= 0.45:
            warns.append('The words are like %s but %d%% the same. Check these lines for mistakes:\n%s' % (label, round(ratio * 100), '\n'.join('  - ' + l for l in differ)))
        else:
            info.append('Not found in the lyrics database (LRCLIB) — normal for church and older songs.')
    midi, src = midi_from_links(f.get('midi', ''))
    if not midi and title:
        midi, src = midi_search(title)
        if midi:
            warns.append('MIDI found on ' + src + '.')
    if midi:
        info.append('MIDI: %s (%d KB).' % (src, max(1, len(midi) // 1024)))
    else:
        info.append('No MIDI found. The chorus works without one; a MIDI can be added later.')
    song = {'t': title, 'a': author, 'v': v, 'c': c}
    return song, midi, errors, warns, info


def report(song, errors, warns, info, auto):
    out = ['### Chorus robot']
    if errors:
        out.append('❌ **This chorus cannot be shared yet.** Edit the issue (⋯ → Edit) to fix it; the robot checks again.')
    elif warns:
        out.append('⚠️ **Ready for the maintainer, with notes.**')
    else:
        out.append('✅ **All checks passed.**' + (' It is being published now.' if auto else ''))
    out += ['- ❌ ' + e for e in errors] + ['- ⚠️ ' + w for w in warns] + ['- ℹ️ ' + i for i in info]
    if song.get('v'):
        txt = []
        for i, s in enumerate(song['v']):
            txt.append('\n'.join(s))
            if i == 0 and song.get('c'):
                txt.append('Chorus:\n' + '\n'.join(song['c']))
        out.append('\n<details><summary>The words as they will appear (tidied)</summary>\n\n```text\n' + song['t'] + '\n\n' + '\n\n'.join(txt) + '\n```\n</details>')
    if not errors and not auto:
        out.append('\n**Maintainer:** add the label `chorus-approved` to publish it to every church.')
    return '\n'.join(out)


# ------------------------------------------------------------ publishing
def slug(s):
    return (re.sub(r'[^a-z0-9]+', '-', norm(s)).strip('-') or 'chorus')[:40]


def publish(num, f, song, midi, by_label):
    doc = json.load(open(COMMUNITY, encoding='utf-8'))
    songs = doc.get('songs', [])
    if any(s.get('issue') == num for s in songs):
        return None
    n = max([FIRST - 1] + [int(s.get('n', 0)) for s in songs]) + 1
    sid = '%s-%d' % (slug(song['t']), n)
    entry = {'n': n, 'id': sid, 't': song['t'], 'a': song['a'], 'v': song['v']}
    if song.get('c'):
        entry['c'] = song['c']
    entry['by'] = clean_text(f.get('church'), 80)
    entry['added'] = datetime.date.today().isoformat()
    entry['issue'] = num
    if midi:
        os.makedirs(MIDI_DIR, exist_ok=True)
        open(os.path.join(MIDI_DIR, sid + '.mid'), 'wb').write(midi)
        entry['midi'] = 'data/hymns/community/midi/%s.mid' % sid
    songs.append(entry)
    doc['songs'] = songs
    doc['rev'] = int(doc.get('rev', 0)) + 1
    doc['updated'] = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    open(COMMUNITY, 'w', encoding='utf-8').write(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
    git = lambda *a: subprocess.run(['git'] + list(a), cwd=ROOT, check=True)
    git('config', 'user.name', 'github-actions[bot]')
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
    git('add', 'data/hymns/community')
    git('commit', '-m', 'Shared chorus CHR %d: %s (#%d)' % (n, song['t'], num))
    for _ in range(3):
        if subprocess.run(['git', 'push', 'origin', 'HEAD:main'], cwd=ROOT).returncode == 0:
            break
        git('pull', '--rebase', 'origin', 'main')
    else:
        raise RuntimeError('could not push')
    try:  # pushes by the robot do not start other workflows by themselves
        api('POST', '/repos/%s/actions/workflows/pages.yml/dispatches' % REPO, {'ref': 'main'})
    except Exception as e:
        print('pages dispatch failed', e)
    return n


def main():
    ev = json.load(open(os.environ['GITHUB_EVENT_PATH'], encoding='utf-8'))
    action = ev.get('action')
    issue = ev.get('issue') or {}
    num = issue.get('number')
    labels = {l.get('name') for l in issue.get('labels', [])}
    if 'chorus-published' in labels or issue.get('state') == 'closed':
        print('already published or closed')
        return
    approve = action == 'labeled' and (ev.get('label') or {}).get('name') == 'chorus-approved'
    if action == 'labeled' and not approve:
        return
    ensure_labels()
    f = parse_form(issue.get('body') or '')
    song, midi, errors, warns, info = run_checks(f)
    auto = os.environ.get('AUTO_PUBLISH', '').strip().lower() == 'true' and not errors and not warns
    if not approve:
        comment(num, report(song, errors, warns, info, auto))
        set_labels(num, add=['chorus', 'chorus-needs-attention' if (errors or warns) else 'chorus-checked'],
                   remove=['chorus-checked' if (errors or warns) else 'chorus-needs-attention'])
        if not auto:
            return
    if errors:
        comment(num, report(song, errors, warns, info, False) + '\n\n**Not published:** fix the problems above first.')
        set_labels(num, remove=['chorus-approved'])
        return
    n = publish(num, f, song, midi, approve)
    if n is None:
        return
    api('POST', '/repos/%s/issues/%d/comments' % (REPO, num), {'body': '🎵 **Published as CHR %d** in the shared Praise Choruses%s. Every SDA Sabbath gets it when it is online (the website updates in about 5 minutes). Thank you for sharing!' % (n, ' with its MIDI' if midi else '')})
    set_labels(num, add=['chorus-published'], remove=['chorus-checked', 'chorus-needs-attention'])
    api('PATCH', '/repos/%s/issues/%d' % (REPO, num), {'state': 'closed', 'state_reason': 'completed'})


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'selftest':
        f = parse_form(open(sys.argv[2], encoding='utf-8').read())
        song, midi, errors, warns, info = run_checks(f)
        print(json.dumps(f, indent=1, ensure_ascii=False))
        print(report(song, errors, warns, info, False))
        print('MIDI bytes:', len(midi) if midi else 0)
    else:
        main()
