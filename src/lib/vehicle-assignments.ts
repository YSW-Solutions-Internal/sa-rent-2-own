import "server-only";

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Keeps contract_vehicle_assignments in sync with a contract's current
 * vehicle — the history table a vehicle's "which contracts has it been on"
 * and a contract's "which vehicle is/was on it" are both read from.
 *
 * Call this after creating a contract, or after updating one whose vehicle
 * changed. A no-op if this contract already has an open assignment to this
 * exact vehicle (every other save, since vehicle_id didn't change). */
export async function syncVehicleAssignment(
  supabase: Supabase,
  contractId: string,
  vehicleId: string,
  effectiveFrom: string,
  reason?: string | null
): Promise<string | null> {
  const { data: current } = await supabase
    .from("contract_vehicle_assignments")
    .select("id, vehicle_id")
    .eq("contract_id", contractId)
    .is("effective_to", null)
    .maybeSingle();

  if (current?.vehicle_id === vehicleId) return null;

  if (current) {
    const { error } = await supabase
      .from("contract_vehicle_assignments")
      .update({ effective_to: effectiveFrom })
      .eq("id", current.id);
    if (error) return "Couldn't close the previous vehicle's assignment";
  }

  // The vehicle can only be on one contract at a time — close out any open
  // assignment it has under a *different* contract first (the "vehicle
  // moves to a new contract" case), otherwise the one-open-per-vehicle
  // constraint would reject this insert.
  const { error: closeError } = await supabase
    .from("contract_vehicle_assignments")
    .update({ effective_to: effectiveFrom })
    .eq("vehicle_id", vehicleId)
    .is("effective_to", null);
  if (closeError) return "Couldn't free the vehicle from its previous assignment";

  const { error: insertError } = await supabase.from("contract_vehicle_assignments").insert({
    contract_id: contractId,
    vehicle_id: vehicleId,
    effective_from: effectiveFrom,
    reason: reason?.trim() || null,
  });
  if (insertError) return "Couldn't record the new vehicle on the contract";
  return null;
}
