# Switching on the Church Service cloud (accounts, statistics, feedback, Google Slides)

Church Service works fully without this. Once it is set up, the app gets:

- **Sign-in** on first start (email code, optionally Google) and **Settings → Account**
- **Install and usage statistics** for the maintainer: devices, active churches, hours used and presenting,
  which features are used, versions, screen layouts — at **admin.html**
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
<tr><td>Usage statistics (“Help improve Church Service”, only if you switch it on)</td><td>A random number for this device; how many minutes the app was in use and presenting each day; how often each kind of item (Bible, hymn, slides, video, banner, web page) went on screen; the app version, operating system, browser and screen layout; the church name and town from Settings → Church; and, if you signed in, which account. Never the words, pictures or videos you show.</td><td>The Church Service cloud (Supabase)</td></tr>
```

and this section after the table (fill in the region you chose in step 1):

```html
<h2>The Church Service cloud</h2>
<p>Accounts, usage statistics and messages are kept in a database run for Church Service by Supabase, in REGION. Only the maintainer can see the statistics and messages; a signed-in person can see their own messages and the replies. Statistics are used only to understand how many churches use Church Service, how much, and which parts, so it can be improved.</p>
<p>Statistics are off unless you switch them on, in the first-start setup or Settings → Account, and you can switch them off again at any time. Settings → Account → Delete my account deletes your account, your messages and the statistics of the devices you signed in on.</p>
```
