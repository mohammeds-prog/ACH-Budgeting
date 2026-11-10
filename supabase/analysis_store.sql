-- ═══════════════════════════════════════════════════════════════════
--  Analysis data in the database, so the live site (and its chat) can
--  read it. Run in the Supabase SQL editor (ACH project). Safe to run
--  more than once. Touches nothing that exists today.
--
--  What is stored — totals only, never a patient's name, chart number or
--  birth date:
--    analysis_snapshots  one row per uploaded report: the totals the
--                        Analysis pages use (production / collections by
--                        office·provider·month, A/R by office·age·insurer·
--                        status, retention counts, new patients by source,
--                        ad spend, adjustments). ~5 MB per daily upload.
--    storage 'analysis'  one private file, schedule/visit-index.json.gz:
--                        visit dates, office, provider and status per
--                        anonymous patient (a number, not the chart #), so
--                        custom date ranges on the Retention view work.
--
--  Only admin and management can read or upload. The server reads with the
--  service key. Only the 3 latest uploads per report are kept.
-- ═══════════════════════════════════════════════════════════════════

begin;

create or replace function public.is_admin_or_management()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','management'));
$$;
grant execute on function public.is_admin_or_management() to authenticated;

create table if not exists analysis_snapshots (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('production','collections','aging','schedule','adjustments','adSpend','newPatients')),
  as_of        date,                      -- the report's own date, when it has one
  file_name    text,
  data         jsonb not null,            -- the totals, exactly as the pages use them
  index_path   text,                      -- schedule only: the visit-index file in storage
  uploaded_by  uuid default auth.uid(),
  uploaded_at  timestamptz not null default now()
);
create index if not exists analysis_snapshots_kind_time on analysis_snapshots (kind, uploaded_at desc);

alter table analysis_snapshots enable row level security;
drop policy if exists as_select on analysis_snapshots;
drop policy if exists as_insert on analysis_snapshots;
drop policy if exists as_delete on analysis_snapshots;
create policy as_select on analysis_snapshots for select to authenticated using (is_admin_or_management());
create policy as_insert on analysis_snapshots for insert to authenticated with check (is_admin_or_management());
create policy as_delete on analysis_snapshots for delete to authenticated using (is_admin_or_management());
-- No update policy: an upload is never edited, only replaced by a newer one.

-- Keep the 3 newest uploads of each report; older ones are removed.
create or replace function public.analysis_snapshots_trim()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from analysis_snapshots s
  where s.kind = new.kind
    and s.id not in (select id from analysis_snapshots where kind = new.kind order by uploaded_at desc, id desc limit 3);
  return null;
end;
$$;
drop trigger if exists analysis_snapshots_trim on analysis_snapshots;
create trigger analysis_snapshots_trim after insert on analysis_snapshots
  for each row execute function public.analysis_snapshots_trim();

-- The private bucket for the visit index.
insert into storage.buckets (id, name, public)
  values ('analysis', 'analysis', false)
  on conflict (id) do nothing;

drop policy if exists analysis_files_select on storage.objects;
drop policy if exists analysis_files_insert on storage.objects;
drop policy if exists analysis_files_update on storage.objects;
drop policy if exists analysis_files_delete on storage.objects;
create policy analysis_files_select on storage.objects for select to authenticated
  using (bucket_id = 'analysis' and public.is_admin_or_management());
create policy analysis_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'analysis' and public.is_admin_or_management());
create policy analysis_files_update on storage.objects for update to authenticated
  using (bucket_id = 'analysis' and public.is_admin_or_management());
create policy analysis_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'analysis' and public.is_admin_or_management());

commit;

-- Check afterwards:
--   select kind, as_of, file_name, pg_size_pretty(pg_column_size(data)::bigint) as size, uploaded_at
--   from analysis_snapshots order by kind, uploaded_at desc;
