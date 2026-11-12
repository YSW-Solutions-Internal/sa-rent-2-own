"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import { syncVehicleAssignment } from "@/lib/vehicle-assignments";
import { DEAL_NUMBER_SCHEMES, nextDealNumber } from "./deal-number";
import { contractFormSchema, type ContractFormValues } from "./schema";

export interface ActionResult {
  error?: string;
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The surname-derived base for an auto-generated statement tag — the last
 * word of the client's name, letters only, uppercased. */
function extractSurnameTag(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? fullName;
  const letters = last.toUpperCase().replace(/[^A-Z]/g, "");
  return letters || "DEAL";
}

/** Statement tag auto-generation rule: surname, with the next free numeric
 * suffix (2, 3, ...) appended on collision against every other contract's
 * tag — not just this client's. Existing/backfilled contracts keep
 * whatever curated tag they already have; this only runs for new ones. */
async function generateStatementTag(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  clientId: string
): Promise<string> {
  const { data: client } = await supabase
    .from("clients")
    .select("full_name")
    .eq("id", clientId)
    .maybeSingle();
  const base = extractSurnameTag(client?.full_name ?? "DEAL");

  const { data: existing } = await supabase
    .from("contracts")
    .select("statement_tag")
    .not("statement_tag", "is", null)
    .ilike("statement_tag", `${base}%`);

  const taken = new Set((existing ?? []).map((r) => r.statement_tag?.toUpperCase()));
  if (!taken.has(base)) return base;

  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** Next deal number for a new contract of this type, or null for a
 * contract type with no numbering scheme (e.g. "other"). The actual
 * number-crunching is pure and lives in deal-number.ts (unit-tested there)
 * — a "use server" file can only export async functions, so it can't live
 * here. */
async function generateDealNumber(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  contractType: ContractFormValues["contractType"]
): Promise<string | null> {
  const scheme = DEAL_NUMBER_SCHEMES[contractType];
  if (!scheme) return null;

  const { data: existing } = await supabase
    .from("contracts")
    .select("deal_number")
    .ilike("deal_number", `${scheme.prefix}%`)
    .limit(5000);

  return nextDealNumber((existing ?? []).map((r) => r.deal_number), scheme);
}

/** Read-only preview of the deal number a new contract of this type would
 * get right now, shown in the "Add contract" form before anything is
 * saved. Best-effort: the real number is only locked in at insert time
 * (createContract retries on a collision), so two people creating a
 * contract of the same type at nearly the same moment could both be shown
 * the same preview, with the second actually getting the next one after
 * it. */
export async function previewDealNumber(
  contractType: ContractFormValues["contractType"]
): Promise<{ dealNumber: string | null }> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  return { dealNumber: await generateDealNumber(supabase, contractType) };
}

async function toContractRow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  values: ContractFormValues
) {
  const statementTag = values.statementTag || (await generateStatementTag(supabase, values.clientId));

  return {
    vehicle_id: values.vehicleId || null, // empty = no vehicle (see updateContract)
    client_id: values.clientId,
    contract_type: values.contractType,
    status: values.status,
    start_date: values.startDate,
    end_date: values.endDate || null,
    payment_method: values.paymentMethod,
    installment_amount: toNumber(values.installmentAmount),
    residual_value: toNumber(values.residualValue),
    // total_collected / outstanding_balance / arrears_amount are deliberately
    // not written here — removed from the capture form (SPEC item 5, 2026-11-09)
    // since they're legacy-import/running-balance figures, not something to
    // hand-edit on every save. Omitting them from the row leaves an existing
    // contract's values untouched on update, and new contracts get the
    // columns' own `default 0`. purchase_price / potential_sale_price /
    // sale_price moved to vehicles entirely (SPEC item 6, 2026-11-09).
    is_paid_up: values.isPaidUp ?? false,
    notes: values.notes || null,
    deal_number: values.dealNumber || null,
    statement_tag: statementTag,
    billing_day: toNumber(values.billingDay),
    billing_direction: values.billingDirection ?? "arrears",
    billing_frequency: values.billingFrequency ?? "monthly",
    billing_status: values.billingStatus ?? "active",
  };
}

function friendlyInsertError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    if (error.message.includes("contracts_deal_number_key")) {
      return "That deal number is already used on another contract";
    }
    if (error.message.includes("contracts_statement_tag_key")) {
      return "That statement tag is already used on another contract";
    }
    return "That vehicle already has an active contract — end it first";
  }
  if (error.code === "23503") {
    return "Selected vehicle or client no longer exists";
  }
  return "Couldn't save the contract";
}

export async function createContract(raw: ContractFormValues): Promise<ActionResult> {
  await requireAdmin();
  const parsed = contractFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const values = parsed.data;
  if (!values.vehicleId) return { error: "Select a vehicle" };

  const supabase = await createSupabaseServerClient();

  // An auto-generated deal number can collide if two contracts of the same
  // type are created at nearly the same moment (read-then-insert race on
  // the unique index) -- recompute and retry rather than surface a
  // confusing "that deal number is already used" error for a number the
  // person never typed themselves. A manually-typed one gets one attempt,
  // same as before.
  const maxAttempts = values.dealNumber ? 1 : 3;
  let contract: { id: string } | null = null;
  let error: { code?: string; message: string } | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const dealNumber = values.dealNumber || (await generateDealNumber(supabase, values.contractType));
    const row = await toContractRow(supabase, { ...values, dealNumber: dealNumber ?? undefined });
    ({ data: contract, error } = await supabase.from("contracts").insert(row).select("id").single());

    if (contract) break;
    const isDealNumberCollision = error?.code === "23505" && error.message.includes("contracts_deal_number_key");
    if (values.dealNumber || !isDealNumberCollision || attempt === maxAttempts) break;
  }

  if (error || !contract) {
    return { error: friendlyInsertError(error ?? { message: "unknown" }) };
  }

  const syncError = await syncVehicleAssignment(supabase, contract.id, values.vehicleId, values.startDate);
  if (syncError) {
    return { error: `Contract created, but ${syncError.charAt(0).toLowerCase()}${syncError.slice(1)}` };
  }

  revalidatePath("/contracts");
  revalidatePath("/vehicles");
  return {};
}

export async function updateContract(
  contractId: string,
  raw: ContractFormValues
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = contractFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const values = parsed.data;

  const supabase = await createSupabaseServerClient();

  // Swapping the vehicle: check the change date before touching anything.
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await supabase.from("contracts").select("vehicle_id").eq("id", contractId).maybeSingle();
  if (!existing) return { error: "Contract not found" };
  const vehicleChanged = (existing.vehicle_id ?? "") !== values.vehicleId;
  const changeDate = values.vehicleChangeDate || today;
  if (vehicleChanged) {
    if (changeDate > today) return { error: "The vehicle change date can't be in the future" };
    const { data: open } = await supabase
      .from("contract_vehicle_assignments")
      .select("effective_from")
      .eq("contract_id", contractId)
      .is("effective_to", null)
      .maybeSingle();
    if (open && changeDate < open.effective_from) {
      return { error: `The vehicle change date can't be before the current vehicle went on (${open.effective_from})` };
    }
  }

  const row = await toContractRow(supabase, values);
  const { error } = await supabase.from("contracts").update(row).eq("id", contractId);

  if (error) {
    return { error: friendlyInsertError(error) };
  }

  const syncError = await syncVehicleAssignment(
    supabase,
    contractId,
    values.vehicleId || null,
    changeDate,
    values.vehicleChangeReason
  );
  if (syncError) {
    // Put the contract back on its old vehicle so the two records agree.
    await supabase.from("contracts").update({ vehicle_id: existing.vehicle_id }).eq("id", contractId);
    return { error: `${syncError}. The vehicle was not changed.` };
  }

  revalidatePath("/contracts");
  revalidatePath("/vehicles");
  return {};
}

export async function deleteContract(contractId: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("contracts").delete().eq("id", contractId);

  if (error) {
    return {
      error: "Couldn't delete the contract",
    };
  }

  revalidatePath("/contracts");
  revalidatePath("/vehicles");
  return {};
}
