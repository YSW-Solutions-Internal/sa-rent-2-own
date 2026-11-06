-- SPEC item 32 (payments dashboard follow-ups): the stat cards, the
-- per-contract rollup table and the Report tab's 12-month matrix were
-- still summing every payment_transactions row in JS on each page load
-- (3,600+ and growing) - only the chart read from a view. These two
-- views move that aggregation into Postgres; the app still applies the
-- same role-based cash-contract filter it always has, just over far
-- fewer, already-aggregated rows.
--
-- security_invoker: both views run with the caller's rights, so the
-- existing payment_transactions RLS (admin / Fleet Manager read) still
-- applies - same convention as payment_monthly_totals (migration
-- 20261105090000).

-- One row per contract that has ever had a payment_transactions row.
-- last_type uses array_agg ordered the same way payments/page.tsx used
-- to iterate (oldest to newest, tiebroken by id) so "last" means the
-- row with the greatest (transaction_date, id) - the same stable
-- tiebreaker the page's raw-transaction fetch already orders by, for
-- same-day batches.
create or replace view public.payment_contract_summary
with (security_invoker = true) as
select
  contract_id,
  sum(cash_effect)::numeric(14, 2) as net_collected,
  count(*) filter (where type = 'debit_note') as reversal_count,
  count(*) as transaction_count,
  min(transaction_date) as first_transaction_date,
  max(transaction_date) as last_transaction_date,
  (array_agg(type order by transaction_date desc, id desc))[1] as last_type
from public.payment_transactions
group by contract_id;

grant select on public.payment_contract_summary to authenticated;

-- One row per contract per calendar month that had any activity - feeds
-- the Report tab's monthly matrix. month is date-truncated so it can be
-- sliced into "YYYY-MM" the same way the app's existing monthKey() does.
create or replace view public.payment_contract_monthly
with (security_invoker = true) as
select
  contract_id,
  date_trunc('month', transaction_date)::date as month,
  sum(cash_effect)::numeric(14, 2) as net_collected
from public.payment_transactions
group by contract_id, date_trunc('month', transaction_date);

grant select on public.payment_contract_monthly to authenticated;
