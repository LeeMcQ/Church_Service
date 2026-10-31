# Church Service — offline church presenter for SDA media teams

Church Service shows Bible passages, hymns, slides, videos, web pages and your PC screen on the projector
(the extended screen) while the operator prepares what comes next on the main screen. It is a
Progressive Web App: install it once and it runs with **no internet**, on old PCs and 1–2 GB phones.

```
┌ Church Service ─ ● Display: Projector ─ [ Go to… John 3:16 / hymn 73 ] ────── [▶ Present  F5 ] ┐
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

## Plan tab: Basic and Advanced

The Plan tab has its own switch (the choice is kept on each device); the rest of the app is the same either way.

- **Basic** (the default) is for the volunteer at the media desk: the order of service with a **Show** button
  on each part (▶ shows a hymn and starts its music), and three big buttons underneath — **Back**, **Next**
  and **Blank**. Tap a part to put it on Next. **Next** steps through the slides, then moves on to the next part
  of the service (a part with nothing to show puts the logo up).
- **Advanced** is the plan editor: add and attach media, change the order, templates, sharing. Each part shows
  a small picture of its first slide.

## Tools → Listen

**Listen for verses & hymns** listens to the service and offers the Bible verses and hymns that are mentioned —
by number (“hymn 100”, “number 73 in our hymnal”) or by name (“let us sing Great Is Thy Faithfulness”) — as
cards under Black / Logo / Clear (on phones above the tabs). While a hymn is on screen it follows the singing
and offers the stanza being sung. Nothing goes on screen by itself. It uses the browser's online speech
service (Chrome or Edge), so it needs the internet while it listens, and it follows the language of your main
Bible (English or Afrikaans).

## What each tab does

| Tab | What you can do |
|---|---|
| **Bible** | Type `John 3:16-18`, `Ps 23`, `Joh 3:16` (Afrikaans) or tap book → chapter → verses. KJV, WEB and the Afrikaans 1933/53 Bible are built in; add NIV, ESV, NKJV, Xhosa or any licensed Bible. Two translations side by side (e.g. English + isiXhosa). Text grows to fill the screen; long passages split into readable slides automatically. “Keep reading” shows the next verses when the preacher carries on. Full-text search. A row of verse numbers above the verses puts any verse one tap away, and the list keeps the live verse in view. |
| **Hymns** | Type the number or words. Title slide, one stanza per slide, chorus repeated automatically, choose which stanzas to sing (1, 2, 4). Tap a stanza to make it Next (also while the hymn is on screen); double-tap, Enter or Present shows it. Jump to any stanza from the control bar. Edit or add hymns; import or export hymnbooks. |
| **Slides** | PDF, PowerPoint (.pptx) and pictures. Converted once on import and kept offline. Speaker notes shown to the operator. Auto-advance loop for announcements. |
| **Video** | VLC-style player: playlist with auto-next and repeat, speed 0.25×–4×, A-B repeat, loop, frame step, fade in/out, volume boost to 200 %, 10-band equaliser with presets, fit/fill/stretch, zoom, rotate, mirror, brightness/contrast/colour/hue, .srt/.vtt subtitles, snapshots. Music can play **in the background** while lyrics stay on screen. |
| **Web & PC** | Two parts in one tab. **Web page:** *Mirror a tab* — the projector shows exactly that browser tab, without the mouse pointer (scroll/zoom it from Church Service in Chrome); *Embed* — YouTube and embeddable sites load directly on the display. **PC screen:** share the whole screen, one window (e.g. PowerPoint or a Bible app) or a tab; see it live inside Church Service. **Freeze** keeps the last picture up while you work privately. The **mini controller** floats on top of other programs. |
| **Plan** | Prepare the order of service at home (one-tap Divine Service, Sabbath School and Vespers templates, or **your own templates**: build a plan once, then ⋯ → Save as template, with or without its hymns and readings, and make it the default for new plans). Type in the Add box — “hymn 73”, “Amazing grace”, “John 3:16-18”, a slide deck, video or banner name — and pick a suggestion, or use **Add media…** (Bible verse ranges and whole chapters, hymns and choruses by number or words, slides, video, banners, web pages; new files can be added right there). Attach or change the media of each part while it keeps its name (“Opening Hymn — Hymn 73”), rename parts, add who leads them, drag parts into order, see progress and what is **On screen**, undo a removal, copy the order as text, export it to Word, **save or share it with its media** (⋯ → Save or share this plan: one `.sdaplan` file with the slides, pictures, banners and videos it uses; Bible passages and hymns go as references; templates can be shared the same way from ⋯ → Templates → Share, and opened on another device with ⋯ → Open a shared plan or template, as a plan or as the default template), and step through it in church with **Next part** (it becomes Next; Present shows it). |
| **Banners & Music** | Welcome, verse, announcement, offering (with giving QR code), countdown and Sabbath-sunset banners drawn live on the display; a self-running pre-service loop; **background music** that starts with the banners and fades out when something else goes on screen; key verses for the 28 Fundamental Beliefs and sermon topics. See [Banners](docs/banners-and-ai.md#banners) and [Banner music](docs/banners-and-ai.md#banner-music). |
| **Tools → Stage** | The **second screen for the people on the platform** (confidence monitor): the slide on screen and what comes next, the words in large type, speaker notes, the time, speaker timers, your messages and the order of service — never shown to the congregation. Open it on another monitor, cast it, or let pastors and singers **follow on their own phones and laptops** with a QR code or a short room code. See [Stage screen](docs/stage-and-obs.md#stage-screen)). |
| **Tools → Listen** | Verse and hymn suggestions from what is said and sung (see above). |
| **Tools → Stream** | **OBS Studio** for the live stream: lower thirds that show the **Bible verse or hymn words automatically** when they go on screen, names and titles, announcements, a scrolling ticker and the church logo; the slides as a full-screen **Presentation** source; **one-click OBS set-up**, automatic scene switching, and start/stop streaming and recording. See [Live stream (OBS)](docs/stage-and-obs.md#live-stream-obs)). |
| **Settings** | Fonts (Atkinson Hyperlegible, serif), colours, background picture, logo, margins, text sizes, fade/cut, 4:3 projectors, light/dark theme, tabs left or right, low-power mode, backups, Bibles, church details, online AI. |

**Live translation** (sermon → captions in another language) is planned; the caption line is already
built into the display.

## Quick start

1. Open **https://leemcq.github.io/Church_Service/** in Chrome or Edge and press **Install** (it then works offline).
2. Connect the projector as an *extended* screen, press **Present** (F5) and choose the projector.
3. Type `John 3:16` or `hymn 73` in **Go to…**, press Enter, then **Present**.

For the church PC, the free **companion** program (download page in the app) adds OBS over the network and
a local web address. Everything is explained in the guides below.

## Guides

| Guide | What is in it |
|---|---|
| [Getting started](docs/getting-started.md) | Install, working offline, projector setup, the companion, casting, phones, several screens, accounts |
| [Keyboard and clicker](docs/keyboard-and-clicker.md) | Shortcuts and presentation clickers |
| [Bibles and hymns](docs/bibles-and-hymns.md) | Bible translations, hymnbooks, shared praise choruses, lyrics search, hymn music |
| [Stage screen and OBS](docs/stage-and-obs.md) | The Tools tab, stage screens, phones and laptops, live streaming with OBS, Stream Deck buttons |
| [Banners and AI](docs/banners-and-ai.md) | Banners, editing on the slide, banner music, the optional online AI |
| [Offline safety](docs/offline-safety.md) | Readiness badge, updates held on the Sabbath, the emergency USB copy, the Friday check and the offline tests |
| [Backup and moving devices](docs/backup.md) | Back up to Google Drive or a file, restore on another PC or phone, switching on Google Drive |
| [Development](docs/development.md) | Weak computers, the code layout, building, testing, deploying |
| [Cloud setup](supabase/SETUP.md) | Switching on accounts, statistics and suggestions (maintainer) |

## Credits and licences

- Bible texts: KJV and WEB (public domain), Afrikaanse Bybel 1933/53 — converted from the Joy in the Journey app
  (`github.com/LeeMcQ/joy-in-the-journey`).
- Sample hymn words: public domain.
- Fonts: Atkinson Hyperlegible Next and Source Serif 4 (SIL Open Font License).
- pdf.js (Apache 2.0), fflate (MIT), qrcode-generator (MIT), SpessaSynth (Apache 2.0), Trystero and noble-secp256k1 (MIT).
- GeneralUser GS 2.0.3 SoundFont by S. Christian Collins — free to use and modify
  (`data/music/GeneralUser-GS-LICENSE.txt`, https://www.schristiancollins.com).
- High-quality and Studio hymn sounds (`data/music/hq.sf3`, `data/music/studio.sf3`, optional downloads): Salamander Grand Piano V3 by Alexander Holm
  (CC BY 3.0) and the GrandOrgue demo pipe organ, recordings by Lars Palo (CC BY-SA 2.5) — `data/music/HQ-SOUNDS-LICENSE.txt`.
- Hymn MIDI files: supplied by the church for its own services.
- Church Service code: MIT.
