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
