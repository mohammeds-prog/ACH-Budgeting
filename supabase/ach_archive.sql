-- ═══════════════════════════════════════════════════════════════════════════
-- ACH Archive — read-only reference of past received payments (search only)
--
-- Run top to bottom in the Supabase SQL editor. Every statement is guarded, so
-- it is safe to re-run.
--
-- Deliberately a separate table from ach_entries: no match / status / posting
-- fields, and nothing here can affect the ACH tracker's totals or tabs.
--
-- Access:
--   search          — anyone with ACH access (can_view_ach)
--   upload / delete — admin and management only
--   edit            — nobody; archive rows are never changed after upload
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Fragment search ──────────────────────────────────────────────────────
-- Trigram indexing makes "find 954116767 anywhere in the description" fast at
-- hundreds of thousands of rows. Supabase keeps extensions in `extensions`,
-- which is on the default search_path, so gin_trgm_ops resolves below.
create extension if not exists pg_trgm with schema extensions;


-- ── 2. Who may upload / delete ─────────────────────────────────────────────
create or replace function public.can_manage_archive()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role in ('admin', 'management')
       from public.profiles p
      where p.id = auth.uid()),
    false)
$$;


-- ── 3. Table ───────────────────────────────────────────────────────────────
create table if not exists public.ach_archive (
  id             uuid primary key default gen_random_uuid(),
  posting_date   date          not null,
  details        text,                       -- CREDIT / DEBIT
  bank_account   text,                       -- e.g. 8209, from the Chase filename
  description    text,                       -- full bank description, searched
  insurance_name text,                       -- detected from the description
  amount         numeric(12,2),

  -- Identity of the bank transaction, built by the app on upload: the bank's
  -- TRACE# when present (unique per ACH transaction), otherwise date + amount +
  -- account + description. Re-uploading overlapping months skips rows that are
  -- already here instead of duplicating them.
  dedupe_key     text          not null,

  created_at     timestamptz   not null default now(),
  created_by     text
);

create unique index if not exists ach_archive_dedupe_uniq on public.ach_archive (dedupe_key);
create index if not exists ach_archive_date_idx    on public.ach_archive (posting_date desc);
create index if not exists ach_archive_amount_idx  on public.ach_archive (amount);
create index if not exists ach_archive_account_idx on public.ach_archive (bank_account);
create index if not exists ach_archive_desc_trgm   on public.ach_archive using gin (description gin_trgm_ops);


-- ── 4. Filter lists (distinct values for the dropdowns) ───────────────────
-- security_invoker: the views apply the CALLER's row-level security, so
-- someone without ACH access sees nothing through them either.
create or replace view public.ach_archive_accounts with (security_invoker = true) as
  select distinct bank_account from public.ach_archive where bank_account is not null;

create or replace view public.ach_archive_insurers with (security_invoker = true) as
  select distinct insurance_name from public.ach_archive where insurance_name is not null and insurance_name <> '';


-- ── 5. Row level security ──────────────────────────────────────────────────
alter table public.ach_archive enable row level security;

drop policy if exists archive_select on public.ach_archive;
drop policy if exists archive_insert on public.ach_archive;
drop policy if exists archive_delete on public.ach_archive;

create policy archive_select on public.ach_archive
  for select to authenticated
  using (can_view_ach());

create policy archive_insert on public.ach_archive
  for insert to authenticated
  with check (can_manage_archive());

create policy archive_delete on public.ach_archive
  for delete to authenticated
  using (can_manage_archive());

-- No UPDATE policy on purpose: archived rows are a record, never edited.


-- ── 6. Totals for the header cards ─────────────────────────────────────────
-- Count, dollar total and date span of whatever the user is looking at — the
-- whole archive, or just their current search. Adding up 16,000+ amounts in
-- the browser would mean downloading every row; the database does it in one
-- step. SECURITY INVOKER (the default): the caller's row-level security still
-- applies, so nobody gets totals over rows they couldn't see.
create or replace function public.archive_totals(
  p_terms      text[]  default '{}',
  p_amount_min numeric default null,
  p_amount_max numeric default null,
  p_from       date    default null,
  p_to         date    default null,
  p_insurance  text    default null,
  p_bank       text    default null,
  p_details    text    default null
)
returns table (payments bigint, total numeric, first_date date, last_date date)
language sql
stable
as $$
  select count(*), coalesce(sum(amount), 0), min(posting_date), max(posting_date)
    from public.ach_archive a
   where (cardinality(p_terms) = 0
          or a.description ilike all (select '%' || t || '%' from unnest(p_terms) as t))
     and (p_amount_min is null or a.amount >= p_amount_min)
     and (p_amount_max is null or a.amount <  p_amount_max)
     and (p_from       is null or a.posting_date >= p_from)
     and (p_to         is null or a.posting_date <= p_to)
     and (p_insurance  is null or a.insurance_name = p_insurance)
     and (p_bank       is null or a.bank_account   = p_bank)
     and (p_details    is null or a.details        = p_details)
$$;
