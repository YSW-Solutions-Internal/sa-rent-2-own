"use server";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canSeeFinancials, canViewContracts } from "@/lib/auth/permissions";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import type { VehicleStatus } from "@/lib/database.types";

export interface VehicleDetails {
  fileNo: string;
  reg: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  vin: string | null;
  engineNumber: string | null;
  status: VehicleStatus;
  currentMileage: number | null;
  nextServiceKm: number | null;
  nextServiceDate: string | null;
  lastServicedBy: string | null;
  trackerSupplier: string | null;
  trackerRunning: string | null;
  natisOnFile: boolean;
  hasSpareKey: boolean;
  licenseDiscExpiry: string | null;
  warrantyActive: boolean;
  clientName: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  installmentAmount: number | null;
  /** Admin only — null for everyone else, never sent to the browser. */
  purchasePrice: number | null;
  potentialSalePrice: number | null;
}

/**
 * Read-only vehicle summary for the "click a reg" popup on the Payments
 * screens. Gated like the Payments page itself (admin / Fleet Manager), and
 * prices are only included for admins.
 */
export async function getVehicleDetails(
  vehicleId: string
): Promise<{ data?: VehicleDetails; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !canViewContracts(profile.role)) return { error: "Not authorized" };

  const supabase = await createSupabaseServerClient();
  const [{ data: vehicle }, { data: registration }, { data: contract }] = await Promise.all([
    supabase
      .from("vehicles")
      .select(
        "file_no, make, model, year, colour, vin, engine_number, status, current_mileage, next_service_km, next_service_date, last_serviced_by, tracker_supplier, tracker_running, natis_on_file, has_spare_key, license_disc_expiry, warranty_active, purchase_price, potential_sale_price"
      )
      .eq("id", vehicleId)
      .maybeSingle(),
    supabase
      .from("vehicle_registrations")
      .select("plate_number")
      .eq("vehicle_id", vehicleId)
      .is("effective_to", null)
      .maybeSingle(),
    supabase
      .from("contracts")
      .select("client_id, start_date, end_date, installment_amount")
      .eq("vehicle_id", vehicleId)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  if (!vehicle) return { error: "Vehicle not found" };

  let clientName: string | null = null;
  if (contract) {
    const { data: client } = await supabase
      .from("clients")
      .select("full_name")
      .eq("id", contract.client_id)
      .maybeSingle();
    clientName = client?.full_name ?? null;
  }

  const showPrices = canSeeFinancials(profile.role);

  return {
    data: {
      fileNo: vehicle.file_no,
      reg: registration?.plate_number ?? null,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      colour: vehicle.colour,
      vin: vehicle.vin,
      engineNumber: vehicle.engine_number,
      status: vehicle.status,
      currentMileage: vehicle.current_mileage,
      nextServiceKm: vehicle.next_service_km,
      nextServiceDate: vehicle.next_service_date,
      lastServicedBy: vehicle.last_serviced_by,
      trackerSupplier: vehicle.tracker_supplier,
      trackerRunning: vehicle.tracker_running,
      natisOnFile: vehicle.natis_on_file,
      hasSpareKey: vehicle.has_spare_key,
      licenseDiscExpiry: vehicle.license_disc_expiry,
      warrantyActive: vehicle.warranty_active,
      clientName,
      contractStart: contract?.start_date ?? null,
      contractEnd: contract?.end_date ?? null,
      installmentAmount: contract?.installment_amount ?? null,
      purchasePrice: showPrices ? vehicle.purchase_price : null,
      potentialSalePrice: showPrices ? vehicle.potential_sale_price : null,
    },
  };
}
