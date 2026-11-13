-- The new admin UI for editing contract T&C wording (SPEC item 61) writes to
-- this table directly, so it needs the same audit trail every other
-- mutable table gets (see 20261029100000_audit_all_writes.sql).
create trigger audit_contract_clause_templates
  after insert or update or delete on public.contract_clause_templates
  for each row execute function public.audit_row_change();
