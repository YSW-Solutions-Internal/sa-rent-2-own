-- Multiple vehicles can be mid-flow for the same phone number at once (e.g.
-- two "add a service" messages sent back to back). Previously whatsapp_flows
-- held exactly one row per phone, so two concurrent inbound messages could
-- both see "no flow yet" and both save a fresh one -- whichever upsert
-- committed last silently clobbered the other (see the JF13MRGP/JF53YJGP
-- incident, 2026-11-09: a service flow that had already replied to the user
-- was wiped out a second later by a second message for a different vehicle).
--
-- Each vehicle now gets its own row; at most one per phone is "active" (the
-- one currently being asked about), enforced by a partial unique index so
-- the claim is atomic at the DB level -- a second concurrent insert can't
-- also become active, it has to queue instead.

alter table public.whatsapp_flows
  add column id uuid not null default gen_random_uuid(),
  add column active boolean not null default true,
  add column created_at timestamptz not null default now();

alter table public.whatsapp_flows drop constraint whatsapp_flows_pkey;
alter table public.whatsapp_flows add primary key (id);

create index whatsapp_flows_phone_created_idx on public.whatsapp_flows (phone, created_at);
create unique index whatsapp_flows_one_active_per_phone on public.whatsapp_flows (phone) where active;

-- Atomically claims the active slot for a phone, or does nothing if another
-- flow already holds it (returns null either way the caller checks for).
create or replace function public.whatsapp_flow_claim(
  p_phone text, p_flow text, p_step text, p_data jsonb
) returns public.whatsapp_flows
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.whatsapp_flows;
begin
  insert into public.whatsapp_flows (phone, flow, step, data, active, created_at, updated_at)
  values (p_phone, p_flow, p_step, p_data, true, now(), now())
  on conflict (phone) where active
  do nothing
  returning * into v_row;

  return v_row;
end;
$$;

-- Queues a vehicle's flow behind whichever one is currently active for this phone.
create or replace function public.whatsapp_flow_enqueue(
  p_phone text, p_flow text, p_step text, p_data jsonb
) returns public.whatsapp_flows
language sql
security definer
set search_path = public
as $$
  insert into public.whatsapp_flows (phone, flow, step, data, active, created_at, updated_at)
  values (p_phone, p_flow, p_step, p_data, false, now(), now())
  returning *;
$$;

-- Closes (deletes) a flow and, if anything is queued behind it for the same
-- phone, promotes the oldest queued one to active and returns it (null if
-- the queue was empty). One function so both steps commit together.
create or replace function public.whatsapp_flow_close_and_promote(
  p_id uuid
) returns public.whatsapp_flows
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_next public.whatsapp_flows;
begin
  delete from public.whatsapp_flows where id = p_id returning phone into v_phone;
  if v_phone is null then
    return null;
  end if;

  update public.whatsapp_flows
  set active = true, updated_at = now()
  where id = (
    select id from public.whatsapp_flows
    where phone = v_phone and not active
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning * into v_next;

  return v_next;
end;
$$;

revoke all on function public.whatsapp_flow_claim(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_flow_enqueue(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_flow_close_and_promote(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_flow_claim(text, text, text, jsonb) to service_role;
grant execute on function public.whatsapp_flow_enqueue(text, text, text, jsonb) to service_role;
grant execute on function public.whatsapp_flow_close_and_promote(uuid) to service_role;
