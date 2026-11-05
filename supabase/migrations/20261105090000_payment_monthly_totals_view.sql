-- One row per month of payment activity, so the Payments dashboard chart can
-- read a few dozen rows instead of paging through every transaction.
--   collected = receipts, reversed = debit notes (shown positive), net = collected - reversed.
-- security_invoker: the view runs with the caller's rights, so the existing
-- payment_transactions RLS (admin / Fleet Manager read) still applies.
create or replace view public.payment_monthly_totals
with (security_invoker = true) as
select
  date_trunc('month', transaction_date)::date as month,
  coalesce(sum(cash_effect) filter (where type = 'receipt'), 0)::numeric(14, 2) as collected,
  coalesce(-sum(cash_effect) filter (where type = 'debit_note'), 0)::numeric(14, 2) as reversed,
  sum(cash_effect)::numeric(14, 2) as net
from public.payment_transactions
group by 1;

grant select on public.payment_monthly_totals to authenticated;
