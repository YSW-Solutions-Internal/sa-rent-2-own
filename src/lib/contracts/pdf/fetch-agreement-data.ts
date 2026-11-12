import "server-only";

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import type { AgreementCategory, AgreementData } from "./types";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** short_term_rental and rental share the same short-form template;
 * rent_to_own has its own full agreement. "other" has no agreement. */
export function categoryForContractType(contractType: string): AgreementCategory | null {
  if (contractType === "rent_to_own") return "rent_to_own";
  if (contractType === "short_term_rental" || contractType === "rental") return "rental";
  return null;
}

function monthsBetween(start: string, end: string | null): number | null {
  if (!end) return null;
  const a = new Date(start);
  const b = new Date(end);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** Assembles everything a contract's agreement PDF needs: the contract
 * itself, its client, its vehicle (plus current plate, read the same way
 * contracts/page.tsx does), and the category's active clause templates.
 * Returns null if the contract, its category, or a required relation is
 * missing. */
export async function fetchAgreementData(
  supabase: Supabase,
  contractId: string
): Promise<AgreementData | { error: string }> {
  const { data: contract } = await supabase
    .from("contracts")
    .select(
      `contract_type, deal_number, start_date, end_date, installment_amount, residual_value,
       annual_escalation_pct, startup_fee_total, startup_fee_account_admin_monthly, startup_fee_credit_bureau,
       startup_fee_gps_monthly, startup_fee_gps_unit_installation, startup_fee_initiation,
       startup_fee_pre_delivery_valet, startup_fee_registration_license, monthly_km_allowance,
       excess_km_rate, motor_plan, product_name, expected_end_value_inc_vat, client_id, vehicle_id`
    )
    .eq("id", contractId)
    .maybeSingle();
  if (!contract) return { error: "Contract not found" };

  const category = categoryForContractType(contract.contract_type);
  if (!category) return { error: `No agreement template for contract type "${contract.contract_type}"` };
  if (!contract.vehicle_id) return { error: "This contract has no vehicle assigned" };

  const [{ data: client }, { data: vehicle }, { data: registration }, { data: clauses }] = await Promise.all([
    supabase
      .from("clients")
      .select("full_name, id_number, cell_number, email, address")
      .eq("id", contract.client_id)
      .maybeSingle(),
    supabase
      .from("vehicles")
      .select("file_no, make, model, year, colour, vin, engine_number, current_mileage, license_disc_expiry")
      .eq("id", contract.vehicle_id)
      .maybeSingle(),
    supabase
      .from("vehicle_registrations")
      .select("plate_number")
      .eq("vehicle_id", contract.vehicle_id)
      .is("effective_to", null)
      .maybeSingle(),
    supabase
      .from("contract_clause_templates")
      .select("heading, body")
      .eq("category", category)
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  if (!client) return { error: "Client not found" };
  if (!vehicle) return { error: "Vehicle not found" };

  const contractTypeLabel =
    category === "rent_to_own" ? "Rent to Own Agreement" : "Vehicle Rental Agreement";

  return {
    contractTypeLabel,
    dealNumber: contract.deal_number,
    startDate: contract.start_date,
    endDate: contract.end_date,
    termMonths: monthsBetween(contract.start_date, contract.end_date),
    installmentAmount: contract.installment_amount,
    residualValue: contract.residual_value,
    annualEscalationPct: contract.annual_escalation_pct,
    startupFeeTotal: contract.startup_fee_total,
    startupFeeAccountAdminMonthly: contract.startup_fee_account_admin_monthly,
    startupFeeCreditBureau: contract.startup_fee_credit_bureau,
    startupFeeGpsMonthly: contract.startup_fee_gps_monthly,
    startupFeeGpsUnitInstallation: contract.startup_fee_gps_unit_installation,
    startupFeeInitiation: contract.startup_fee_initiation,
    startupFeePreDeliveryValet: contract.startup_fee_pre_delivery_valet,
    startupFeeRegistrationLicense: contract.startup_fee_registration_license,
    monthlyKmAllowance: contract.monthly_km_allowance,
    excessKmRate: contract.excess_km_rate,
    motorPlan: contract.motor_plan,
    productName: contract.product_name,
    expectedEndValueIncVat: contract.expected_end_value_inc_vat,
    client: {
      fullName: client.full_name,
      idNumber: client.id_number,
      cellNumber: client.cell_number,
      email: client.email,
      address: client.address,
    },
    vehicle: {
      fileNo: vehicle.file_no,
      regNumber: registration?.plate_number ?? null,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      colour: vehicle.colour,
      vin: vehicle.vin,
      engineNumber: vehicle.engine_number,
      currentMileage: vehicle.current_mileage,
      licenseDiscExpiry: vehicle.license_disc_expiry,
    },
    clauses: (clauses ?? []).map((c) => ({ heading: c.heading, body: c.body })),
    generatedAt: new Date().toISOString(),
  };
}
