-- Run this in your Supabase project → SQL Editor
--
-- ⚠  RLS POLICIES LIVE IN policies.sql — NOT HERE.
--    Apply schema.sql first, then policies.sql. A table created here
--    without running policies.sql is completely unprotected: the anon
--    key is public (it ships in the browser bundle), so anyone on the
--    internet can read and delete its contents.
--
--    Never write `using (true)`. That was the state of this file until
--    2026-08-03 and it left all financial data world-readable.

-- ─────────────────────────────────────────
-- Table: ach_entries
-- ─────────────────────────────────────────
create table if not exists ach_entries (
  id                uuid primary key default gen_random_uuid(),
  posting_date      date,
  details           text,              -- 'CREDIT' | 'DEBIT'
  bank_account      text,
  description       text,
  insurance_name    text,
  amount            numeric(12, 2),
  from_location     text,              -- "received by"
  location          text,              -- "belongs to"
  splits            jsonb,             -- [{location, amount, match, status, initials}]
  match             text,              -- 'Yes' | 'No' | 'Partial'
  status            text,
  initials          text,
  notes             text,
  transfer_complete boolean default false,
  transfer_initials text,
  created_at        timestamptz default now()
);

-- ─────────────────────────────────────────
-- Table: exp_entries
-- ─────────────────────────────────────────
create table if not exists exp_entries (
  id          uuid primary key default gen_random_uuid(),
  date        date,
  person      text,
  description text,
  vendor      text,
  clinic      text,
  amount      numeric(12, 2),
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────
-- Table: exp_collections
-- ─────────────────────────────────────────
-- One row per (month, location). lib/expenditureStorage.js looks rows up
-- by that pair, so the uniqueness constraint must be composite — a plain
-- unique index on month_key alone would allow only one location per month.
create table if not exists exp_collections (
  id         uuid primary key default gen_random_uuid(),
  month_key  text not null,            -- e.g. '2026-05'
  location   text not null,
  amount     numeric(12, 2) not null,
  created_at timestamptz default now(),
  unique (month_key, location)
);

-- ─────────────────────────────────────────
-- Table: exp_vendors
-- ─────────────────────────────────────────
create table if not exists exp_vendors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- Tables managed outside this file
-- ─────────────────────────────────────────
-- profiles, activity_logs and ach_attachments were created directly in
-- the Supabase dashboard and their column definitions are not mirrored
-- here. Their RLS policies ARE captured in policies.sql.
--
-- To bring their definitions under version control, dump them with:
--
--   select table_name, column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name in ('profiles','activity_logs','ach_attachments')
--   order by table_name, ordinal_position;


-- ─────────────────────────────────────────
-- NEXT STEP — REQUIRED
-- ─────────────────────────────────────────
-- Run policies.sql now. Until you do, every table above is readable and
-- deletable by anyone with the public anon key.
