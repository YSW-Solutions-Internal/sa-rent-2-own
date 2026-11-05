"use server";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export interface ContractVehicleHistoryEntry {
  id: string;
  vehicle_id: string;
  effective_from: string;
  effective_to: string | null;
  file_no: string;
  plate: string | null;
  reason: string | null;
}

export async function listContractVehicleHistory(
  contractId: string
): Promise<{ data?: ContractVehicleHistoryEntry[]; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: assignments, error } = await supabase
    .from("contract_vehicle_assignments")
    .select("id, vehicle_id, effective_from, effective_to, reason")
    .eq("contract_id", contractId)
    .order("effective_from", { ascending: false });

  if (error) return { error: "Couldn't load vehicle history" };
  if (!assignments || assignments.length === 0) return { data: [] };

  const vehicleIds = [...new Set(assignments.map((a) => a.vehicle_id))];
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, file_no")
    .in("id", vehicleIds);
  const { data: registrations } = await supabase
    .from("vehicle_registrations")
    .select("vehicle_id, plate_number")
    .in("vehicle_id", vehicleIds)
    .is("effective_to", null);

  const fileNoByVehicle = new Map((vehicles ?? []).map((v) => [v.id, v.file_no]));
  const plateByVehicle = new Map((registrations ?? []).map((r) => [r.vehicle_id, r.plate_number]));

  const rows: ContractVehicleHistoryEntry[] = assignments.map((a) => ({
    id: a.id,
    vehicle_id: a.vehicle_id,
    effective_from: a.effective_from,
    effective_to: a.effective_to,
    file_no: fileNoByVehicle.get(a.vehicle_id) ?? "Unknown vehicle",
    plate: plateByVehicle.get(a.vehicle_id) ?? null,
    reason: a.reason,
  }));

  return { data: rows };
}
