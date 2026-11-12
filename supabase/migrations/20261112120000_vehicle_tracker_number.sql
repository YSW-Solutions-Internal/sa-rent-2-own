-- The client's fleet-wide tracker device numbers (serials/IMEIs) have
-- nowhere to live today: tracker_supplier is the company name (e.g.
-- "Cartrack"), not a per-unit identifier. Nullable, free text like
-- tracker_supplier itself — formats vary by supplier (short numeric
-- codes, long IMEI-style numbers).
alter table public.vehicles
  add column tracker_number text;
