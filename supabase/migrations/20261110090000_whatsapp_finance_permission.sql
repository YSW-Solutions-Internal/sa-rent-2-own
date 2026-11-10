-- Separate per-person permission for WhatsApp finance questions (payments,
-- revenue/income and transaction totals). whatsapp_enabled alone only grants
-- contract and vehicle information (SPEC item 43) -- finance has to be
-- switched on separately per number, off by default, and is meaningless
-- without whatsapp_enabled also being on (enforced in the app, not here).
alter table public.profiles
  add column whatsapp_finance_enabled boolean not null default false;
