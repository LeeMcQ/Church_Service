#!/usr/bin/env python3
"""
Convert Bible source files into Church Service's compact offline format.

Output (per translation):
    <out>/<id>/info.json   -> metadata + book names + verse counts per chapter
    <out>/<id>/01.json ... 66.json -> [[v1, v2, ...], [v1, ...], ...]  (chapters -> verses)

Why per-book files: a low-RAM phone only ever parses one book (~70 KB) at a time
instead of a 6 MB whole-Bible JSON.

Supported input shapes (auto-detected):
  * Joy-in-the-Journey flat   {"metadata":{...},"verses":[{book,chapter,verse,text}]}
  * Joy-in-the-Journey nested {"books":[{"name","chapters":[{"chapter","verses":[{verse,text}]}]}]}
  * thiagobodruk              [{"abbrev","chapters":[["v1","v2"],...]}]
  * Zefania XML               <XMLBIBLE><BIBLEBOOK bnumber><CHAPTER cnumber><VERS vnumber>
  * CSV / TSV                 book_number,chapter,verse,text

Usage:
    python tools/build_bibles.py                 # builds sources listed in SOURCES below
    python tools/build_bibles.py --licensed      # also converts files dropped in ./licensed/
                                                 # into ./data/bibles-private/ (git-ignored)
"""
import csv, json, os, re, sys, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.environ.get("SELAH_BIBLE_SRC", os.path.join(ROOT, "sources"))

# Public-domain translations shipped with the app.
SOURCES = [
    dict(id="kjv", abbr="KJV", name="King James Version", lang="en", year="1769",
         license="Public domain", file="kjv.json"),
    dict(id="web", abbr="WEB", name="World English Bible", lang="en", year="2006",
         license="Public domain", file="web.json"),
    dict(id="afr53", abbr="AFR", name="Afrikaanse Bybel 1933/53", lang="af", year="1933/1953",
         license="Public domain (50-year term expired)", file="afr.json"),
]

BOOKS_EN = ["Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
 "1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah",
 "Esther","Job","Psalms","Proverbs","Ecclesiastes","Song of Solomon","Isaiah","Jeremiah",
 "Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum",
 "Habakkuk","Zephaniah","Haggai","Zechariah","Malachi","Matthew","Mark","Luke","John","Acts",
 "Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians",
 "1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews",
 "James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation"]

BOOKS_AF = ["Genesis","Exodus","Levitikus","Numeri","Deuteronomium","Josua","Rigters","Rut",
 "1 Samuel","2 Samuel","1 Konings","2 Konings","1 Kronieke","2 Kronieke","Esra","Nehemia",
 "Ester","Job","Psalms","Spreuke","Prediker","Hooglied","Jesaja","Jeremia","Klaagliedere",
 "Esegiël","Daniël","Hosea","Joël","Amos","Obadja","Jona","Miga","Nahum","Habakuk","Sefanja",
 "Haggai","Sagaria","Maleagi","Matteus","Markus","Lukas","Johannes","Handelinge","Romeine",
 "1 Korintiërs","2 Korintiërs","Galasiërs","Efesiërs","Filippense","Kolossense",
 "1 Tessalonisense","2 Tessalonisense","1 Timoteus","2 Timoteus","Titus","Filemon","Hebreërs",
 "Jakobus","1 Petrus","2 Petrus","1 Johannes","2 Johannes","3 Johannes","Judas","Openbaring"]

BOOKS_XH = ["Genesis","Eksodus","Levitikus","Numeri","Duteronomi","Yoshuwa","Abagwebi","Rute",
 "1 Samuweli","2 Samuweli","1 Kumkani","2 Kumkani","1 Kronike","2 Kronike","Ezra","Nehemiya",
 "Estere","Yobhi","Iindumiso","IMizekeliso","INtshumayeli","IsiHlabelelo","Isaya","Yeremiya",
 "IZililo","Hezekile","Daniyeli","Hoseya","Yoweli","Amosi","Obhadiya","Yona","Mika","Nahum",
 "Habhakuki","Zefaniya","Hagayi","Zekariya","Malaki","Mateyu","Marko","Luka","Yohane","IZenzo",
 "KwabaseRoma","1 KwabaseKorinte","2 KwabaseKorinte","KwabaseGalati","KwabaseEfese",
 "KwabaseFilipi","KwabaseKolose","1 KwabaseTesalonika","2 KwabaseTesalonika","1 kuTimoti",
 "2 kuTimoti","kuTito","kuFilemon","KumaHebhere","ElikaYakobi","1 kaPetros","2 kaPetros",
 "1 kaYohane","2 kaYohane","3 kaYohane","ElikaYuda","ISityhilelo"]

NAMES = {"en": BOOKS_EN, "af": BOOKS_AF, "xh": BOOKS_XH}
EN_INDEX = {n.lower(): i + 1 for i, n in enumerate(BOOKS_EN)}
EN_INDEX.update({"psalm": 19, "song of songs": 22, "canticles": 22, "revelations": 66})


def clean(text):
    text = text.replace("¶", "").replace(" ", " ")
    text = re.sub(r"<[^>]+>", "", text)          # stray HTML
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"([!?.;:])([A-Z])", r"\1 \2", text)  # "almal!Amen" -> "almal! Amen"
    return text


def book_no(name_or_no):
    if isinstance(name_or_no, int):
        return name_or_no
    s = str(name_or_no).strip()
    if s.isdigit():
        return int(s)
    return EN_INDEX.get(s.lower())


def load_any(path):
    """Return dict: book_no -> {chapter -> {verse -> text}}, plus optional metadata."""
    data = {}
    meta = {}

    def put(b, c, v, t):
        if not b or b < 1 or b > 66:
            return
        data.setdefault(b, {}).setdefault(int(c), {})[int(v)] = clean(t or "")

    low = path.lower()
    if low.endswith(".xml"):
        root = ET.parse(path).getroot()
        if root.tag.upper() == "XMLBIBLE":                      # Zefania
            meta["name"] = root.get("biblename")
            for bk in root.iter("BIBLEBOOK"):
                b = int(bk.get("bnumber"))
                for ch in bk.iter("CHAPTER"):
                    for vs in ch.iter("VERS"):
                        put(b, ch.get("cnumber"), vs.get("vnumber"), "".join(vs.itertext()))
        else:
            raise SystemExit("Unsupported XML (only Zefania is supported by this script; "
                             "the app's import screen also accepts OSIS).")
        return data, meta

    if low.endswith(".csv") or low.endswith(".tsv") or low.endswith(".txt"):
        delim = "\t" if not low.endswith(".csv") else ","
        with open(path, encoding="utf-8-sig") as f:
            for row in csv.reader(f, delimiter=delim):
                if len(row) < 4 or not row[1].strip().isdigit():
                    continue
                put(book_no(row[0]), row[1], row[2], delim.join(row[3:]))
        return data, meta

    with open(path, encoding="utf-8-sig") as f:
        j = json.load(f)

    if isinstance(j, dict) and "verses" in j:                    # flat
        meta = j.get("metadata") or {}
        for x in j["verses"]:
            put(book_no(x.get("book") or x.get("book_name")), x["chapter"], x["verse"], x["text"])
    elif isinstance(j, dict) and "books" in j:                   # nested
        meta = {k: j[k] for k in j if k != "books"}
        for i, bk in enumerate(j["books"]):
            b = book_no(bk.get("number") or bk.get("name")) or i + 1
            for ch in bk["chapters"]:
                for vs in ch["verses"]:
                    put(b, ch["chapter"], vs["verse"], vs["text"])
    elif isinstance(j, list) and j and "chapters" in j[0]:       # thiagobodruk
        for i, bk in enumerate(j):
            for ci, ch in enumerate(bk["chapters"]):
                for vi, t in enumerate(ch):
                    put(i + 1, ci + 1, vi + 1, t)
    else:
        raise SystemExit(f"Unrecognised Bible JSON shape: {path}")
    return data, meta


def write_translation(spec, data, out_dir):
    tdir = os.path.join(out_dir, spec["id"])
    os.makedirs(tdir, exist_ok=True)
    names = NAMES.get(spec["lang"], BOOKS_EN)
    books = []
    total = 0
    for b in range(1, 67):
        chapters = data.get(b, {})
        if not chapters:
            books.append([names[b - 1], 0, []])
            continue
        n_ch = max(chapters)
        arr, counts = [], []
        for c in range(1, n_ch + 1):
            verses = chapters.get(c, {})
            n_v = max(verses) if verses else 0
            arr.append([verses.get(v, "") for v in range(1, n_v + 1)])
            counts.append(n_v)
            total += n_v
        books.append([names[b - 1], n_ch, counts])
        with open(os.path.join(tdir, f"{b:02d}.json"), "w", encoding="utf-8") as f:
            json.dump(arr, f, ensure_ascii=False, separators=(",", ":"))
    info = {k: spec[k] for k in ("id", "abbr", "name", "lang", "year", "license") if k in spec}
    info["books"] = books
    with open(os.path.join(tdir, "info.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  {spec['abbr']:6} {total:6d} verses -> {os.path.relpath(tdir, ROOT)}")
    return {k: info[k] for k in info if k != "books"}


def build(specs, src_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    index = []
    for spec in specs:
        path = os.path.join(src_dir, spec["file"])
        if not os.path.exists(path):
            print(f"  skip {spec['abbr']}: {path} not found")
            continue
        data, _ = load_any(path)
        index.append(write_translation(spec, data, out_dir))
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    return index


def licensed_specs():
    """Files in ./licensed/ : <id>.<ext> with optional <id>.meta.json next to it."""
    lic = os.path.join(ROOT, "licensed")
    specs = []
    if not os.path.isdir(lic):
        return specs
    for fn in sorted(os.listdir(lic)):
        if fn.endswith(".meta.json") or fn.startswith(".") or fn.lower().startswith("readme"):
            continue
        base = fn.rsplit(".", 1)[0]
        meta_path = os.path.join(lic, base + ".meta.json")
        meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}
        spec = dict(id=meta.get("id", base.lower()), abbr=meta.get("abbr", base.upper()[:6]),
                    name=meta.get("name", base), lang=meta.get("lang", "en"),
                    year=meta.get("year", ""), license=meta.get("license", "Licensed — private use"),
                    file=fn)
        specs.append(spec)
    return specs


if __name__ == "__main__":
    print("Public-domain Bibles:")
    build(SOURCES, SRC_DIR, os.path.join(ROOT, "data", "bibles"))
    if "--licensed" in sys.argv:
        print("Licensed Bibles (private, git-ignored):")
        build(licensed_specs(), os.path.join(ROOT, "licensed"),
              os.path.join(ROOT, "data", "bibles-private"))
