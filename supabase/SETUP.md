# Switching on the Church Service cloud (accounts, statistics, feedback, Google Slides)

Church Service works fully without this. Once it is set up, the app gets:

- **Sign-in** on first start (email code, optionally Google) and **Settings → Account**
- **Church statistics** for the maintainer at **admin.html**: churches presenting, services (and how many without
  internet), new churches, setup times, hymn of the week and the most-sung hymns and passages, a map of churches,
  service languages, features, equipment, reliability, searches that found nothing, and churches’ own stories —
  plus a **monthly email** with the main changes (step 7)
- **Comments and suggestions** from the app (speech-bubble button) and from **feedback.html**, with replies
- **Google Slides links** that download as offline slides (and *Update from Google Slides*)

It uses a free [Supabase](https://supabase.com) project. Steps (about 15 minutes):

## 1. Create the project
1. Sign in at supabase.com → **New project**. Name: `church-service`. Region: the closest to your churches
   (e.g. *West EU (Ireland)* or *Central EU (Frankfurt)*; there is no South African region). Keep the database
   password somewhere safe (it is not needed in the app).

## 2. Create the tables and rules
1. **SQL Editor → New query**, paste all of `supabase/schema.sql`, press **Run**. (Safe to run again later.)
2. Make yourself the maintainer — run, with your own email:
   ```sql
   insert into public.admins (email) values ('you@example.com');
   ```

## 3. Sign-in by email code
1. **Authentication → Sign In / Providers → Email**: on (it is on by default). *Confirm email* may stay on.
2. **Authentication → Email Templates → Magic Link**: make the email show the code. Replace the body with:
   ```html
   <h2>Your Church Service sign-in code</h2>
   <p>Type this code in Church Service:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>Or <a href="{{ .ConfirmationURL }}">sign in on this device</a>.</p>
   ```
   Do the same for **Confirm signup** (a new person's first email).
3. **Authentication → URL Configuration**: *Site URL* `https://leemcq.github.io/Church_Service/`, and under
   *Redirect URLs* add `https://leemcq.github.io/Church_Service/**` and `http://localhost:7777/**` (the companion).
4. Email sending: Supabase's built-in email sends only a few emails per hour. Before many churches sign in,
   add your own SMTP (**Project Settings → Authentication → SMTP**), for example a free Resend or Brevo account.

**Google sign-in (optional):** create an OAuth client in Google Cloud (APIs & Services → Credentials → OAuth client
ID, type *Web application*, authorised redirect URI `https://<your-project>.supabase.co/auth/v1/callback`), put its
ID and secret in **Authentication → Providers → Google**, then set `google: true` in `js/core/cloud-config.js`.

## 4. Google Slides download (optional but recommended)
Install the Supabase CLI, then from the repository folder:
```
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy gslides
```
(The function only downloads Google Slides exports of decks shared as "Anyone with the link"; it stores nothing.)

## 5. Connect the app
**Project Settings → API**: copy the *Project URL* and the *anon public* key into `js/core/cloud-config.js`:
```js
export const CLOUD = {
  url: 'https://abcdefghijkl.supabase.co',
  anonKey: 'eyJhbGciOi…',
  google: false,
  requireSignIn: false,
};
```
Commit and push: the website updates in about 5 minutes, and the next companion download includes it too.
The anon key is meant to be public; what anyone may read or write is limited by the rules in `schema.sql`
(statistics and messages can only be read by the emails in `public.admins`).

Signing in stays optional. `requireSignIn: true` asks for a sign-in on first start instead (it never blocks a PC
without internet: it can carry on and sign in later).

Usage statistics are off until each church switches them on (Settings → Account, or the first-start setup).

## Looking at the numbers
Open **https://leemcq.github.io/Church_Service/admin.html** (or Settings → Account → *Statistics and feedback*),
sign in with your maintainer email. Change a message's status (planned, done …) and type a reply: the sender sees
it under *My messages* in the app.

## 6. Update the privacy notice (before you push step 5)
`privacy.html` describes the app as it runs without the cloud. Once the cloud is on, sign-in, statistics and
messages go to your Supabase project, so add this to the table under *What is sent, and to whom*, and change the
*Comments and suggestions* row's “To” to *The Church Service cloud (Supabase)*:

```html
<tr><td>Signing in (account)</td><td>Your email address, to send you a sign-in code; with “Continue with Google”, your Google account’s email and name</td><td>The Church Service cloud (Supabase), and Google if you choose it</td></tr>
<tr><td>Usage statistics (“Help improve Church Service”; only while signed in; switch off in Settings → Account)</td><td>A random number for this device; each day: minutes in use and presenting (and how many without internet), how often each kind of item went on screen, which hymns (number and title) and Bible passages (the reference) were shown, which features were used, searches for a hymn number or reference that found nothing, and errors; the app version, system, browser, screen size and layout, projector connection and sound set-up; the church name, town, conference and union, and its location rounded to about 10 km; the language of the services; when the setup was finished; and which account. Recorded also without internet and sent later. Never slides, pictures, videos, sermons or anything typed.</td><td>The Church Service cloud (Supabase)</td></tr>
<tr><td>Your story (only if you send it)</td><td>How you heard of Church Service, how it changed your services, whether it may be quoted, the church name and town</td><td>The Church Service cloud (Supabase)</td></tr>
```

and this section after the table (fill in the region you chose in step 1):

```html
<h2>The Church Service cloud</h2>
<p>Accounts, usage statistics and messages are kept in a database run for Church Service by Supabase, in REGION. Only the maintainer can see the statistics and messages; a signed-in person can see their own messages and the replies. Statistics are used only to understand how many churches use Church Service, how much, and which parts, so it can be improved.</p>
<p>Statistics are off unless you switch them on, in the first-start setup or Settings → Account, and you can switch them off again at any time. Settings → Account → Delete my account deletes your account, your messages and the statistics of the devices you signed in on.</p>
```

## 7. The monthly statistics email
On the 1st of every month GitHub emails you the month before: the main changes first (churches presenting, services
with and without internet, new churches and churches that went quiet, hymn of the month, setup, reliability,
searches that found nothing, new stories), then the numbers. It uses the same figures as admin.html.

1. **Supabase → Project Settings → API**: copy the **service_role** key. It can read everything: keep it secret,
   never put it in the app or in a file in the repository.
2. **Gmail → Google Account → Security → 2-Step Verification → App passwords**: make an app password for "Mail"
   (16 letters). (Any other email account with SMTP works too; then also add `SMTP_HOST` and `SMTP_PORT`.)
3. **GitHub → the Church_Service repository → Settings → Secrets and variables → Actions → New repository secret**, add:
   - `SUPABASE_SERVICE_KEY` — the service_role key
   - `SMTP_USER` — the Gmail address that sends it (for example your own)
   - `SMTP_PASS` — the app password
   - `REPORT_TO` — optional: who receives it (default `SMTP_USER`; several addresses with commas)
4. Try it: **Actions → Monthly statistics email → Run workflow** (leave the month empty for last month). The email
   arrives within a minute or two; every run also keeps the report as a file under the run's *Artifacts*.

Without these secrets the job runs, says what is missing, and sends nothing (it never fails the repository).
