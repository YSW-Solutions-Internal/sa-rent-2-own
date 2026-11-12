-- Realistic-looking client data for the mask-test CI job: verify-mask.sql must reject this
-- before mask.sql runs, and accept it after.
insert into public.clients (id, full_name, id_number, cell_number, alt_cell_number, email, address) values
  ('00000000-0000-0000-0000-000000000001', 'JANE DOE', '8001015009087', '+27821234567', '+27831234567',
   'jane@gmail.com', '12 MAIN ROAD, CAPE TOWN'),
  ('00000000-0000-0000-0000-000000000002', 'JOHN SMITH', '7505055009081', '+27721234567', null, null, null);

insert into public.client_banking_details (client_id, bank_name, account_holder_name_encrypted,
  account_holder_name_iv, account_number_encrypted, account_number_iv, account_number_last4) values
  ('00000000-0000-0000-0000-000000000001', 'FNB', 'x', 'x', 'x', 'x', '1234');

insert into public.whatsapp_flows (phone, flow, step) values ('+27821234567', 'service', 'start');

insert into public.whatsapp_messages (phone, direction, status, body) values
  ('+27821234567', 'in', 'received', 'hello');

insert into public.audit_log (table_name, record_id, action, diff) values
  ('clients', '00000000-0000-0000-0000-000000000001', 'update', '{"cell_number": "+27821234567"}');
