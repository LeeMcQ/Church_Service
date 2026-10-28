#!/usr/bin/env python3
"""Idempotent data fixes for the bundled hymns and Bibles. Run from the repo root: python3 tools/polish_data.py"""
import json, re, glob

def load(p): return json.load(open(p, encoding='utf-8'))
def save(p, d): open(p, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, separators=(',', ':')))

# hymns ---------------------------------------------------------------
def fix_line(s):
    s = re.sub(r'(?<=\w)- ', ' – ', s)           # "you- by" -> "you – by"
    s = re.sub(r'(?<=\w)-$', ' –', s)            # trailing dash
    s = s.replace('--', ' – ')
    s = s.replace('dearth’s', 'earth’s')
    s = re.sub(r"(^|\s)['‘]n(\s)", r'\1’n\2', s)  # Afrikaans article
    return s

for f in glob.glob('data/hymns/*.json'):
    if f.endswith('index.json'): continue
    d = load(f)
    for h in d['hymns']:
        h['v'] = [[fix_line(l) for l in st] for st in h.get('v', [])]
        if h.get('c'): h['c'] = [fix_line(l) for l in h['c']]
    # Titles lost their apostrophes ("Gods Free Mercy", "The Lords My Shepherd"): put back the one the hymn's own
    # words use ("God’s"), but only when the words never use the plain form ("Faith of Our Fathers" stays).
    for h in d['hymns']:
        lyr = ' '.join(l for st in h.get('v', []) for l in st) + ' ' + ' '.join(h.get('c') or [])
        forms = {}
        for w in re.findall(r"[A-Za-z’']+", lyr):
            w2 = w.replace("'", '’').strip('’') if not w.startswith(("’", "'")) or len(w) < 3 else w.replace("'", '’')
            key = w2.replace('’', '').lower()
            forms.setdefault(key, set()).add(w2)
        def fix_word(m):
            t = m.group(0)
            before = h['t'][m.start() - 1] if m.start() > 0 else ''
            after = h['t'][m.end()] if m.end() < len(h['t']) else ''
            if before in "’'‘" or after in "’'": return t      # already has one
            if t in ('Tis', 'Twas', 'Neath'): return '’' + t   # ’Tis, ’Twas, ’Neath
            fs = forms.get(t.lower(), set())
            inner = [x for x in fs if '’' in x[1:-1]]            # an apostrophe inside the word: God’s, I’ve, O’er
            if not inner or [x for x in fs if '’' not in x]: return t
            x = inner[0]; j = x.index('’')
            return t[:j] + '’' + t[j:]
        h['t'] = re.sub(r"[A-Za-z]+", fix_word, h['t'])
    if f.endswith('sda-online.json'):
        for h in d['hymns']:   # SDAH 578 (Clarkson, 1963 text): "So send I you", not "So sent I you"
            if h['n'] == 578: h['v'] = [[l.replace('So sent I you', 'So send I you').replace('So Send I you', 'So send I you') for l in st] for st in h['v']]
    if f.endswith('choruses.json'):
        d['hymns'] = [h for h in d['hymns'] if not (h['n'] == 42 and h['t'].startswith('We Are Standing on Holy Ground'))]
    save(f, d)

# Bibles: Afrikaans typography ----------------------------------------
for f in glob.glob('data/bibles/afr53/[0-9]*.json'):
    d = load(f)
    d = [[re.sub(r"(^|[\s“‘(\[])['‘]n(?=[\s.,;:!?)])", r'\1’n', v).replace('--', ' – ') for v in ch] for ch in d]
    save(f, d)
print('polished')

# Bibles: Psalm titles and acrostic letters -----------------------------
# The KJV (and the Afrikaans 1933/53 where the title shares a verse with the text) glue the Psalm's title onto
# verse 1 ("A Psalm of David. The LORD is my shepherd") and Psalm 119's Hebrew letters onto every eighth verse
# ("ALEPH. Blessed are…"). They move to titles.json ({"19": {"23": {"1": "A Psalm of David."}}}): the Bible tab
# shows them small above the verse, and the projector shows only the verse. Running this again changes nothing.
KJV_END = {18: 'And he said,', 54: 'Doth not David hide himself with us?'}   # titles that do not end at the first full stop
KJV_TITLE = re.compile(r"^\[?(To the chief Musician|A\]? Psalm|A Song|Maschil|Michtam|A Prayer|Shiggaion|David's|\[A\] Psalm)")
AF_TITLE_WORDS = re.compile(r"^(Vir die musiekleier|’n Psalm|’n Lied|’n Gedig|’n Onderwysing|’n Gebed|’n Loflied|’n Bedevaartslied|’n Klaaglied|Van Dawid|Van Salomo|Van Asaf|Van die kinders van Korag|By die lofoffer|’n Psalm van|’n Lied van)[^.;]*[.;]\s+")
HEBREW = ['ALEPH', 'BETH', 'GIMEL', 'DALETH', 'HE', 'VAU', 'ZAIN', 'CHETH', 'TETH', 'JOD', 'CAPH', 'LAMED', 'MEM', 'NUN', 'SAMECH', 'AIN', 'PE', 'TZADDI', 'KOPH', 'RESH', 'SCHIN', 'TAU']
AF_LETTERS = re.compile(r"^(Alef|Bet|Gimel|Dalet|He|Wau|Sajin|Get|Tet|Jod|Kaf|Lamed|Mem|Noen|Samek|Ajin|Pe|Sade|Kof|Resj|Sin|Sjin|Tau)\.\s+")

def split_titles(tr):
    path = 'data/bibles/%s/19.json' % tr
    tpath = 'data/bibles/%s/titles.json' % tr
    ps = load(path)
    try: titles = load(tpath)
    except Exception: titles = {}
    t19 = titles.setdefault('19', {})
    kjv_ps = load('data/bibles/kjv/19.json')
    for i, ch in enumerate(ps):
        p = i + 1
        for vi in range(len(ch)):
            v = ch[vi]; head = ''
            if vi == 0 and tr == 'kjv' and KJV_TITLE.match(v):
                if p in KJV_END:
                    j = v.find(KJV_END[p]); head, rest = (v[:j + len(KJV_END[p])], v[j + len(KJV_END[p]):]) if j >= 0 else ('', v)
                else:
                    m = re.match(r'^(.*?[.:]) (?=[A-Z‹\[])', v); head, rest = (m.group(1), v[len(m.group(1)):]) if m else ('', v)
            elif vi == 0 and tr == 'afr53' and len(ch) == len(kjv_ps[i]):   # more verses than the KJV: the title has its own verse(s)
                rest = v
                while True:
                    m = AF_TITLE_WORDS.match(rest)
                    if not m: break
                    head += m.group(0); rest = rest[len(m.group(0)):]
                head = head.strip()
                if AF_TITLE_WORDS.match(rest.strip() + ' ') and AF_TITLE_WORDS.match(rest.strip() + ' ').end() >= len(rest.strip()):
                    head, rest = '', v   # the whole verse is title ("Vir die musiekleier. ’n Psalm van Dawid."): keep it
            else:
                rest = v
            # Hebrew letters (Psalm 119 and the alphabet Psalms 25, 37, 145 in Afrikaans)
            m = re.match(r'^(%s)\.\s+' % '|'.join(HEBREW), rest) if tr == 'kjv' else AF_LETTERS.match(rest)
            if m and (p == 119 or tr == 'afr53'):
                head = (head + ' ' if head else '') + m.group(1); rest = rest[len(m.group(0)):]
            rest = rest.strip()
            if head and rest:   # a verse that is only a title stays as it is (its own verse number)
                ch[vi] = rest[0].upper() + rest[1:] if tr == 'afr53' and rest[:2] == 'o ' else rest
                t19.setdefault(str(p), {})[str(vi + 1)] = head.strip()
    save(path, ps)
    save(tpath, titles)
    return sum(len(x) for x in t19.values())

for tr in ('kjv', 'afr53'):
    print(tr, 'psalm titles/letters:', split_titles(tr))
idx = load('data/bibles/index.json')   # the app only asks for titles.json where there is one (no 404s)
for t in idx:
    if t['id'] in ('kjv', 'afr53'): t['titles'] = True
open('data/bibles/index.json', 'w', encoding='utf-8').write(json.dumps(idx, ensure_ascii=False, indent=1) + '\n')

# Afrikaans 1933/53: Exodus 30:31-38 were missing from the source text (the chapter stopped at verse 30).
# Text from the Bible Society of South Africa's AFR53 (biblesa.co.za/af/bybel/AFR53/EXO.30), checked against a
# second copy; written in this file's style (HERE for the LORD, ’n, spaced dash).
EXO30_TAIL = [
    'En jy moet met die kinders van Israel spreek en sê: Dit moet vir My ’n heilige salfolie wees in julle geslagte.',
    'Op geen mens se liggaam mag dit uitgegiet word nie; julle mag ook, na dieselfde voorskrif, so iets nie maak nie: heilig is dit; heilig moet dit vir julle wees.',
    'Elkeen wat so iets meng of iets daarvan aan ’n onbevoegde laat kom, moet uit sy volksgenote uitgeroei word.',
    'Verder het die HERE vir Moses gesê: Neem vir jou speserye: storaksgom en naeltjies en gálbanum – speserye en ook suiwer wierook; alles in gelyke hoeveelhede,',
    'en maak daar reukwerk van, ’n mengsel soos die salfmenger dit maak, met sout gemeng, suiwer, heilig.',
    'En vrywe ’n gedeelte daarvan heeltemal fyn, en sit ’n deel daarvan neer voor die Getuienis in die tent van samekoms, waar Ek met jou sal saamkom; hoogheilig moet dit vir julle wees.',
    'En die reukwerk wat jy moet maak – na dieselfde voorskrif mag julle vir julle nie maak nie; as iets heiligs aan die HERE moet dit vir jou wees.',
    'Elkeen wat so iets maak om daaraan te ruik, moet uit sy volksgenote uitgeroei word.',
]
ex = load('data/bibles/afr53/02.json')
if len(ex[29]) == 30:
    ex[29].extend(EXO30_TAIL)
    save('data/bibles/afr53/02.json', ex)
    info = load('data/bibles/afr53/info.json')
    try:
        info['books'][1][2][29] = 38
        save('data/bibles/afr53/info.json', info)
    except Exception as e:
        print('info.json verse count not updated:', e)
print('Exodus 30 (AFR):', len(load('data/bibles/afr53/02.json')[29]), 'verses')
