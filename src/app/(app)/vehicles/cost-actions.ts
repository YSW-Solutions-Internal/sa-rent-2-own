"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { requireAdmin } from "@/lib/auth/require-role";
import { vehicleCostFormSchema, type VehicleCost } from "./costs-schema";

export interface ActionResult {
  error?: string;
}

const INVOICE_BUCKET = "vehicle-invoices";
const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

export async function listVehicleCosts(
  vehicleId: string
): Promise<{ data?: VehicleCost[]; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("vehicle_costs")
    .select("id, cost_type, cost_date, supplier, amount, mileage_at_time, invoice_file_path, work_done, notes, source, recorded_by")
    .eq("vehicle_id", vehicleId)
    .order("cost_date", { ascending: false });

  if (error) return { error: "Couldn't load cost history" };

  const ids = [...new Set((data ?? []).map((c) => c.recorded_by).filter((id): id is string => !!id))];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  return {
    data: (data ?? []).map(({ recorded_by, ...cost }) => ({
      ...cost,
      recorded_by_name: recorded_by ? (names.get(recorded_by) ?? null) : null,
    })),
  };
}

export async function createVehicleCost(
  vehicleId: string,
  formData: FormData
): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authorized" };

  const parsed = vehicleCostFormSchema.safeParse({
    costType: formData.get("costType"),
    costDate: formData.get("costDate"),
    supplier: formData.get("supplier") || undefined,
    amount: formData.get("amount"),
    mileageAtTime: formData.get("mileageAtTime") || undefined,
    workDone: formData.get("workDone") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const values = parsed.data;
  const amount = Number(values.amount);
  if (!Number.isFinite(amount)) {
    return { error: "Amount must be a number" };
  }

  const supabase = await createSupabaseServerClient();

  let invoiceFilePath: string | null = null;
  const file = formData.get("invoice");
  if (file instanceof File && file.size > 0) {
    if (file.type !== "application/pdf") {
      return { error: "Invoice must be a PDF" };
    }
    if (file.size > MAX_INVOICE_BYTES) {
      return { error: "Invoice is too big (10MB max)" };
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `${vehicleId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from(INVOICE_BUCKET)
      .upload(path, file, { contentType: file.type || "application/pdf" });
    if (uploadError) {
      return { error: `Couldn't upload invoice: ${uploadError.message}` };
    }
    invoiceFilePath = path;
  }

  const { error } = await supabase.from("vehicle_costs").insert({
    vehicle_id: vehicleId,
    cost_type: values.costType,
    cost_date: values.costDate,
    supplier: values.supplier || null,
    amount,
    mileage_at_time: values.mileageAtTime ? Number(values.mileageAtTime) : null,
    invoice_file_path: invoiceFilePath,
    work_done: values.workDone || null,
    notes: values.notes || null,
    recorded_by: profile.id,
  });

  if (error) {
    return { error: "Couldn't save the cost entry" };
  }

  revalidatePath("/vehicles");
  return {};
}

export async function deleteVehicleCost(costId: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const { data: cost } = await supabase
    .from("vehicle_costs")
    .select("invoice_file_path")
    .eq("id", costId)
    .maybeSingle();

  const { error } = await supabase.from("vehicle_costs").delete().eq("id", costId);
  if (error) {
    return { error: "Couldn't delete the cost entry" };
  }

  if (cost?.invoice_file_path) {
    await supabase.storage.from(INVOICE_BUCKET).remove([cost.invoice_file_path]);
  }

  revalidatePath("/vehicles");
  return {};
}

export async function getInvoiceUrl(
  filePath: string
): Promise<{ url?: string; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from(INVOICE_BUCKET)
    .createSignedUrl(filePath, 60);

  if (error || !data) return { error: "Couldn't open the invoice" };
  return { url: data.signedUrl };
}
