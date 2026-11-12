-- Masks client personal data in a PREVIEW branch database after prod data is loaded into it
-- (scripts/preview-refresh.sh). Never run against prod. Safe to re-run: each client's fake
-- values come from its position by id, so a second run writes the same values.
-- Staff (profiles, auth.users) are left real so everyone can log in and use the WhatsApp sandbox.
begin;

with numbered as (
  select id, row_number() over (order by id) as n from public.clients
)
update public.clients c set
  cell_number = '+2700' || lpad(numbered.n::text, 7, '0'),
  alt_cell_number = case when c.alt_cell_number is null then null
    else '+2700' || lpad((numbered.n + 5000000)::text, 7, '0') end,
  email = case when c.email is null then null else 'client-' || numbered.n || '@example.invalid' end,
  id_number = case when c.id_number is null then null else '0000000' || lpad(numbered.n::text, 6, '0') end,
  address = case when c.address is null then null else 'MASKED ADDRESS ' || numbered.n end
from numbered
where c.id = numbered.id;

delete from public.client_banking_details;
delete from public.whatsapp_flows;
delete from public.whatsapp_messages;

-- Last: the updates and deletes above write audit rows of their own, and the audit diffs
-- hold the pre-mask values.
delete from public.audit_log where table_name in ('clients', 'client_banking_details');

commit;
