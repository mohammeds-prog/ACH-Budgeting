-- ═══════════════════════════════════════════════════════════════════
--  Zero Payments gets its own access switch, separate from ACH.
--
--  Before: one flag (profiles.can_view_ach) opened ACH, Zero Payments and
--  the ACH Archive together. After: profiles.can_view_zero_payments opens
--  Zero Payments on its own, so a user can have Zero Payments without ACH
--  (or ACH without Zero Payments).
--
--  Nobody loses access: every user who can see ACH today is given Zero
--  Payments too. Admin and management keep everything, as before.
--
--  Safe to run more than once. Run it in the Supabase SQL editor (ACH
--  project). Depends on the helper functions in policies.sql.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- 1. The flag. Existing ACH users keep Zero Payments.
alter table profiles add column if not exists can_view_zero_payments boolean not null default false;
update profiles set can_view_zero_payments = true
  where coalesce(can_view_ach, false) and not can_view_zero_payments;

-- 2. Who can see Zero Payments.
create or replace function public.can_view_zero_payments()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and (p.role in ('admin','management') or coalesce(p.can_view_zero_payments, false))
  );
$$;
grant execute on function public.can_view_zero_payments() to authenticated;

-- 3. zero_payments: the same rules as before, keyed on the new switch.
drop policy if exists zp_select on zero_payments;
drop policy if exists zp_insert on zero_payments;
drop policy if exists zp_update on zero_payments;
create policy zp_select on zero_payments for select to authenticated
  using (can_view_zero_payments());
create policy zp_insert on zero_payments for insert to authenticated
  with check (can_view_zero_payments() and is_editor());
create policy zp_update on zero_payments for update to authenticated
  using (can_view_zero_payments()) with check (can_view_zero_payments());
-- zp_delete (admin only) is unchanged.

-- 4. zero_payment_attachments (the EOB file list).
drop policy if exists zpa_select on zero_payment_attachments;
drop policy if exists zpa_insert on zero_payment_attachments;
drop policy if exists zpa_delete on zero_payment_attachments;
create policy zpa_select on zero_payment_attachments for select to authenticated
  using (can_view_zero_payments());
create policy zpa_insert on zero_payment_attachments for insert to authenticated
  with check (can_view_zero_payments());
create policy zpa_delete on zero_payment_attachments for delete to authenticated
  using (can_view_zero_payments());

-- 5. The EOB files themselves live in the 'ach-attachments' bucket under
--    zero/{id}/…. These ADD access to that folder only, for Zero Payments
--    users; the bucket's existing rules for ACH files are not touched
--    (Postgres combines policies with OR, so nothing is narrowed).
drop policy if exists zero_files_select on storage.objects;
drop policy if exists zero_files_insert on storage.objects;
drop policy if exists zero_files_delete on storage.objects;
create policy zero_files_select on storage.objects for select to authenticated
  using (bucket_id = 'ach-attachments' and name like 'zero/%' and public.can_view_zero_payments());
create policy zero_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ach-attachments' and name like 'zero/%' and public.can_view_zero_payments());
create policy zero_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ach-attachments' and name like 'zero/%' and public.can_view_zero_payments());

commit;

-- Check afterwards:
--   select email, role, can_view_ach, can_view_zero_payments from profiles order by email;
--   select policyname, cmd, qual from pg_policies where tablename in ('zero_payments','zero_payment_attachments');
--   select policyname, cmd, qual from pg_policies where schemaname = 'storage' and policyname like 'zero_files_%';
--
-- One thing this does NOT change: if the bucket's existing rules let any
-- ACH user read every file in it, an ACH-only user can still open a
-- Zero Payments EOB file if they know its exact path. Run this to see:
--   select policyname, cmd, qual from pg_policies where schemaname = 'storage';
