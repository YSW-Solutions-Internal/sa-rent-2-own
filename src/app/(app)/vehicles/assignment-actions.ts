"use server";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canSeeFinancials, canViewContracts } from "@/lib/auth/permissions";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export interface VehicleContractHistoryEntry {
  id: string;
  contract_id: string;
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
      contract_id: a.contract_id,
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

/**
 * Net cash collected for a vehicle across every contract it has been on
 * (past and present). Admin / Fleet Manager only (matches the payments
 * data's RLS); Fleet Managers don't see cash contracts, same as everywhere
 * else. Returns `data: null` when the caller isn't allowed to see it.
 */
export async function getVehicleTotalCollected(
  vehicleId: string
): Promise<{ data?: number | null; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !canViewContracts(profile.role)) return { data: null };

  const supabase = await createSupabaseServerClient();
  const { data: assignments, error } = await supabase
    .from("contract_vehicle_assignments")
    .select("contract_id")
    .eq("vehicle_id", vehicleId);
  if (error) return { error: "Couldn't load total collected" };

  const contractIds = [...new Set((assignments ?? []).map((a) => a.contract_id))];
  if (contractIds.length === 0) return { data: 0 };

  let query = supabase
    .from("payment_contract_summary")
    .select("net_collected")
    .in("contract_id", contractIds);
  if (!canSeeFinancials(profile.role)) {
    const { data: cash } = await supabase
      .from("contracts")
      .select("id")
      .in("id", contractIds)
      .eq("payment_method", "cash");
    const cashIds = (cash ?? []).map((c) => c.id);
    if (cashIds.length > 0) query = query.not("contract_id", "in", `(${cashIds.join(",")})`);
  }

  const { data: rows, error: sumError } = await query;
  if (sumError) return { error: "Couldn't load total collected" };
  return { data: (rows ?? []).reduce((sum, r) => sum + Number(r.net_collected), 0) };
}
