-- Church Service cloud: accounts, install & usage statistics, and feedback.
-- Run once in Supabase → SQL Editor (it is safe to run again after an update).
-- Nothing here stores slides, plans, songs or anything shown on screen: only counts and what people type
-- into the feedback form.

-- ------------------------------------------------------------ tables
create table if not exists public.installs (
  id          uuid primary key,                 -- random id made by each copy of the app (one per browser)
  user_id     uuid references auth.users(id) on delete set null,
  church      text,
  town        text,
  country     text,
  platform    text,                             -- Windows, Android, … (from the browser)
  browser     text,
  app_version text,
  layout      text,                             -- screen layout, e.g. "ps" = projector + stage screen
  lang        text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create table if not exists public.usage_days (
  install_id  uuid not null references public.installs(id) on delete cascade,
  day         date not null,
  minutes     int  not null default 0,          -- minutes the app was in use (open and being used)
  presenting  int  not null default 0,          -- minutes a projector was connected
  items       jsonb not null default '{}'::jsonb, -- how often each kind of item went on screen: {"bible":12,"hymns":5}
  primary key (install_id, day)
);

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  install_id  uuid,
  user_id     uuid references auth.users(id) on delete set null,
  email       text,
  kind        text not null default 'idea' check (kind in ('idea', 'problem', 'praise', 'other')),
  message     text not null check (char_length(message) between 3 and 4000),
  page        text,
  app_version text,
  info        jsonb,
  status      text not null default 'new' check (status in ('new', 'seen', 'planned', 'done', 'wontfix')),
  reply       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Who may see the statistics and answer feedback (the maintainer). Add yourself:
--   insert into public.admins (email) values ('you@example.com');
create table if not exists public.admins (email text primary key);

create index if not exists usage_days_day on public.usage_days (day);
create index if not exists installs_last_seen on public.installs (last_seen);
create index if not exists feedback_created on public.feedback (created_at desc);

-- ------------------------------------------------------------ security: read only what you may, write only through the functions below
alter table public.installs   enable row level security;
alter table public.usage_days enable row level security;
alter table public.feedback   enable row level security;
alter table public.admins     enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

drop policy if exists installs_read on public.installs;
create policy installs_read on public.installs for select using (public.is_admin() or user_id = auth.uid());
drop policy if exists usage_read on public.usage_days;
create policy usage_read on public.usage_days for select using (public.is_admin());
drop policy if exists feedback_read on public.feedback;
create policy feedback_read on public.feedback for select using (public.is_admin() or (auth.uid() is not null and user_id = auth.uid()));
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select using (public.is_admin());

-- Reading goes through the rules above (row level security); writing only through the functions below.
grant select on public.installs, public.usage_days, public.feedback, public.admins to anon, authenticated;
revoke insert, update, delete on public.installs, public.usage_days, public.feedback, public.admins from anon, authenticated;

-- ------------------------------------------------------------ what the app calls
-- The app reports in now and then: who it is (install id, church, version) and the minutes used since last time.
-- (Replaced by version 2 in the "statistics v2" section at the end; kept here so this file still runs top to bottom.)
drop function if exists public.ping(uuid, jsonb, jsonb);
create or replace function public.ping(p_install uuid, p_info jsonb, p_days jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if p_install is null then raise exception 'install id missing'; end if;
  insert into public.installs as i (id, user_id, church, town, country, platform, browser, app_version, layout, lang)
  values (p_install, auth.uid(), left(p_info ->> 'church', 120), left(p_info ->> 'town', 80), left(p_info ->> 'country', 60),
          left(p_info ->> 'platform', 40), left(p_info ->> 'browser', 40), left(p_info ->> 'version', 24), left(p_info ->> 'layout', 12), left(p_info ->> 'lang', 8))
  on conflict (id) do update set
    last_seen = now(),
    user_id = coalesce(auth.uid(), i.user_id),
    church = coalesce(nullif(excluded.church, ''), i.church),
    town = coalesce(nullif(excluded.town, ''), i.town),
    country = coalesce(nullif(excluded.country, ''), i.country),
    platform = coalesce(excluded.platform, i.platform),
    browser = coalesce(excluded.browser, i.browser),
    app_version = coalesce(excluded.app_version, i.app_version),
    layout = coalesce(excluded.layout, i.layout),
    lang = coalesce(excluded.lang, i.lang);

  for d in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) loop
    continue when (d ->> 'day') is null or (d ->> 'day')::date not between current_date - 60 and current_date + 1;
    insert into public.usage_days as u (install_id, day, minutes, presenting, items)
    values (p_install, (d ->> 'day')::date,
            least(greatest(coalesce((d ->> 'minutes')::int, 0), 0), 1440),
            least(greatest(coalesce((d ->> 'presenting')::int, 0), 0), 1440),
            coalesce((select jsonb_object_agg(k, least(greatest(v::int, 0), 10000)) from jsonb_each_text(coalesce(d -> 'items', '{}'::jsonb)) as x(k, v)
                      where k in ('bible', 'hymns', 'slides', 'video', 'ai', 'web', 'plan', 'stream', 'stage') and v ~ '^[0-9]+$'), '{}'::jsonb))
    on conflict (install_id, day) do update set
      minutes = least(u.minutes + excluded.minutes, 1440),
      presenting = least(u.presenting + excluded.presenting, 1440),
      items = (select coalesce(jsonb_object_agg(k, least(coalesce((u.items ->> k)::int, 0) + coalesce((excluded.items ->> k)::int, 0), 1000000)), '{}'::jsonb)
               from (select jsonb_object_keys(u.items || excluded.items) as k) keys);
  end loop;
end $$;

-- A comment or suggestion from the app (or feedback.html).
create or replace function public.send_feedback(p_install uuid, p_kind text, p_message text, p_email text, p_page text, p_version text, p_info jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if char_length(coalesce(btrim(p_message), '')) < 3 or char_length(p_message) > 4000 then raise exception 'The message must be 3 to 4000 characters.'; end if;
  if p_install is not null and (select count(*) from public.feedback f where f.install_id = p_install and f.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many messages today. Please try again tomorrow.';
  end if;
  insert into public.feedback (install_id, user_id, kind, message, email, page, app_version, info)
  values (p_install, auth.uid(), case when p_kind in ('idea', 'problem', 'praise', 'other') then p_kind else 'other' end,
          btrim(p_message), left(nullif(btrim(coalesce(p_email, '')), ''), 200), left(p_page, 60), left(p_version, 24), p_info)
  returning id into new_id;
  return new_id;
end $$;

-- "Delete my account": removes the person's feedback, installs (and their usage) and the account itself.
-- (Version 2 at the end also removes their stories.)
create or replace function public.forget_me()
returns void language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  delete from public.feedback where user_id = me;
  delete from public.installs where user_id = me;
  delete from auth.users where id = me;
end $$;

-- ------------------------------------------------------------ maintainer (admin.html)
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'installs',      (select count(*) from public.installs),
    'signed_in',     (select count(*) from public.installs where user_id is not null),
    'accounts',      (select count(distinct user_id) from public.installs where user_id is not null),
    'active_1',      (select count(*) from public.installs where last_seen > now() - interval '1 day'),
    'active_7',      (select count(*) from public.installs where last_seen > now() - interval '7 days'),
    'active_30',     (select count(*) from public.installs where last_seen > now() - interval '30 days'),
    'new_30',        (select count(*) from public.installs where first_seen > now() - interval '30 days'),
    'minutes_total', (select coalesce(sum(minutes), 0) from public.usage_days),
    'minutes_30',    (select coalesce(sum(minutes), 0) from public.usage_days where day > current_date - 30),
    'presenting_30', (select coalesce(sum(presenting), 0) from public.usage_days where day > current_date - 30),
    'days',          (select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) from (
                        select day, count(*) as installs, sum(minutes) as minutes, sum(presenting) as presenting
                        from public.usage_days where day > current_date - 90 group by day) x),
    'weeks',         (select coalesce(jsonb_agg(x order by x.week), '[]'::jsonb) from (
                        select date_trunc('week', first_seen)::date as week, count(*) as n
                        from public.installs where first_seen > now() - interval '26 weeks' group by 1) x),
    'versions',      (select coalesce(jsonb_object_agg(coalesce(app_version, '?'), n), '{}'::jsonb) from (
                        select app_version, count(*) n from public.installs where last_seen > now() - interval '30 days' group by 1) x),
    'platforms',     (select coalesce(jsonb_object_agg(coalesce(platform, '?'), n), '{}'::jsonb) from (
                        select platform, count(*) n from public.installs where last_seen > now() - interval '30 days' group by 1) x),
    'layouts',       (select coalesce(jsonb_object_agg(coalesce(layout, '?'), n), '{}'::jsonb) from (
                        select layout, count(*) n from public.installs where last_seen > now() - interval '30 days' group by 1) x),
    'features',      (select coalesce(jsonb_object_agg(k, total), '{}'::jsonb) from (
                        select k, sum(v::int) as total from public.usage_days, jsonb_each_text(items) as e(k, v)
                        where day > current_date - 30 group by k) x),
    'churches',      (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                        select i.church, i.town, i.country, i.platform, i.app_version, i.layout, i.first_seen, i.last_seen,
                               i.user_id is not null as signed_in,
                               (select coalesce(sum(u.minutes), 0) from public.usage_days u where u.install_id = i.id) as minutes
                        from public.installs i order by i.last_seen desc limit 500) x),
    'feedback_new',  (select count(*) from public.feedback where status = 'new')
  );
end $$;

create or replace function public.admin_feedback(p_status text default null)
returns setof public.feedback language sql stable security definer set search_path = public as $$
  select * from public.feedback where public.is_admin() and (p_status is null or status = p_status) order by created_at desc limit 500;
$$;

create or replace function public.admin_update_feedback(p_id bigint, p_status text, p_reply text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.feedback set status = coalesce(p_status, status), reply = coalesce(p_reply, reply), updated_at = now() where id = p_id;
end $$;

-- ------------------------------------------------------------ who may call what
revoke all on function public.ping(uuid, jsonb, jsonb) from public;
revoke all on function public.send_feedback(uuid, text, text, text, text, text, jsonb) from public;
revoke all on function public.forget_me() from public;
revoke all on function public.admin_stats() from public;
revoke all on function public.admin_feedback(text) from public;
revoke all on function public.admin_update_feedback(bigint, text, text) from public;
grant execute on function public.ping(uuid, jsonb, jsonb) to anon, authenticated;
grant execute on function public.send_feedback(uuid, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.forget_me() to authenticated;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_feedback(text) to authenticated;
grant execute on function public.admin_update_feedback(bigint, text, text) to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ============================================================ statistics v2 (November 2026)
-- Hymns and Bible passages shown, services with and without internet, features, equipment, the church's
-- approximate place, the language of the services, setup times, and how churches heard of the app and how it
-- changed their services. Safe to run again. Used by admin.html and the monthly report (tools/monthly_report.py).

alter table public.installs add column if not exists app        text;
alter table public.installs add column if not exists conference text;
alter table public.installs add column if not exists union_name text;
alter table public.installs add column if not exists lat        numeric(4,1);   -- rounded to about 10 km
alter table public.installs add column if not exists lon        numeric(4,1);
alter table public.installs add column if not exists svc_lang   text;           -- en, af, both, two
alter table public.installs add column if not exists ready      boolean;        -- everything stored for offline use
alter table public.installs add column if not exists equip      jsonb;          -- equipment (see js/core/stats.js)
alter table public.installs add column if not exists setup      jsonb;          -- first open, setup finished, first presentation (ms)

alter table public.usage_days add column if not exists offline  int   not null default 0;            -- presenting minutes without internet
alter table public.usage_days add column if not exists hymns    jsonb not null default '{}'::jsonb;   -- "book|n|title": times shown
alter table public.usage_days add column if not exists texts    jsonb not null default '{}'::jsonb;   -- "John 3:16–18": times shown
alter table public.usage_days add column if not exists features jsonb not null default '{}'::jsonb;   -- feature: minutes in use
alter table public.usage_days add column if not exists empty    jsonb not null default '{}'::jsonb;   -- searches that found nothing
alter table public.usage_days add column if not exists peak     jsonb not null default '{}'::jsonb;   -- most stage screens / phones at once
alter table public.usage_days add column if not exists errors   int   not null default 0;

create table if not exists public.stories (
  id             bigint generated always as identity primary key,
  install_id     uuid,
  user_id        uuid references auth.users(id) on delete set null,
  app            text,
  church         text,
  town           text,
  referral       text,   -- another church, conference, pastor, whatsapp, facebook, search, event, other
  referral_other text,
  story          text,   -- how the app changed their services
  may_quote      boolean not null default false,
  created_at     timestamptz not null default now()
);
alter table public.stories enable row level security;
drop policy if exists stories_read on public.stories;
create policy stories_read on public.stories for select using (public.is_admin());
grant select on public.stories to authenticated;
revoke insert, update, delete on public.stories from anon, authenticated;
create index if not exists stories_created on public.stories (created_at desc);

-- ------------------------------------------------------------ helpers
-- Safe conversions: a damaged value becomes null or 0 instead of failing the whole report from a device
-- (a report that fails is sent again and again, so one bad day would block that device for good).
create or replace function public._date(t text) returns date language plpgsql immutable as $$
begin return t::date; exception when others then return null; end $$;
create or replace function public._num(t text) returns numeric language sql immutable as $$
  select case when t ~ '^-?[0-9]{1,16}(\.[0-9]+)?$' then t::numeric else 0 end;
$$;
-- A count map from the app, cleaned: at most max_keys keys of at most max_len characters, counts 0..100000.
create or replace function public._counts(j jsonb, max_len int default 80, max_keys int default 200)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select left(regexp_replace(k, '[\u0000-\u001f]', '', 'g'), max_len) as k, least(greatest(v::numeric, 0), 100000)::int as v
    from jsonb_each_text(case when jsonb_typeof(j) = 'object' then j else '{}'::jsonb end) as e(k, v)
    where v ~ '^[0-9]+(\.[0-9]+)?$' and v::numeric > 0 and btrim(k) <> ''
    limit max_keys) x;
$$;
-- Two count maps added together.
create or replace function public._add(a jsonb, b jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, least(coalesce((a ->> k)::int, 0) + coalesce((b ->> k)::int, 0), 10000000)), '{}'::jsonb)
  from (select jsonb_object_keys(coalesce(a, '{}'::jsonb) || coalesce(b, '{}'::jsonb)) as k) keys;
$$;
-- The larger of two values per key (most screens or phones at once).
create or replace function public._max(a jsonb, b jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, greatest(coalesce((a ->> k)::int, 0), coalesce((b ->> k)::int, 0))), '{}'::jsonb)
  from (select jsonb_object_keys(coalesce(a, '{}'::jsonb) || coalesce(b, '{}'::jsonb)) as k) keys;
$$;
-- One church, however many devices it uses: its name and town, or the device when no name is set.
create or replace function public._church_key(p_church text, p_town text, p_id uuid)
returns text language sql immutable as $$
  select coalesce(nullif(lower(btrim(coalesce(p_church, ''))), '') || '|' || lower(btrim(coalesce(p_town, ''))), p_id::text);
$$;
create or replace function public._may_read_stats() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

-- ------------------------------------------------------------ what the app calls (version 2, same name)
-- Answers 2, so the app knows its new counts (hymns, passages, features …) were stored; an older database answers
-- nothing and the app keeps those counts on the device until this has been run.
drop function if exists public.ping(uuid, jsonb, jsonb);
create or replace function public.ping(p_install uuid, p_info jsonb, p_days jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare d jsonb; num numeric;
begin
  if p_install is null then raise exception 'install id missing'; end if;
  insert into public.installs as i (id, user_id, church, town, country, platform, browser, app_version, layout, lang,
                                    app, conference, union_name, lat, lon, svc_lang, ready, equip, setup)
  values (p_install, auth.uid(), left(p_info ->> 'church', 120), left(p_info ->> 'town', 80), left(p_info ->> 'country', 60),
          left(p_info ->> 'platform', 40), left(p_info ->> 'browser', 40), left(p_info ->> 'version', 24), left(p_info ->> 'layout', 12), left(p_info ->> 'lang', 8),
          left(p_info ->> 'app', 24), left(p_info ->> 'conference', 80), left(p_info ->> 'union', 80),
          case when (p_info ->> 'lat') ~ '^-?[0-9]+(\.[0-9]+)?$' and abs((p_info ->> 'lat')::numeric) <= 90 then round((p_info ->> 'lat')::numeric, 1) end,
          case when (p_info ->> 'lon') ~ '^-?[0-9]+(\.[0-9]+)?$' and abs((p_info ->> 'lon')::numeric) <= 180 then round((p_info ->> 'lon')::numeric, 1) end,
          left(p_info ->> 'svc_lang', 8),
          case when jsonb_typeof(p_info -> 'ready') = 'boolean' then (p_info ->> 'ready')::boolean end,
          case when jsonb_typeof(p_info -> 'equip') = 'object' and length((p_info -> 'equip')::text) < 2000 then p_info -> 'equip' end,
          case when jsonb_typeof(p_info -> 'setup') = 'object' and length((p_info -> 'setup')::text) < 500 then p_info -> 'setup' end)
  on conflict (id) do update set
    last_seen = now(),
    user_id = coalesce(auth.uid(), i.user_id),
    church = coalesce(nullif(excluded.church, ''), i.church),
    town = coalesce(nullif(excluded.town, ''), i.town),
    country = coalesce(nullif(excluded.country, ''), i.country),
    platform = coalesce(excluded.platform, i.platform),
    browser = coalesce(excluded.browser, i.browser),
    app_version = coalesce(excluded.app_version, i.app_version),
    layout = coalesce(excluded.layout, i.layout),
    lang = coalesce(excluded.lang, i.lang),
    app = coalesce(excluded.app, i.app),
    conference = coalesce(nullif(excluded.conference, ''), i.conference),
    union_name = coalesce(nullif(excluded.union_name, ''), i.union_name),
    lat = coalesce(excluded.lat, i.lat),
    lon = coalesce(excluded.lon, i.lon),
    svc_lang = coalesce(nullif(excluded.svc_lang, ''), i.svc_lang),
    ready = coalesce(excluded.ready, i.ready),
    equip = coalesce(excluded.equip, i.equip),
    setup = coalesce(excluded.setup, i.setup);

  for d in select * from jsonb_array_elements(case when jsonb_typeof(p_days) = 'array' then p_days else '[]'::jsonb end) loop
    continue when jsonb_typeof(d) <> 'object' or public._date(d ->> 'day') is null or public._date(d ->> 'day') not between current_date - 60 and current_date + 1;
    insert into public.usage_days as u (install_id, day, minutes, presenting, offline, errors, items, hymns, texts, features, empty, peak)
    values (p_install, public._date(d ->> 'day'),
            least(greatest(public._num(d ->> 'minutes'), 0), 1440)::int,
            least(greatest(public._num(d ->> 'presenting'), 0), 1440)::int,
            least(greatest(public._num(d ->> 'offline'), 0), 1440)::int,
            least(greatest(public._num(d ->> 'errors'), 0), 10000)::int,
            coalesce((select jsonb_object_agg(k, v) from jsonb_each(public._counts(d -> 'items', 20, 20)) as x(k, v)
                      where k in ('bible', 'hymns', 'slides', 'video', 'ai', 'web', 'plan', 'stream', 'stage')), '{}'::jsonb),
            public._counts(d -> 'hymns', 90, 200), public._counts(d -> 'texts', 40, 200),
            public._counts(d -> 'features', 30, 40), public._counts(d -> 'empty', 30, 50), public._counts(d -> 'peak', 20, 10))
    on conflict (install_id, day) do update set
      minutes    = least(u.minutes + excluded.minutes, 1440),
      presenting = least(u.presenting + excluded.presenting, 1440),
      offline    = least(u.offline + excluded.offline, 1440),
      errors     = least(u.errors + excluded.errors, 100000),
      items      = public._add(u.items, excluded.items),
      hymns      = public._add(u.hymns, excluded.hymns),
      texts      = public._add(u.texts, excluded.texts),
      features   = public._add(u.features, excluded.features),
      empty      = public._add(u.empty, excluded.empty),
      peak       = public._max(u.peak, excluded.peak);
  end loop;
  return 2;
end $$;
revoke all on function public.ping(uuid, jsonb, jsonb) from public;
grant execute on function public.ping(uuid, jsonb, jsonb) to anon, authenticated;

-- How they heard of the app and how it changed their services (asked once in the app; Settings → Account too).
create or replace function public.send_story(p_install uuid, p_app text, p_church text, p_town text, p_referral text, p_referral_other text, p_story text, p_may_quote boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if char_length(coalesce(p_story, '')) > 3000 or char_length(coalesce(p_referral_other, '')) > 200 then raise exception 'The text is too long.'; end if;
  if coalesce(btrim(p_story), '') = '' and coalesce(btrim(p_referral), '') = '' then raise exception 'Nothing to send.'; end if;
  if p_install is not null and (select count(*) from public.stories s where s.install_id = p_install and s.created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many messages today. Please try again tomorrow.';
  end if;
  insert into public.stories (install_id, user_id, app, church, town, referral, referral_other, story, may_quote)
  values (p_install, auth.uid(), left(p_app, 24), left(btrim(coalesce(p_church, '')), 120), left(btrim(coalesce(p_town, '')), 80),
          case when p_referral in ('church', 'conference', 'pastor', 'whatsapp', 'facebook', 'search', 'event', 'other') then p_referral end,
          nullif(btrim(coalesce(p_referral_other, '')), ''), nullif(btrim(coalesce(p_story, '')), ''), coalesce(p_may_quote, false))
  returning id into new_id;
  return new_id;
end $$;

-- "Delete my account" also removes the person's stories.
create or replace function public.forget_me()
returns void language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  delete from public.feedback where user_id = me;
  delete from public.stories where user_id = me;
  delete from public.installs where user_id = me;
  delete from auth.users where id = me;
end $$;

-- ------------------------------------------------------------ the dashboard and the monthly report
-- Everything for one period (p_from .. p_to, inclusive) and the period before it (the calendar month before
-- when the period is a calendar month, otherwise the same number of days before). p_app: one app, or null for all.
-- A "service" is a church's day with at least 15 minutes presenting; "without internet" when at least half of
-- those minutes were presented offline.
create or replace function public.stats_report(p_from date, p_to date, p_app text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pf date; pt date; res jsonb;
begin
  if not public._may_read_stats() then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'bad period'; end if;
  if extract(day from p_from) = 1 and p_to = (date_trunc('month', p_from) + interval '1 month - 1 day')::date then
    pf := (p_from - interval '1 month')::date; pt := p_from - 1;
  else
    pf := p_from - (p_to - p_from + 1); pt := p_from - 1;
  end if;

  with dev as (
    select i.*, public._church_key(i.church, i.town, i.id) as ck from public.installs i where p_app is null or i.app = p_app
  ), cd as (   -- per church per day
    select dev.ck, u.day, sum(u.presenting) as presenting, sum(u.offline) as offline, sum(u.minutes) as minutes, sum(u.errors) as errors
    from public.usage_days u join dev on dev.id = u.install_id where u.day between pf and p_to group by dev.ck, u.day
  ), svc as (select * from cd where presenting >= 15),
  per as (
    select 'cur' as p, p_from as f, p_to as t union all select 'prev', pf, pt
  ), totals as (
    select per.p,
      (select count(distinct ck) from svc where svc.day between per.f and per.t) as churches,
      (select count(*) from svc where svc.day between per.f and per.t) as services,
      (select count(*) from svc where svc.day between per.f and per.t and svc.offline * 2 >= svc.presenting) as offline_services,
      (select coalesce(sum(presenting), 0) from cd where cd.day between per.f and per.t) as presenting_min,
      (select coalesce(sum(minutes), 0) from cd where cd.day between per.f and per.t) as minutes,
      (select coalesce(sum(errors), 0) from cd where cd.day between per.f and per.t) as errors,
      (select count(distinct u.install_id) from public.usage_days u join dev on dev.id = u.install_id where u.day between per.f and per.t) as devices,
      (select count(*) from (select ck, min(day) as first from svc group by ck) x where x.first between per.f and per.t) as new_churches,
      (select count(*) from dev where (dev.setup ->> 'known') = 'true' and public._num(dev.setup ->> 'first_open') > 1.6e12 and to_timestamp(public._num(dev.setup ->> 'first_open') / 1000)::date between per.f and per.t) as setup_started,
      (select count(*) from dev where (dev.setup ->> 'known') = 'true' and public._num(dev.setup ->> 'first_open') > 1.6e12 and to_timestamp(public._num(dev.setup ->> 'first_open') / 1000)::date between per.f and per.t
                                    and (dev.setup ->> 'setup_done') is not null) as setup_done,
      (select percentile_cont(0.5) within group (order by (public._num(dev.setup ->> 'first_present') - public._num(dev.setup ->> 'first_open')) / 60000.0)
         from dev where (dev.setup ->> 'known') = 'true' and (dev.setup ->> 'first_present') is not null
                    and public._num(dev.setup ->> 'first_open') > 1.6e12 and to_timestamp(public._num(dev.setup ->> 'first_open') / 1000)::date between per.f and per.t) as first_present_min
    from per
  ), hy as (   -- hymns: times shown and how many churches sang each
    select per.p, split_part(e.key, '|', 1) as book, split_part(e.key, '|', 2) as n,
           max(nullif(split_part(e.key, '|', 3), '')) as title, sum(e.value::int) as times, count(distinct dev.ck) as churches
    from per join public.usage_days u on u.day between per.f and per.t join dev on dev.id = u.install_id, jsonb_each_text(u.hymns) e
    where e.value::numeric > 0
    group by 1, 2, 3
  ), tx as (
    select per.p, e.key as ref, sum(e.value::int) as times, count(distinct dev.ck) as churches
    from per join public.usage_days u on u.day between per.f and per.t join dev on dev.id = u.install_id, jsonb_each_text(u.texts) e
    where e.value::numeric > 0
    group by 1, 2
  ), wk as (   -- the hymn of the week: most churches in the last 7 days of the period
    select split_part(e.key, '|', 1) as book, split_part(e.key, '|', 2) as n, max(nullif(split_part(e.key, '|', 3), '')) as title,
           count(distinct dev.ck) as churches, sum(e.value::int) as times
    from public.usage_days u join dev on dev.id = u.install_id, jsonb_each_text(u.hymns) e
    where u.day between p_to - 6 and p_to group by 1, 2 order by churches desc, times desc, 2 limit 1
  ), feat as (
    select per.p, e.key as k, sum(e.value::int) as minutes, count(distinct dev.ck) as churches
    from per join public.usage_days u on u.day between per.f and per.t join dev on dev.id = u.install_id, jsonb_each_text(u.features) e
    where e.value::numeric > 0
    group by 1, 2
  ), kinds as (
    select per.p, e.key as k, sum(e.value::int) as n
    from per join public.usage_days u on u.day between per.f and per.t join dev on dev.id = u.install_id, jsonb_each_text(u.items) e
    group by 1, 2
  ), act as (  -- devices in use in the period, with their church
    select distinct dev.* from dev join public.usage_days u on u.install_id = dev.id where u.day between p_from and p_to
  ), latest as (
    select app_version as v from dev where last_seen > now() - interval '3 days' and app_version is not null group by app_version order by count(*) desc limit 1
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', pf, 'prev_to', pt, 'app', p_app),
    'totals', (select jsonb_object_agg(p, to_jsonb(totals) - 'p') from totals),
    'weeks', (select coalesce(jsonb_agg(x order by x.week), '[]'::jsonb) from (
               select date_trunc('week', u.day)::date as week, count(distinct dev.ck) filter (where true) as churches,
                      count(*) as device_days
               from public.usage_days u join dev on dev.id = u.install_id
               where u.day > p_to - 182 and u.day <= p_to and u.presenting >= 15 group by 1) x),
    'hymns', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
               select c.book, c.n, c.title, c.times, c.churches, coalesce(pv.times, 0) as prev_times, coalesce(pv.churches, 0) as prev_churches
               from hy c left join hy pv on pv.p = 'prev' and pv.book = c.book and pv.n = c.n
               where c.p = 'cur' order by c.churches desc, c.times desc limit 25) x),
    'hymn_of_week', (select to_jsonb(wk) from wk),
    'texts', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
               select c.ref, c.times, c.churches, coalesce(pv.times, 0) as prev_times
               from tx c left join tx pv on pv.p = 'prev' and pv.ref = c.ref
               where c.p = 'cur' order by c.churches desc, c.times desc limit 25) x),
    'features', (select coalesce(jsonb_object_agg(k, jsonb_build_object('minutes', minutes, 'churches', churches,
                   'prev_minutes', coalesce((select f2.minutes from feat f2 where f2.p = 'prev' and f2.k = feat.k), 0))), '{}'::jsonb)
                 from feat where p = 'cur'),
    'kinds', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from kinds where p = 'cur'),
    'languages', (select coalesce(jsonb_object_agg(coalesce(nullif(l, ''), '?'), n), '{}'::jsonb) from (
                   select svc_lang as l, count(distinct ck) as n from act group by 1) x),
    'empty', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
               select e.key as q, sum(e.value::int) as times, count(distinct dev.ck) as churches
               from public.usage_days u join dev on dev.id = u.install_id, jsonb_each_text(u.empty) e
               where u.day between p_from and p_to group by 1 order by 3 desc, 2 desc limit 20) x),
    'reliability', jsonb_build_object(
       'devices', (select count(*) from act),
       'ready', (select count(*) from act where ready is true),
       'not_ready', (select count(*) from act where ready is false),
       'latest_version', (select v from latest),
       'on_latest', (select count(*) from act where app_version = (select v from latest)),
       'errors', (select coalesce(sum(errors), 0) from cd where cd.day between p_from and p_to),
       'hours', (select round(coalesce(sum(minutes), 0) / 60.0, 1) from cd where cd.day between p_from and p_to)),
    'map', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
             select dev.ck, max(dev.church) as church, max(dev.town) as town, max(dev.country) as country, max(dev.conference) as conference,
                    max(dev.union_name) as union_name, round(avg(dev.lat), 1) as lat, round(avg(dev.lon), 1) as lon,
                    (select count(*) from svc where svc.ck = dev.ck and svc.day between p_from and p_to) as services,
                    (select max(day) from svc where svc.ck = dev.ck) as last_service,
                    min(dev.first_seen)::date as first_seen, bool_or(dev.app = 'church-service') as cs
             from dev group by dev.ck) x),
    'equipment', jsonb_build_object(
       'systems',   (select coalesce(jsonb_object_agg(coalesce(k, '?'), n), '{}'::jsonb) from (select platform as k, count(*) n from act group by 1) x),
       'browsers',  (select coalesce(jsonb_object_agg(coalesce(k, '?'), n), '{}'::jsonb) from (select browser as k, count(*) n from act group by 1) x),
       'layouts',   (select coalesce(jsonb_object_agg(coalesce(k, '?'), n), '{}'::jsonb) from (select layout as k, count(*) n from act group by 1) x),
       'display',   (select coalesce(jsonb_object_agg(coalesce(nullif(k, ''), 'none'), n), '{}'::jsonb) from (select equip ->> 'display' as k, count(*) n from act where equip is not null group by 1) x),
       'role',      (select coalesce(jsonb_object_agg(coalesce(nullif(k, ''), '?'), n), '{}'::jsonb) from (select equip ->> 'role' as k, count(*) n from act where equip is not null group by 1) x),
       'speakers',  (select coalesce(jsonb_object_agg(coalesce(nullif(k, ''), '?'), n), '{}'::jsonb) from (select equip ->> 'speakers' as k, count(*) n from act where equip is not null group by 1) x),
       'hall',      (select coalesce(jsonb_object_agg(coalesce(nullif(k, ''), '?'), n), '{}'::jsonb) from (select equip ->> 'hall' as k, count(*) n from act where equip is not null group by 1) x),
       'sound',     (select coalesce(jsonb_object_agg(coalesce(nullif(k, ''), '?'), n), '{}'::jsonb) from (select equip ->> 'sound' as k, count(*) n from act where equip is not null group by 1) x),
       'screens',   (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select (equip ->> 'w') || '×' || (equip ->> 'h') as k, count(*) n from act where equip ? 'w' group by 1 order by 2 desc limit 8) x),
       'memory',    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(nullif(equip ->> 'mem', '0'), '?') || ' GB' as k, count(*) n from act where equip is not null group by 1) x),
       'installed', (select count(*) from act where (equip ->> 'installed') = 'true'),
       'extended',  (select count(*) from act where (equip ->> 'extended') = 'true'),
       'touch',     (select count(*) from act where (equip ->> 'touch') = 'true'),
       'companion', (select count(*) from act where (equip ->> 'companion') = 'true'),
       'with_equip',(select count(*) from act where equip is not null),
       'peak_stage', (select coalesce(max(public._num(u.peak ->> 'stage')), 0) from public.usage_days u join dev on dev.id = u.install_id where u.day between p_from and p_to),
       'peak_phones', (select coalesce(max(public._num(u.peak ->> 'phones')), 0) from public.usage_days u join dev on dev.id = u.install_id where u.day between p_from and p_to)),
    'referrals', (select coalesce(jsonb_object_agg(coalesce(k, 'not said'), n), '{}'::jsonb) from (
                   select referral as k, count(*) n from public.stories s where p_app is null or s.app = p_app group by 1) x),
    'referrals_period', (select coalesce(jsonb_object_agg(coalesce(k, 'not said'), n), '{}'::jsonb) from (
                   select referral as k, count(*) n from public.stories s where (p_app is null or s.app = p_app) and s.created_at::date between p_from and p_to group by 1) x),
    'stories', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                 select id, church, town, referral, referral_other, story, may_quote, created_at from public.stories s
                 where (p_app is null or s.app = p_app) and story is not null order by created_at desc limit 60) x),
    'new_churches', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                 select max(dev.church) as church, max(dev.town) as town, min(svc.day) as first_service
                 from svc join dev on dev.ck = svc.ck group by svc.ck having min(svc.day) between p_from and p_to order by 3) x)
  ) into res;
  return res;
end $$;

revoke all on function public.stats_report(date, date, text) from public;
revoke all on function public.send_story(uuid, text, text, text, text, text, text, boolean) from public;
grant execute on function public.stats_report(date, date, text) to authenticated, service_role;
grant execute on function public.send_story(uuid, text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.forget_me() to authenticated;
