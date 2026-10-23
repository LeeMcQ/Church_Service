# SDA Sabbath — offline church presenter for SDA media teams

SDA Sabbath shows Bible passages, hymns, slides, videos, web pages and your PC screen on the projector
(the extended screen) while the operator prepares what comes next on the main screen. It is a
Progressive Web App: install it once and it runs with **no internet**, on old PCs and 1–2 GB phones.

```
┌ SDA Sabbath ─ ● Display: Projector ─ [ Go to… John 3:16 / hymn 73 ] ────── [▶ Present  F5 ] ┐
│ Bible  │                                                         │ ○ Next  (green)          │
│ Hymns  │   the selected tab's options for what goes on next      │ ● Live  (red)            │
│ Banners│                                                         │ Black · Logo · Clear     │
│ Slides │                                                         │                          │
│ Video  │                                                         │                          │
│ Web&PC │                                                         │                          │
│ Plan   │                                                         │                          │
└────────┴─────── control bar while something is live (adapts to Bible / hymn / video …) ─────┘
```

Nothing reaches the projector until **Present** (F5 or Ctrl+Enter). Each tab keeps its own
“next” item, shown in the green **Next** monitor; the red **Live** monitor shows the projector.

## What each tab does

| Tab | What you can do |
|---|---|
| **Bible** | Type `John 3:16-18`, `Ps 23`, `Joh 3:16` (Afrikaans) or tap book → chapter → verses. KJV, WEB and the Afrikaans 1933/53 Bible are built in; add NIV, ESV, NKJV, Xhosa or any licensed Bible. Two translations side by side (e.g. English + isiXhosa). Text grows to fill the screen; long passages split into readable slides automatically. “Keep reading” shows the next verses when the preacher carries on. Full-text search. A row of verse numbers above the verses puts any verse one tap away, and the list keeps the live verse in view. |
| **Hymns** | Type the number or words. Title slide, one stanza per slide, chorus repeated automatically, choose which stanzas to sing (1, 2, 4). Tap a stanza to make it Next (also while the hymn is on screen); double-tap, Enter or Present shows it. Jump to any stanza from the control bar. Edit or add hymns; import or export hymnbooks. |
| **Slides** | PDF, PowerPoint (.pptx) and pictures. Converted once on import and kept offline. Speaker notes shown to the operator. Auto-advance loop for announcements. |
| **Video** | VLC-style player: playlist with auto-next and repeat, speed 0.25×–4×, A-B repeat, loop, frame step, fade in/out, volume boost to 200 %, 10-band equaliser with presets, fit/fill/stretch, zoom, rotate, mirror, brightness/contrast/colour/hue, .srt/.vtt subtitles, snapshots. Music can play **in the background** while lyrics stay on screen. |
| **Web & PC** | Two parts in one tab. **Web page:** *Mirror a tab* — the projector shows exactly that browser tab, without the mouse pointer (scroll/zoom it from SDA Sabbath in Chrome); *Embed* — YouTube and embeddable sites load directly on the display. **PC screen:** share the whole screen, one window (e.g. PowerPoint or a Bible app) or a tab; see it live inside SDA Sabbath. **Freeze** keeps the last picture up while you work privately. The **mini controller** floats on top of other programs. |
| **Plan** | Prepare the order of service at home (one-tap Divine Service, Sabbath School and Vespers templates, or **your own templates**: build a plan once, then ⋯ → Save as template, with or without its hymns and readings, and make it the default for new plans). Type in the Add box — “hymn 73”, “Amazing grace”, “John 3:16-18”, a slide deck, video or banner name — and pick a suggestion, or use **Add media…** (Bible verse ranges and whole chapters, hymns and choruses by number or words, slides, video, banners, web pages; new files can be added right there). Attach or change the media of each part while it keeps its name (“Opening Hymn — Hymn 73”), rename parts, add who leads them, drag parts into order, see progress and what is **On screen**, undo a removal, copy the order as text, export it to Word, **save or share it with its media** (⋯ → Save or share this plan: one `.sdaplan` file with the slides, pictures, banners and videos it uses; Bible passages and hymns go as references; templates can be shared the same way from ⋯ → Templates → Share, and opened on another device with ⋯ → Open a shared plan or template, as a plan or as the default template), and step through it in church with **Next part** (it becomes Next; Present shows it). |
| **Banners & Music** | Welcome, verse, announcement, offering (with giving QR code), countdown and Sabbath-sunset banners drawn live on the display; a self-running pre-service loop; **background music** that starts with the banners and fades out when something else goes on screen; key verses for the 28 Fundamental Beliefs and sermon topics. See [Banners](#banners) and [Banner music](#banner-music). |
| **Tools → Stage** | The **second screen for the people on the platform** (confidence monitor): the slide on screen and what comes next, the words in large type, speaker notes, the time, speaker timers, your messages and the order of service — never shown to the congregation. Open it on another monitor, cast it, or let pastors and singers **follow on their own phones and laptops** with a QR code or a short room code. See [Stage screen](#stage-screen). |
| **Tools → Stream** | **OBS Studio** for the live stream: lower thirds that show the **Bible verse or hymn words automatically** when they go on screen, names and titles, announcements, a scrolling ticker and the church logo; the slides as a full-screen **Presentation** source; **one-click OBS set-up**, automatic scene switching, and start/stop streaming and recording. See [Live stream (OBS)](#live-stream-obs). |
| **Settings** | Fonts (Atkinson Hyperlegible, serif), colours, background picture, logo, margins, text sizes, fade/cut, 4:3 projectors, light/dark theme, tabs left or right, low-power mode, backups, Bibles, church details, online AI. |

**Live translation** (sermon → captions in another language) is planned; the caption line is already
built into the display.

## Keyboard and clicker

| Key | Action |
|---|---|
| F5 · Ctrl+Enter | Present the Next item |
| → ↓ Page Down Space | Next verse / stanza / slide (Space plays/pauses a video) |
| ← ↑ Page Up | Previous |
| B or . | Black screen (press again to return) |
| L | Logo (a default slide with the church name or “Welcome” until you add a logo in Settings → Screen) |
| C or Esc twice | Clear the screen (one Esc never clears it) |
| / or Ctrl+K | Go to a reference or hymn number |
| 1 … 9 | Select that stanza (Hymns) or verse (Bible) as Next; two digits quickly for verse 10 and up. F5 then presents it |
| Click · double-click · Enter | On a verse, verse number or stanza: select it as Next · present it now · present it now |
| Alt+1 … Alt+9 | Switch tabs (Bible, Hymns, Banners & Music, Slides, Video, Web & PC, Plan, Tools, Settings) |
| F (on the projector window) | Full screen on/off |

Presentation clickers (Logitech, Targus, Norwii and the like) send Page Up / Page Down, so they work out of the
box, like in PowerPoint or Google Slides:
- Page Down / Page Up always move the slides, even when the cursor is in a search box, a dropdown has focus, a
  dialog is open, or the projector window has focus (only a multi-line text box keeps them).
- In a search box the app focused by itself (Bible reference, hymn search) and that is still empty, the other
  clicker buttons work too: arrows, “.” (black screen) and Esc. Letters still type normally.
- With nothing on screen, the clicker’s next button shows what is on the green Next screen.
- On the last slide of an item, pressing next again within 4 seconds moves on to the item on the Next screen
  (Bible readings simply continue to the following verses).
- The clicker’s “start slideshow” button (F5 / Shift+F5) presents; its black-screen button (“.”, B or W) blacks out.
- Browser Forward / Back keys, media next / previous keys and mouse side buttons also change slides.
- A clicker in **mouse mode** works on the projector window once it is full screen: left click = next, right
  click = back, scroll = next / back.
- **Clicker setup and test…** (display menu, or `?`) shows exactly what each clicker button sends and lets you
  **teach** any button (Next, Previous, Black, Present, Clear) by pressing it once. Taught buttons work everywhere,
  also while typing. It also shows the app build number, to check the newest version is running.

## Getting started

### 1. Open the app and install it

The app is published from this repository to **https://leemcq.github.io/Church_Service/** by the
included GitHub Pages workflow (repository **Settings → Pages → Source: GitHub Actions**).

On each church PC or phone, open that address in Chrome or Edge and choose **Install**. Every
file (Bibles, hymns, fonts, PDF engine) downloads in one go; after that SDA Sabbath works offline.

### Working without internet

SDA Sabbath is built to run a whole service with no internet:

- **Everything is stored on the device** the first time it is opened with internet (keep it open for a minute;
  Settings → App → Offline shows the progress). An **Offline** mark appears in the top bar when there is no internet.
- **Updates never break the offline copy.** A new version is downloaded completely while the current one keeps
  working, and only then takes over. If the download is interrupted, the current version simply stays.
- **It checks itself.** Every half hour (and when the internet comes back) the app checks that every stored file
  is there and fetches any that are missing. **Settings → App → Check & repair offline files** does it on demand.
- **Nothing stops the service.** If one part could not be stored (for example a tab), that tab shows a short
  message with *Try again* and *Repair offline files*, and every other tab keeps working. If the app itself cannot
  start, a help page offers *Reload* and *Repair* instead of a blank screen. Internet-only features (AI, online
  lyrics search, Bible downloads, music streams, web pages) say "you are offline" instead of failing.
- **Download a fresh copy** (Settings → App) only runs when the internet is really there, so the offline copy is
  never thrown away by accident.
- Install SDA Sabbath (browser menu → Install app) and press **Protect data**, so the browser never clears it to
  free disk space.

### 2. Projector setup (PC)

1. Connect the projector as an **extended** display (Windows: Win+P → Extend).
2. Press **Present** once. In Chrome/Edge, allow **Window management** when asked — from then on
   the display opens straight onto the projector.
3. Click the projector screen once so videos may play with sound (not needed once SDA Sabbath is installed).
4. The projector **stays full screen**. If it ever drops out (Esc on the projector, a clicker's slide-show
   button, another program), your next key press or click on the control screen, or on the projector, puts it
   straight back. A double click or F on the projector only goes *into* full screen. To allow leaving full
   screen, turn off **Settings → Displays → Keep the projector full screen**.

### 3. The SDA Sabbath companion (optional, recommended for the church PC)

One program (about 25 MB — most of it the hymn-music instrument sounds; no installer, no other software) that contains the whole app:

- **Windows:** download `selah-windows-x64.exe` from the **[companion download page](https://leemcq.github.io/Church_Service/companion.html)** (also linked in the app under Settings and Tools → Stream; it is rebuilt with every website update) and double-click it.
  SDA Sabbath opens at `http://localhost:7777`. To add Start-menu and desktop shortcuts in one go:

  ```powershell
  irm https://leemcq.github.io/Church_Service/download/selah-windows-x64.exe -OutFile $env:TEMP\selah.exe; & $env:TEMP\selah.exe --install
  ```
- **Raspberry Pi / Linux / Mac:** `selah-linux-arm64`, `selah-linux-x64`, `selah-macos-arm64` — `chmod +x` and run.

What it adds:

| | |
|---|---|
| **Phone remote** | Phones on the church Wi-Fi open `http://<pc>:7777/remote` (or scan the QR code in Settings → Displays) and enter the PIN. |
| **TV or second PC as the screen** | Open `http://<pc>:7777/display` in the TV's browser. |
| **Videos from the PC** | Files in `Videos\Selah` appear in the Video tab on every device, and stream with seeking. The list needs the PIN, but the files themselves can be opened by anyone on the same Wi-Fi who knows a file’s name, so keep private files out of that folder. |
| **Exact PowerPoint** | If LibreOffice is installed, .pptx files are converted to PDF so they look exactly as designed. Without it SDA Sabbath uses its built-in renderer (text, pictures, shapes, backgrounds). |

**Safe on the church PC:** only the companion's own pages (opened from its address) may use it without the PIN. A website
open in a browser on the same PC cannot control the screen or read the PIN, and requests that use an outside domain name
for this PC are refused (protection against DNS rebinding). Slides that reach a TV or second PC through the companion
(or Cast) are cleaned before they are drawn.

Options: `--port`, `--media <folder>`, `--pin <NNNN>`, `--no-browser`, `--install`. The PIN and folder
are remembered in `%APPDATA%\Selah\companion.txt`. Windows asks once to allow network access — allow
it for private networks.

### Casting to a TV or wireless display

- **Cast (Chromecast, Google TV, Android TV)** in the display menu uses the browser’s own casting. It only finds
  Google Cast devices. Most other TVs and projectors (Samsung, LG, Hisense, “Screen mirroring”) use **Miracast**,
  which a web page cannot reach, so they never appear in that list — on Android too.
- **Windows: Connect to a wireless display…** (display menu) opens the Windows Connect panel (also **Windows + K**,
  or Settings → System → Display → *Connect to a wireless display*). Pick the TV, choose **Extend** (Windows + P),
  and press **Present on the wireless display**: the TV is then a second screen with only the slides on it.
- **Android phones:** use the SDA Sabbath companion (the TV’s browser opens the companion address), or **Use this
  device as the screen** and then the phone’s *Smart View / Screen Cast / Screen mirroring*.
- While a display is connected, the **×** beside the display button stops it (Stop casting / Close the display
  window). The display menu also has **Cast to another device…**. Closing or reloading the app stops a cast and
  closes the display window; a cast TV that loses its controller goes black and ends the cast after a few seconds.

### Phones and tablets

Press **Present** and choose:
- **This device** — full screen on the phone itself (HDMI adapter or screen mirroring).
- **Cast** — Chromecast or a wireless display (Chrome on Android).
- **SDA Sabbath companion** — use the phone as a remote for the church PC or TV.

## Bibles

Built in (public domain): **KJV**, **WEB**, **Afrikaanse Bybel 1933/53**.
**NIV** (© Biblica) and the **1975 Xhosa Bible** (© Bible Society of South Africa) cannot be shipped
publicly. Each church adds its own licensed copy:

- **On one device:** Settings → Bibles & hymns → **Add a Bible** (Zefania XML, OSIS XML, JSON, CSV).
  The `xho75.json` file from Joy in the Journey imports directly.
- **For your whole installation:** drop the file into `licensed/` and run `python tools/build.py --bibles`
  (see `licensed/README.md`). The folder is git-ignored, so it never becomes public.

## Hymns

`data/hymns/sda-sample.json` holds sample hymns whose words are public domain, numbered as in the
1985 SDA Hymnal. Replace or add hymnbooks with **Hymns → ⋯ → Import a hymnbook**:

- JSON (SDA Sabbath format, formerly "Selah"):
  ```json
  { "id": "sda-en", "name": "SDA Hymnal", "short": "SDAH", "lang": "en",
    "hymns": [ { "n": 73, "t": "Holy, Holy, Holy", "a": "Reginald Heber",
                 "v": [["line 1", "line 2"], ["stanza 2 …"]], "c": ["chorus line 1", "…"] } ] }
  ```
- JSON as in the Afrikaans Liedboek site: `[ { "number": 1, "title": "…", "lyrics": "…" } ]`
  (stanzas separated by an empty line, chorus starting with `Chorus:` / `Koor:` / `Refrain:`).
- Plain text: each hymn starts with `# 73 Holy, Holy, Holy`, stanzas separated by empty lines.

To ship a hymnbook with the app, put the JSON in `data/hymns/` and list it in `data/hymns/index.json`.

### Find lyrics online

**Hymns → ⋯ → Find lyrics online** searches public lyric sites (LRCLIB and Lyrics.ovh) for a title, a first line
or any words (add “by singer” to narrow it). Songs already on the device are shown first. Online results are
ranked with a match label and a preview, so you can pick the right one; if an AI key is set, **Ask AI to help
identify** can also suggest which songs the words belong to (the lyrics always come from the lyric sites, never
from AI). The chosen words are split into stanzas and a chorus (shown as the slides they will become), can be
corrected, and are kept **offline** in a book (Praise Choruses by default) with **Add and put on Next**.
If nothing is found, links to other sites and a paste box are offered. Song words belong to their owners: check
that your church’s CCLI (or other) licence covers showing them.

### Hymn music (offline)

695 hymns of the English SDA Hymnal (1–695) have their accompaniment built in, marked ♪ in the list. The church's
MIDI files are played by a SoundFont synthesizer inside the browser (SpessaSynth) with the **GeneralUser GS 2.0.3**
SoundFont and the author's recommended GS reverb (59) and chorus (43, Chorus 3) — the same sound you get from
Falcosoft MIDI Player with that SoundFont. Nothing is streamed: it works with no internet.

- **Play music** plays the accompaniment for exactly the stanzas you chose to sing: introduction, then one verse of
  music per stanza, with the real ending on the last one. **Present & play** puts the hymn on the screen and starts
  the music together; press **M** to play/pause.
- **Words follow music:** while the hymn is live, the slides change with the music (title during the introduction,
  each stanza and chorus as it is reached). Press → / ← at any time to take over.
- **Tempo** (60–140 %), **Key** (±6 semitones), **Instrument** (as arranged, piano, organ, strings, choir), jump to the
  introduction or any verse, **Fade** and **Stop**. Volume, reverb and chorus are in **Hymns → ⚙ Hymn options**.
- **Phone as remote:** when a phone controls the church PC through the companion, the music plays on the PC (the
  display window). Open the display on the PC from `http://localhost:7777` — browsers only allow the synthesizer on
  `https://` or `localhost`. Click the projector window once at the start so it may play sound.
- 33 hymns (mostly the short responses 660–695) are through-composed, so they always play as recorded; 25 hymns have
  fewer verses of music than stanzas, so the verse music is repeated. Hymns 696–698 have no MIDI yet.

To rebuild after changing the MIDI files (put the numbered `.mid` files in `sources/hymn-midi/`):

```
pip install mido; npm i spessasynth_core                # once
python tools/build_hymn_music.py sources/hymn-midi     # verse/intro analysis → data/music/index.json + MIDI pack
node tools/build_hymn_soundfont.mjs path/to/GeneralUser-GS.sf2 sources/hymn-midi   # → data/music/hymnal.sf2
python tools/build.py
```

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

Measured in testing: before hymn music was added the whole app installed (262 files, 14 MB) in about 3 seconds on a LAN; it is now 276 files, 34 MB, and updates only download the files that changed; each window uses
about 8 MB of JavaScript memory; with the CPU slowed six times, a 24-verse passage is laid out in about
0.5 s and Present + Next takes about 0.4 s.

## Development

```
python tools/build.py              # update the offline file list (run before deploying)
python tools/build.py --bibles     # rebuild Bibles from ./sources (KJV, WEB, AFR from Joy in the Journey)
cd companion && cargo build --release
./companion/target/release/selah --app-dir .     # serve this folder live while editing
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
data/music/                  hymn MIDI pack, verse index, GeneralUser GS subset (hymnal.sf2)
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

## Credits and licences

- Bible texts: KJV and WEB (public domain), Afrikaanse Bybel 1933/53 — converted from the Joy in the Journey app
  (`github.com/LeeMcQ/joy-in-the-journey`).
- Sample hymn words: public domain.
- Fonts: Atkinson Hyperlegible Next and Source Serif 4 (SIL Open Font License).
- pdf.js (Apache 2.0), fflate (MIT), qrcode-generator (MIT), SpessaSynth (Apache 2.0), Trystero and noble-secp256k1 (MIT).
- GeneralUser GS 2.0.3 SoundFont by S. Christian Collins — free to use and modify
  (`data/music/GeneralUser-GS-LICENSE.txt`, https://www.schristiancollins.com).
- Hymn MIDI files: supplied by the church for its own services.
- SDA Sabbath code: MIT.

## Tools

The **Tools** tab (under More) has two parts, chosen with the buttons at its top:

- **Stage** — the second screen for the platform: messages, timers, stage screens, phones & laptops. See
  [Stage screen](#stage-screen).
- **Stream** — OBS: lower thirds, the slides for a presentation scene, scene switching. See
  [Live stream (OBS)](#live-stream-obs).

Offering banners (verse + giving QR code) are in **Banners**.

## Stage screen

**Tools → Stage** (Tools is under More; Stage is the first button at the top of the tab) runs a second screen for the preacher, worship leaders, singers and band — a
*confidence monitor*. The congregation never sees it: nothing on it goes to the projector.

```
┌ ● Stage · Connected ─── 10:42 ──── [ SPEAKER 12:30 ]  [ SERVICE 48:10 ] ─── Talk · ⚙ · ⛶ ┐
│ ▌ Please wrap up                                                     (message from the desk) │
│ NOW  Hymn 73 · Verse 2 · 3/7          │ NEXT  Next slide · Chorus                            │
│ ┌──────────────────────────────┐      │ ┌──────────────────┐                                 │
│ │  the slide, exactly as the   │      │ │   next slide     │                                 │
│ │  hall sees it                │      │ └──────────────────┘                                 │
│ └──────────────────────────────┘      │ ORDER OF SERVICE  Opening hymn ✓ · Scripture ● · …   │
│ speaker notes (slides)                │                                                      │
└ Previous · Next · Show Next · Black · Logo · Clear · Start/Pause timer · +1 · −1 (if allowed) ┘
```

**What it shows**

- **Now** — the slide on the projector (same renderer, so it looks exactly the same), its name and place (Verse 2 · 3/7),
  Black / Logo state, the time left in a playing video, and **speaker notes** of PowerPoint/PDF slides.
- **Next** — the next slide of the item on screen, or the item waiting on the green Next screen ("Then: Hymn 73").
- **Clock and timers** — time of day, the **featured** timer large (green → amber when little time is left → red and
  counting the overtime as +1:23), and the other timers small.
- **Messages from the media desk** — a yellow banner ("5 minutes left", "Louder, please"…), optionally flashing, with a
  soft chime on phones. It stays until cleared or for 10 s – 2 min.
- **Order of service** — the parts of the open plan, who leads them, planned minutes, what is done, on screen and next.

**Layouts:** *Full* (picture, notes, next, plan), *Words* (the words in very large type — for singers and the preacher),
*Slides* (current and next picture side by side), *Timer* (one big count-down and the clock). Options: text size,
show/hide next, plan, notes and picture, 12/24-hour clock, and **mirror** for teleprompter glass.

**Connecting a stage screen — every usual way, plus a link for phones:**

| Way | How |
|---|---|
| **Another monitor on this PC** | Tools → Stage → **Open stage screen** (or the **Stage** button in the top bar). It opens full screen on a screen that is neither this one nor the projector; **Choose screen…** picks one. |
| **Cast** | **Cast stage screen** — Chromecast, Google TV, Android TV (a second cast session, separate from the projector). Miracast TVs: connect them in Windows (Win + K → Extend) and use *Open stage screen*. |
| **Phones, tablets, laptops (internet)** | Turn on **Phones & laptops**. People scan the **QR code**, or open the short address **leemcq.github.io/Church_Service/stage** and type the **room code** (e.g. `K7F Q2M`). No app, no account. |
| **Church network without internet** | With the SDA Sabbath companion running, screens on the church Wi-Fi open `http://<pc>:7777/stage.html?via=lan`. |

How the phone link works: the slides go **directly from the media-desk PC to each phone** over an encrypted WebRTC
connection. Public Nostr relays are only used for the two devices to find each other, and the room code is also the key
that encrypts that handshake, so no server ever sees the slides, messages or who is connected. On the church Wi-Fi
the traffic stays inside the building. Phones connect only to the media desk, never to each other, and pictures are
shrunk to phone size (videos are never sent). A phone that loses the connection, or a media-desk PC that reloads,
reconnects by itself. **New code** disconnects everyone; on networks that block direct connections (rare) a TURN server
can be set under *Connection settings…*.

**Only the real media desk is followed.** The media desk has its own signing key; the QR code (and the OBS addresses)
carry its fingerprint, and a phone or OBS source accepts slides only from the peer that proves that key. Someone who
only has the room code cannot show fake slides or stream overlays. A phone that typed the code by hand trusts the first
media desk that proves a key and remembers it. On the church network each screen sends a private key of its own, so no
screen can act in another's name.

**Control from the stage (optional):** stage screens only follow, until someone enters the **control PIN** shown in the
Tools → Stage (⚙ → *Unlock controls*), or you switch on **Control** for that device in *Connected screens*. Then they get
Previous / Next / Show Next / Black / Logo / Clear and the timer buttons, and the keys → ← Page Up/Down and B work there
too (a presentation clicker plugged into the stage laptop works). Wrong PINs are limited to five tries a minute for
the whole media desk (reloading or rejoining does not reset it). Switching **Control** off for a device sticks even if
it reloads with a saved PIN; **New PIN** takes away control given by PIN (devices you allowed by hand keep it). The stage window on this PC may control by default (a touch screen on the platform).

**Talk back:** every stage screen has **Talk to the media desk** — quick replies ("Ready", "Need 5 more minutes",
"Microphone problem"…) or typed text. It appears as a notice in SDA Sabbath and in Tools → Stage, with *Reply*.

**Timers:** a *Speaker* count-down and a *Service* stopwatch to start with; add count-downs, stopwatches and
"ends at 12:00" clocks (up to 8). Start / Pause, Reset, ±1 minute and 5–45 minute presets. One is **featured** large on
the stage. In the **Plan** tab, ⋯ → **Planned time…** on a part (e.g. Sermon 35 min) starts the featured count-down
when that part goes on screen. Timers keep running when the app is reloaded, and every screen counts on its own, so a
phone that sleeps shows the right time when it wakes.

**Messages:** type and Send (Enter), or click a quick message; *Edit* changes the list. The top-bar Stage button shows
how many stage screens follow, the running timer and a yellow dot while a message is up.

## Live stream (OBS)

**Tools → Stream** (the third button at the top of the Tools tab) feeds OBS Studio. Two Browser Sources follow SDA Sabbath live:

| Source | What it shows |
|---|---|
| **SDA Sabbath · Lower third** (transparent, over the camera) | **Automatically:** the reference and verse when a Bible passage goes on screen; the hymn words (or only the title) when a hymn is on screen; optionally other text slides. **By hand:** a name and title ("Pastor … — Guest speaker", saved names one click away), an announcement, a **scrolling ticker**, the **church logo** in the corner. A name shown by hand goes over the automatic words while it is up. **Show overlays on the stream** off hides everything at once. |
| **SDA Sabbath · Slides** (full screen) | The slides exactly as on the projector, for a "Presentation" scene. **Text over the camera** makes the background see-through, so Bible and hymn text sits over the camera picture. Black, videos, web pages and screen sharing show nothing here (add a Window Capture of the display window for videos). |

**Setting up OBS — two clicks:** in OBS (28 or newer) open **Tools → WebSocket Server Settings**, tick **Enable WebSocket
server**, and copy the password (**Show Connect Info**). In SDA Sabbath → Tools → Stream: **1. Connect to OBS** (nothing in OBS
changes yet), **2.** check the camera scene (the scene with your webcam / capture card is picked automatically) and press
**Set up OBS**. SDA Sabbath adds the lower third on top of your camera scene and creates a **SDA Sabbath · Presentation**
scene with the slides. Press it again any time to repair or update the sources (a size or CSS you set in OBS is kept;
choosing another camera scene moves the lower third). OBS on another computer: open SDA Sabbath from the companion on
that computer (an https page may only reach OBS on the same PC), or set it up by hand.

**OBS on another computer (no WebSocket, any OBS version):** run the companion on the SDA Sabbath PC and open SDA Sabbath from it. In **Tools → Stream → OBS on another computer** press **Copy lower third address**, then in OBS on the other PC add a Browser Source with that address (1920 × 1080). It works over Wi-Fi or cable without internet.

**OBS on another PC through an HDMI cable:** a PC's HDMI port only sends a picture, so the OBS PC needs a USB HDMI capture card. Connect a spare HDMI output of the SDA Sabbath PC to it (Windows: Win+P → Extend), then **Tools → Stream → OBS through an HDMI cable → Show on a screen…** and choose that output. The lower third is shown on green: in OBS add **Video Capture Device** (the card) and a **Chroma Key** filter. The slides can go out the same way (on black) through a second output and card.

**By hand:** Tools → Stream → *Set up OBS by hand* → **Copy address**, then in OBS: Sources → + → **Browser** → paste the URL,
Width 1920, Height 1080. Or drag the **Drag into OBS** button onto the Sources list.

**How OBS follows:** with the SDA Sabbath companion on the church PC, OBS loads the overlays from it
(`http://localhost:7777/obs.html?via=lan&mode=lower`) and needs no internet. Otherwise the sources follow over the internet
with the same room code as the stage screens (turned on automatically), peer to peer and encrypted, like phones do.

**OBS control** (when connected): the scene list (click to put a scene on air — in **Studio Mode** into Preview, and you
press Transition), **Start/Stop streaming** with a pre-flight check (lower third and slides connected, scene on air,
overlays on), **recording**, stream health while live (connection, dropped frames, reconnecting), and a red
**● LIVE 0:42:10 / ● REC** mark in the top bar of SDA Sabbath. Names of the people leading today's plan parts are one
click away under Lower thirds.
**Follow the slides** switches OBS to the Presentation scene for slides, pictures and banners and back to the camera scene
for Bible verses, hymns, black and clear (the lower third then carries the words — if automatic words are off, it
stays on the slides). Videos and screen sharing go to the camera scene, the presentation scene or nowhere (your choice).
It only switches between those two scenes, so a scene you choose yourself in OBS (pre-service loop, closing card) is
never taken off air, and picking a scene in OBS pauses following until the next item. While the presentation scene is on
air, the lower third leaves out the automatic words (the slide already shows them). Renamed scenes are followed.
**Text over the camera** puts the camera scene underneath the slides in the presentation scene.

**Look:** Classic (dark bar), Light or Minimal (text with shadow only), left or centred, four sizes, accent colour (or the
projector's), all inside the broadcast-safe area. The tab has a live preview over a checkerboard (= see-through).

## Banners

Like every other tab, nothing in **Banners** reaches the projector until **Present**: buttons say **Set as Next**.

- **Make** — Welcome, Bible verse, Announcement, Tithe & offering, Countdown, Sabbath sunset, Closing blessing,
  Blank and Picture banners. Banners are drawn live on the display like Bible verses, so the text is sharp, fills
  the screen and fits 4:3 projectors too. The preview updates as you type.
  - **Filled in for you** from **Church details** (Settings → Church): church name, the coming Sabbath’s date,
    the sunset time (“Sabbath begins at sunset: 18:58”, worked out offline from the church’s location), the
    service time for the countdown and a **QR code for online giving** (https links only).
  - **Bible verse banners** take a reference (e.g. `Ps 23:1-3`) and fill in the text from any installed Bible.
  - **Look**: eight colour palettes chosen for readable contrast, patterns, text position, sans or serif, your
    logo, and **your own photos** as backgrounds (darkened automatically so text stays readable).
  - **Countdown** counts down to the service time on the display itself and shows “Welcome” at zero.
- **Saved** — your banners, kept in the app’s database (works offline): Set as Next, Edit, Rename, Duplicate,
  Delete, Add to plan, Add to loop. Banners made with the old Banner tab are moved here automatically.
- **Pre-service loop** — banners and announcement slide decks take turns every 5–30 seconds, with an optional
  “Service starts in 4:32” clock in the corner; when it is time, the loop can switch to your Welcome banner. The
  loop runs **on the display itself**, so it keeps going if the phone or PC that started it goes to sleep.
  Pause / resume from the bottom bar; Next / Previous move by hand.
- **Topics** — key Bible verses for the **28 Fundamental Beliefs** and about 40 sermon topics (prayer, hope, grace,
  health, children, mothers, Christmas, Easter …), shown from the Bible you choose (KJV, WEB, Afrikaans, or an
  imported NIV / Xhosa). Search in English or Afrikaans (“wederkoms”, “gebed”), type a reference, or any words to
  search the Bible. **Set all as Next** puts every verse on slides; **Banner** turns one verse into a banner;
  topics can be added to the service plan.

Service plans can link banners, the pre-service loop and topic verses (Plan → Add media… → Banner).

### Editing a banner on the slide (like Google Slides)

**Banners & Music → Make** is a slide editor. The toolbar above the slide and the **Format options** panel work
like Google Slides:

- **Insert:** text boxes, pictures (upload, paste, or drag a photo onto the slide), 27 shapes (rectangles, ovals,
  stars, arrows, hearts, speech bubbles, ribbons …), lines and arrows, and **fields** that fill themselves in:
  `{date}` (the coming Sabbath), `{sunset}`, `{church}`, `{town}`, `{service}`, `{today}`. Pick a tool and drag on
  the slide to draw, or click for the usual size.
- **Select and move:** click, Shift/Ctrl-click or drag a box around several items. Drag to move (red guides snap to
  the slide's edges and centre and to other items; Alt turns snapping off, Shift keeps a straight line). Eight handles
  resize (Shift keeps proportions), the round handle rotates (Shift: steps of 15°). Arrow keys nudge; Shift+arrow
  nudges further.
- **Text:** double-click to type. Font (22 fonts), size, bold, italic, underline, strikethrough, text colour,
  highlight, alignment, vertical alignment, line and letter spacing, bullets and numbering, indent, clear
  formatting, text shadow and outline, and autofit (grow the box, or shrink the text to fit). Selected words can be
  formatted on their own.
- **Fill and border:** solid colour or gradient, transparent, border colour/weight/dash, rounded corners, drop
  shadow, transparency.
- **Pictures:** replace, fill/fit/stretch, crop (zoom and focus), mask with a shape (circle, star …), flip,
  brightness, contrast, saturation, black & white, blur.
- **Arrange:** bring to front / send to back, align and space evenly, group (Ctrl+G), lock, rotate 90°, flip,
  duplicate (Ctrl+D), cut/copy/paste (also between banners), delete, right-click menu, undo/redo (Ctrl+Z / Ctrl+Y).
- **Animation:** each item can fade, zoom, fly or spin in when the slide appears, with a duration and delay.
- **Slides:** the strip under the slide adds, duplicates, reorders (drag) and deletes slides; each slide has its own
  kind, text, colours and picture. Present a banner and the arrow keys or clicker step through its slides; in the
  Service loop every slide takes its turn.
- **Background:** a colour set, one colour of your own, or a two-colour gradient at any angle, or a picture.

The ready-made banners (Welcome, Bible verse, …) still fill in their text from the fields in the **Slide** panel.
Drag or double-click that text on the slide and it turns into ordinary text boxes you can move and format (the date
and sunset stay live as fields). **Wide** gives the slide more room.

## Banner music

**Banners & Music → Music** keeps a list of background music for the banners and the pre-service loop.

- **When a banner or the pre-service loop goes on screen** the music fades in and plays the list (shuffle, repeat
  all / one / once). **When something else goes on screen** (hymn, Bible, slides, video) it fades out (1–8 s).
  Both rules can be switched off; Play, Pause, Next, Previous, Fade out and Stop are always in the Music view and
  in the bottom bar.
- **Music files** are kept on the device and play offline: MP3, M4A/AAC, WAV, OGG, Opus, FLAC, WebM, the sound of
  MP4/MOV videos, **AIFF** (converted to WAV when added) and **MIDI** (played with the hymn instruments). Formats
  browsers cannot play (WMA, AMR, APE …) are refused with a note to convert them (Audacity or VLC).
- **Online links**: internet radio streams (Icecast/Shoutcast, `.m3u`, `.pls`, HLS `.m3u8`), direct links to music
  files, **YouTube** videos and playlists and **SoundCloud** (these play in a small player in the corner, as
  their terms require). Spotify, Apple Music, Deezer and similar open in their own window: they do not allow other
  apps to play their music. Streams that start with `http://` are blocked by browsers on the https site.
- The music plays from the control PC's speakers (or the sound system connected to it). Only play music your
  church may play in public.

## Online AI (optional)

In **Settings → AI** choose a provider (OpenAI, Google Gemini, xAI Grok, Together AI, OpenRouter or Anthropic
Claude — text only), paste your key and press **Test key**: it shows the models your key can use and lets you
choose a text and a picture model (or leave both on Automatic). If a model is retired, SDA Sabbath picks a
current one by itself and remembers it.

- Banners → Make has **two AI picture makers**:
  1. **Make background** makes a **background picture without text**; the banner words stay sharp on top.
  2. **Make full banner…** makes **one finished picture with all your words in it** (church name, heading,
     message, bottom line, anything else) built around **pictures you attach** (a photo of the church, people, your
     logo). OpenAI (gpt-image) and Google Gemini accept attached pictures; other providers use the words only.
     AI can misspell, so the result is shown for checking and can be remade before you use it. The giving QR
     code is never drawn by AI (the app adds the real one on top).
  Pictures are saved on the device, so they work offline afterwards.
- **Ask AI** in Banners → Topics answers a question in **three slide-sized ways** (a short answer, an answer with
  the Bible’s own words, and key points). You choose one, edit it, optionally add an AI or own picture, and press
  Set as Next. Bible references are checked against the installed Bible and the verse shown is the Bible’s own text.
- **AI summary (online)** in Banners → Topics writes 2–3 short slides into edit boxes. Every Bible reference is
  checked against the installed Bible (✓ with the verse text, or a warning when it does not exist) and words
  worth a second look are pointed out. Nothing is shown until you press Set as Next and then Present.

Keys stay on this device only and are never included in backups. Everything else works without a key or internet.
