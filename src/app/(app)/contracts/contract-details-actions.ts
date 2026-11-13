"use server";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canViewContracts } from "@/lib/auth/permissions";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import type { ContractStatus, ContractType } from "@/lib/database.types";

export interface ContractDetails {
  dealNumber: string | null;
  contractType: ContractType;
  status: ContractStatus;
  clientName: string | null;
  clientBlacklisted: boolean;
  reg: string | null;
  vehicle: string | null;
  startDate: string;
  endDate: string | null;
  installmentAmount: number | null;
  totalCollected: number;
  outstandingBalance: number;
  arrearsAmount: number;
}

/**
 * Read-only contract summary for the "click a deal number" popup on the
 * Payments screens — same gating and shape as vehicle-details-actions.ts's
 * getVehicleDetails, for the "click a reg" popup it already pairs with.
 */
export async function getContractDetails(contractId: string): Promise<{ data?: ContractDetails; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !canViewContracts(profile.role)) return { error: "Not authorized" };

  const supabase = await createSupabaseServerClient();
  const { data: contract } = await supabase
    .from("contracts")
    .select(
      "deal_number, contract_type, status, client_id, vehicle_id, start_date, end_date, installment_amount, total_collected, outstanding_balance, arrears_amount"
    )
    .eq("id", contractId)
    .maybeSingle();
  if (!contract) return { error: "Contract not found" };

  const [{ data: client }, vehicleInfo] = await Promise.all([
    supabase.from("clients").select("full_name, blacklisted").eq("id", contract.client_id).maybeSingle(),
    contract.vehicle_id
      ? Promise.all([
          supabase.from("vehicles").select("make, model, year").eq("id", contract.vehicle_id).maybeSingle(),
          supabase
            .from("vehicle_registrations")
            .select("plate_number")
            .eq("vehicle_id", contract.vehicle_id)
            .is("effective_to", null)
            .maybeSingle(),
        ])
      : Promise.resolve(null),
  ]);

  const vehicleRow = vehicleInfo?.[0].data ?? null;
  const registrationRow = vehicleInfo?.[1].data ?? null;

  return {
    data: {
      dealNumber: contract.deal_number,
      contractType: contract.contract_type,
      status: contract.status,
      clientName: client?.full_name ?? null,
      clientBlacklisted: client?.blacklisted ?? false,
      reg: registrationRow?.plate_number ?? null,
      vehicle: vehicleRow ? [vehicleRow.year, vehicleRow.make, vehicleRow.model].filter(Boolean).join(" ") || null : null,
      startDate: contract.start_date,
      endDate: contract.end_date,
      installmentAmount: contract.installment_amount,
      totalCollected: contract.total_collected,
      outstandingBalance: contract.outstanding_balance,
      arrearsAmount: contract.arrears_amount,
    },
  };
}
