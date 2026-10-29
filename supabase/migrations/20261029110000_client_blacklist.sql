-- Lets staff flag a client as blacklisted, with a reason (who and when is in the audit log). The app shows a red warning
-- sign next to the client's name wherever it appears. Changes are audited by the
-- existing row-change trigger on clients.
alter table public.clients
  add column blacklisted boolean not null default false,
  add column blacklist_reason text;
