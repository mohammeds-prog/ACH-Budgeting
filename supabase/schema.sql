-- Run this in your Supabase project → SQL Editor

-- ─────────────────────────────────────────
-- Table: ach_entries
-- ─────────────────────────────────────────
create table if not exists ach_entries (
  id           uuid primary key default gen_random_uuid(),
  posting_date date,
  details      text,
  description  text,
  amount       numeric(12, 2),
  type         text,
  location     text,
  match        text,
  initials     text,
  created_at   timestamptz default now()
);

alter table ach_entries enable row level security;

create policy "ach_select" on ach_entries for select using (true);
create policy "ach_insert" on ach_entries for insert with check (true);
create policy "ach_update" on ach_entries for update using (true) with check (true);
create policy "ach_delete" on ach_entries for delete using (true);


-- ─────────────────────────────────────────
-- Table: exp_entries
-- ─────────────────────────────────────────
create table if not exists exp_entries (
  id          uuid primary key default gen_random_uuid(),
  date        date,
  person      text,
  description text,
  clinic      text,
  amount      numeric(12, 2),
  created_at  timestamptz default now()
);

alter table exp_entries enable row level security;

create policy "exp_select" on exp_entries for select using (true);
create policy "exp_insert" on exp_entries for insert with check (true);
create policy "exp_update" on exp_entries for update using (true) with check (true);
create policy "exp_delete" on exp_entries for delete using (true);


-- ─────────────────────────────────────────
-- Table: exp_collections
-- ─────────────────────────────────────────
create table if not exists exp_collections (
  id         uuid primary key default gen_random_uuid(),
  month_key  text unique not null,   -- e.g. '2026-05'
  amount     numeric(12, 2) not null,
  created_at timestamptz default now()
);

alter table exp_collections enable row level security;

create policy "coll_select" on exp_collections for select using (true);
create policy "coll_insert" on exp_collections for insert with check (true);
create policy "coll_update" on exp_collections for update using (true) with check (true);
create policy "coll_delete" on exp_collections for delete using (true);
