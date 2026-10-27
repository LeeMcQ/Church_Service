# Stage screen and OBS

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
| **Church network without internet** | With the Church Service companion running, screens on the church Wi-Fi open `http://<pc>:7777/stage.html?via=lan`. |

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
"Microphone problem"…) or typed text. It appears as a notice in Church Service and in Tools → Stage, with *Reply*.

**Timers:** a *Speaker* count-down and a *Service* stopwatch to start with; add count-downs, stopwatches and
"ends at 12:00" clocks (up to 8). Start / Pause, Reset, ±1 minute and 5–45 minute presets. One is **featured** large on
the stage. In the **Plan** tab, ⋯ → **Planned time…** on a part (e.g. Sermon 35 min) starts the featured count-down
when that part goes on screen. Timers keep running when the app is reloaded, and every screen counts on its own, so a
phone that sleeps shows the right time when it wakes.

**Messages:** type and Send (Enter), or click a quick message; *Edit* changes the list. The top-bar Stage button shows
how many stage screens follow, the running timer and a yellow dot while a message is up.

## Live stream (OBS)

**Tools → Stream** (the third button at the top of the Tools tab) feeds OBS Studio. Two Browser Sources follow Church Service live:

| Source | What it shows |
|---|---|
| **Church Service · Lower third** (transparent, over the camera) | **Automatically:** the reference and verse when a Bible passage goes on screen; the hymn words (or only the title) when a hymn is on screen; optionally other text slides. **By hand:** a name and title ("Pastor … — Guest speaker", saved names one click away), an announcement, a **scrolling ticker**, the **church logo** in the corner. A name shown by hand goes over the automatic words while it is up. **Show overlays on the stream** off hides everything at once. |
| **Church Service · Slides** (full screen) | The slides exactly as on the projector, for a "Presentation" scene. **Text over the camera** makes the background see-through, so Bible and hymn text sits over the camera picture. Black, videos, web pages and screen sharing show nothing here (add a Window Capture of the display window for videos). |

**Setting up OBS — two clicks:** in OBS (28 or newer) open **Tools → WebSocket Server Settings**, tick **Enable WebSocket
server**, and copy the password (**Show Connect Info**). In Church Service → Tools → Stream: **1. Connect to OBS** (nothing in OBS
changes yet), **2.** check the camera scene (the scene with your webcam / capture card is picked automatically) and press
**Set up OBS**. Church Service adds the lower third on top of your camera scene and creates a **Church Service · Presentation**
scene with the slides. Press it again any time to repair or update the sources (a size or CSS you set in OBS is kept;
choosing another camera scene moves the lower third). OBS on another computer: open Church Service from the companion on
that computer (an https page may only reach OBS on the same PC), or set it up by hand.

**OBS on another computer (no WebSocket, any OBS version):** run the companion on the Church Service PC and open Church Service from it. In **Tools → Stream → OBS on another computer** press **Copy lower third address**, then in OBS on the other PC add a Browser Source with that address (1920 × 1080). It works over Wi-Fi or cable without internet.

**OBS on another PC through an HDMI cable:** a PC's HDMI port only sends a picture, so the OBS PC needs a USB HDMI capture card. Connect a spare HDMI output of the Church Service PC to it (Windows: Win+P → Extend), then **Tools → Stream → OBS through an HDMI cable → Show on a screen…** and choose that output. The lower third is shown on green: in OBS add **Video Capture Device** (the card) and a **Chroma Key** filter. The slides can go out the same way (on black) through a second output and card.

**By hand:** Tools → Stream → *Set up OBS by hand* → **Copy address**, then in OBS: Sources → + → **Browser** → paste the URL,
Width 1920, Height 1080. Or drag the **Drag into OBS** button onto the Sources list.

**How OBS follows:** with the Church Service companion on the church PC, OBS loads the overlays from it
(`http://localhost:7777/obs.html?via=lan&mode=lower`) and needs no internet. Otherwise the sources follow over the internet
with the same room code as the stage screens (turned on automatically), peer to peer and encrypted, like phones do.

**OBS control** (when connected): the scene list (click to put a scene on air — in **Studio Mode** into Preview, and you
press Transition), **Start/Stop streaming** with a pre-flight check (lower third and slides connected, scene on air,
overlays on), **recording**, stream health while live (connection, dropped frames, reconnecting), and a red
**● LIVE 0:42:10 / ● REC** mark in the top bar of Church Service. Names of the people leading today's plan parts are one
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

## Stream Deck and remote buttons

Like OBS, Church Service can be driven by buttons: an Elgato Stream Deck, Bitfocus Companion (with a Stream Deck,
X-keys or a phone), or any program that opens a web address. It needs the **companion** running on the service PC
and Church Service opened from it at `http://localhost:7777`. **Tools → Stream → Stream Deck and remote buttons**
lists every address with a Copy button and a Test button.

| Address (on the service PC) | What it does |
|---|---|
| `http://localhost:7777/api/control/next` / `prev` | next / previous slide |
| `…/black` / `logo` | black screen / logo, on and off |
| `…/clear`, `…/present` | clear the screen; present what is on Next |
| `…/goto?q=John%203:16`, `…/goto?q=73` | put a verse or hymn on Next |
| `…/show?q=73` | put it on Next and present it |
| `…/plan-next` / `plan-prev` | next / previous part of the plan |
| `…/music-toggle`, `music-fade`, `music-stop` | hymn music |
| `…/go?i=3` | go to slide 3 of what is live |
| `http://localhost:7777/api/status` | JSON: what is live, slide n of m, what is next, black/logo, projector open |

From another computer use the PC's network address and add `?pin=` with the companion's PIN (shown in its window).
Without the PIN only programs on the service PC itself may press buttons; web pages from other sites never can.
**Present** needs the projector already open (a browser only opens windows after a click): press Present once.

**Bitfocus Companion:** add the connection *Generic: HTTP Requests*, then on a button choose the action *GET* and
paste the address. **Elgato Stream Deck app:** install a free web-request plugin from the Marketplace and paste
the address as a GET request.

[← Back to the README](../README.md)
