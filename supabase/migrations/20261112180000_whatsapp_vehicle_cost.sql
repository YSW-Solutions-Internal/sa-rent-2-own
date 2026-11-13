-- "Add a repair/car wash/maintenance/other cost" over WhatsApp. Same
-- attribution pattern as whatsapp_save_service (20261029100000) — set the
-- acting user/source before the insert so audit_log attributes it correctly
-- — but simpler: unlike a service, these cost types never touch the
-- vehicle's own mileage/next-service fields, so there's nothing else to
-- update in the same transaction.
--
-- Gated at "manager or admin" here (matching is_manager_or_admin(), which
-- can't be used directly since there's no auth.uid() for a service-role
-- call); the app currently only lets admins reach this (service-flow's
-- sibling, vehicle-cost-flow.ts, checks canEdit(role) before ever calling
-- this), so widening it to Fleet Managers later is a one-line app change,
-- no migration needed.
create or replace function public.whatsapp_save_vehicle_cost(
  p_user uuid,
  p_vehicle uuid,
  p_cost_type public.vehicle_cost_type,
  p_cost_date date,
  p_supplier text,
  p_amount numeric,
  p_work_done text,
  p_invoice text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = p_user and is_active and role in ('admin', 'manager')
  ) then
    raise exception 'not authorised';
  end if;

  perform set_config('app.acting_user', p_user::text, true);
  perform set_config('app.acting_source', 'whatsapp', true);

  insert into public.vehicle_costs (
    vehicle_id, cost_type, cost_date, supplier, amount,
    invoice_file_path, work_done, source, recorded_by
  ) values (
    p_vehicle, p_cost_type, p_cost_date, p_supplier, p_amount,
    p_invoice, p_work_done, 'whatsapp', p_user
  );
end;
$$;

revoke all on function public.whatsapp_save_vehicle_cost(uuid, uuid, public.vehicle_cost_type, date, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_save_vehicle_cost(uuid, uuid, public.vehicle_cost_type, date, text, numeric, text, text) to service_role;
