#!/usr/bin/env python3
"""
Monthly statistics email for the maintainer: the month before in plain words, with the biggest changes first.

Runs on GitHub on the 1st of every month (.github/workflows/monthly-report.yml), or by hand:

  python tools/monthly_report.py                      # last calendar month, emailed
  python tools/monthly_report.py --month 2026-10      # a given month
  python tools/monthly_report.py --dry-run            # write report.html and report.txt, send nothing
  python tools/monthly_report.py --from-json r.json   # render a saved stats_report result (testing)

Settings (GitHub → Settings → Secrets and variables → Actions):
  SUPABASE_SERVICE_KEY  the "service_role" key (Supabase → Project Settings → API). Secret: never in the app.
  SMTP_USER, SMTP_PASS  the account that sends the email, e.g. your Gmail address and a Gmail app password
  SMTP_HOST, SMTP_PORT  optional (default smtp.gmail.com, 465)
  REPORT_TO             optional (default SMTP_USER); several addresses separated by commas
  SUPABASE_URL          optional (default: the url in js/core/cloud-config.js)
Without SUPABASE_SERVICE_KEY or the SMTP settings the job says what is missing and stops without failing.
Only standard Python is used.
"""
import datetime as dt, html, json, os, re, smtplib, ssl, sys, urllib.request
from email.message import EmailMessage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = 'Church Service' if os.path.basename(ROOT).lower().startswith('church') or 'church-service' in open(os.path.join(ROOT, 'js', 'core', 'cloud.js'), encoding='utf-8').read() else 'SDA Sabbath'
SITE = 'https://leemcq.github.io/' + ('Church_Service' if APP == 'Church Service' else 'SDA_Sabbath') + '/'

FEATURE = {'plan_basic': 'Plan – Basic view', 'plan_advanced': 'Plan – Advanced view', 'listen': 'Listen (verse and hymn suggestions)',
           'translate': 'Live translation', 'music': 'Hymn music', 'two_projectors': 'Two projectors', 'stage_screens': 'Stage screens',
           'phones': 'Translation on phones', 'display_window': 'Projector window', 'display_cast': 'Cast', 'display_socket': 'TV through the companion',
           'display_self': 'This screen'}
LANG = {'en': 'English', 'af': 'Afrikaans', 'both': 'English and Afrikaans', 'two': 'Two Bibles', '?': 'not known'}
REFERRAL = {'church': 'another church', 'conference': 'their conference or union', 'pastor': 'a pastor or elder', 'whatsapp': 'WhatsApp',
            'facebook': 'Facebook / social media', 'search': 'an internet search', 'event': 'a camp meeting or event', 'other': 'something else', 'not said': 'not said'}


def cloud_url():
    src = open(os.path.join(ROOT, 'js', 'core', 'cloud-config.js'), encoding='utf-8').read()
    m = re.search(r"url:\s*'([^']*)'", src)
    return (m.group(1) if m else '').rstrip('/')


def month_range(arg=None):
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=2))).date()   # South African time
    if arg:
        y, m = map(int, arg.split('-'))
        first = dt.date(y, m, 1)
    else:
        first = (today.replace(day=1) - dt.timedelta(days=1)).replace(day=1)
    last = (first.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    return first, last


def fetch(first, last, app=None):
    url, key = os.environ.get('SUPABASE_URL') or cloud_url(), os.environ.get('SUPABASE_SERVICE_KEY', '')
    req = urllib.request.Request(url + '/rest/v1/rpc/stats_report', method='POST',
                                 data=json.dumps({'p_from': first.isoformat(), 'p_to': last.isoformat(), 'p_app': app}).encode(),
                                 headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


# ------------------------------------------------------------ the story of the month
def n(v):
    return int(v or 0)


def pct(a, b):
    return round(100 * a / b) if b else 0


def plural(k, one, many=None):
    return '%d %s' % (k, one if k == 1 else (many or one + 's'))


def trend(cur, prev):
    """'up 4 (+19 %)' / 'down 2 (−8 %)' / 'the same' / 'new'."""
    cur, prev = n(cur), n(prev)
    if not prev:
        return 'new this month' if cur else 'none yet'
    d = cur - prev
    if not d:
        return 'the same as the month before'
    return '%s %d (%s%d %%) on the month before' % ('up' if d > 0 else 'down', abs(d), '+' if d > 0 else '−', abs(round(100 * d / prev)))


def highlights(r):
    """The major changes, most important first: (weight, html, text)."""
    c, p = r['totals']['cur'], r['totals']['prev']
    out = []

    def add(weight, text, html_text=None):
        out.append((weight, html_text or html.escape(text), text))

    # Churches and services
    dc = n(c['churches']) - n(p['churches'])
    add(100 + abs(dc), '%s presented with %s — %s.' % (plural(n(c['churches']), 'church', 'churches'), APP, trend(c['churches'], p['churches'])))
    if n(c['services']):
        off, offp = pct(n(c['offline_services']), n(c['services'])), pct(n(p['offline_services']), n(p['services']))
        add(90, '%s were run, %d %% of them without internet (%d %% the month before).' % (plural(n(c['services']), 'service'), off, offp))
    # New and quiet churches
    new = r.get('new_churches') or []
    if new:
        names = ', '.join('%s (%s)' % (x.get('church') or 'a church', x.get('town') or '?') for x in new[:8])
        add(95, 'New this month: %s%s.' % (names, ' and %d more' % (len(new) - 8) if len(new) > 8 else ''))
    pf, pt = r['period']['prev_from'], r['period']['prev_to']
    quiet = [m for m in (r.get('map') or []) if not n(m.get('services')) and m.get('last_service') and pf <= m['last_service'] <= pt]
    if quiet:
        add(85, 'Went quiet (presented the month before, not this month): %s. Worth a friendly call.' % ', '.join('%s (%s)' % (m.get('church') or '?', m.get('town') or '?') for m in quiet[:8]))
    # Hymns and passages
    hy = r.get('hymns') or []
    if hy:
        h0 = hy[0]
        add(70, 'Hymn of the month: %s %s, sung by %s.' % (h0['n'], h0.get('title') or '', plural(n(h0['churches']), 'church', 'churches')))
        climbers = [x for x in hy[:10] if not n(x.get('prev_churches'))]
        if climbers:
            add(40, 'New in the top 10 hymns: %s.' % ', '.join('%s %s' % (x['n'], x.get('title') or '') for x in climbers[:4]))
    w = r.get('hymn_of_week')
    if w:
        add(35, 'Hymn of the last week of the month: %s %s (%s).' % (w['n'], w.get('title') or '', plural(n(w['churches']), 'church', 'churches')))
    tx = r.get('texts') or []
    if tx:
        add(45, 'Most-shown Bible passage: %s (%s).' % (tx[0]['ref'], plural(n(tx[0]['churches']), 'church', 'churches')))
    # Features: the biggest changes in use
    feats = r.get('features') or {}
    moves = []
    for k, v in feats.items():
        cur, prev = n(v.get('minutes')), n(v.get('prev_minutes'))
        if prev and abs(cur - prev) / prev >= 0.3 and abs(cur - prev) >= 60:
            moves.append((abs(cur - prev), '%s %s (%s churches)' % (FEATURE.get(k, k), 'up %d %%' % pct(cur - prev, prev) if cur > prev else 'down %d %%' % pct(prev - cur, prev), n(v.get('churches')))))
        elif not prev and cur >= 60:
            moves.append((cur, '%s started being used (%s churches)' % (FEATURE.get(k, k), n(v.get('churches')))))
    if moves:
        moves.sort(reverse=True)
        add(50, 'Feature use: ' + '; '.join(m[1] for m in moves[:3]) + '.')
    # Setup
    if n(c.get('setup_started')):
        fp = c.get('first_present_min')
        add(55, '%d of %d new devices finished the setup (%d %%)%s.' % (n(c['setup_done']), n(c['setup_started']), pct(n(c['setup_done']), n(c['setup_started'])),
                                                                     ', and the typical time to the first presentation was %d minutes' % round(fp) if fp is not None else ''))
    # Reliability
    rel = r.get('reliability') or {}
    if n(rel.get('not_ready')):
        add(80, '%s not fully stored for offline use: they could fail without internet.' % plural(n(rel['not_ready']), 'device is', 'devices are'))
    if n(rel.get('devices')) and pct(n(rel.get('on_latest')), n(rel['devices'])) < 80:
        add(60, 'Only %d %% of devices run the latest version.' % pct(n(rel.get('on_latest')), n(rel['devices'])))
    eh_cur = n(c.get('errors')) * 100 / max(1, n(c.get('minutes')) / 60)
    eh_prev = n(p.get('errors')) * 100 / max(1, n(p.get('minutes')) / 60)
    if eh_cur > 5 and eh_cur > eh_prev * 1.5:
        add(75, 'Errors rose to %d per 100 hours of use (%d the month before).' % (round(eh_cur), round(eh_prev)))
    # Searches that found nothing
    em = r.get('empty') or []
    if em:
        add(42, 'Searches that found nothing: %s.' % ', '.join('“%s” (%s)' % (x['q'], plural(n(x['churches']), 'church', 'churches')) for x in em[:3]))
    # Stories and referrals
    first, last = r['period']['from'], r['period']['to']
    stories = [s for s in (r.get('stories') or []) if first <= (s.get('created_at') or '')[:10] <= last]
    if stories:
        add(65, '%s told how %s changed their services.' % (plural(len(stories), 'church', 'churches'), APP))
    refs = r.get('referrals_period') or {}
    if refs:
        top = sorted(refs.items(), key=lambda x: -x[1])
        add(30, 'How new churches heard of it: ' + ', '.join('%s %d' % (REFERRAL.get(k, k), v) for k, v in top[:4]) + '.')
    out.sort(key=lambda x: -x[0])
    return out, stories


def render(r):
    c, p = r['totals']['cur'], r['totals']['prev']
    first = dt.date.fromisoformat(r['period']['from'])
    month = first.strftime('%B %Y')
    hl, stories = highlights(r)
    rel = r.get('reliability') or {}
    tiles = [
        (n(c['churches']), 'churches presenting', trend(c['churches'], p['churches'])),
        (n(c['services']), 'services', trend(c['services'], p['services'])),
        ('%d %%' % pct(n(c['offline_services']), n(c['services'])), 'without internet', ''),
        (n(c['new_churches']), 'new churches', ''),
        ('%d %%' % pct(n(rel.get('ready')), n(rel.get('devices'))) if n(rel.get('devices')) else '—', 'ready offline', ''),
        (round(n(c.get('presenting_min')) / 60), 'hours presenting', trend(round(n(c.get('presenting_min')) / 60), round(n(p.get('presenting_min')) / 60))),
    ]
    esc = html.escape
    tile_html = ''.join('<td style="padding:10px 12px;border:1px solid #e3ded2;border-radius:10px;background:#fff;vertical-align:top;width:16%%">'
                        '<div style="font-size:24px;font-weight:800;color:#1f4e79">%s</div><div style="font-size:12px;color:#5a6475">%s</div>'
                        '<div style="font-size:11px;color:#2b7f3e">%s</div></td>' % (esc(str(v)), esc(lbl), esc(t)) for v, lbl, t in tiles)
    hy = r.get('hymns') or []
    hymns = ''.join('<tr><td style="padding:4px 8px">%s</td><td style="padding:4px 8px">%s</td><td style="padding:4px 8px;text-align:right">%s</td></tr>'
                    % (esc(str(x['n'])), esc(x.get('title') or ''), esc(str(x['churches']))) for x in hy[:10])
    quotes = ''.join('<blockquote style="margin:10px 0;padding:4px 0 4px 12px;border-left:3px solid #2b7f3e">%s<br><span style="color:#5a6475;font-size:12px">%s%s%s</span></blockquote>'
                     % (esc(s.get('story') or ''), esc(s.get('church') or 'A church'), ', ' + esc(s['town']) if s.get('town') else '',
                        ' · may be quoted' if s.get('may_quote') else ' · private') for s in stories[:6])
    langs = ', '.join('%s %d' % (LANG.get(k, k), v) for k, v in sorted((r.get('languages') or {}).items(), key=lambda x: -x[1]))
    body = (
        '<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:760px;margin:auto;color:#1d2330;background:#f6f5f1;padding:20px">'
        '<h1 style="font-size:22px;margin:0 0 4px">%s in %s</h1><p style="color:#5a6475;margin:0 0 14px">Compared with %s.</p>'
        '<h2 style="font-size:16px;margin:16px 0 6px">The main changes</h2><ul style="padding-left:20px;margin:0">%s</ul>'
        '<table role="presentation" style="border-collapse:separate;border-spacing:6px;margin:14px -6px;width:100%%"><tr>%s</tr></table>'
        '%s%s%s'
        '<p style="margin-top:20px"><a href="%sadmin.html" style="background:#1f4e79;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">Open the dashboard</a></p>'
        '<p style="color:#5a6475;font-size:12px">Counts from churches that are signed in with statistics switched on. A church counts once, however many devices it uses. '
        'A service is a day with at least 15 minutes presenting; "without internet" when at least half of it was presented offline.</p></div>'
    ) % (esc(APP), esc(month), esc(dt.date.fromisoformat(r['period']['prev_from']).strftime('%B %Y')),
         ''.join('<li style="margin:5px 0">%s</li>' % h for _, h, _ in hl[:10]), tile_html,
         ('<h2 style="font-size:16px;margin:16px 0 6px">Most-sung hymns</h2><table style="border-collapse:collapse;font-size:14px">'
          '<tr style="color:#5a6475"><th style="text-align:left;padding:4px 8px">No.</th><th style="text-align:left;padding:4px 8px">Hymn</th><th style="text-align:right;padding:4px 8px">Churches</th></tr>%s</table>' % hymns) if hymns else '',
         ('<p style="margin-top:14px"><b>Service languages:</b> %s</p>' % esc(langs)) if langs else '',
         ('<h2 style="font-size:16px;margin:16px 0 6px">In their words</h2>%s' % quotes) if quotes else '', SITE)
    text = '%s in %s\n\nThe main changes\n%s\n\nDashboard: %sadmin.html\n' % (APP, month, '\n'.join('- ' + t for _, _, t in hl[:10]), SITE)
    subject = '%s – %s: %s, %s' % (APP, month, plural(n(c['churches']), 'church', 'churches'), plural(n(c['services']), 'service'))
    return subject, body, text


def send(subject, body, text):
    user, pw = os.environ.get('SMTP_USER', ''), os.environ.get('SMTP_PASS', '')
    to = [a.strip() for a in (os.environ.get('REPORT_TO') or user).split(',') if a.strip()]
    msg = EmailMessage()
    msg['Subject'], msg['From'], msg['To'] = subject, '%s statistics <%s>' % (APP, user), ', '.join(to)
    msg.set_content(text)
    msg.add_alternative(body, subtype='html')
    host, port = os.environ.get('SMTP_HOST') or 'smtp.gmail.com', int(os.environ.get('SMTP_PORT') or 465)
    ctx = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=60) as s:
            s.login(user, pw); s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=60) as s:
            s.starttls(context=ctx); s.login(user, pw); s.send_message(msg)
    print('Sent "%s" to %s' % (subject, ', '.join(to)))


def main():
    args = sys.argv[1:]
    month = args[args.index('--month') + 1] if '--month' in args else (os.environ.get('REPORT_MONTH') or None)
    dry = '--dry-run' in args or os.environ.get('DRY_RUN') == 'true'
    if '--from-json' in args:
        r = json.load(open(args[args.index('--from-json') + 1], encoding='utf-8'))
    else:
        if not os.environ.get('SUPABASE_SERVICE_KEY'):
            print('No SUPABASE_SERVICE_KEY secret yet: add it in GitHub → Settings → Secrets and variables → Actions (see supabase/SETUP.md). Nothing sent.')
            return
        first, last = month_range(month)
        r = fetch(first, last, os.environ.get('REPORT_APP') or None)
    subject, body, text = render(r)
    open(os.path.join(ROOT, 'report.html'), 'w', encoding='utf-8').write(body)
    open(os.path.join(ROOT, 'report.txt'), 'w', encoding='utf-8').write(subject + '\n\n' + text)
    print(subject); print(text)
    if dry:
        print('Dry run: report.html written, nothing sent.')
        return
    if not (os.environ.get('SMTP_USER') and os.environ.get('SMTP_PASS')):
        print('No SMTP_USER / SMTP_PASS secrets yet: the report was made (see the run\'s report file) but not emailed.')
        return
    send(subject, body, text)


if __name__ == '__main__':
    main()
