# Bibles and hymns

## Bibles

Built in (public domain): **KJV**, **WEB**, **Afrikaanse Bybel 1933/53**.
**NIV** (© Biblica) and the **1975 Xhosa Bible** (© Bible Society of South Africa) cannot be shipped
publicly. Each church adds its own licensed copy:

- **On one device:** Settings → Bibles & hymns → **Add a Bible**. Search the list and press **Add**, or choose a
  file (Zefania XML, OSIS XML, CES XML, JSON, CSV). The `xho75.json` file from Joy in the Journey imports directly.
- The list in **Add a Bible** searches three sources together (buttons above the results show each source and its
  count, and filter to one source): bible.helloao.org (Free Use Bible API), getBible, and the multilingual
  [Bible corpus](https://github.com/christos-c/bible-corpus) by Christodoulopoulos and Steedman (about 100
  languages, including the full Xhosa, Shona, Somali, Amharic and Malagasy Bibles and the Zulu, Swahili, Ewe,
  Wolof and Dinka New Testaments). The corpus is where the Xhosa Bible in Joy in the Journey comes from. Its
  catalogue is in `js/core/biblecorpus.js`; each translation keeps its own copyright (the Xhosa text is
  © Bible Society of South Africa). getBible's list is also built in (`js/core/biblegetbible.js`), so it shows
  even when api.getbible.net is slow; bible.helloao.org's list loads live, and a Bible from it downloads in one
  file or, when the site has no single file, chapter by chapter.
- **For your whole installation:** drop the file into `licensed/` and run `python tools/build.py --bibles`
  (see `licensed/README.md`). The folder is git-ignored, so it never becomes public.

## Hymns

Built in (listed in `data/hymns/index.json`): the SDA Hymnal (698), the 1941 Church Hymnal (703), Advent
Lofliedere (Afrikaans, 481), Praise Choruses and Malmesbury Praise. Add or replace hymnbooks with
**Hymns → ⋯ → Import a hymnbook**:

- JSON (Church Service format, formerly "Selah"):
  ```json
  { "id": "sda-en", "name": "SDA Hymnal", "short": "SDAH", "lang": "en",
    "hymns": [ { "n": 73, "t": "Holy, Holy, Holy", "a": "Reginald Heber",
                 "v": [["line 1", "line 2"], ["stanza 2 …"]], "c": ["chorus line 1", "…"] } ] }
  ```
- JSON as in the Afrikaans Liedboek site: `[ { "number": 1, "title": "…", "lyrics": "…" } ]`
  (stanzas separated by an empty line, chorus starting with `Chorus:` / `Koor:` / `Refrain:`).
- Plain text: each hymn starts with `# 73 Holy, Holy, Holy`, stanzas separated by empty lines.

To ship a hymnbook with the app, put the JSON in `data/hymns/` and list it in `data/hymns/index.json`.

### Shared praise choruses (every church gets new songs)

Choruses that churches share and the maintainer approves join **Praise Choruses** in every copy of Church Service,
numbered **CHR 501** and up (marked *Shared*), with their MIDI music when there is one. The app checks for new ones a
few seconds after it starts (at most every 6 hours, and whenever the internet comes back); **Hymns → ⋯ → Check for new
shared choruses** checks at once. They work offline afterwards.

**Sharing a chorus:** add it in Praise Choruses (⋯ → Find lyrics online, or New hymn), pick it, and press **Share with all
churches**. Say whether the words may be shared (public domain, written by your church, or with the writer's permission;
CCLI songs may not be shared), then **Share on GitHub** opens a ready-filled "Share a praise chorus" issue (a free GitHub
account is needed; **Copy the song** sends it another way).

**The chorus robot** (`.github/workflows/chorus.yml`, `tools/chorus_bot.py`) answers on the issue within minutes: it tidies the
words (capitals, spaces, quotes), refuses songs already in Church Service or not cleared for sharing, flags typos and near-duplicates,
compares the words with a public lyrics database (LRCLIB) to catch mistakes (and to warn when it is a published song), and looks
for a MIDI file (a .zip dropped into the issue, or a close title match on BitMidi, flagged for a check). **The maintainer adds the
label `chorus-approved`** and the robot adds the song to `data/hymns/community/choruses.json`, rebuilds the website and closes
the issue. To publish songs that pass every check without waiting, set the repository variable `AUTO_PUBLISH_CHORUSES` to `true`.

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
  introduction or any verse, **Fade** and **Stop**. Volume, sound quality, church echo, reverb and chorus are in
  **Hymns → ⚙ Hymn options**.
- **Phone as remote:** when a phone controls the church PC through the companion, the music plays on the PC (the
  display window). Open the display on the PC from `http://localhost:7777` — browsers only allow the synthesizer on
  `https://` or `localhost`. Click the projector window once at the start so it may play sound.
- 33 hymns (mostly the short responses 660–695) are through-composed, so they always play as recorded; 25 hymns have
  fewer verses of music than stanzas, so the verse music is repeated. Hymns 696–698 have no MIDI yet.

#### Sound quality (Hymns → ⚙ Hymn options → Music)

- **Instruments → High quality:** a recorded concert grand piano (Salamander Grand Piano, Yamaha C5) and a recorded
  church pipe organ (Montre 8', Prestant 4', Bourdon 8' from the GrandOrgue demo organ) replace the standard piano and
  organ. The hymnal's own arrangements, which use an electric piano, play on the grand piano too. It is an 18 MB
  download the first time (then offline, kept across app updates). **Automatic** switches it on for PCs and laptops
  and leaves phones on the standard 4 MB sounds; when a phone is the remote, the church PC decides.
- **Instruments → Studio** (for the church PC): all 16 recorded loudness layers of the grand piano, so every change
  in touch is a different recording, a longer natural ring, finer audio, and a fuller organ (adds Flûte harmonique
  8' and Octavin 2'). A larger one-time download (`data/music/studio.sf3`), then offline. Devices with little
  memory use High quality instead. The **Best** preset and the setup's "The church PC" choose it.
- **Church echo:** the sound of a church (small room, church or large church) instead of the synthesizer's reverb.
- **Sound preset:** Best (church PC), Balanced, Light (phone, old PC), Large church with organ, or Small room and clear.
  Each sets the instruments, church echo, quality and equaliser together; changing any of them makes it Custom.
- **Equaliser:** five bands (bass, low, middle, presence, treble, ±12 dB) with presets: Flat, Warm, Clear words,
  Small speakers, Big hall, Bass boost and Organ.
- **Sound quality** (Best or Lighter sample interpolation) and **Notes at once** (96–350): lower them on old PCs
  and phones that crackle.
  It is calculated in the app, so it costs no download.
- **Natural playing:** the melody (top note of each chord) sings out, the inner parts sit back and every note varies a
  little, instead of every note being struck equally hard. The timing is not changed, so the words stay in step.

To rebuild the sound pack: `node tools/build_hq_soundfont.mjs <SalamanderGrandPiano clone> <GrandOrgue demo folder>`
(details at the top of the script).

To rebuild after changing the MIDI files (put the numbered `.mid` files in `sources/hymn-midi/`):

```
pip install mido; npm i spessasynth_core                # once
python tools/build_hymn_music.py sources/hymn-midi     # verse/intro analysis → data/music/index.json + MIDI pack
node tools/build_hymn_soundfont.mjs path/to/GeneralUser-GS.sf2 sources/hymn-midi   # → data/music/hymnal.sf2
node tools/compress_soundfont.mjs data/music/hymnal.sf2 data/music/hymnal.sf3   # → the 4 MB file the app uses
python tools/build.py
```

[← Back to the README](../README.md)
