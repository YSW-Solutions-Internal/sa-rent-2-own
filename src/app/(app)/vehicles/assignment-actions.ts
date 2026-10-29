"use server";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export interface VehicleContractHistoryEntry {
  id: string;
  effective_from: string;
  effective_to: string | null;
  deal_number: string | null;
  contract_status: string;
  client_name: string;
  client_blacklisted: boolean;
}

export async function listVehicleContractHistory(
  vehicleId: string
): Promise<{ data?: VehicleContractHistoryEntry[]; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: assignments, error } = await supabase
    .from("contract_vehicle_assignments")
    .select("id, contract_id, effective_from, effective_to")
    .eq("vehicle_id", vehicleId)
    .order("effective_from", { ascending: false });

  if (error) return { error: "Couldn't load contract history" };
  if (!assignments || assignments.length === 0) return { data: [] };

  const contractIds = [...new Set(assignments.map((a) => a.contract_id))];
  const { data: contracts } = await supabase
    .from("contracts")
    .select("id, deal_number, status, client_id")
    .in("id", contractIds);

  const clientIds = [...new Set((contracts ?? []).map((c) => c.client_id))];
  const { data: clients } = await supabase
    .from("clients")
    .select("id, full_name, blacklisted")
    .in("id", clientIds);

  const contractById = new Map((contracts ?? []).map((c) => [c.id, c]));
  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.full_name]));
  const blacklistedClientIds = new Set((clients ?? []).filter((c) => c.blacklisted).map((c) => c.id));

  const rows: VehicleContractHistoryEntry[] = assignments.map((a) => {
    const contract = contractById.get(a.contract_id);
    return {
      id: a.id,
      effective_from: a.effective_from,
      effective_to: a.effective_to,
      deal_number: contract?.deal_number ?? null,
      contract_status: contract?.status ?? "—",
      client_name: contract ? (clientNameById.get(contract.client_id) ?? "Unknown client") : "Unknown client",
      client_blacklisted: contract ? blacklistedClientIds.has(contract.client_id) : false,
    };
  });

  return { data: rows };
}
