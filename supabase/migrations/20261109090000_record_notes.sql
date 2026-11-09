-- Phase 1 of the activity-log feature (SPEC item 39, merged with the old
-- item 38): a per-record notes timeline, kept separate from the business
-- tables themselves (one table for every object type, not a notes column
-- per table) so it can be shown merged with audit_log into one
-- chronological "Activity" feed later (Phase 3).
--
-- entity_type mirrors audit_log.table_name's values (literal table names
-- like 'vehicles', 'contracts') so the two can be queried/merged by the
-- same (type, id) key.
create table public.record_notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  note text not null,
  -- Nullable like audit_log.changed_by: a note from the app always has a
  -- real admin author, but a note backfilled from a record's old
  -- free-text `notes` field has none — rendered as "(imported)" instead.
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Serves "this record's notes, newest first" directly, the same shape
-- the upgraded audit_log index below is built for.
create index record_notes_entity_idx on public.record_notes (entity_type, entity_id, created_at desc);

alter table public.record_notes enable row level security;

-- Admin only, matching this whole feature's visibility decision (SPEC
-- item 39) and audit_log's own existing admin-only policy. Editing or
-- deleting a note is itself logged, via the audit trigger below.
create policy record_notes_admin_select on public.record_notes
  for select to authenticated
  using (public.is_admin());

create policy record_notes_admin_insert on public.record_notes
  for insert to authenticated
  with check (public.is_admin() and created_by = auth.uid());

create policy record_notes_admin_update on public.record_notes
  for update to authenticated
  using (public.is_admin());

create policy record_notes_admin_delete on public.record_notes
  for delete to authenticated
  using (public.is_admin());

create trigger audit_record_notes
  after insert or update or delete on public.record_notes
  for each row execute function public.audit_row_change();

-- The per-record Activity feed (Phase 3) fetches "this record's history,
-- newest first" — audit_log's existing (table_name, record_id) index
-- doesn't cover the sort, so every fetch re-sorts. The 3-column composite
-- below serves the same (table_name, record_id) lookups via its leftmost
-- prefix, so it replaces rather than supplements the old one.
drop index if exists public.audit_log_table_name_record_id_idx;
create index audit_log_table_name_record_id_created_at_idx
  on public.audit_log (table_name, record_id, created_at desc);
