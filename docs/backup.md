# Backup and moving to another device

**Settings → Backup** keeps a copy of everything a church has set up in SDA Sabbath, and restores it on another
PC, laptop or phone:

- always: settings, plans and templates, hymnbooks (yours and edited ones), Bibles you added, banners and their
  pictures, banner music;
- if ticked: **slides** (PDF, PowerPoint, pictures) and **videos and audio** (can be large).

Screen settings stay with each device (a laptop's projector set-up is not copied to a phone), and an AI key is
never put in a backup. Restoring replaces items with the same name and keeps everything else on the device.

There are two ways:

| | How | Needs |
|---|---|---|
| **Google Drive** | *Back up to Google Drive*, then on the other device *Restore from Google Drive* | A Google account, and the client id below (once, by the maintainer) |
| **Backup file** | *Save a backup file* (`.sdabackup`), copy it any way (USB stick, OneDrive, WhatsApp), *Restore from a file* | Nothing |

The first-start setup also offers *Moving from another device? Restore a backup*.

The backups go into a folder **SDA Sabbath backup** in the person's own Google Drive. SDA Sabbath asks only for
Google's `drive.file` permission: it sees the files it created itself and nothing else in the Drive. Videos make a
backup big; a backup must stay under 4 GB.

## Switching on Google Drive (maintainer, about 10 minutes)

1. Open **https://console.cloud.google.com**, sign in, and create a project (e.g. *SDA Sabbath*).
2. **APIs & Services → Library**: search **Google Drive API** and press **Enable**.
3. **Google Auth Platform** (OAuth consent screen): press **Get started**. App name *SDA Sabbath*, your support
   email, audience **External**, your contact email. Then:
   - **Data access → Add or remove scopes**: tick `.../auth/drive.file` ("See, edit, create and delete only the
     specific Google Drive files you use with this app"). Save.
   - **Audience**: while it says *Testing*, only the Google accounts added under **Test users** can sign in (up to
     100; add the churches' emails). Press **Publish app** to let everyone in: `drive.file` needs no Google
     review, but Google may ask you to verify the website domain (Search Console) for the app name and logo.
4. **Clients → Create client**, type **Web application**, name *SDA Sabbath web*:
   - Authorised JavaScript origins: `https://leemcq.github.io` and `http://localhost:7777`
   - Authorised redirect URIs: `https://leemcq.github.io/Church_Service/oauth.html` and
     `http://localhost:7777/oauth.html`
   - Press **Create** and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). It is not a secret.
5. Paste it into `js/core/cloud-config.js`:
   ```js
   googleClientId: '1234567890-abc….apps.googleusercontent.com',
   ```
   Commit and push: the website updates in about 5 minutes.

Until the client id is filled in, the Google Drive buttons say that Drive backup is not switched on; backup files
work anyway. Google Drive backup does not need the Supabase cloud (accounts and statistics).

[← Back to the README](../README.md)
