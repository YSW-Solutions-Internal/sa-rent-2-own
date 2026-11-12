-- Fields needed to render a filled contract agreement PDF (rent-to-own
-- "Contract details"/"Startup fee" tables; SPEC item 61) that the
-- contract form doesn't collect yet. Deliberately not exposed in
-- ContractPanel's UI per explicit instruction: nothing populates these
-- today, so the generated PDF renders them as blank fields until a later
-- change adds the UI. All nullable, no defaults.
--
-- agreement_file_path holds the storage path of the PDF generated at
-- contract-creation time (see 20261112110000_contract_agreements_storage.sql),
-- mirroring vehicle_costs.invoice_file_path's pattern for vehicle-invoices.
alter table public.contracts
  add column annual_escalation_pct numeric(5, 2),
  add column startup_fee_total numeric(10, 2),
  add column startup_fee_account_admin_monthly numeric(10, 2),
  add column startup_fee_credit_bureau numeric(10, 2),
  add column startup_fee_gps_monthly numeric(10, 2),
  add column startup_fee_gps_unit_installation numeric(10, 2),
  add column startup_fee_initiation numeric(10, 2),
  add column startup_fee_pre_delivery_valet numeric(10, 2),
  add column startup_fee_registration_license numeric(10, 2),
  add column monthly_km_allowance integer,
  add column excess_km_rate numeric(6, 2),
  add column motor_plan text,
  add column product_name text,
  add column expected_end_value_inc_vat numeric(10, 2),
  add column agreement_file_path text;
