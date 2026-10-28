# Licensed Bibles (kept private)

Put Bible files your church is licensed to use here — for example the NIV, or the 1975 Xhosa
Bible (`xho75.json` from the Joy in the Journey app). This folder is git-ignored, so the files
never reach a public repository.

Then run:

```
python tools/build.py --bibles
```

They are converted into `data/bibles-private/` (also git-ignored) and become part of **your**
installation: they download with the rest of the app and work offline, on every device that
installs Church Service from your own PC or companion.

Optional: add `<name>.meta.json` next to a file to set its labels, e.g. `xho75.meta.json`:

```json
{ "id": "xho75", "abbr": "XHO", "name": "IZibhalo Ezingcwele 1975", "lang": "xh",
  "license": "© 1975 Bible Society of South Africa — used with permission" }
```

`lang` (`en`, `af` or `xh`) decides the book names shown (John / Johannes / Yohane).

Supported formats: Zefania XML, JSON (Joy in the Journey flat or nested, thiagobodruk),
CSV/TSV (`book, chapter, verse, text`). Inside the app, **Settings → Bibles & hymns → Add a
Bible** also accepts OSIS XML and stores the Bible on that one device only.
