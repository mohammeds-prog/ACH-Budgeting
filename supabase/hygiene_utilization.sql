-- ═══════════════════════════════════════════════════════════════════════════
-- Hygiene Utilization — schema, RLS and module access
--
-- Run top to bottom in the Supabase SQL editor. Every statement is guarded
-- (if not exists / drop policy if exists) so it is safe to re-run.
--
-- Two columns are GENERATED rather than stored by the app:
--   day_num          — derived from work_date. A row claiming "Monday" against
--                      a Wednesday date is a data bug waiting to happen, so the
--                      day of week is computed, never typed.
--   utilization_pct  — utilized / available. Computed in one place so the
--                      database, exports and the UI can never disagree.
-- Both use IMMUTABLE expressions (extract/round); to_char is only STABLE and
-- would be rejected here.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Module access flag on profiles ──────────────────────────────────────
alter table public.profiles
  add column if not exists can_view_hygiene boolean not null default false;


-- ── 2. Access helper, matching the existing can_view_* functions ───────────
create or replace function public.can_view_hygiene()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role in ('admin', 'management') or p.can_view_hygiene
       from public.profiles p
      where p.id = auth.uid()),
    false)
$$;


-- ── 3. Table ───────────────────────────────────────────────────────────────
create table if not exists public.hygiene_utilization (
  id          uuid primary key default gen_random_uuid(),

  location    text         not null,
  work_date   date         not null,
  hours       text,                              -- shift window, e.g. "8:00 AM - 5:00 PM"

  available   numeric(8,2) not null default 0,   -- hygiene hours available
  utilized    numeric(8,2) not null default 0,   -- hygiene hours actually used

  notes       text,
  created_at  timestamptz  not null default now(),
  created_by  text,

  -- 1 = Monday … 7 = Sunday (ISO). Derived, so it can never contradict the date.
  day_num smallint generated always as (extract(isodow from work_date)::smallint) stored,

  -- Percentage to one decimal. NULL when available is 0 — division by zero is
  -- "no data", not 0%, and must not be charted as if the clinic ran at 0%.
  utilization_pct numeric(5,1) generated always as (
    case when available > 0 then round((utilized / available) * 100, 1) end
  ) stored,

  constraint hygiene_nonneg check (available >= 0 and utilized >= 0)
);

-- One row per location per day. Prevents the duplicate-entry problem that
-- would silently double a location's available hours in any total.
create unique index if not exists hygiene_location_date_uniq
  on public.hygiene_utilization (location, work_date);

create index if not exists hygiene_work_date_idx on public.hygiene_utilization (work_date desc);
create index if not exists hygiene_location_idx  on public.hygiene_utilization (location);


-- ── 4. Row level security ──────────────────────────────────────────────────
alter table public.hygiene_utilization enable row level security;

drop policy if exists hyg_select on public.hygiene_utilization;
drop policy if exists hyg_insert on public.hygiene_utilization;
drop policy if exists hyg_update on public.hygiene_utilization;
drop policy if exists hyg_delete on public.hygiene_utilization;

-- Read: anyone granted the Hygiene module.
create policy hyg_select on public.hygiene_utilization
  for select to authenticated
  using (can_view_hygiene());

-- Write: module access AND an editing role. Note this is deliberately stricter
-- than the existing ach_entries/zero_payments UPDATE policies, which allow any
-- viewer to edit. This table is new, so nothing breaks by getting it right here.
create policy hyg_insert on public.hygiene_utilization
  for insert to authenticated
  with check (can_view_hygiene() and is_editor());

create policy hyg_update on public.hygiene_utilization
  for update to authenticated
  using (can_view_hygiene() and is_editor())
  with check (can_view_hygiene() and is_editor());

-- Delete stays admin-only, matching ach_entries and zero_payments.
create policy hyg_delete on public.hygiene_utilization
  for delete to authenticated
  using (is_admin());


-- ── 5. Sanity check (optional, read-only) ──────────────────────────────────
-- select column_name, data_type, is_generated
--   from information_schema.columns
--  where table_name = 'hygiene_utilization'
--  order by ordinal_position;
