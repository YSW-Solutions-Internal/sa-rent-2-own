import { redirect } from "next/navigation";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canEdit, canViewContracts } from "@/lib/auth/permissions";

import { ContractsTable } from "./contracts-table";
import type { ContractRow, SelectableClient, SelectableVehicle } from "./types";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContractsPage({ searchParams }: PageProps<"/contracts">) {
  const params = await searchParams;
  const initialEndingSoon = firstParam(params.ending) === "soon";
  // /contracts?open=<id> opens that contract's panel straight away (links from vehicles and clients).
  const initialOpenContractId = firstParam(params.open) ?? null;

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
          "id, vehicle_id, client_id, contract_type, status, start_date, end_date, payment_method, installment_amount, residual_value, total_collected, outstanding_balance, arrears_amount, is_paid_up, notes, deal_number, statement_tag, billing_day, billing_direction, billing_frequency, billing_status, agreement_file_path"
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
  );  // (null for contracts with no vehicle — never matches a car)

  // Available for a contract: no active contract. Cars that are sold, written
  // off or at end of deal still show, with a warning, until the availability
  // rules are buttoned down (SPEC item 30).
  const WARNING_STATUS_LABELS: Record<string, string> = {
    sold: "Sold",
    written_off: "Written off",
    end_of_deal: "End of deal",
  };
  const selectableVehicles: SelectableVehicle[] = (vehicles ?? [])
    .filter((v) => !activeVehicleIds.has(v.id))
    .map((v) => ({ id: v.id, label: vehicleLabel(v), warning: WARNING_STATUS_LABELS[v.status] }));

  const selectableClients: SelectableClient[] = (clients ?? []).map((c) => ({
    id: c.id,
    label: c.full_name,
    blacklisted: c.blacklisted,
  }));

  const rows: ContractRow[] = (contracts ?? []).map((c) => {
    const vehicle = c.vehicle_id ? vehicleById.get(c.vehicle_id) : undefined;
    return {
      ...c,
      vehicleLabel: vehicle ? vehicleLabel(vehicle) : c.vehicle_id ? "Unknown vehicle" : "No vehicle",
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
        initialOpenContractId={initialOpenContractId}
        exportedBy={profile.fullName}
        canEdit={canEdit(profile.role)}
      />
    </div>
  );
}
