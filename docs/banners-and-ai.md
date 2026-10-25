# Banners and AI

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

[← Back to the README](../README.md)
