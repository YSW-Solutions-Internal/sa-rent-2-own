-- SPEC item 32's remaining step: the Transactions tab was shipping every
-- payment_transactions row (3,600+ and growing) to the browser on every
-- page load so client-side search/sort/filter had something to work
-- against. This view pre-joins the fields the tab actually displays and
-- searches by (deal number, client, reg) directly onto each transaction
-- row, so PostgREST can filter/sort/paginate server-side instead - the
-- app now only fetches the rows a given search/filter/page actually
-- needs.
--
-- security_invoker: runs with the caller's rights, so payment_transactions'
-- existing RLS (admin / Fleet Manager read) still applies, same as
-- payment_monthly_totals and the payment_contract_* views.
create or replace view public.payment_transactions_detail
with (security_invoker = true) as
select
  pt.id,
  pt.contract_id,
  pt.transaction_date,
  pt.type,
  pt.reference,
  pt.invoice_reference,
  pt.cash_effect,
  pt.reversed_transaction_id,
  c.deal_number,
  c.payment_method,
  c.vehicle_id,
  cl.full_name as client_name,
  coalesce(cl.blacklisted, false) as client_blacklisted,
  vr.plate_number as reg
from public.payment_transactions pt
left join public.contracts c on c.id = pt.contract_id
left join public.clients cl on cl.id = c.client_id
left join public.vehicle_registrations vr
  on vr.vehicle_id = c.vehicle_id and vr.effective_to is null;

grant select on public.payment_transactions_detail to authenticated;
