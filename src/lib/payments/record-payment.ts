import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, PaymentMethod } from "@/lib/database.types";

export interface RecordPaymentInput {
  contractId: string;
  /** ISO yyyy-mm-dd. */
  transactionDate: string;
  amount: number;
  paymentMethod?: PaymentMethod | null;
  /** A real bank/debit-order reference, if known. Auto-generated when omitted. */
  reference?: string | null;
  /** Shows up in payment_transactions.source — which caller recorded this. */
  source: "manual" | "batch_update" | "bank_statement";
}

export interface RecordPaymentResult {
  id?: string;
  error?: string;
}

function generateReference(): string {
  return `MANUAL-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/**
 * invoice_reference ties a payment to a billing period (see SPEC.md §4) —
 * there's no real invoicing system behind it, just the key that groups a
 * period's receipt with any reversal/re-attempt against it. For a fresh
 * manual/batch payment we derive one from the contract + the month being
 * paid for, rather than asking the caller to invent one.
 */
function billingPeriodReference(dealNumber: string | null, contractId: string, transactionDate: string): string {
  return `${dealNumber ?? contractId}-${transactionDate.slice(0, 7)}`;
}

/**
 * Inserts a payment_transactions row ("receipt" — a successful collection;
 * recording a reversal/debit-note is a separate, unbuilt workflow since it
 * needs to link back to the receipt it reverses).
 *
 * Shared core so the manual "Add payment" UI, a future batch payment-update
 * script and a future bank-statement parser all go through the same
 * reference/invoice_reference generation and insert instead of each
 * duplicating it — only `source` (and how each caller gets its Supabase
 * client: cookie-based for the web UI, service-role for scripts) differs.
 */
export async function recordPayment(
  supabase: SupabaseClient<Database>,
  input: RecordPaymentInput
): Promise<RecordPaymentResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { error: "Amount must be greater than zero" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate)) {
    return { error: "Invalid transaction date" };
  }

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("deal_number")
    .eq("id", input.contractId)
    .maybeSingle();
  if (contractError || !contract) return { error: "Contract not found" };

  const invoiceReference = billingPeriodReference(contract.deal_number, input.contractId, input.transactionDate);
  const explicitReference = input.reference?.trim() || null;

  // Up to two attempts: a self-generated reference colliding (astronomically
  // unlikely — timestamp + random suffix) gets one retry with a fresh one.
  // A caller-supplied reference colliding is a real duplicate, not something
  // to paper over, so that never retries.
  for (let attempt = 0; attempt < 2; attempt++) {
    const reference = explicitReference ?? generateReference();
    const { data, error } = await supabase
      .from("payment_transactions")
      .insert({
        contract_id: input.contractId,
        transaction_date: input.transactionDate,
        type: "receipt",
        reference,
        invoice_reference: invoiceReference,
        amount: input.amount,
        cash_effect: input.amount,
        payment_method: input.paymentMethod ?? null,
        source: input.source,
      })
      .select("id")
      .single();

    if (!error) return { id: data.id };

    if (error.code === "23505") {
      if (!explicitReference && attempt === 0) continue;
      return { error: "A payment with that reference already exists for this billing period" };
    }
    return { error: "Couldn't record the payment" };
  }

  return { error: "Couldn't record the payment" };
}
