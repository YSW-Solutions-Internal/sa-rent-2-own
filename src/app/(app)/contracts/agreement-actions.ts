"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import { fetchAgreementData } from "@/lib/contracts/pdf/fetch-agreement-data";
import { renderAgreementPdf } from "@/lib/contracts/pdf/render";

const AGREEMENT_BUCKET = "contract-agreements";

export interface AgreementResult {
  error?: string;
  url?: string;
}

/** Generates the as-signed agreement PDF and stores it at the contract's
 * stable path, recording it on contracts.agreement_file_path. Called
 * right after a new contract is created; also callable on demand for a
 * contract that has none yet (e.g. one created before this feature, or a
 * first attempt that failed). Does not overwrite an existing stored copy
 * - that's what regenerateAgreementPreview is for. */
export async function generateContractAgreement(contractId: string): Promise<AgreementResult> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("contracts")
    .select("agreement_file_path")
    .eq("id", contractId)
    .maybeSingle();
  if (existing?.agreement_file_path) {
    return { error: "This contract already has a stored agreement" };
  }

  const data = await fetchAgreementData(supabase, contractId);
  if ("error" in data) return { error: data.error };

  const pdf = await renderAgreementPdf(data.category, data);
  const path = `${contractId}/agreement.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(AGREEMENT_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf" });
  if (uploadError) return { error: `Couldn't store the agreement: ${uploadError.message}` };

  const { error: updateError } = await supabase
    .from("contracts")
    .update({ agreement_file_path: path })
    .eq("id", contractId);
  if (updateError) return { error: "Agreement stored, but couldn't be linked to the contract" };

  revalidatePath("/contracts");
  return {};
}

/** Signed URL for the stored as-signed agreement. filePath is the
 * contract's own agreement_file_path, already known client-side (same
 * pattern as vehicles/cost-actions.ts's getInvoiceUrl). */
export async function getStoredAgreementUrl(filePath: string): Promise<AgreementResult> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from(AGREEMENT_BUCKET).createSignedUrl(filePath, 60);
  if (error || !data) return { error: "Couldn't open the agreement" };
  return { url: data.signedUrl };
}

/** Renders a fresh agreement from the contract's current data and stores
 * it at a fixed "preview" path (upserted each time, never the as-signed
 * original), returning a signed URL to it. For contracts whose data has
 * changed since the original was generated, or any contract type that
 * predates this feature and has no stored original yet. */
export async function regenerateAgreementPreview(contractId: string): Promise<AgreementResult> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const data = await fetchAgreementData(supabase, contractId);
  if ("error" in data) return { error: data.error };

  const pdf = await renderAgreementPdf(data.category, data);
  const path = `${contractId}/preview.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(AGREEMENT_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (uploadError) return { error: `Couldn't render a preview: ${uploadError.message}` };

  const { data: signed, error: signError } = await supabase.storage.from(AGREEMENT_BUCKET).createSignedUrl(path, 60);
  if (signError || !signed) return { error: "Couldn't open the preview" };
  return { url: signed.signedUrl };
}
