"""Structure analysis for the SDA Hymnal accompaniment MIDI files.

Each file is: [intro] [verse 1] [verse 2] ... [last verse with ending]. Sections are separated
by a fermata — the tempo drops to roughly a third of the hymn tempo for about one beat, then
returns. That pattern gives exact section boundaries (in ticks), which the app uses to play
exactly the stanzas being sung and to change slides in time with the music.
"""
import collections
import mido


def tempo_map(mid):
    """[(tick, bpm)] sorted, with a value at tick 0."""
    ev = []
    for tr in mid.tracks:
        t = 0
        for m in tr:
            t += m.time
            if m.type == 'set_tempo':
                ev.append((t, mido.tempo2bpm(m.tempo)))
    ev.sort()
    if not ev or ev[0][0] != 0:
        ev.insert(0, (0, 120.0))
    out = []
    for t, b in ev:  # last event at a tick wins
        if out and out[-1][0] == t:
            out[-1] = (t, b)
        else:
            out.append((t, b))
    return out


def note_spans(mid):
    """All notes: (start_tick, end_tick, channel, key, velocity, track)."""
    notes = []
    for ti, tr in enumerate(mid.tracks):
        t = 0
        on = {}
        for m in tr:
            t += m.time
            if m.type == 'note_on' and m.velocity > 0:
                on.setdefault((m.channel, m.note), []).append((t, m.velocity))
            elif m.type in ('note_off', 'note_on'):
                lst = on.get((m.channel, m.note))
                if lst:
                    s, v = lst.pop(0)
                    notes.append((s, t, m.channel, m.note, v, ti))
    notes.sort()
    return notes


def tick_to_seconds_fn(tmap, tpq):
    pts = []
    sec = 0.0
    for i, (t, bpm) in enumerate(tmap):
        if i:
            pt, pb = tmap[i - 1]
            sec += (t - pt) / tpq * 60.0 / pb
        pts.append((t, sec, bpm))

    def f(tick):
        lo = 0
        for i, p in enumerate(pts):
            if p[0] <= tick:
                lo = i
            else:
                break
        t, s, b = pts[lo]
        return s + (tick - t) / tpq * 60.0 / b
    return f


def analyse(path):
    mid = mido.MidiFile(path)
    tpq = mid.ticks_per_beat
    tmap = tempo_map(mid)
    notes = note_spans(mid)
    if not notes:
        return None
    first_tick = notes[0][0]
    last_tick = max(n[1] for n in notes)
    # Base tempo: the tempo that covers the most beats.
    dur = collections.Counter()
    for i, (t, b) in enumerate(tmap):
        nt = tmap[i + 1][0] if i + 1 < len(tmap) else last_tick
        dur[round(b)] += max(0, nt - t)
    base = dur.most_common(1)[0][0]
    # Fermata boundaries: a slow event (< 60% of base) followed within 3 beats by a return to >= 80% of base.
    bounds = []
    for i, (t, b) in enumerate(tmap):
        if b < base * 0.6 and i + 1 < len(tmap):
            nt, nb = tmap[i + 1]
            if nb >= base * 0.8 and nt - t <= 3 * tpq and nt < last_tick - tpq:
                bounds.append(nt)
    # Sections between boundaries.
    edges = [first_tick] + bounds + [last_tick]
    sections = [[edges[i], edges[i + 1]] for i in range(len(edges) - 1) if edges[i + 1] - edges[i] > tpq]
    secs = tick_to_seconds_fn(tmap, tpq)
    # Melody: highest sounding note on the keyboard channels (0/1); phrase ends = long notes / rests.
    kb = sorted({n[2] for n in notes if n[2] != 9})
    names = [x.name for tr in mid.tracks for x in tr if x.type == 'track_name']
    # Which channels carry the four-part keyboard texture (program 5 = the piano part in these files)?
    progs = {}
    for tr in mid.tracks:
        for m in tr:
            if m.type == 'program_change':
                progs.setdefault(m.channel, m.program)
    melody_ch = 0
    mel = [n for n in notes if n[2] == melody_ch]
    # keep the top note of each onset
    top = {}
    for s, e, c, k, v, ti in mel:
        if s not in top or k > top[s][1]:
            top[s] = (e, k)
    onsets = sorted(top)
    phrase_ends = []
    for i, s in enumerate(onsets):
        e = top[s][0]
        nxt = onsets[i + 1] if i + 1 < len(onsets) else None
        length = (nxt if nxt else e) - s
        gap = (nxt - e) if nxt else 0
        if length >= 2 * tpq or gap >= tpq // 2:
            phrase_ends.append(nxt if nxt else e)
    return {
        'tpq': tpq,
        'base_bpm': base,
        'tempo': [[t, round(b, 3)] for t, b in tmap],
        'sections': sections,
        'section_seconds': [[round(secs(a), 3), round(secs(b), 3)] for a, b in sections],
        'phrase_ends': phrase_ends,
        'channels': kb,
        'programs': progs,
        'name': names[0].strip() if names else '',
        'title': names[1].strip() if len(names) > 1 else '',
        'seconds': round(secs(last_tick), 2),
        'first_tick': first_tick,
        'last_tick': last_tick,
    }


def melody(notes, tpq, channel=0):
    """Top note of each onset on the melody channel: [(tick, key)]."""
    top = {}
    for s, e, c, k, v, ti in notes:
        if c == channel and (s not in top or k > top[s]):
            top[s] = k
    return sorted(top.items())


def periods(mel, start, end, tpq, min_score=0.85):
    """All plausible verse lengths L (ticks): the melody after `start` repeats itself L later.
    Returns [(L, score)] with score = fraction of onsets that reappear (same key) L later."""
    pts = [(t, k) for t, k in mel if start <= t < end]
    if len(pts) < 8:
        return []
    tol = tpq // 8
    idx = {}
    for t, k in pts:
        idx.setdefault(t // tol, []).append((t, k))

    def score(L):
        hit = tot = 0
        for t, k in pts:
            if t + L >= end - tpq // 2:
                break
            tot += 1
            for bucket in ((t + L) // tol - 1, (t + L) // tol, (t + L) // tol + 1):
                if any(abs(t2 - (t + L)) <= tol and k2 == k for t2, k2 in idx.get(bucket, ())):
                    hit += 1
                    break
        return (hit / tot if tot >= 6 else 0.0)

    out = []
    L = 4 * tpq
    while L <= (end - start) * 0.67:
        sc = score(L)
        if sc >= min_score:
            out.append((L, sc))
        L += tpq // 2
    # keep local maxima only
    res = []
    for i, (L, sc) in enumerate(out):
        if any(abs(L2 - L) <= tpq and sc2 > sc for L2, sc2 in out):
            continue
        res.append((L, sc))
    return res


def _score_at(mel, start, end, L, tpq):
    """Fraction of melody onsets after `start` that reappear (same key) L ticks later."""
    pts = [(t, k) for t, k in mel if start <= t < end]
    tol = tpq // 8
    have = {}
    for t, k in pts:
        have.setdefault(t // tol, []).append((t, k))
    hit = tot = 0
    for t, k in pts:
        if t + L >= end - tpq // 2:
            break
        tot += 1
        for bkt in ((t + L) // tol - 1, (t + L) // tol, (t + L) // tol + 1):
            if any(abs(t2 - (t + L)) <= tol and k2 == k for t2, k2 in have.get(bkt, ())):
                hit += 1
                break
    return hit / tot if tot >= 6 else 0.0


def verse_plan(a, notes, stanzas=None):
    """Intro end + verse starts.

    Verse length: the shift at which the melody repeats itself. Verse phase (where verse 1
    starts) is less obvious: the intro may run straight into verse 1, or be the refrain (which
    also ends every verse). Candidates are anchored both at the intro fermatas and at the end of
    the file; the one whose verse starts fall on the arrangement's pauses (fermatas) wins, then
    the one whose verses fill the file exactly. The hymn's stanza count breaks remaining ties
    (e.g. a melody that repeats inside each verse)."""
    tpq = a['tpq']
    first, last = a['first_tick'], a['last_tick']
    bounds = [s for s, e in a['sections']][1:]
    near_bound = lambda t: any(abs(b - t) <= tpq for b in bounds)
    cands = []
    for chans in ((0,), tuple(c for c in a['channels'] if c in (0, 1)), tuple(a['channels'])):
        mel = melody([n for n in notes if n[2] in chans], tpq, chans[0]) if len(chans) == 1 else \
            sorted({(n[0], n[3]) for n in notes if n[2] in chans})
        onsets = [t for t, k in mel]
        Ls = {}
        for s in [first] + bounds[:3]:
            for L, sc in periods(mel, s, last, tpq):
                Ls[L] = max(Ls.get(L, 0), sc)

        def add(intro_end, L, reps, sc):
            # one "verse" proves nothing about repetition, unless the hymn has a single stanza
            if reps < 2 and not (stanzas == 1 and reps == 1):
                return
            cov = (last - intro_end) / (reps * L)
            if not 0.85 <= cov <= 1.6:
                return
            starts = [intro_end + i * L for i in range(reps)]
            checks = starts[1:]   # verse-to-verse boundaries (an intro may flow straight into verse 1)
            frac = (sum(1 for t in checks if near_bound(t)) / len(checks)) if checks else 0.5
            cands.append({'intro_end': intro_end, 'L': L, 'reps': reps, 'score': sc, 'aligned': frac, 'cov': cov})

        for L, sc in Ls.items():
            # anchored at the start / at an intro fermata
            for s in [first] + bounds[:3]:
                reps = int((last - s + tpq) // L)
                if stanzas and s == first and reps == stanzas + 1:   # intro that is itself a full verse
                    add(s + L, L, reps - 1, sc)
                add(s, L, reps, sc)
            # anchored at the end: the last verse finishes with the file
            r0 = max(1, int((last - first) // L))
            for reps in (r0 - 1, r0, r0 + 1):
                if reps < 1:
                    continue
                st = last - reps * L
                if st < first - tpq:
                    continue
                near = [b for b in bounds if abs(b - st) <= tpq] or [t for t in onsets if abs(t - st) <= tpq // 2]
                st = min(near, key=lambda b: abs(b - st)) if near else st
                if st - first < 2 * tpq:
                    st = first
                add(st, L, reps, sc)
        if cands:
            break
    if not cands:
        s = bounds[0] if bounds else first
        return {'intro_end': s, 'verse_len': last - s, 'verses': [[s, last]], 'score': 0.0, 'method': 'single'}

    def rank(c):
        diff = abs(c['reps'] - stanzas) if stanzas else 0
        over = 1 if stanzas and c['reps'] > stanzas else 0
        fit = 0 if abs(c['cov'] - 1) <= 0.06 else 1
        # Verse starts that all land on the arrangement's pauses are the strongest evidence; the
        # stanza count only decides between candidates that agree with the pauses equally well.
        aligned = 1 if c['aligned'] >= 0.99 else 0
        intro_on_pause = 0 if (c['intro_end'] == first or near_bound(c['intro_end'])) else 1
        return (-aligned, diff, over, fit, -round(c['score'], 2), intro_on_pause, round(abs(c['cov'] - 1), 3), -round(c['aligned'], 2), -c['L'])
    c = min(cands, key=rank)
    starts = [c['intro_end'] + i * c['L'] for i in range(c['reps'])]
    snapped = []
    shift = 0
    for i, t in enumerate(starts):
        # Verse 1 may carry a pickup (a couple of extra beats): allow a wider snap for it. A verse
        # start with a pause next to it snaps to the pause; one without follows verse 1's shift.
        tol = 3 * tpq if i == 0 else tpq
        near = [b for b in bounds if abs(b - t) <= tol and (not snapped or b > snapped[-1])]
        if near:
            b = min(near, key=lambda b: abs(b - t))
            if i == 0:
                shift = b - t
            snapped.append(b)
        else:
            snapped.append(t + shift)
    verses = [[snapped[i], snapped[i + 1] if i + 1 < len(snapped) else last] for i in range(len(snapped))]
    return {'intro_end': snapped[0] if snapped else c['intro_end'], 'verse_len': c['L'], 'verses': verses, 'score': round(c['score'], 3), 'method': 'repeat'}
