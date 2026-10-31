# Offline safety: making sure Church Service never fails in a service

Church Service is built so the service never depends on the internet. This page lists what protects it and
the short check to do before every Sabbath.

## What the app does by itself

| Protection | What it means |
|---|---|
| **Everything stored on install** | Every file (Bibles, hymns, hymn music, fonts, pdf.js) is in `asset-manifest.json` and stored on install. The build stops if a page or script would load anything from the internet. |
| **Updates that cannot half-happen** | An update downloads completely into a new store while the old version keeps working. If even one file fails, the update is thrown away and the working version stays. |
| **No updates during the Sabbath** | Settings → App → Updates: *Hold during the Sabbath* (default). From Friday midday to Saturday night, and whenever something is on screen, an update is never put in place by itself and no pop-up appears. The badge shows **Update ready**; apply it after the service. *Always ask* holds every update. |
| **Readiness badge** | Next to the name at the top: **✔ Ready offline** (green), **Saving… %** (amber), **⚠ N files missing** (red), **Update ready** (blue). On phones it is a coloured dot. Tap it for the self-check panel: check & repair, storage protection, apply update, USB fallback. |
| **Self-repair** | Every 30 minutes with internet, and whenever the internet comes back, missing files are fetched again. |
| **Protected storage** | The app asks the browser not to delete its files when the disk fills (at start, on install, and from the badge panel). |

## Emergency USB copy

Copy `church-service-windows-x64.exe` (Companion page → download) and a recent backup file
(Settings → Backup) to a USB stick. On any PC: double-click the program, Church Service opens at
`http://localhost:7777` with no internet; restore the backup there for plans and slides.
See [companion.html#usb](../companion.html#usb).

## Before every Sabbath (2 minutes, Friday evening, on the church PC)

1. Open Church Service with the internet on. Wait for **✔ Ready offline**.
2. Tap the badge: every line should have a tick (apply any waiting update now, not tomorrow).
3. Switch the internet off (Wi‑Fi off or cable out). Close Church Service completely and open it again.
4. Show a Bible verse, a hymn with music, and the first slide of the plan on the projector.
5. Switch the internet back on (or leave it off for the service).

## Automatic tests (every deploy)

`tests/offline.py` runs on GitHub before the website is updated. It installs the app, checks every file is
stored, then cuts the network and does a cold start, opens every tab and page, shows a verse, a hymn and the
hymn music, and fails on any failed request or script error. It also publishes a deliberately broken update
and checks it is refused while the working version keeps running offline, and checks the Sabbath update hold.
If any check fails, the deploy stops and the website keeps the last version that passed.

    pip install playwright && python -m playwright install chromium
    python tests/offline.py

## Bad networks (stress test, 31 October 2026)

- **Wi-Fi login pages and proxies:** every downloaded file is checked against the fingerprint in the offline file
  list before it is stored. A login page (or any wrong or stale file) is never stored, and one stored by an older
  version is found and replaced by the self-check.
- **Wi-Fi with no internet ("lie-fi"):** no request waits forever. Downloads give up when they do not start
  within 15 s or stall for 20 s; pages fall back to the stored copy after 4 s. The folder address
  (…/Church_Service/) opens straight from the stored copy.
- **First install:** the app itself (pages, scripts, styles, fonts, icons) is downloaded first and must be
  complete before it takes over; Bibles, hymns and music may follow and are fetched by the self-check later.
- **Odd addresses:** …/stage/, …/index.html/ and deeper paths are sent to the right page instead of an unstyled one.
- **Hard reload offline:** Ctrl+Shift+R becomes a normal reload when there is no internet.
- `tests/offline.py` checks all of these on every deploy.

## First visit in two steps (full stress test, 31 October 2026)

- The first visit stores the app, the hymnbooks and the King James Bible (about 7 MB of the 25 MB) before it
  takes over, so a phone on 3G can use it within seconds instead of minutes.
- The rest (the other Bibles, hymn music, the PDF reader, the sound engine and streaming) downloads straight
  after, 12 files at a time, with the church's own Bibles first. The badge shows "Saving… %" until it is done and
  "✔ Ready offline" after. Updates still store every file before they take over.
- With no internet, a file is only taken from another stored version when it has this version's fingerprint:
  a newer version's file is never mixed in, and a Wi-Fi login page stored by mistake is never shown.
