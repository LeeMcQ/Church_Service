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
    if f.endswith('choruses.json'):
        d['hymns'] = [h for h in d['hymns'] if not (h['n'] == 42 and h['t'].startswith('We Are Standing on Holy Ground'))]
    save(f, d)

# Bibles: Afrikaans typography ----------------------------------------
for f in glob.glob('data/bibles/afr53/[0-9]*.json'):
    d = load(f)
    d = [[re.sub(r"(^|[\s“‘(\[])['‘]n(?=[\s.,;:!?)])", r'\1’n', v).replace('--', ' – ') for v in ch] for ch in d]
    save(f, d)
print('polished')
