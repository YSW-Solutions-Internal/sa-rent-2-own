import "server-only";

import { z } from "zod";

import { canSeeFinancials, canViewContracts } from "@/lib/auth/permissions";
import type { UserRole } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Read-only fleet queries for the WhatsApp bot. These run with the service
 * role (no RLS), so every function here is the permission boundary: explicit
 * column lists, and role checks via the same helpers the pages use. Never
 * selected, whatever the role: ID numbers, cell numbers, banking details,
 * purchase / potential sale prices.
 */
export interface ToolContext {
  role: UserRole;
}

const FLEET_STATUSES = ["on_road", "parked", "in_repair", "for_sale", "str", "rental", "courtesy"] as const;
const ALL_STATUSES = [...FLEET_STATUSES, "sold", "written_off", "end_of_deal"] as const;

const MAX_ROWS = 25;
const MAX_MATCHES = 15;
const SEARCH_STOPWORDS = new Set(["the", "a", "my", "car", "cars", "vehicle", "vehicles", "bakkie", "with", "for", "of", "and", "is", "where"]);

const todayZA = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Letters/digits (and spaces) only, so user text can never reach a filter string. */
const clean = (s: string) => s.replace(/[^A-Za-z0-9 ]/g, "").trim();

const VEHICLE_COLUMNS =
  "id, file_no, make, model, year, colour, status, legacy_status_note, current_mileage, next_service_km, next_service_date, license_disc_expiry";

type VehicleRow = {
  id: string;
  file_no: string;
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  status: string;
  legacy_status_note: string | null;
  current_mileage: number | null;
  next_service_km: number | null;
  next_service_date: string | null;
  license_disc_expiry: string | null;
};

async function describeVehicles(vehicles: VehicleRow[], ctx: ToolContext) {
  if (vehicles.length === 0) return [];
  const db = createAdminClient();
  const ids = vehicles.map((v) => v.id);

  const { data: plates } = await db
    .from("vehicle_registrations")
    .select("vehicle_id, plate_number")
    .in("vehicle_id", ids)
    .is("effective_to", null);
  const plateByVehicle = new Map((plates ?? []).map((p) => [p.vehicle_id, p.plate_number]));

  const contractByVehicle = new Map<string, Record<string, unknown>>();
  if (canViewContracts(ctx.role)) {
    const { data: contracts } = await db
      .from("contracts")
      .select("vehicle_id, client_id, contract_type, deal_number, end_date, installment_amount, outstanding_balance")
      .in("vehicle_id", ids)
      .eq("status", "active");
    const clientIds = [...new Set((contracts ?? []).map((c) => c.client_id))];
    const { data: clients } = clientIds.length
      ? await db.from("clients").select("id, full_name, blacklisted").in("id", clientIds)
      : { data: [] };
    const nameById = new Map((clients ?? []).map((c) => [c.id, c.full_name]));
    const blacklistedIds = new Set((clients ?? []).filter((c) => c.blacklisted).map((c) => c.id));
    for (const c of contracts ?? []) {
      if (!c.vehicle_id) continue;
      contractByVehicle.set(c.vehicle_id, {
        client: nameById.get(c.client_id) ?? null,
        ...(blacklistedIds.has(c.client_id) ? { client_blacklisted: true } : {}),
        type: c.contract_type,
        deal_number: c.deal_number,
        contract_end_date: c.end_date,
        installment_rand: c.installment_amount,
        // Outstanding balances are admin-only in the app, so they are here.
        ...(canSeeFinancials(ctx.role) ? { outstanding_balance_rand: c.outstanding_balance } : {}),
      });
    }
  }

  return vehicles.map((v) => ({
    registration: plateByVehicle.get(v.id) ?? null,
    file_no: v.file_no,
    vehicle: [v.year, v.make, v.model].filter(Boolean).join(" ") || null,
    colour: v.colour,
    status: v.status,
    status_note: v.legacy_status_note,
    mileage_km: v.current_mileage,
    next_service_km: v.next_service_km,
    next_service_date: v.next_service_date,
    licence_disc_expiry: v.license_disc_expiry,
    ...(canViewContracts(ctx.role) ? { current_contract: contractByVehicle.get(v.id) ?? null } : {}),
  }));
}

const findVehicleInput = z.object({ query: z.string().min(2).max(60) });

async function findVehicle(raw: unknown, ctx: ToolContext) {
  const { query } = findVehicleInput.parse(raw);
  const db = createAdminClient();
  const text = clean(query);
  const compact = text.replace(/ /g, "").toUpperCase();
  if (compact.length < 2) return { error: "Query too short" };

  const ids = new Set<string>();

  // Registration (current or historic plates) and file number.
  const { data: byPlate } = await db
    .from("vehicle_registrations")
    .select("vehicle_id")
    .ilike("plate_number", `%${compact}%`)
    .limit(10);
  for (const r of byPlate ?? []) ids.add(r.vehicle_id);

  const { data: byFile } = await db.from("vehicles").select("id").ilike("file_no", `%${compact}%`).limit(10);
  for (const r of byFile ?? []) ids.add(r.id);

  // Client name -> their active contracts' vehicles (admin / Fleet Manager only).
  if (canViewContracts(ctx.role) && text.length >= 3) {
    const { data: clients } = await db.from("clients").select("id").ilike("full_name", `%${text}%`).limit(10);
    if (clients?.length) {
      const { data: contracts } = await db
        .from("contracts")
        .select("vehicle_id")
        .in("client_id", clients.map((c) => c.id))
        .eq("status", "active");
      for (const c of contracts ?? []) if (c.vehicle_id) ids.add(c.vehicle_id);
    }
  }

  // Make / model / colour / year ("Jeep Renegade", "white polo 2019"). Every
  // word must match one of those fields; words are letters/digits only (see
  // `clean`), so they are safe inside the filter string.
  const words = text
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !SEARCH_STOPWORDS.has(w.toLowerCase()));
  if (words.length > 0 && words.length <= 5) {
    let q = db.from("vehicles").select("id");
    for (const w of words) {
      const fields = [`make.ilike.%${w}%`, `model.ilike.%${w}%`, `colour.ilike.%${w}%`];
      if (/^(19|20)\d{2}$/.test(w)) fields.push(`year.eq.${w}`);
      q = q.or(fields.join(","));
    }
    const { data: byDescription } = await q.limit(MAX_MATCHES + 1);
    for (const r of byDescription ?? []) ids.add(r.id);
  }

  if (ids.size === 0) {
    return { matches: [], note: "No vehicle matched. Ask for the registration, file number, or make/model/colour/year." };
  }

  const { data: vehicles } = await db.from("vehicles").select(VEHICLE_COLUMNS).in("id", [...ids].slice(0, 60));
  // Fleet vehicles before sold / written-off / ended ones.
  const rank = (status: string) => ((FLEET_STATUSES as readonly string[]).includes(status) ? 0 : 1);
  const sorted = (vehicles ?? []).sort((a, b) => rank(a.status) - rank(b.status) || a.file_no.localeCompare(b.file_no));
  const described = await describeVehicles(sorted, ctx);

  if (described.length === 1) return { matches: described };

  // Several cars: a short list to choose from, not full details.
  return {
    multiple_matches: true,
    total: described.length,
    shown: Math.min(described.length, MAX_MATCHES),
    instruction:
      "More than one vehicle matched. Show this list (registration, file number, year make model, colour, status, current client if given) and ask which one they want details about. Do not give full details yet. Once they pick one, call find_vehicle with its registration.",
    matches: described.slice(0, MAX_MATCHES).map((v) => ({
      registration: v.registration,
      file_no: v.file_no,
      vehicle: v.vehicle,
      colour: v.colour,
      status: v.status,
      ...("current_contract" in v
        ? {
            current_client: (v.current_contract as { client?: string | null } | null)?.client ?? null,
            ...((v.current_contract as { client_blacklisted?: boolean } | null)?.client_blacklisted
              ? { client_blacklisted: true }
              : {}),
          }
        : {}),
    })),
  };
}

async function fleetSummary(_raw: unknown, ctx: ToolContext) {
  const db = createAdminClient();
  const counts: Record<string, number> = {};
  for (const status of ALL_STATUSES) {
    const { count } = await db.from("vehicles").select("id", { count: "exact", head: true }).eq("status", status);
    counts[status] = count ?? 0;
  }
  const fleetTotal = FLEET_STATUSES.reduce((n, s) => n + counts[s], 0);

  const out: Record<string, unknown> = {
    fleet_total: fleetTotal,
    fleet_by_status: Object.fromEntries(FLEET_STATUSES.map((s) => [s, counts[s]])),
    end_of_contract_by_status: { sold: counts.sold, written_off: counts.written_off, end_of_deal: counts.end_of_deal },
  };

  if (canViewContracts(ctx.role)) {
    const { count } = await db.from("contracts").select("id", { count: "exact", head: true }).eq("status", "active");
    out.active_contracts = count ?? 0;
  }
  return out;
}

const listVehiclesInput = z.object({
  status: z.enum(ALL_STATUSES).optional(),
  service_due_within_days: z.number().int().min(0).max(365).optional(),
  licence_expiring_within_days: z.number().int().min(0).max(365).optional(),
  contract_ending_within_days: z.number().int().min(0).max(365).optional(),
  limit: z.number().int().min(1).max(MAX_ROWS).optional(),
});

async function listVehicles(raw: unknown, ctx: ToolContext) {
  const input = listVehiclesInput.parse(raw);
  const db = createAdminClient();
  const today = todayZA();
  const limit = input.limit ?? 15;

  if (input.contract_ending_within_days !== undefined && !canViewContracts(ctx.role)) {
    return { error: "Not permitted for this user" };
  }

  let ids: string[] | null = null;
  if (input.contract_ending_within_days !== undefined) {
    const { data } = await db
      .from("contracts")
      .select("vehicle_id")
      .eq("status", "active")
      .gte("end_date", today)
      .lte("end_date", addDays(today, input.contract_ending_within_days))
      .order("end_date")
      .limit(200);
    ids = (data ?? []).map((c) => c.vehicle_id).filter((id): id is string => id !== null);
    if (ids.length === 0) return { total: 0, vehicles: [] };
  }

  let q = db.from("vehicles").select(VEHICLE_COLUMNS, { count: "exact" });
  q = input.status ? q.eq("status", input.status) : q.in("status", [...FLEET_STATUSES]);
  if (ids) q = q.in("id", ids);
  if (input.service_due_within_days !== undefined) {
    q = q.lte("next_service_date", addDays(today, input.service_due_within_days)).order("next_service_date");
  } else if (input.licence_expiring_within_days !== undefined) {
    q = q.lte("license_disc_expiry", addDays(today, input.licence_expiring_within_days)).order("license_disc_expiry");
  } else {
    q = q.order("file_no");
  }

  const { data, count } = await q.limit(limit);
  return { total: count ?? 0, shown: data?.length ?? 0, vehicles: await describeVehicles(data ?? [], ctx) };
}

export const TOOLS = [
  {
    name: "find_vehicle",
    description:
      "Look up vehicles by registration (e.g. KX97TCGP, spaces ignored), file number (e.g. B0154), client name, or a description: make, model, colour and/or year (e.g. \"Jeep Renegade\", \"white Polo 2019\"). One match returns full details; several matches return a short list to choose from. Returns status, mileage, service dates, licence disc expiry and, for permitted users, the active contract.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string", description: "Registration, file number, client name, or make/model/colour/year words" } },
      required: ["query"],
      additionalProperties: false,
    },
    run: findVehicle,
  },
  {
    name: "fleet_summary",
    description: "Fleet-wide counts: vehicles per status (on road, parked, in repair, for sale, STR, rental, courtesy), end-of-contract counts and active contracts.",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
    run: fleetSummary,
  },
  {
    name: "list_vehicles",
    description:
      "List vehicles, optionally filtered. Use service_due_within_days (0 = due or overdue today) for service due, licence_expiring_within_days for licence discs, contract_ending_within_days for contracts ending soon, or status for one status. Defaults to fleet vehicles only. Returns at most 25.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: [...ALL_STATUSES] },
        service_due_within_days: { type: "integer", minimum: 0, maximum: 365 },
        licence_expiring_within_days: { type: "integer", minimum: 0, maximum: 365 },
        contract_ending_within_days: { type: "integer", minimum: 0, maximum: 365 },
        limit: { type: "integer", minimum: 1, maximum: MAX_ROWS },
      },
      additionalProperties: false,
    },
    run: listVehicles,
  },
];

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: `Unknown tool ${name}` });
  try {
    return JSON.stringify(await tool.run(input, ctx));
  } catch (err) {
    if (err instanceof z.ZodError) return JSON.stringify({ error: "Invalid input", detail: err.issues.map((i) => i.message) });
    console.error(`whatsapp tool ${name} failed`, err);
    return JSON.stringify({ error: "Lookup failed" });
  }
}
