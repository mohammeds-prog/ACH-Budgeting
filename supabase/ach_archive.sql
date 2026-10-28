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
