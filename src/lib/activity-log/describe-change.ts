import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { AuditAction } from "@/lib/database.types";
import { formatDisplayDate } from "@/lib/date-ranges";
import { VEHICLE_STATUS_LABELS } from "@/lib/vehicle-status";

/**
 * Activity log (SPEC item 39) Phase 2: turns a raw audit_log row into
 * something a person can read, without any DB access of its own (it's a
 * pure function over the diff it's given — Phase 3's UI resolves
 * `changed_by` to a name and calls this for the record/field text).
 *
 * Scope for v1 (per the Phase 2 plan): curated field labels/formatters for
 * vehicles, clients, contracts, vehicle_costs and client_banking_details —
 * the tables the app's modals actually show. Every other audited table
 * (insurance_claims, sale_listings, rental_payment_periods, profiles,
 * vehicle_registrations, vehicle_assignments, contract_vehicle_assignments,
 * payment_transactions, record_notes) falls back to a humanized version of
 * the raw field name and a plain string value — not pretty, but not a wall
 * of raw JSON either.
 */

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface DescribedAuditEntry {
  /** One-line summary — the only thing shown for insert/delete/reveal, and
   * a fallback label for update (e.g. "Banking details updated") in cases
   * where individual field changes are deliberately never itemized. */
  summary: string;
  /** Per-field changes for an `update`. Empty for insert/delete/reveal,
   * and for tables (client_banking_details, record_notes) whose changes
   * are never itemized even on update. */
  changes: FieldChange[];
}

type FormatterFn = (value: unknown) => string;

// ---- Formatter primitives --------------------------------------------

const text: FormatterFn = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

const currency: FormatterFn = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);
};

const number: FormatterFn = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-ZA").format(n);
};

const date: FormatterFn = (v) => formatDisplayDate(typeof v === "string" ? v : null);

const bool: FormatterFn = (v) => (v === true ? "Yes" : v === false ? "No" : "—");

/** Never shown verbatim — used for the few fields worth acknowledging
 * changed without reproducing their (often long, or sensitive) content. */
const redacted: FormatterFn = (v) => (v === null || v === undefined || v === "" ? "—" : "(changed)");

function enumLabel(labels: Record<string, string>): FormatterFn {
  return (v) => {
    if (v === null || v === undefined || v === "") return "—";
    return labels[String(v)] ?? String(v);
  };
}

// ---- Enum label maps not already shared elsewhere ---------------------
// VEHICLE_STATUS_LABELS and ROLE_LABELS are imported above; the rest are
// small and table-specific enough that duplicating them here (rather than
// importing from a page component, which would pull a client bundle into
// this server-only module) is the simpler choice.

const TRACKER_LABELS: Record<string, string> = { yes: "Yes", no: "No", no_info: "No info" };
const INSURANCE_CLAIM_STATUS_LABELS: Record<string, string> = {
  none: "None",
  pending: "Pending",
  paid: "Paid",
  denied: "Denied",
};
const CONTRACT_TYPE_LABELS: Record<string, string> = {
  rent_to_own: "Rent-to-own",
  short_term_rental: "Short-term rental",
  rental: "Rental",
  other: "Other",
};
const CONTRACT_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  defaulted: "Defaulted",
  repossessed: "Repossessed",
};
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  debit_order: "Debit order",
  eft: "EFT",
  cash: "Cash",
  other: "Other",
};
const BILLING_DIRECTION_LABELS: Record<string, string> = { advance: "Pays ahead", arrears: "Pays in arrears" };
const BILLING_FREQUENCY_LABELS: Record<string, string> = { weekly: "Weekly", monthly: "Monthly" };
const BILLING_STATUS_LABELS: Record<string, string> = { active: "Active", paused: "Paused", stopped: "Stopped" };
const COST_TYPE_LABELS: Record<string, string> = {
  service: "Service",
  repair: "Repair",
  car_wash: "Car wash",
  maintenance: "Maintenance",
  other: "Other",
};
const COST_SOURCE_LABELS: Record<string, string> = { web: "Web", whatsapp: "WhatsApp" };

// ---- Per-table field configuration -------------------------------------

interface FieldConfig {
  label: string;
  format: FormatterFn;
}

/** Fields never worth showing regardless of table: internal bookkeeping,
 * not something a person reading "what changed" cares about. */
const UNIVERSAL_SKIP = new Set(["id", "created_at", "updated_at"]);

const VEHICLE_FIELDS: Record<string, FieldConfig> = {
  file_no: { label: "File number", format: text },
  make: { label: "Make", format: text },
  model: { label: "Model", format: text },
  year: { label: "Year", format: text },
  colour: { label: "Colour", format: text },
  vin: { label: "VIN", format: text },
  engine_number: { label: "Engine number", format: text },
  status: { label: "Status", format: enumLabel(VEHICLE_STATUS_LABELS) },
  assigned_to_name: { label: "Assigned to", format: text },
  current_mileage: { label: "Current mileage", format: number },
  next_service_km: { label: "Next service km", format: number },
  next_service_date: { label: "Next service date", format: date },
  last_serviced_by: { label: "Last serviced by", format: text },
  tracker_supplier: { label: "Tracker supplier", format: text },
  tracker_running: { label: "Tracker running", format: enumLabel(TRACKER_LABELS) },
  natis_on_file: { label: "NATIS on file", format: bool },
  license_disc_expiry: { label: "Licence disc expiry", format: date },
  has_spare_key: { label: "Has spare key", format: bool },
  warranty_active: { label: "Warranty active", format: bool },
  warranty_notes: { label: "Warranty notes", format: text },
  has_contract_file: { label: "Has contract file", format: bool },
  insurance_claim_status: { label: "Insurance claim status", format: enumLabel(INSURANCE_CLAIM_STATUS_LABELS) },
  // Internal/not independently meaningful — skipped rather than configured:
  // legacy_status_note (raw import text, superseded by status),
  // assigned_to (uuid; assigned_to_name above is the readable form).
};
const VEHICLE_SKIP = new Set(["legacy_status_note", "assigned_to"]);

const CLIENT_FIELDS: Record<string, FieldConfig> = {
  full_name: { label: "Full name", format: text },
  id_number: { label: "ID number", format: redacted },
  cell_number: { label: "Cell number", format: text },
  alt_cell_number: { label: "Alt cell number", format: text },
  email: { label: "Email", format: text },
  address: { label: "Address", format: text },
  notes: { label: "Notes", format: redacted },
  blacklisted: { label: "Blacklisted", format: bool },
  blacklist_reason: { label: "Blacklist reason", format: text },
};

const CONTRACT_FIELDS: Record<string, FieldConfig> = {
  deal_number: { label: "Deal number", format: text },
  statement_tag: { label: "Statement tag", format: text },
  contract_type: { label: "Contract type", format: enumLabel(CONTRACT_TYPE_LABELS) },
  start_date: { label: "Start date", format: date },
  end_date: { label: "End date", format: date },
  status: { label: "Status", format: enumLabel(CONTRACT_STATUS_LABELS) },
  payment_method: { label: "Payment method", format: enumLabel(PAYMENT_METHOD_LABELS) },
  installment_amount: { label: "Installment", format: currency },
  purchase_price: { label: "Purchase price", format: currency },
  potential_sale_price: { label: "Potential sale price", format: currency },
  sale_price: { label: "Sale price", format: currency },
  residual_value: { label: "Residual value", format: currency },
  total_collected: { label: "Total collected", format: currency },
  outstanding_balance: { label: "Outstanding balance", format: currency },
  arrears_amount: { label: "Arrears amount", format: currency },
  is_paid_up: { label: "Paid up", format: bool },
  notes: { label: "Notes", format: redacted },
  billing_day: { label: "Billing day", format: text },
  billing_direction: { label: "Billing direction", format: enumLabel(BILLING_DIRECTION_LABELS) },
  billing_frequency: { label: "Billing frequency", format: enumLabel(BILLING_FREQUENCY_LABELS) },
  billing_status: { label: "Billing status", format: enumLabel(BILLING_STATUS_LABELS) },
  // vehicle_id/client_id are uuids with no name available here — the
  // vehicle side already gets its own dedicated history via
  // contract_vehicle_assignments (SPEC §4), surfaced separately.
};
const CONTRACT_SKIP = new Set(["vehicle_id", "client_id"]);

const VEHICLE_COST_FIELDS: Record<string, FieldConfig> = {
  cost_type: { label: "Cost type", format: enumLabel(COST_TYPE_LABELS) },
  cost_date: { label: "Cost date", format: date },
  supplier: { label: "Supplier", format: text },
  amount: { label: "Amount", format: currency },
  mileage_at_time: { label: "Mileage at time", format: number },
  work_done: { label: "Work done", format: text },
  notes: { label: "Notes", format: redacted },
  source: { label: "Source", format: enumLabel(COST_SOURCE_LABELS) },
  // vehicle_id/recorded_by are uuids with no name available here;
  // invoice_file_path is a storage path, not meaningful on its own.
};
const VEHICLE_COST_SKIP = new Set(["vehicle_id", "recorded_by", "invoice_file_path"]);

const PROFILE_FIELDS: Record<string, FieldConfig> = {
  full_name: { label: "Full name", format: text },
  phone: { label: "Phone", format: text },
  email: { label: "Email", format: text },
  role: { label: "Role", format: enumLabel(ROLE_LABELS) },
  is_active: { label: "Active", format: bool },
};

const TABLE_CONFIG: Record<string, { fields: Record<string, FieldConfig>; skip?: Set<string> }> = {
  vehicles: { fields: VEHICLE_FIELDS, skip: VEHICLE_SKIP },
  clients: { fields: CLIENT_FIELDS },
  contracts: { fields: CONTRACT_FIELDS, skip: CONTRACT_SKIP },
  vehicle_costs: { fields: VEHICLE_COST_FIELDS, skip: VEHICLE_COST_SKIP },
  profiles: { fields: PROFILE_FIELDS },
};

/** Tables whose changes are never itemized field-by-field, however they
 * were made — the content itself is either sensitive (banking) or free
 * text that's long/better read in its own place (a note's own text is
 * already visible right next to this log entry). */
const NEVER_ITEMIZE = new Set(["client_banking_details", "record_notes"]);

const TABLE_DISPLAY_NAMES: Record<string, string> = {
  vehicles: "Vehicle",
  clients: "Client",
  contracts: "Contract",
  vehicle_costs: "Cost entry",
  client_banking_details: "Banking details",
  record_notes: "Note",
  profiles: "Staff profile",
  insurance_claims: "Insurance claim",
  sale_listings: "Sale listing",
  rental_payment_periods: "Rental payment period",
  vehicle_registrations: "Vehicle registration",
  vehicle_assignments: "Vehicle assignment",
  contract_vehicle_assignments: "Contract vehicle assignment",
  payment_transactions: "Payment transaction",
};

function displayName(tableName: string): string {
  return TABLE_DISPLAY_NAMES[tableName] ?? humanize(tableName);
}

function humanize(field: string): string {
  const spaced = field.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function fieldConfigFor(tableName: string, field: string): FieldConfig {
  return TABLE_CONFIG[tableName]?.fields[field] ?? { label: humanize(field), format: text };
}

function isSkipped(tableName: string, field: string): boolean {
  if (UNIVERSAL_SKIP.has(field)) return true;
  return TABLE_CONFIG[tableName]?.skip?.has(field) ?? false;
}

// ---- Main entry point ---------------------------------------------------

export function describeAuditEntry(tableName: string, action: AuditAction, diff: unknown): DescribedAuditEntry {
  const name = displayName(tableName);

  if (action === "reveal") {
    // Only ever written for client_banking_details (SPEC §4) — a plain,
    // specific message reads better than the generic "<name> viewed" template.
    return { summary: "Banking details revealed", changes: [] };
  }
  if (action === "insert") {
    return { summary: `${name} created`, changes: [] };
  }
  if (action === "delete") {
    return { summary: `${name} deleted`, changes: [] };
  }

  // action === "update"
  const record = diff as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null | undefined;
  const before = record?.before ?? {};
  const after = record?.after ?? {};

  if (NEVER_ITEMIZE.has(tableName)) {
    return { summary: `${name} updated`, changes: [] };
  }

  const changes: FieldChange[] = [];
  for (const field of Object.keys(after)) {
    if (isSkipped(tableName, field)) continue;
    const beforeValue = before[field];
    const afterValue = after[field];
    if (beforeValue === afterValue) continue;
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;

    const config = fieldConfigFor(tableName, field);
    changes.push({
      field,
      label: config.label,
      before: config.format(beforeValue),
      after: config.format(afterValue),
    });
  }

  return {
    summary: changes.length > 0 ? `${name} updated` : `${name} updated (no visible field changes)`,
    changes,
  };
}
