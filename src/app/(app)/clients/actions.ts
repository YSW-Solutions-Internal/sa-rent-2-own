"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-role";
import { encryptField, decryptField, lastFour } from "@/lib/crypto";
import { clientFormSchema, type ClientFormValues } from "./schema";

export interface ActionResult {
  error?: string;
  /** Set by create actions: the new record's id. */
  id?: string;
}

function toClientRow(values: ClientFormValues) {
  const blacklisted = Boolean(values.blacklisted);
  return {
    full_name: values.fullName,
    id_number: values.idNumber || null,
    cell_number: values.cellNumber,
    alt_cell_number: values.altCellNumber || null,
    email: values.email || null,
    address: values.address || null,
    notes: values.notes || null,
    blacklisted,
    blacklist_reason: blacklisted ? values.blacklistReason?.trim() || null : null,
  };
}

/**
 * Encrypts and writes banking details only when the form actually supplied
 * new account holder/number values — leaving those fields blank on an
 * edit keeps whatever's already on file untouched, since we never
 * round-trip decrypted values back into the form by default.
 */
async function upsertBankingDetailsIfProvided(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  clientId: string,
  values: ClientFormValues,
  createdBy: string
): Promise<string | null> {
  if (!values.accountHolderName || !values.accountNumber) {
    return null;
  }
  if (!values.bankName) {
    return "Bank name is required when adding banking details";
  }

  // Each field gets its own IV — AES-GCM requires a unique key+IV pair per
  // encryption; reusing one IV across two ciphertexts under the same key
  // would break both confidentiality and the authentication guarantee.
  const holderEncrypted = encryptField(values.accountHolderName);
  const numberEncrypted = encryptField(values.accountNumber);

  const { error } = await supabase.from("client_banking_details").upsert(
    {
      client_id: clientId,
      bank_name: values.bankName,
      account_type: values.accountType ?? "other",
      branch_code: values.branchCode || null,
      account_holder_name_encrypted: holderEncrypted.ciphertext,
      account_holder_name_iv: holderEncrypted.iv,
      account_number_encrypted: numberEncrypted.ciphertext,
      account_number_iv: numberEncrypted.iv,
      key_version: numberEncrypted.keyVersion,
      account_number_last4: lastFour(values.accountNumber),
      created_by: createdBy,
    },
    { onConflict: "client_id" }
  );

  return error ? "Client saved, but couldn't save banking details" : null;
}

export async function createClient(raw: ClientFormValues): Promise<ActionResult> {
  const profile = await requireAdmin();
  const parsed = clientFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const values = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: client, error } = await supabase
    .from("clients")
    .insert(toClientRow(values))
    .select("id")
    .single();

  if (error || !client) {
    return { error: "Couldn't create the client" };
  }

  const bankingError = await upsertBankingDetailsIfProvided(
    supabase,
    client.id,
    values,
    profile.id
  );
  if (bankingError) {
    return { error: bankingError };
  }

  revalidatePath("/clients");
  revalidatePath("/contracts");
  return { id: client.id };
}

export async function updateClient(
  clientId: string,
  raw: ClientFormValues
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const parsed = clientFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const values = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("clients")
    .update(toClientRow(values))
    .eq("id", clientId);

  if (error) {
    return { error: "Couldn't update the client" };
  }

  const bankingError = await upsertBankingDetailsIfProvided(
    supabase,
    clientId,
    values,
    profile.id
  );
  if (bankingError) {
    return { error: bankingError };
  }

  revalidatePath("/clients");
  return {};
}

export async function deleteClient(clientId: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("clients").delete().eq("id", clientId);

  if (error) {
    return {
      error: error.code === "23503"
        ? "Can't delete a client with contracts on them"
        : "Couldn't delete the client",
    };
  }

  revalidatePath("/clients");
  return {};
}

export interface RevealedBankingDetails {
  bankName: string;
  accountType: string;
  branchCode: string | null;
  accountHolderName: string;
  accountNumber: string;
}

export async function revealBankingDetails(
  clientId: string
): Promise<{ data?: RevealedBankingDetails; error?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const { data: row, error } = await supabase
    .from("client_banking_details")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error || !row) {
    return { error: "No banking details on file" };
  }

  const accountHolderName = decryptField({
    ciphertext: row.account_holder_name_encrypted,
    iv: row.account_holder_name_iv,
    keyVersion: row.key_version,
  });
  const accountNumber = decryptField({
    ciphertext: row.account_number_encrypted,
    iv: row.account_number_iv,
    keyVersion: row.key_version,
  });

  // audit_log has no insert policy for signed-in users, so this goes through the
  // service role. Fail closed: no log row, no reveal.
  const { error: auditError } = await createAdminClient().from("audit_log").insert({
    table_name: "client_banking_details",
    record_id: row.id,
    action: "reveal",
    changed_by: profile.id,
    source: "web",
  });
  if (auditError) {
    console.error("banking reveal: audit log write failed", auditError);
    return { error: "Couldn't record this view, so the details were not shown" };
  }

  return {
    data: {
      bankName: row.bank_name,
      accountType: row.account_type,
      branchCode: row.branch_code,
      accountHolderName,
      accountNumber,
    },
  };
}
