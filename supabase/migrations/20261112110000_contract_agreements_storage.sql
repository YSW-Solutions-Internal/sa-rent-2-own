-- Private bucket for generated contract agreement PDFs (SPEC item 61).
-- Objects are stored as "<contract_id>/agreement.pdf" - one stable path
-- per contract, holding the as-signed PDF generated at contract-creation
-- time; contracts.agreement_file_path points at it. A later
-- preview/regenerate action renders a fresh PDF on demand from current
-- data without touching this stored copy, so it needs no extra storage
-- path of its own.
--
-- file_size_limit/allowed_mime_types are set at creation this time
-- (unlike vehicle-invoices, which had neither until a later audit -
-- 20261106100000_vehicle_invoices_bucket_limits.sql).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-agreements', 'contract-agreements', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- Admin/manager only, matching contracts_manage: contracts are already an
-- admin/manager-only domain, and techs have no business need for signed
-- agreement documents.
create policy contract_agreements_select on storage.objects
  for select to authenticated
  using (bucket_id = 'contract-agreements' and public.is_manager_or_admin());

create policy contract_agreements_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'contract-agreements' and public.is_manager_or_admin());

create policy contract_agreements_update on storage.objects
  for update to authenticated
  using (bucket_id = 'contract-agreements' and public.is_manager_or_admin())
  with check (bucket_id = 'contract-agreements' and public.is_manager_or_admin());

create policy contract_agreements_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'contract-agreements' and public.is_manager_or_admin());
