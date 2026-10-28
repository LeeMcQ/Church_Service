#!/usr/bin/env python3
"""
Build the offline hymn music library for Church Service.

  python tools/build_hymn_music.py "<folder with 001.mid … 695.mid>" [book-id]

Writes
  data/music/<book>-midi.zip   all MIDI files, compressed (≈1.5 MB instead of 15 MB)
  data/music/index.json        per hymn: tune name, length, intro and verse boundaries (MIDI ticks)

The SoundFont is built separately with tools/build_hymn_soundfont.mjs.
Needs: pip install mido
"""
import glob, json, os, re, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mido
from hymn_midi_analysis import analyse, note_spans, verse_plan

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    src = sys.argv[1]
    book = sys.argv[2] if len(sys.argv) > 2 else 'sda-online'
    hymnal = json.load(open(os.path.join(ROOT, 'data', 'hymns', book + '.json'), encoding='utf-8'))
    stanzas = {h['n']: len(h['v']) for h in (hymnal['hymns'] if isinstance(hymnal, dict) else hymnal)}
    out_dir = os.path.join(ROOT, 'data', 'music')
    os.makedirs(out_dir, exist_ok=True)
    pack = book + '-midi.zip'
    files = sorted(f for f in glob.glob(os.path.join(src, '**', '*.mid'), recursive=True) if re.match(r'^\d+\.mid$', os.path.basename(f)))
    entries = {}
    stats = {'exact': 0, 'fewer': 0, 'more': 0, 'single': 0}
    with zipfile.ZipFile(os.path.join(out_dir, pack), 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            n = int(os.path.basename(f)[:-4])
            name = '%03d.mid' % n
            z.write(f, name)
            a = analyse(f)
            if not a:
                continue
            st = stanzas.get(n)
            p = verse_plan(a, note_spans(mido.MidiFile(f)), st)
            k = len(p['verses'])
            if p['method'] == 'single':
                stats['single'] += 1
            elif st and k == st:
                stats['exact'] += 1
            elif st and k < st:
                stats['fewer'] += 1
            else:
                stats['more'] += 1
            tune = re.sub(r'^\s*#\s*\d+\s*', '', a['name'])
            tune = re.sub(r'\s*\.\.\..*$', '', tune).strip()
            entries[str(n)] = {
                'f': name, 'tune': tune, 'sec': a['seconds'], 'tpq': a['tpq'],
                'first': a['first_tick'], 'last': a['last_tick'],
                'intro': p['intro_end'], 'v': p['verses'],
                'ok': p['method'] == 'repeat' and p['score'] >= 0.85,
            }
    index_path = os.path.join(out_dir, 'index.json')
    index = json.load(open(index_path, encoding='utf-8')) if os.path.exists(index_path) else {}
    index.setdefault('version', 1)
    index['soundfont'] = 'hymnal.sf3'  # made by build_hymn_soundfont.mjs + compress_soundfont.mjs
    index['soundfontName'] = 'GeneralUser GS 2.0.3 by S. Christian Collins (hymnal subset)'
    index.setdefault('books', {})[book] = {'pack': pack, 'hymns': entries}
    with open(index_path, 'w', encoding='utf-8') as fh:
        json.dump(index, fh, separators=(',', ':'), ensure_ascii=False)
    size = os.path.getsize(os.path.join(out_dir, pack))
    print('%d tunes -> data/music/%s (%.2f MB) and index.json (%.0f KB)' % (len(entries), pack, size / 1048576, os.path.getsize(index_path) / 1024))
    print('verse structure: %(exact)d match the hymnal, %(fewer)d have fewer verses (repeated when sung), %(more)d more, %(single)d through-composed' % stats)


if __name__ == '__main__':
    main()
