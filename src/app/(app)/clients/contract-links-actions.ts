"use server";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canSeeFinancials, canViewContracts } from "@/lib/auth/permissions";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import type { ContractStatus } from "@/lib/database.types";

export interface ClientContractEntry {
  id: string;
  deal_number: string | null;
  status: ContractStatus;
  start_date: string;
  end_date: string | null;
  file_no: string;
  plate: string | null;
}

export async function listClientContracts(
  clientId: string
): Promise<{ data?: ClientContractEntry[]; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: contracts, error } = await supabase
    .from("contracts")
    .select("id, deal_number, status, start_date, end_date, vehicle_id")
    .eq("client_id", clientId)
    .order("start_date", { ascending: false });

  if (error) return { error: "Couldn't load linked contracts" };
  if (!contracts || contracts.length === 0) return { data: [] };

  const vehicleIds = [...new Set(contracts.map((c) => c.vehicle_id).filter((id): id is string => id !== null))];
  const { data: vehicles } = await supabase.from("vehicles").select("id, file_no").in("id", vehicleIds);
  const { data: registrations } = await supabase
    .from("vehicle_registrations")
    .select("vehicle_id, plate_number")
    .in("vehicle_id", vehicleIds)
    .is("effective_to", null);

  const fileNoByVehicle = new Map((vehicles ?? []).map((v) => [v.id, v.file_no]));
  const plateByVehicle = new Map((registrations ?? []).map((r) => [r.vehicle_id, r.plate_number]));

  const rows: ClientContractEntry[] = contracts.map((c) => ({
    id: c.id,
    deal_number: c.deal_number,
    status: c.status,
    start_date: c.start_date,
    end_date: c.end_date,
    file_no: c.vehicle_id ? (fileNoByVehicle.get(c.vehicle_id) ?? "Unknown vehicle") : "No vehicle",
    plate: c.vehicle_id ? (plateByVehicle.get(c.vehicle_id) ?? null) : null,
  }));

  return { data: rows };
}

/**
 * Net cash collected from a client across all their contracts, to date.
 * Admin / Fleet Manager only; Fleet Managers don't see cash contracts.
 * Returns `data: null` when the caller isn't allowed to see it.
 */
export async function getClientTotalCollected(
  clientId: string
): Promise<{ data?: number | null; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !canViewContracts(profile.role)) return { data: null };

  const supabase = await createSupabaseServerClient();
  let contractQuery = supabase.from("contracts").select("id").eq("client_id", clientId);
  if (!canSeeFinancials(profile.role)) contractQuery = contractQuery.neq("payment_method", "cash");
  const { data: contracts, error } = await contractQuery;
  if (error) return { error: "Couldn't load total collected" };

  const contractIds = (contracts ?? []).map((c) => c.id);
  if (contractIds.length === 0) return { data: 0 };

  const { data: rows, error: sumError } = await supabase
    .from("payment_contract_summary")
    .select("net_collected")
    .in("contract_id", contractIds);
  if (sumError) return { error: "Couldn't load total collected" };
  return { data: (rows ?? []).reduce((sum, r) => sum + Number(r.net_collected), 0) };
}
