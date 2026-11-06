-- Two missing indexes found by a performance audit (2026-11-06):
--
-- payment_transactions is paginated via .order("transaction_date").order("id")
-- (a stable sort needs the id tiebreaker — see the vehicles/payments pages'
-- established pattern) on every full-table fetch in the Payments pages;
-- without this index Postgres sorts the whole table from scratch each time,
-- and the table only grows (3,600+ rows and counting).
create index payment_transactions_transaction_date_id_idx
  on public.payment_transactions (transaction_date, id);

-- Admin -> Users' Activity tab filters audit_log by changed_by (latest 100);
-- audit_log already has (table_name, record_id) and created_at indexes but
-- nothing on changed_by, so that lookup forces a full scan of a table that
-- grows on every write across 13+ audited tables with no retention policy.
create index audit_log_changed_by_created_at_idx
  on public.audit_log (changed_by, created_at desc);
