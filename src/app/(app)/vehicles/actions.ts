"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import type { VehicleStatus } from "@/lib/database.types";
import { VEHICLE_COLOUR_OPTIONS } from "@/lib/vehicle-colours";
import { vehicleFormSchema, vehicleStatusValues, type VehicleFormValues } from "./schema";

export interface ActionResult {
  error?: string;
  /** Set by create actions: the new record's id. */
  id?: string;
}

function toInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toVehicleRow(values: VehicleFormValues) {
  return {
    file_no: values.fileNo,
    make: values.make || null,
    model: values.model || null,
    year: toInt(values.year),
    colour: values.colour || null,
    vin: values.vin || null,
    engine_number: values.engineNumber || null,
    status: values.status,
    current_mileage: toInt(values.currentMileage),
    next_service_km: toInt(values.nextServiceKm),
    next_service_date: values.nextServiceDate || null,
    last_serviced_by: values.lastServicedBy || null,
    tracker_supplier: values.trackerSupplier || null,
    tracker_running: values.trackerRunning,
    natis_on_file: values.natisOnFile ?? false,
    license_disc_expiry: values.licenseDiscExpiry || null,
    has_spare_key: values.hasSpareKey ?? false,
    warranty_active: values.warrantyActive ?? false,
    warranty_notes: values.warrantyNotes || null,
    has_contract_file: values.hasContractFile ?? false,
  };
}

export async function createVehicle(raw: VehicleFormValues): Promise<ActionResult> {
  await requireAdmin();
  const parsed = vehicleFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const values = parsed.data;

  const supabase = await createClient();
  const { data: vehicle, error } = await supabase
    .from("vehicles")
    .insert(toVehicleRow(values))
    .select("id")
    .single();

  if (error || !vehicle) {
    return { error: error?.message.includes("duplicate") ? "That file number is already in use" : "Couldn't create the vehicle" };
  }

  const { error: regError } = await supabase.from("vehicle_registrations").insert({
    vehicle_id: vehicle.id,
    plate_number: values.plateNumber,
  });

  if (regError) {
    return { error: "Vehicle created, but couldn't record the registration" };
  }

  revalidatePath("/vehicles");
  revalidatePath("/contracts");
  return { id: vehicle.id };
}

export async function updateVehicle(
  vehicleId: string,
  raw: VehicleFormValues
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = vehicleFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const values = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicles")
    .update(toVehicleRow(values))
    .eq("id", vehicleId);

  if (error) {
    return { error: "Couldn't update the vehicle" };
  }

  // Only touch registration history if the plate actually changed, so we
  // don't create a no-op history entry on every unrelated edit.
  const { data: current } = await supabase
    .from("vehicle_registrations")
    .select("id, plate_number")
    .eq("vehicle_id", vehicleId)
    .is("effective_to", null)
    .maybeSingle();

  if (!current || current.plate_number !== values.plateNumber) {
    const today = new Date().toISOString().slice(0, 10);
    if (current) {
      await supabase
        .from("vehicle_registrations")
        .update({ effective_to: today })
        .eq("id", current.id);
    }
    await supabase.from("vehicle_registrations").insert({
      vehicle_id: vehicleId,
      plate_number: values.plateNumber,
      effective_from: today,
      reason: current ? "Plate changed" : undefined,
    });
  }

  revalidatePath("/vehicles");
  return {};
}

// Lightweight single-field updates for the Vehicles table's inline status/
// colour editors — avoid routing through the full vehicleFormSchema, which
// requires fields (plate number, etc.) the inline editors don't touch.

export async function updateVehicleStatus(
  vehicleId: string,
  status: VehicleStatus
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = z.enum(vehicleStatusValues).safeParse(status);
  if (!parsed.success) {
    return { error: "Invalid status" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicles")
    .update({ status: parsed.data })
    .eq("id", vehicleId);

  if (error) {
    return { error: "Couldn't update status" };
  }

  revalidatePath("/vehicles");
  return {};
}

export async function updateVehicleColour(vehicleId: string, colour: string): Promise<ActionResult> {
  await requireAdmin();
  const parsed = z.enum(VEHICLE_COLOUR_OPTIONS as [string, ...string[]]).safeParse(colour);
  if (!parsed.success) {
    return { error: "Invalid colour" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicles")
    .update({ colour: parsed.data })
    .eq("id", vehicleId);

  if (error) {
    return { error: "Couldn't update colour" };
  }

  revalidatePath("/vehicles");
  return {};
}

/** Fields the Vehicles table lets you edit by clicking the value. */
const inlineEditableFields = ["current_mileage", "next_service_km", "next_service_date"] as const;
export type InlineEditableField = (typeof inlineEditableFields)[number];

/**
 * Updates one of the inline-editable service/mileage fields. `raw` is the
 * input's string value: "" clears the field; numbers must be whole and
 * non-negative; the date must be an ISO yyyy-mm-dd.
 */
export async function updateVehicleInlineField(
  vehicleId: string,
  field: InlineEditableField,
  raw: string
): Promise<ActionResult> {
  await requireAdmin();
  if (!inlineEditableFields.includes(field)) return { error: "Invalid field" };

  const trimmed = raw.trim();
  let value: number | string | null;
  if (field === "next_service_date") {
    if (trimmed === "") value = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) value = trimmed;
    else return { error: "Enter a valid date" };
  } else if (trimmed === "") {
    value = null;
  } else {
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) return { error: "Enter a whole number, 0 or more" };
    value = n;
  }

  const patch =
    field === "next_service_date"
      ? { next_service_date: value as string | null }
      : field === "current_mileage"
        ? { current_mileage: value as number | null }
        : { next_service_km: value as number | null };

  const supabase = await createClient();
  const { error } = await supabase.from("vehicles").update(patch).eq("id", vehicleId);

  if (error) return { error: "Couldn't save the change" };

  revalidatePath("/vehicles");
  return {};
}

export async function deleteVehicle(vehicleId: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("vehicles").delete().eq("id", vehicleId);

  if (error) {
    return {
      error: error.code === "23503"
        ? "Can't delete a vehicle with contracts on it — end or reassign the contract first"
        : "Couldn't delete the vehicle",
    };
  }

  revalidatePath("/vehicles");
  return {};
}
