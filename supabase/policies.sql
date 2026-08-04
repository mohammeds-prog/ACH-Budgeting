-- ═══════════════════════════════════════════════════════════════════
--  Row Level Security — authoritative definition
--  Applied to production 2026-08-03.
--
--  This file is the source of truth for who can read and write what.
--  Re-running it is safe and idempotent.
--
--  Before this existed, every policy was `using (true)`, which allowed
--  anonymous internet users to read, modify and delete all financial
--  data via the public anon key. Do not reintroduce `using (true)`.
--
--  Role model mirrors lib/permissions.js:
--    admin       — full access, only role that can add/import/delete ACH
--    management  — read ACH, edit match; full budget access
--    user        — read ACH, edit match; full budget access
--    viewer      — read only (plus ACH notes/transfer-complete, see below)
--
--  Module visibility is additionally gated per user by the
--  profiles.can_view_ach / profiles.can_view_budgeting flags.
--  admin and management bypass those flags.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── Helper functions ─────────────────────────────────────────────────
-- All are SECURITY DEFINER so they can read `profiles` without tripping
-- that table's own RLS (which would recurse). search_path is pinned to
-- prevent search_path hijacking. Same pattern as the existing
-- get_my_role() function.

create or replace function public.can_view_ach()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and (p.role in ('admin','management') or coalesce(p.can_view_ach, false))
  );
$$;

create or replace function public.can_view_budget()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and (p.role in ('admin','management') or coalesce(p.can_view_budgeting, false))
  );
$$;

-- every role except 'viewer'
create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','management','user')
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

grant execute on function public.can_view_ach(), public.can_view_budget(),
                          public.is_editor(),    public.is_admin()
  to authenticated;


-- ── ach_entries ──────────────────────────────────────────────────────
-- NOTE: UPDATE is deliberately open to any ACH viewer, not just editors.
-- The UI passes onSaveNotes and onTransferComplete unconditionally
-- (app/ach/page.js), so viewers can legitimately edit notes and mark
-- transfers complete today. Tightening this to is_editor() requires
-- gating those two props first, or viewers will hit silent failures.
alter table ach_entries enable row level security;

drop policy if exists ach_select on ach_entries;
drop policy if exists ach_insert on ach_entries;
drop policy if exists ach_update on ach_entries;
drop policy if exists ach_delete on ach_entries;

create policy ach_select on ach_entries for select to authenticated
  using (can_view_ach());
create policy ach_insert on ach_entries for insert to authenticated
  with check (is_admin());
create policy ach_update on ach_entries for update to authenticated
  using (can_view_ach()) with check (can_view_ach());
create policy ach_delete on ach_entries for delete to authenticated
  using (is_admin());


-- ── exp_entries ──────────────────────────────────────────────────────
alter table exp_entries enable row level security;

drop policy if exists exp_select on exp_entries;
drop policy if exists exp_insert on exp_entries;
drop policy if exists exp_update on exp_entries;
drop policy if exists exp_delete on exp_entries;

create policy exp_select on exp_entries for select to authenticated
  using (can_view_budget());
create policy exp_insert on exp_entries for insert to authenticated
  with check (can_view_budget() and is_editor());
create policy exp_update on exp_entries for update to authenticated
  using (can_view_budget() and is_editor()) with check (can_view_budget() and is_editor());
create policy exp_delete on exp_entries for delete to authenticated
  using (can_view_budget() and is_editor());


-- ── exp_collections ──────────────────────────────────────────────────
alter table exp_collections enable row level security;

drop policy if exists coll_select on exp_collections;
drop policy if exists coll_insert on exp_collections;
drop policy if exists coll_update on exp_collections;
drop policy if exists coll_delete on exp_collections;

create policy coll_select on exp_collections for select to authenticated
  using (can_view_budget());
create policy coll_insert on exp_collections for insert to authenticated
  with check (can_view_budget() and is_editor());
create policy coll_update on exp_collections for update to authenticated
  using (can_view_budget() and is_editor()) with check (can_view_budget() and is_editor());
create policy coll_delete on exp_collections for delete to authenticated
  using (can_view_budget() and is_editor());


-- ── exp_vendors ──────────────────────────────────────────────────────
-- Was created without RLS and sat fully exposed until 2026-08-03.
alter table exp_vendors enable row level security;

drop policy if exists vendors_select on exp_vendors;
drop policy if exists vendors_insert on exp_vendors;
drop policy if exists vendors_delete on exp_vendors;

create policy vendors_select on exp_vendors for select to authenticated
  using (can_view_budget());
create policy vendors_insert on exp_vendors for insert to authenticated
  with check (can_view_budget() and is_editor());
create policy vendors_delete on exp_vendors for delete to authenticated
  using (can_view_budget() and is_editor());


-- ── ach_attachments ──────────────────────────────────────────────────
-- Metadata only. The files themselves live in storage.objects and are
-- governed by separate storage policies — see storage.sql.
alter table ach_attachments enable row level security;

drop policy if exists "authenticated full access" on ach_attachments;
drop policy if exists attach_select on ach_attachments;
drop policy if exists attach_insert on ach_attachments;
drop policy if exists attach_delete on ach_attachments;

create policy attach_select on ach_attachments for select to authenticated
  using (can_view_ach());
create policy attach_insert on ach_attachments for insert to authenticated
  with check (can_view_ach());
create policy attach_delete on ach_attachments for delete to authenticated
  using (can_view_ach());


-- ── profiles ─────────────────────────────────────────────────────────
-- Already correct before this migration; recorded here for completeness.
-- Critically, the only write path is `admin write all`, so a non-admin
-- cannot promote themselves. app/api/admin/users/route.js depends on
-- that being true — it reads profiles.role to authorize callers.
--
--   own profile          SELECT  auth.uid() = id
--   admin read all       SELECT  get_my_role() = 'admin'
--   management read all  SELECT  get_my_role() = 'management'
--   admin write all      ALL     get_my_role() = 'admin'


-- ── activity_logs ────────────────────────────────────────────────────
-- Already correct before this migration; recorded here for completeness.
-- Append-only by design: there is no UPDATE or DELETE policy, so the
-- audit trail cannot be altered or scrubbed. Do not add one.
--
--   users can insert own logs  INSERT  auth.uid() = user_id
--   admins can read all logs   SELECT  get_my_role() = 'admin'

commit;


-- ═══════════════════════════════════════════════════════════════════
--  Verification — run after applying.
--
--  1) No policy should show `true`, and every one should be scoped
--     to {authenticated}:
--
--     select tablename, policyname, cmd, roles::text,
--            coalesce(qual,'—'), coalesce(with_check,'—')
--     from pg_policies
--     where schemaname = 'public'
--       and tablename in ('ach_entries','exp_entries','exp_collections',
--                         'exp_vendors','ach_attachments')
--     order by tablename, cmd;
--
--  2) Anonymous reads must return []. From a logged-out browser console:
--
--     fetch(SUPABASE_URL + '/rest/v1/ach_entries?select=*&limit=1',
--       { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY } })
--       .then(r => r.json()).then(console.log)
--
--  3) Anonymous writes must fail with 401 / code 42501.
-- ═══════════════════════════════════════════════════════════════════
