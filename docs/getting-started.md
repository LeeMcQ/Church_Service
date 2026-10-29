# Getting started

### 1. Open the app and install it

The app is published from this repository to **https://leemcq.github.io/Church_Service/** by the
included GitHub Pages workflow (repository **Settings → Pages → Source: GitHub Actions**).

On each church PC or phone, open that address once with internet. Every file (Bibles, hymns, fonts, PDF
engine) downloads in one go, and a card at the bottom shows the progress and then **Saved on this device**. The
same card offers **Install** (Chrome, Edge, Samsung Internet) or says how to install on this browser (iPhone and
iPad: Share → Add to Home Screen; Mac Safari: File → Add to Dock). The installed app has its own Church Service
icon and window and opens with no internet. Firefox on a computer cannot install apps, but the app still works
offline there. "Not now" asks again after a week; Settings → App → Install has the same button or steps.

Needs the internet (everything else works without it): adding Bibles from the online lists, lyrics search, AI,
YouTube and web pages, Google Drive backup, stage screens joined over the internet (on the church network they
work through the companion), and the first download of the optional high-quality instruments.

### Working without internet

Church Service is built to run a whole service with no internet:

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
- Install Church Service (browser menu → Install app) and press **Protect data**, so the browser never clears it to
  free disk space.

### First start

A short setup runs once (Settings → About → Run the setup again): the language of your services and your church
(name, conference, location for sunset times), the screens this PC drives, **Hymn music** — this device (church PC,
laptop or phone), your hall (small, medium, large) and what the music is heard through (sound desk, small
speakers, TV) set the best sound, with *Download now* for the Studio or High-quality instruments and *Play a
test* — and **Ready for Sabbath**: saved for use without internet, install the app, keep the data safe, and a
clicker test.

### 2. Projector setup (PC)

1. Connect the projector as an **extended** display (Windows: Win+P → Extend).
2. Press **Present** once. In Chrome/Edge, allow **Window management** when asked — from then on
   the display opens straight onto the projector.
3. Click the projector screen once so videos may play with sound (not needed once Church Service is installed).
4. The projector **stays full screen**. If it ever drops out (Esc on the projector, a clicker's slide-show
   button, another program), your next key press or click on the control screen, or on the projector, puts it
   straight back. A double click or F on the projector only goes *into* full screen. To allow leaving full
   screen, turn off **Settings → Displays → Keep the projector full screen**.

### 3. The Church Service companion (optional, recommended for the church PC)

One program (about 25 MB — most of it the hymn-music instrument sounds; no installer, no other software) that contains the whole app:

- **Windows:** download `church-service-windows-x64.exe` from the **[companion download page](https://leemcq.github.io/Church_Service/companion.html)** (also linked in the app under Settings and Tools → Stream; it is rebuilt with every website update) and double-click it.
  Church Service opens at `http://localhost:7777`. To add Start-menu and desktop shortcuts in one go:

  ```powershell
  irm https://leemcq.github.io/Church_Service/download/church-service-windows-x64.exe -OutFile $env:TEMP\church-service.exe; & $env:TEMP\church-service.exe --install
  ```
- **Raspberry Pi / Linux / Mac:** `church-service-linux-arm64`, `church-service-linux-x64`, `church-service-macos-arm64` — `chmod +x` and run.

What it adds:

| | |
|---|---|
| **Phone remote** | Phones on the church Wi-Fi open `http://<pc>:7777/remote` (or scan the QR code in Settings → Displays) and enter the PIN. |
| **TV or second PC as the screen** | Open `http://<pc>:7777/display` in the TV's browser. |
| **Videos from the PC** | Files in `Videos\Church Service` (or `Videos\Selah` if the PC already has that folder) appear in the Video tab on every device, and stream with seeking. The list needs the PIN, but the files themselves can be opened by anyone on the same Wi-Fi who knows a file’s name, so keep private files out of that folder. |
| **Exact PowerPoint** | If LibreOffice is installed, .pptx files are converted to PDF so they look exactly as designed. Without it Church Service uses its built-in renderer (text, pictures, shapes, backgrounds). |

**Safe on the church PC:** only the companion's own pages (opened from its address) may use it without the PIN. A website
open in a browser on the same PC cannot control the screen or read the PIN, and requests that use an outside domain name
for this PC are refused (protection against DNS rebinding). Slides that reach a TV or second PC through the companion
(or Cast) are cleaned before they are drawn.

Options: `--port`, `--media <folder>`, `--pin <NNNN>`, `--no-browser`, `--install`. The PIN and folder
are remembered in `%APPDATA%\Church Service\companion.txt` (taken over once from an older
`%APPDATA%\Selah\companion.txt`). It installs into its own folders, so the SDA Sabbath companion on the same PC is left alone. Windows asks once to allow network access — allow
it for private networks.

### Casting to a TV or wireless display

- **Cast (Chromecast, Google TV, Android TV)** in the display menu uses the browser’s own casting. It only finds
  Google Cast devices. Most other TVs and projectors (Samsung, LG, Hisense, “Screen mirroring”) use **Miracast**,
  which a web page cannot reach, so they never appear in that list — on Android too.
- **Windows: Connect to a wireless display…** (display menu) opens the Windows Connect panel (also **Windows + K**,
  or Settings → System → Display → *Connect to a wireless display*). Pick the TV, choose **Extend** (Windows + P),
  and press **Present on the wireless display**: the TV is then a second screen with only the slides on it.
- **Android phones:** use the Church Service companion (the TV’s browser opens the companion address), or **Use this
  device as the screen** and then the phone’s *Smart View / Screen Cast / Screen mirroring*.
- While a display is connected, the **×** beside the display button stops it (Stop casting / Close the display
  window). The display menu also has **Cast to another device…**. Closing or reloading the app stops a cast and
  closes the display window; a cast TV that loses its controller goes black and ends the cast after a few seconds.

### Phones and tablets

Press **Present** and choose:
- **Nothing connected:** Present opens a **small screen in the corner** of the phone. Drag it to any corner; tap it
  for ⤢ (full screen; leaving full screen brings it back to the corner) and ✕ (close).
- **This device** — full screen on the phone itself (HDMI adapter or screen mirroring).
- **Cast** — Chromecast or a wireless display (Chrome on Android).
- **Church Service companion** — use the phone as a remote for the church PC or TV.

### Several screens: two projectors, stage screens

**Settings → Displays → Screens** (also part of the first-start setup) chooses what this PC drives: projector only,
projector + stage screen, two projectors, two projectors + stage screen, projector + two stage screens, or two
projectors + two stage screens. Each output can be put on a chosen screen (Chrome/Edge, after allowing *Window
management*). **Projector 2** shows the same picture as the main projector (a second projector or a TV in the foyer);
its videos play silently and stay in time with the main projector, which has the sound. A second **stage screen** works
like the first (for example one for the preacher and one for the singers). Browsers open one new window per click, so
after Present the Live monitor offers **Open Projector 2 / Open Stage screen** for the rest.

### Account, statistics and suggestions (optional cloud)

With the Church Service cloud switched on (see `supabase/SETUP.md`), the first start offers a sign-in with an email
code (or Google) and runs a short setup: language, church, screens, and whether to send usage statistics (off
unless the church switches them on). **Settings → Account** shows the
account, the statistics switch, *My messages* (with replies) and *Delete my account*. The speech-bubble button at the
top sends a comment or suggestion (it waits on the device when offline); the website has the same form at
`feedback.html`. The maintainer sees installs, active churches, hours used and presenting, feature use, versions,
layouts and all messages at `admin.html`. Without the cloud the app works as before (the setup still runs once; the
suggestion button opens a public GitHub issue, so no email address is asked for). **Google Slides** links (shared as *Anyone with the link*) then download as
offline slides that step with Next, and **⋯ → Update from Google Slides** fetches the latest version.

[← Back to the README](../README.md)
