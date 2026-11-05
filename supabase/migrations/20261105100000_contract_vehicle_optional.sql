-- A contract can now exist with no vehicle (a car taken off it, not yet replaced).
-- The partial unique index "one active contract per vehicle" and the foreign key
-- both ignore NULLs, so nothing else changes. A vehicle's history stays in
-- contract_vehicle_assignments (the open row is closed when a car is removed).
alter table public.contracts alter column vehicle_id drop not null;
