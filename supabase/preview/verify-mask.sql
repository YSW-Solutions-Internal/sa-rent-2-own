-- Fails (raises) if a preview database still holds unmasked client data. Runs last in
-- scripts/preview-refresh.sh so a broken or incomplete mask fails the workflow loudly.
-- When a migration adds a new column holding client personal data, mask it in mask.sql
-- and add a check here.
do $$
declare
  n bigint;
begin
  select count(*) into n from public.clients
  where cell_number !~ '^\+2700\d{7}$'
     or (alt_cell_number is not null and alt_cell_number !~ '^\+2700\d{7}$')
     or (email is not null and email !~ '@example\.invalid$')
     or (id_number is not null and id_number !~ '^0{7}\d{6}$')
     or (address is not null and address !~ '^MASKED ADDRESS');
  if n > 0 then raise exception 'verify-mask: % clients rows still hold unmasked data', n; end if;

  select count(*) into n from public.client_banking_details;
  if n > 0 then raise exception 'verify-mask: client_banking_details has % rows', n; end if;

  select count(*) into n from public.whatsapp_flows;
  if n > 0 then raise exception 'verify-mask: whatsapp_flows has % rows', n; end if;

  select count(*) into n from public.whatsapp_messages;
  if n > 0 then raise exception 'verify-mask: whatsapp_messages has % rows', n; end if;

  select count(*) into n from public.audit_log where table_name in ('clients', 'client_banking_details');
  if n > 0 then raise exception 'verify-mask: audit_log has % client/banking rows', n; end if;
end;
$$;
