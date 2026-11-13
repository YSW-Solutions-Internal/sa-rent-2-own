"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canSeeFinancials } from "@/lib/auth/permissions";
import { requireAdmin } from "@/lib/auth/require-role";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { recordPayment } from "@/lib/payments/record-payment";
import type { PaymentMethod, PaymentTransactionType } from "@/lib/database.types";

import { paymentMethodValues } from "./schema";

export interface ActionResult {
  error?: string;
}

export interface ContractPaymentHistoryEntry {
  id: string;
  transaction_date: string;
  type: PaymentTransactionType;
  reference: string;
  invoice_reference: string;
  amount: number;
  cash_effect: number;
  payment_method: PaymentMethod | null;
  reversed: boolean;
}

export async function listContractPaymentHistory(
  contractId: string
): Promise<{ data?: ContractPaymentHistoryEntry[]; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authorized" };

  const supabase = await createSupabaseServerClient();

  // Cash payments are hidden from Fleet Managers everywhere.
  if (!canSeeFinancials(profile.role)) {
    const { data: contract } = await supabase
      .from("contracts")
      .select("payment_method")
      .eq("id", contractId)
      .maybeSingle();
    if (contract?.payment_method === "cash") return { data: [] };
  }

  const { data, error } = await supabase
    .from("payment_transactions")
    .select(
      "id, transaction_date, type, reference, invoice_reference, amount, cash_effect, payment_method, reversed_transaction_id"
    )
    .eq("contract_id", contractId)
    .order("transaction_date", { ascending: false });

  if (error) return { error: "Couldn't load payment history" };

  const rows: ContractPaymentHistoryEntry[] = (data ?? []).map((t) => ({
    id: t.id,
    transaction_date: t.transaction_date,
    type: t.type,
    reference: t.reference,
    invoice_reference: t.invoice_reference,
    amount: t.amount,
    cash_effect: t.cash_effect,
    payment_method: t.payment_method,
    reversed: t.reversed_transaction_id !== null,
  }));

  return { data: rows };
}

/**
 * Manually capture a payment against a contract — admin only, same as every
 * other write to this financial ledger (payment_transactions' own RLS policy
 * technically allows Fleet Managers too, but the app enforces admin-only in
 * every mutating action, same as contracts/vehicles/clients).
 */
export async function createManualPayment(
  contractId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();

  const transactionDate = String(formData.get("transactionDate") ?? "");
  const amount = Number(formData.get("amount"));
  const paymentMethodRaw = String(formData.get("paymentMethod") ?? "");
  const reference = String(formData.get("reference") ?? "").trim() || null;

  const paymentMethod = (paymentMethodValues as readonly string[]).includes(paymentMethodRaw)
    ? (paymentMethodRaw as PaymentMethod)
    : null;

  const supabase = await createSupabaseServerClient();
  const result = await recordPayment(supabase, {
    contractId,
    transactionDate,
    amount,
    paymentMethod,
    reference,
    source: "manual",
  });

  if (result.error) return { error: result.error };

  revalidatePath("/contracts");
  revalidatePath("/payments");
  return {};
}
