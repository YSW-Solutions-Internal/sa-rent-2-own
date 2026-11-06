-- All descriptive text is stored in UPPER CASE. A BEFORE INSERT/UPDATE trigger on each table upper-cases the
-- listed columns, so every write path (app, WhatsApp bot, scripts, SQL) is covered. Deliberately NOT
-- upper-cased: emails, encrypted banking fields, file paths, WhatsApp/audit/payment-reference data and enums.
-- Banking account-holder names are encrypted, so the app upper-cases them before encrypting.
create or replace function public.upcase_text_columns()
returns trigger
language plpgsql
as $$
declare
  col text;
  j jsonb := to_jsonb(new);
begin
  foreach col in array tg_argv loop
    if jsonb_typeof(j -> col) = 'string' then
      new := jsonb_populate_record(new, jsonb_build_object(col, upper(j ->> col)));
    end if;
  end loop;
  return new;
end;
$$;

-- "aa_" prefix so it fires before other BEFORE triggers (Postgres runs same-event triggers alphabetically).
create trigger aa_upcase_text before insert or update on public.clients
  for each row execute function public.upcase_text_columns('full_name', 'address', 'notes', 'blacklist_reason');
create trigger aa_upcase_text before insert or update on public.vehicles
  for each row execute function public.upcase_text_columns('file_no', 'make', 'model', 'colour', 'vin', 'engine_number',
    'last_serviced_by', 'tracker_supplier', 'warranty_notes', 'legacy_status_note', 'assigned_to_name');
create trigger aa_upcase_text before insert or update on public.vehicle_registrations
  for each row execute function public.upcase_text_columns('plate_number', 'reason');
create trigger aa_upcase_text before insert or update on public.contracts
  for each row execute function public.upcase_text_columns('notes', 'deal_number', 'statement_tag');
create trigger aa_upcase_text before insert or update on public.insurance_claims
  for each row execute function public.upcase_text_columns('claimant_name', 'notes');
create trigger aa_upcase_text before insert or update on public.vehicle_costs
  for each row execute function public.upcase_text_columns('supplier', 'notes', 'work_done');
create trigger aa_upcase_text before insert or update on public.contract_vehicle_assignments
  for each row execute function public.upcase_text_columns('reason');
create trigger aa_upcase_text before insert or update on public.rental_payment_periods
  for each row execute function public.upcase_text_columns('period_label', 'notes');
create trigger aa_upcase_text before insert or update on public.sale_listings
  for each row execute function public.upcase_text_columns('spec', 'condition', 'location');
create trigger aa_upcase_text before insert or update on public.client_banking_details
  for each row execute function public.upcase_text_columns('bank_name');
create trigger aa_upcase_text before insert or update on public.profiles
  for each row execute function public.upcase_text_columns('full_name');

-- One-off: upper-case existing rows (a no-op update fires the trigger on every row).
update public.clients set id = id;
update public.vehicles set id = id;
update public.vehicle_registrations set id = id;
update public.contracts set id = id;
update public.insurance_claims set id = id;
update public.vehicle_costs set id = id;
update public.contract_vehicle_assignments set id = id;
update public.rental_payment_periods set id = id;
update public.sale_listings set id = id;
update public.client_banking_details set id = id;
update public.profiles set id = id;
