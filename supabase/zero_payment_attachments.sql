-- ═══════════════════════════════════════════════════════════════════
--  EOB file attachments for zero payments.
--
--  Files live in the SAME storage bucket as ACH attachments
--  ('ach-attachments'), so the existing storage.objects policies already
--  cover them and nothing needs to change there. Only the metadata is
--  separate, because it points at a different parent table.
--
--  Paths are namespaced `zero/{id}/…` while ACH stays at `{id}/…`, so the
--  two can never collide. See the KINDS map in lib/storage.js.
--
--  Depends on the helper functions in policies.sql.
-- ═══════════════════════════════════════════════════════════════════

begin;

create table if not exists zero_payment_attachments (
  id              uuid primary key default gen_random_uuid(),
  zero_payment_id uuid not null references zero_payments (id) on delete cascade,
  file_name       text not null,
  file_path       text not null,
  file_size       bigint,
  mime_type       text,
  uploaded_by     text,
  created_at      timestamptz default now()
);

create index if not exists idx_zpa_zero_payment_id
  on zero_payment_attachments (zero_payment_id);

-- ── RLS ──────────────────────────────────────────────────────────────
-- Mirrors ach_attachments: anyone who can see ACH data can read, attach
-- and remove EOB files.
--
-- Note the ON DELETE CASCADE above — deleting a zero payment drops its
-- attachment rows automatically. The files themselves are NOT removed
-- from the bucket by that cascade; they are only cleaned up when a file
-- is deleted through the UI.
alter table zero_payment_attachments enable row level security;

drop policy if exists zpa_select on zero_payment_attachments;
drop policy if exists zpa_insert on zero_payment_attachments;
drop policy if exists zpa_delete on zero_payment_attachments;

create policy zpa_select on zero_payment_attachments for select to authenticated
  using (can_view_ach());
create policy zpa_insert on zero_payment_attachments for insert to authenticated
  with check (can_view_ach());
create policy zpa_delete on zero_payment_attachments for delete to authenticated
  using (can_view_ach());

commit;

-- Verify:
--   select policyname, cmd, roles::text, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'zero_payment_attachments';
