-- ═══════════════════════════════════════════════════════════════════
--  Zero Payments — table + RLS
--  Run this whole file in Supabase → SQL Editor.
--
--  Depends on the helper functions in policies.sql (can_view_ach,
--  is_editor, is_admin). Run policies.sql first if you haven't.
-- ═══════════════════════════════════════════════════════════════════

begin;

create table if not exists zero_payments (
  id             uuid primary key default gen_random_uuid(),
  eob_date       date,
  location       text,
  insurance_name text,
  match          text,          -- 'Yes' | 'No' | 'Partial'
  status         text,          -- matches ACH_STATUSES in lib/constants.js
  initials       text,
  notes          text,
  created_at     timestamptz default now()
);

create index if not exists idx_zero_payments_eob_date on zero_payments (eob_date desc);
create index if not exists idx_zero_payments_location on zero_payments (location);

-- ── RLS ──────────────────────────────────────────────────────────────
-- Deliberately looser on INSERT than ach_entries. ACH rows arrive from the
-- bank feed, so creating one by hand is an admin action. Zero payments have
-- no feed behind them — every row is typed in by whoever worked the EOB — so
-- insert is ordinary reconciliation work and is open to editors
-- (admin/management/user), matching who can add from the UI.
--
-- Delete stays admin-only: it's destructive and there's no undo.
alter table zero_payments enable row level security;

drop policy if exists zp_select on zero_payments;
drop policy if exists zp_insert on zero_payments;
drop policy if exists zp_update on zero_payments;
drop policy if exists zp_delete on zero_payments;

create policy zp_select on zero_payments for select to authenticated
  using (can_view_ach());
create policy zp_insert on zero_payments for insert to authenticated
  with check (can_view_ach() and is_editor());
create policy zp_update on zero_payments for update to authenticated
  using (can_view_ach()) with check (can_view_ach());
create policy zp_delete on zero_payments for delete to authenticated
  using (is_admin());

commit;

-- Verify: every row should be {authenticated} with a function check,
-- and none should show `true`.
--
--   select policyname, cmd, roles::text, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'zero_payments';
