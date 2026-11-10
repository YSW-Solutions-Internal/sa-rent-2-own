-- Purchase price / potential sale price / sale price belong to the vehicle
-- (bought once, sold once), not to whichever contract happens to be on it --
-- a vehicle reassigned to a new client/deal was silently losing its original
-- purchase price unless someone remembered to re-type it on the new
-- contract. Moved to vehicles; contracts loses the columns entirely.
--
-- Backfill: each vehicle takes the values from its single most recent
-- contract (by start_date, ties broken by created_at), matching whichever
-- contract is currently on it in the common case, and the last one it was
-- ever on for a vehicle that's since been taken off everything.

alter table public.vehicles
  add column purchase_price numeric(12, 2),
  add column potential_sale_price numeric(12, 2),
  add column sale_price numeric(12, 2);

update public.vehicles v
set purchase_price = c.purchase_price,
    potential_sale_price = c.potential_sale_price,
    sale_price = c.sale_price
from (
  select distinct on (vehicle_id)
    vehicle_id, purchase_price, potential_sale_price, sale_price
  from public.contracts
  where vehicle_id is not null
  order by vehicle_id, start_date desc, created_at desc
) c
where v.id = c.vehicle_id;

-- vehicle_current_contract is `select *` from contracts, so it depends on
-- every column by name at the catalog level even though it never mentions
-- these three — drop and recreate it around the column drop (a plain
-- `create or replace view` can only append columns, never remove them).
drop view public.vehicle_current_contract;

alter table public.contracts
  drop column purchase_price,
  drop column potential_sale_price,
  drop column sale_price;

create or replace view public.vehicle_current_contract
  with (security_invoker = true) as
select *
from public.contracts
where status = 'active';
