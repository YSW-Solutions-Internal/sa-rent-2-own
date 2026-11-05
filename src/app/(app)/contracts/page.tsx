import { redirect } from "next/navigation";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canEdit, canSeeFinancials, canViewContracts } from "@/lib/auth/permissions";

import { ContractsTable } from "./contracts-table";
import type { ContractRow, SelectableClient, SelectableVehicle } from "./types";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContractsPage({ searchParams }: PageProps<"/contracts">) {
  const params = await searchParams;
  const initialEndingSoon = firstParam(params.ending) === "soon";

  const profile = await getCurrentProfile();
  if (!profile || !canViewContracts(profile.role)) {
    redirect("/");
  }

  const supabase = await createSupabaseServerClient();

  const [{ data: contracts }, { data: vehicles }, { data: clients }, { data: registrations }] =
    await Promise.all([
      supabase
        .from("contracts")
        .select(
          "id, vehicle_id, client_id, contract_type, status, start_date, end_date, payment_method, installment_amount, purchase_price, potential_sale_price, sale_price, residual_value, total_collected, outstanding_balance, arrears_amount, is_paid_up, notes, deal_number, statement_tag, billing_day, billing_direction, billing_frequency, billing_status"
        )
        .order("start_date", { ascending: false }),
      supabase.from("vehicles").select("id, file_no, make, model, year, status, next_service_date"),
      supabase.from("clients").select("id, full_name, blacklisted").order("full_name"),
      supabase.from("vehicle_registrations").select("vehicle_id, plate_number").is("effective_to", null),
    ]);

  const plateByVehicle = new Map((registrations ?? []).map((r) => [r.vehicle_id, r.plate_number]));
  const vehicleLabel = (v: { id: string; file_no: string; make: string | null; model: string | null; year: number | null }) =>
    [v.file_no, plateByVehicle.get(v.id), [v.year, v.make, v.model].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(" · ");

  const vehicleById = new Map((vehicles ?? []).map((v) => [v.id, v]));
  const clientById = new Map((clients ?? []).map((c) => [c.id, c.full_name]));
  const blacklistedClientIds = new Set((clients ?? []).filter((c) => c.blacklisted).map((c) => c.id));

  const activeVehicleIds = new Set(
    (contracts ?? []).filter((c) => c.status === "active").map((c) => c.vehicle_id)
  );

  // Available for a new contract: no active contract, and not already sold,
  // written off or at end of deal.
  const UNAVAILABLE_STATUSES = new Set(["sold", "written_off", "end_of_deal"]);
  const selectableVehicles: SelectableVehicle[] = (vehicles ?? [])
    .filter((v) => !activeVehicleIds.has(v.id) && !UNAVAILABLE_STATUSES.has(v.status))
    .map((v) => ({ id: v.id, label: vehicleLabel(v) }));

  const selectableClients: SelectableClient[] = (clients ?? []).map((c) => ({
    id: c.id,
    label: c.full_name,
    blacklisted: c.blacklisted,
  }));

  // Fleet Managers must not see prices — null them here, server-side, so
  // the values are never sent to their browser.
  const showPrices = canSeeFinancials(profile.role);

  const rows: ContractRow[] = (contracts ?? []).map((c) => {
    const vehicle = vehicleById.get(c.vehicle_id);
    return {
      ...c,
      purchase_price: showPrices ? c.purchase_price : null,
      potential_sale_price: showPrices ? c.potential_sale_price : null,
      vehicleLabel: vehicle ? vehicleLabel(vehicle) : "Unknown vehicle",
      clientName: clientById.get(c.client_id) ?? "Unknown client",
      clientBlacklisted: blacklistedClientIds.has(c.client_id),
    };
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <ContractsTable
        rows={rows}
        vehicles={selectableVehicles}
        clients={selectableClients}
        initialEndingSoon={initialEndingSoon}
        exportedBy={profile.fullName}
        canEdit={canEdit(profile.role)}
      />
    </div>
  );
}
