import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canEdit, canSeeFinancials, canViewContracts } from "@/lib/auth/permissions";
import type { PaymentMethod } from "@/lib/database.types";
import { vehicleStatusValues } from "./schema";

import { VehiclesTable } from "./vehicles-table";
import type { VehicleWithRegistration } from "./types";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VehiclesPage({ searchParams }: PageProps<"/vehicles">) {
  const params = await searchParams;
  const statusParam = firstParam(params.status);
  const initialStatus = vehicleStatusValues.find((s) => s === statusParam);
  const initialServiceDueSoon = firstParam(params.service) === "due_soon";
  const initialContractEndingSoon = firstParam(params.contract) === "ending_soon";
  // /vehicles?open=<id> opens that vehicle straight away (links from contracts).
  const initialOpenVehicleId = firstParam(params.open) ?? null;

  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  // canManage = edit rights (admin only); contract columns are visible to
  // Fleet Managers too; prices are admin-only and stripped below.
  const canManage = canEdit(profile?.role);
  const canSeeContracts = canViewContracts(profile?.role);
  const canSeePrices = canSeeFinancials(profile?.role);

  interface ActiveContractRow {
    vehicle_id: string;
    client_id: string;
    start_date: string;
    end_date: string | null;
    installment_amount: number | null;
    payment_method: PaymentMethod;
    potential_sale_price: number | null;
    purchase_price: number | null;
    total_collected: number;
    residual_value: number | null;
    is_paid_up: boolean;
  }
  interface PastContractRow {
    vehicle_id: string;
    client_id: string;
  }

  // None of these filter by the others' results (registrations/contracts/
  // clients are small tables fetched in full, not scoped by vehicle id), so
  // they all run in one wave instead of waiting on the vehicles query first.
  const [{ data: vehicles }, { data: registrations }, { data: activeContracts }, { data: pastContracts }, { data: clients }] =
    await Promise.all([
      supabase
        .from("vehicles")
        .select(
          "id, file_no, make, model, year, colour, vin, engine_number, status, legacy_status_note, current_mileage, next_service_km, next_service_date, last_serviced_by, tracker_supplier, tracker_running, natis_on_file, license_disc_expiry, has_spare_key, warranty_active, warranty_notes, has_contract_file"
        )
        .order("file_no"),
      supabase.from("vehicle_registrations").select("vehicle_id, plate_number").is("effective_to", null),
      canSeeContracts
        ? supabase
            .from("contracts")
            .select(
              "vehicle_id, client_id, start_date, end_date, installment_amount, payment_method, potential_sale_price, purchase_price, total_collected, residual_value, is_paid_up"
            )
            .eq("status", "active")
        : Promise.resolve({ data: [] as ActiveContractRow[] }),
      canSeeContracts
        ? supabase.from("contracts").select("vehicle_id, client_id").neq("status", "active")
        : Promise.resolve({ data: [] as PastContractRow[] }),
      canSeeContracts
        ? supabase.from("clients").select("id, full_name, cell_number, blacklisted")
        : Promise.resolve({ data: [] as { id: string; full_name: string; cell_number: string; blacklisted: boolean }[] }),
    ]);

  const clientById = new Map((clients ?? []).map((c) => [c.id, c]));
  const plateByVehicle = new Map((registrations ?? []).map((r) => [r.vehicle_id, r.plate_number]));
  const activeContractByVehicle = new Map((activeContracts ?? []).map((c) => [c.vehicle_id, c]));

  const pastClientNamesByVehicle = new Map<string, string[]>();
  for (const c of pastContracts ?? []) {
    const name = clientById.get(c.client_id)?.full_name;
    if (!name || !c.vehicle_id) continue;
    const names = pastClientNamesByVehicle.get(c.vehicle_id) ?? [];
    if (!names.includes(name)) names.push(name);
    pastClientNamesByVehicle.set(c.vehicle_id, names);
  }

  const rows: VehicleWithRegistration[] = (vehicles ?? []).map((v) => {
    const activeContract = activeContractByVehicle.get(v.id);
    const client = activeContract ? clientById.get(activeContract.client_id) : undefined;
    return {
      ...v,
      current_plate: plateByVehicle.get(v.id) ?? null,
      current_client_name: client?.full_name ?? null,
      current_client_blacklisted: client?.blacklisted ?? false,
      current_client_cell: client?.cell_number ?? null,
      current_contract_start_date: activeContract?.start_date ?? null,
      current_contract_end_date: activeContract?.end_date ?? null,
      current_installment_amount: activeContract?.installment_amount ?? null,
      current_payment_method: activeContract?.payment_method ?? null,
      current_potential_sale_price: canSeePrices ? (activeContract?.potential_sale_price ?? null) : null,
      current_purchase_price: canSeePrices ? (activeContract?.purchase_price ?? null) : null,
      current_total_collected: activeContract?.total_collected ?? null,
      current_residual_value: activeContract?.residual_value ?? null,
      current_is_paid_up: activeContract?.is_paid_up ?? null,
      past_client_names: pastClientNamesByVehicle.get(v.id)?.join(", ") ?? null,
    };
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <VehiclesTable
        rows={rows}
        canManage={canManage}
        canViewContracts={canSeeContracts}
        canSeePrices={canSeePrices}
        initialStatus={initialStatus}
        initialServiceDueSoon={initialServiceDueSoon}
        initialContractEndingSoon={initialContractEndingSoon}
        initialOpenVehicleId={initialOpenVehicleId}
        exportedBy={profile?.fullName ?? "Unknown"}
      />
    </div>
  );
}
