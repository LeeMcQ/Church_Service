# Development

## Built for weak computers

- **No framework.** Plain JavaScript modules, about 0.3 MB in total; each tab loads only when first opened.
- **One book at a time.** Bibles are stored per book (~70 KB), not as 6 MB files; at most eight books sit in memory.
- **Render once.** PDF pages and pictures are converted when imported and cached; presenting never re-renders.
- **Hardware video.** Video uses the browser's built-in, usually hardware-accelerated decoders, which is far
  lighter than running VLC itself. The equaliser and volume boost switch on only when used.
- **Low-power mode** (automatic on ≤2 GB RAM or ≤2 cores): no fades, no live video thumbnail, slides at 1280 px,
  screen sharing at 15 fps.
- **Rust where it pays off.** The companion is written in Rust with no third-party crates: one program
  that serves the app, relays the phone remote over WebSockets, streams media and runs LibreOffice.

Measured in testing: before hymn music was added the whole app installed (262 files, 14 MB) in about 3 seconds on a LAN; it is now about 330 files, 24 MB (the hymn instruments shrank from 17 to 4 MB in October 2026), and updates only download the files that changed; each window uses
about 8 MB of JavaScript memory; with the CPU slowed six times, a 24-verse passage is laid out in about
0.5 s and Present + Next takes about 0.4 s.

## Development

```
python tools/build.py              # update the offline file list (run before deploying)
python tools/build.py --bibles     # rebuild Bibles from ./sources (KJV, WEB, AFR from Joy in the Journey)
cd companion && cargo build --release
./companion/target/release/church-service --app-dir .     # serve this folder live while editing
```

Any static web server also works (`python -m http.server`), but service workers and screen sharing need
`https://` or `http://localhost`.

```
index.html, display.html     control screen and projector output
css/                         app.css (control UI), stage.css (projector + monitors)
js/app.js                    tabs, Present, display menu, shortcuts, service worker
js/core/                     render (text fitting), live (Next/Live), link (display connections),
                             wire (network protocol), books (reference parser), bibledata, db, settings, ui
js/tabs/                     bible, hymns, banners & music (ai.js, banner-music.js), slides, video, web & PC (webpc.js: web.js + screen.js), plan, tools, stage, settings
stage.html, js/stage-main.js stage screen (confidence monitor) for the platform; css/stagescreen.css
js/core/stagehub.js          stage hub: state, timers, messages, plan; stage window, Cast, companion and phone outlets
js/core/stagenet.js          phones & laptops: room code, WebRTC data channels found through Nostr (Trystero)
vendor/trystero/             Trystero 0.26 (MIT) with noble-secp256k1 (MIT), bundled as one ES module
obs.html, js/obs-main.js     OBS Browser Source: lower third (mode=lower) and full slides (mode=full); css/obs.css
js/core/obsctl.js            obs-websocket 5 client: one-click set-up, scene switching, stream / record status
js/tabs/stream.js            Tools → Stream (OBS, lower thirds, ticker, look); js/tabs/stage.js: Tools → Stage
js/lib/                      pdf (pdf.js wrapper), pptx renderer, screen capture, subtitles
js/display/display.js        projector renderer (also used for "this device" and Cast)
data/bibles/<id>/            info.json + 01.json … 66.json per translation
data/hymns/                  hymnbooks
companion/                   Rust companion (std only); build.rs embeds the app
data/music/                  hymn MIDI pack, verse index, GeneralUser GS subset (hymnal.sf3)
js/core/musicengine.js       SoundFont player (SpessaSynth), arrangement of intro + sung stanzas
js/core/hymnmusic.js         music controller: this device, or the PC display when used as a remote
js/core/bannerframe.js       banner slides on the display (palettes, countdown, corner clock)
js/core/church.js            church details, Sabbath date and offline sunset times
js/core/ai.js                optional online AI (text, background pictures, model lists)
js/tabs/ai.js                Banners & Music tab (make, saved, pre-service loop, music, topics, Ask AI)
js/tabs/slide-editor.js      Banner slide editor: select, move, resize, rotate, text formatting, arrange, toolbar, format panel
js/core/slideels.js          Free slide items (text boxes, shapes, lines, pictures): validation and drawing
js/core/bgmusic.js           Banner music: music list, players (files, MIDI, streams, YouTube, SoundCloud), start/fade rules
js/tabs/ai-full.js           the “full banner” AI picture maker
js/core/lyrics.js            online lyrics finder: sources, ranking, stanza/chorus detection
data/topics/topics.json      key verses for the 28 Fundamental Beliefs and sermon topics
js/lib/smf.js                MIDI file reader/writer and section joining
vendor/spessasynth/          SpessaSynth (Apache 2.0)
tools/                       build.py, build_bibles.py, build_hymn_music.py, build_hymn_soundfont.mjs
```

## Tests and deploying

Every push to `main` runs `.github/workflows/pages.yml`:

1. `python tools/build.py --minify` shrinks `js/` and `css/` (esbuild, one file at a time, about 35% smaller) on
   GitHub's copy only, then stamps the offline file list. Your folder keeps the readable code.
2. `python tests/smoke.py` opens every page and tab, puts a verse and a hymn live, steps through it, opens the
   stage screen, toggles black, opens a plan file, imports a Bible file and plays hymn music, all on the
   shrunk code. **If any check fails, nothing is published** and the website keeps the last version that passed.
3. The site and the companion downloads are published.

Run the same tests on your own PC before pushing:

```
pip install playwright && python -m playwright install chromium
python tools/build.py && python tests/smoke.py
```

## The hymn SoundFont

`data/music/hymnal.sf3` (4.3 MB) is the GeneralUser GS subset with its samples compressed to Ogg Vorbis, the
format MuseScore uses. To rebuild it: `node tools/build_hymn_soundfont.mjs …` (lossless `.sf2` subset), then
`node tools/compress_soundfont.mjs data/music/hymnal.sf2 data/music/hymnal.sf3` (needs ffmpeg). Keep the `.sf2`
out of the repository: the app only loads the `.sf3`.

[← Back to the README](../README.md)
