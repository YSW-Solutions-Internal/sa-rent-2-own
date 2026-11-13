"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canEdit } from "@/lib/auth/permissions";
import { normalizeSaPhone } from "@/lib/phone";

import { editStaffFormSchema, newStaffFormSchema } from "./schema";

export interface ActionResult {
  error?: string;
}

export async function createStaffUser(raw: unknown): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !canEdit(profile.role)) {
    return { error: "Not authorized" };
  }

  const parsed = newStaffFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const phone = normalizeSaPhone(parsed.data.phone);
  if (!phone) {
    return { error: "Enter a valid South African cell number" };
  }

  const admin = createAdminClient();
  // The admin sets the password here and hands it to the new user directly,
  // so there's no SMS/WhatsApp OTP step: the number is marked confirmed up
  // front and the account can log in with number + password straight away.
  // (Once OTP delivery is live, /setup-account still works for resets.)
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    phone,
    password: parsed.data.password,
    phone_confirm: true,
    // full_name is just display text, but role is a privilege decision — it
    // goes in app_metadata, not user_metadata, because only this
    // service-role call can ever set app_metadata; user_metadata can be set
    // by the account's own owner (even via a public signUp() call), and the
    // handle_new_auth_user trigger only trusts role from app_metadata for
    // exactly that reason (see migration 20261113120000).
    user_metadata: { full_name: parsed.data.fullName },
    app_metadata: { role: parsed.data.role },
  });

  if (createError) {
    return {
      error: createError.message.includes("already been registered")
        ? "That cell number already has an account"
        : "Couldn't create the account",
    };
  }

  // The profile row is created by a database trigger with no signed-in user behind it, so record
  // who created the account explicitly.
  await admin.from("audit_log").insert({
    table_name: "profiles",
    record_id: created.user?.id ?? null,
    action: "insert",
    changed_by: profile.id,
    source: "web",
    diff: { full_name: parsed.data.fullName, phone, role: parsed.data.role },
  });

  revalidatePath("/admin/users");
  return {};
}

export async function setStaffActive(userId: string, isActive: boolean): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !canEdit(profile.role)) {
    return { error: "Not authorized" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", userId);

  if (error) {
    return { error: "Couldn't update the account" };
  }

  revalidatePath("/admin/users");
  return {};
}

export async function setStaffWhatsAppAccess(userId: string, enabled: boolean): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !canEdit(profile.role)) {
    return { error: "Not authorized" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    // Turning the bot off also revokes finance access, so it can't be left
    // silently switched on behind a bot access that's since been removed
    // and later re-approved.
    .update(enabled ? { whatsapp_enabled: true } : { whatsapp_enabled: false, whatsapp_finance_enabled: false })
    .eq("id", userId);

  if (error) {
    return { error: "Couldn't update WhatsApp access" };
  }

  revalidatePath("/admin/users");
  return {};
}

export async function updateStaffUser(userId: string, raw: unknown): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !canEdit(profile.role)) {
    return { error: "Not authorized" };
  }

  const parsed = editStaffFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const phone = normalizeSaPhone(parsed.data.phone);
  if (!phone) {
    return { error: "Enter a valid South African cell number" };
  }

  if (userId === profile.id && parsed.data.role !== profile.role) {
    return { error: "You can't change your own role" };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("profiles")
    .select("phone, role")
    .eq("id", userId)
    .single();
  if (!existing) {
    return { error: "User not found" };
  }
  // Technician is retired from the UI: only keep it if the account already has it.
  if (parsed.data.role === "technician" && existing.role !== "technician") {
    return { error: "Technician can't be assigned any more" };
  }

  // The cell number is also the login identifier, so it has to change in
  // auth.users as well as on the profile.
  if (existing.phone !== phone) {
    const { error: authError } = await createAdminClient().auth.admin.updateUserById(userId, {
      phone,
      phone_confirm: true,
    });
    if (authError) {
      return {
        error: authError.message.toLowerCase().includes("already")
          ? "That cell number already has an account"
          : "Couldn't update the cell number",
      };
    }
  }

  const fullName = [parsed.data.firstName, parsed.data.surname].filter(Boolean).join(" ");
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      phone,
      role: parsed.data.role,
      whatsapp_enabled: parsed.data.role === "technician" ? false : parsed.data.whatsappEnabled,
      // Finance is a stricter sub-permission of the bot itself — never true
      // without whatsapp_enabled also being true.
      whatsapp_finance_enabled:
        parsed.data.role !== "technician" && parsed.data.whatsappEnabled ? parsed.data.whatsappFinanceEnabled : false,
    })
    .eq("id", userId);

  if (error) {
    return { error: "Couldn't update the account" };
  }

  revalidatePath("/admin/users");
  return {};
}

export interface ActivityEntry {
  id: string;
  at: string;
  kind: "audit" | "whatsapp";
  label: string;
  detail?: string;
}

const AUDIT_TABLE_LABELS: Record<string, string> = {
  contracts: "contract",
  client_banking_details: "client banking details",
  vehicle_costs: "vehicle cost",
  vehicles: "vehicle",
  clients: "client",
  vehicle_registrations: "vehicle registration",
  contract_vehicle_assignments: "contract vehicle assignment",
  rental_payment_periods: "rental payment period",
  payment_transactions: "payment",
  vehicle_assignments: "vehicle assignment",
  insurance_claims: "insurance claim",
  sale_listings: "sale listing",
  profiles: "user",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  insert: "Added",
  update: "Updated",
  delete: "Deleted",
  reveal: "Revealed",
};

export async function getStaffActivity(userId: string): Promise<{ error?: string; entries?: ActivityEntry[] }> {
  const profile = await getCurrentProfile();
  if (!profile || !canEdit(profile.role)) {
    return { error: "Not authorized" };
  }

  const supabase = await createClient();
  const [audit, messages] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, table_name, action, created_at")
      .eq("changed_by", userId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("whatsapp_messages")
      .select("id, direction, body, created_at")
      .eq("profile_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (audit.error || messages.error) {
    return { error: "Couldn't load the activity log" };
  }

  const entries: ActivityEntry[] = [
    ...(audit.data ?? []).map((row) => ({
      id: `a-${row.id}`,
      at: row.created_at,
      kind: "audit" as const,
      label: `${AUDIT_ACTION_LABELS[row.action] ?? row.action} ${AUDIT_TABLE_LABELS[row.table_name] ?? row.table_name}`,
    })),
    ...(messages.data ?? []).map((row) => ({
      id: `w-${row.id}`,
      at: row.created_at,
      kind: "whatsapp" as const,
      label: row.direction === "in" ? "Asked the WhatsApp bot" : "WhatsApp bot replied",
      detail: row.body.length > 160 ? `${row.body.slice(0, 160)}…` : row.body,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 100);

  return { entries };
}
