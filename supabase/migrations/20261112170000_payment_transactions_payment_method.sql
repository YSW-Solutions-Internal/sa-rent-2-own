-- Lets a payment record how it actually came in (e.g. a cash top-up on an
-- otherwise debit-order contract), independent of contracts.payment_method
-- (the client's *default* collection method). Nullable: every existing
-- imported row has no per-transaction method on file. Reuses the same
-- public.payment_method enum contracts.payment_method already uses.
alter table public.payment_transactions
  add column payment_method public.payment_method;
