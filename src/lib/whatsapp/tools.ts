import "server-only";

import { z } from "zod";

import { contractTypeValues } from "@/app/(app)/contracts/schema";
import { canViewContracts } from "@/lib/auth/permissions";
import type { UserRole } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { END_OF_CONTRACT_STATUSES, FLEET_STATUSES } from "@/lib/vehicle-status";

/**
 * Read-only fleet queries for the WhatsApp bot. These run with the service
 * role (no RLS), so every function here is the permission boundary: explicit
 * column lists, and role/permission checks via the same helpers the pages
 * use (plus `ctx.financeEnabled`, a per-number permission separate from
 * role — see `whatsapp_finance_enabled`). Never selected, for anyone, under
 * any permission: ID numbers, cell numbers, banking details. Purchase /
 * potential-sale / sale price are finance-gated too (vehicle_financials
 * only) — see `ctx.financeEnabled`.
 */
export interface ToolContext {
  role: UserRole;
  /** Per-number permission (Admin → Users), independent of role: gates
   * payments/revenue/transaction tools and figures. Contract and vehicle
   * info (the base `whatsapp_enabled` tier) never needs this. */
  financeEnabled: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const ALL_STATUSES = [...FLEET_STATUSES, ...END_OF_CONTRACT_STATUSES] as const;

const MAX_ROWS = 25;
const MAX_MATCHES = 15;
// PostgREST (supabase/config.toml's `max_rows`) silently caps any unranged
// select at 1,000 rows — the exact gotcha payments/transactions-query.ts's
// SHOW_ALL_CAP already works around. revenue_summary's fleet-wide queries
// (thousands of payment_transactions rows, several hundred contracts) need
// the same explicit ceiling or they'd quietly undercount.
const REVENUE_ROWS_CAP = 10000;
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
        // Money figures go through the WhatsApp-specific finance permission,
        // not the web app's role-based canSeeFinancials — an admin's role
        // doesn't itself unlock finance on WhatsApp.
        ...(ctx.financeEnabled ? { outstanding_balance_rand: c.outstanding_balance } : {}),
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

/**
 * Shared vehicle-matching logic behind find_vehicle, vehicle_costs and
 * vehicle_financials: registration/file no/client name/description -> matching
 * VehicleRow[], fleet vehicles ranked before ended ones. Factored out of the
 * old find_vehicle so every tool that takes "a vehicle" resolves it the
 * same way.
 */
async function resolveVehicles(query: string, ctx: ToolContext): Promise<VehicleRow[]> {
  const db = createAdminClient();
  const text = clean(query);
  const compact = text.replace(/ /g, "").toUpperCase();
  if (compact.length < 2) return [];

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

  if (ids.size === 0) return [];

  const { data: vehicles } = await db.from("vehicles").select(VEHICLE_COLUMNS).in("id", [...ids].slice(0, 60));
  // Fleet vehicles before sold / written-off / ended ones.
  const rank = (status: string) => ((FLEET_STATUSES as readonly string[]).includes(status) ? 0 : 1);
  return (vehicles ?? []).sort((a, b) => rank(a.status) - rank(b.status) || a.file_no.localeCompare(b.file_no));
}

/**
 * resolveVehicles() plus the "which one?" disambiguation shape every
 * single-vehicle tool (find_vehicle, vehicle_costs, vehicle_financials) needs
 * when it matches none or several. Returns the one VehicleRow on a clean
 * match, or the tool result to hand straight back otherwise.
 */
async function pickVehicle(query: string, ctx: ToolContext): Promise<{ vehicle: VehicleRow } | { result: unknown }> {
  const sorted = await resolveVehicles(query, ctx);
  if (sorted.length === 0) {
    return { result: { matches: [], note: "No vehicle matched. Ask for the registration, file number, or make/model/colour/year." } };
  }
  if (sorted.length === 1) return { vehicle: sorted[0] };

  // Several cars: a short list to choose from, not full details.
  const described = await describeVehicles(sorted, ctx);
  return {
    result: {
      multiple_matches: true,
      total: described.length,
      shown: Math.min(described.length, MAX_MATCHES),
      instruction:
        "More than one vehicle matched. Show this list (registration, file number, year make model, colour, status, current client if given) and ask which one they want details about. Do not give full details yet. Once they pick one, call the same tool again with its registration.",
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
    },
  };
}

const findVehicleInput = z.object({ query: z.string().min(2).max(60) });

async function findVehicle(raw: unknown, ctx: ToolContext) {
  const { query } = findVehicleInput.parse(raw);
  const picked = await pickVehicle(query, ctx);
  if ("result" in picked) return picked.result;
  return { matches: await describeVehicles([picked.vehicle], ctx) };
}

const vehicleCostsInput = z.object({ query: z.string().min(2).max(60), limit: z.number().int().min(1).max(25).optional() });

async function vehicleCosts(raw: unknown, ctx: ToolContext) {
  const { query, limit } = vehicleCostsInput.parse(raw);
  const picked = await pickVehicle(query, ctx);
  if ("result" in picked) return picked.result;

  const [described] = await describeVehicles([picked.vehicle], ctx);
  const db = createAdminClient();
  const { data: costs } = await db
    .from("vehicle_costs")
    .select("cost_type, cost_date, amount, supplier, work_done, mileage_at_time")
    .eq("vehicle_id", picked.vehicle.id)
    .order("cost_date", { ascending: false })
    .limit(limit ?? 15);

  return {
    vehicle: { registration: described.registration, file_no: described.file_no },
    shown: costs?.length ?? 0,
    total_shown_rand: round2((costs ?? []).reduce((sum, c) => sum + c.amount, 0)),
    note: "The total only covers the rows shown (most recent first) — ask for more rows if the vehicle has a longer history.",
    costs: (costs ?? []).map((c) => ({
      date: c.cost_date,
      type: c.cost_type,
      amount_rand: c.amount,
      supplier: c.supplier,
      work_done: c.work_done,
      mileage_km: c.mileage_at_time,
    })),
  };
}

const revenueSummaryInput = z.object({
  group_by: z.enum(["vehicle", "contract_type", "month"]).optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  contract_type: z.enum(contractTypeValues).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

async function revenueSummary(raw: unknown, ctx: ToolContext) {
  if (!ctx.financeEnabled) return { error: "Not permitted for this user" };
  const input = revenueSummaryInput.parse(raw);
  const groupBy = input.group_by ?? "vehicle";
  const db = createAdminClient();
  const period = { from: input.date_from ?? "all time", to: input.date_to ?? "today" };

  if (groupBy === "month") {
    let q = db.from("payment_monthly_totals").select("month, collected, reversed, net").order("month");
    if (input.date_from) q = q.gte("month", `${input.date_from.slice(0, 7)}-01`);
    if (input.date_to) q = q.lte("month", input.date_to);
    const { data } = await q;
    return {
      months: (data ?? []).map((m) => ({ month: m.month, collected_rand: m.collected, reversed_rand: m.reversed, net_rand: m.net })),
    };
  }

  let q = db
    .from("payment_transactions_detail")
    .select("cash_effect, vehicle_id, reg, deal_number")
    .range(0, REVENUE_ROWS_CAP - 1);
  if (input.date_from) q = q.gte("transaction_date", input.date_from);
  if (input.date_to) q = q.lte("transaction_date", input.date_to);
  const { data: txns } = await q;
  let rows = txns ?? [];

  if (input.contract_type || groupBy === "contract_type") {
    const { data: contracts } = await db.from("contracts").select("deal_number, contract_type").range(0, REVENUE_ROWS_CAP - 1);
    const typeByDeal = new Map((contracts ?? []).filter((c) => c.deal_number).map((c) => [c.deal_number as string, c.contract_type]));
    if (input.contract_type) {
      rows = rows.filter((r) => r.deal_number && typeByDeal.get(r.deal_number) === input.contract_type);
    }
    if (groupBy === "contract_type") {
      const byType = new Map<string, { net: number; vehicles: Set<string>; count: number }>();
      for (const r of rows) {
        const type = (r.deal_number && typeByDeal.get(r.deal_number)) || "unknown";
        const entry = byType.get(type) ?? { net: 0, vehicles: new Set<string>(), count: 0 };
        entry.net += r.cash_effect;
        entry.count += 1;
        if (r.vehicle_id) entry.vehicles.add(r.vehicle_id);
        byType.set(type, entry);
      }
      return {
        period,
        by_contract_type: [...byType.entries()].map(([type, v]) => ({
          contract_type: type,
          total_net_collected_rand: round2(v.net),
          vehicle_count: v.vehicles.size,
          average_net_per_vehicle_rand: v.vehicles.size ? round2(v.net / v.vehicles.size) : 0,
          transaction_count: v.count,
        })),
      };
    }
  }

  // groupBy === "vehicle"
  const byVehicle = new Map<string, { reg: string | null; dealNumbers: Set<string>; net: number; count: number }>();
  for (const r of rows) {
    if (!r.vehicle_id) continue;
    const entry = byVehicle.get(r.vehicle_id) ?? { reg: r.reg, dealNumbers: new Set<string>(), net: 0, count: 0 };
    if (r.deal_number) entry.dealNumbers.add(r.deal_number);
    entry.net += r.cash_effect;
    entry.count += 1;
    byVehicle.set(r.vehicle_id, entry);
  }
  const vehicles = [...byVehicle.values()];
  const totalNet = vehicles.reduce((sum, v) => sum + v.net, 0);
  const limit = input.limit ?? 10;
  return {
    period,
    vehicles_with_activity: vehicles.length,
    total_net_collected_rand: round2(totalNet),
    average_net_per_vehicle_rand: vehicles.length ? round2(totalNet / vehicles.length) : 0,
    top_vehicles: vehicles
      .sort((a, b) => b.net - a.net)
      .slice(0, limit)
      .map((v) => ({
        registration: v.reg,
        deal_numbers: [...v.dealNumbers].join(", ") || null,
        net_collected_rand: round2(v.net),
        transaction_count: v.count,
      })),
  };
}

const vehicleFinancialsInput = z.object({ query: z.string().min(2).max(60) });

async function vehicleFinancials(raw: unknown, ctx: ToolContext) {
  if (!ctx.financeEnabled) return { error: "Not permitted for this user" };
  const { query } = vehicleFinancialsInput.parse(raw);
  const picked = await pickVehicle(query, ctx);
  if ("result" in picked) return picked.result;

  const [described] = await describeVehicles([picked.vehicle], ctx);
  const db = createAdminClient();

  // Purchase/potential-sale/sale price live on vehicles (SPEC item 47) but
  // aren't in VEHICLE_COLUMNS/VehicleRow — those are shared by every vehicle
  // tool, finance-gated or not, and these three stay out of the non-finance
  // ones (find_vehicle, list_vehicles, vehicle_costs).
  const { data: priceRow } = await db
    .from("vehicles")
    .select("purchase_price, potential_sale_price, sale_price")
    .eq("id", picked.vehicle.id)
    .single();

  const { data: txns } = await db
    .from("payment_transactions_detail")
    .select("transaction_date, type, cash_effect, deal_number")
    .eq("vehicle_id", picked.vehicle.id)
    .order("transaction_date", { ascending: false });
  const all = txns ?? [];

  const { data: contracts } = await db
    .from("contracts")
    .select("outstanding_balance, arrears_amount")
    .eq("vehicle_id", picked.vehicle.id);

  return {
    vehicle: { registration: described.registration, file_no: described.file_no },
    purchase_price_rand: priceRow?.purchase_price ?? null,
    potential_sale_price_rand: priceRow?.potential_sale_price ?? null,
    sale_price_rand: priceRow?.sale_price ?? null,
    lifetime_net_collected_rand: round2(all.reduce((sum, t) => sum + t.cash_effect, 0)),
    transaction_count: all.length,
    outstanding_balance_rand: round2((contracts ?? []).reduce((sum, c) => sum + (c.outstanding_balance ?? 0), 0)),
    arrears_rand: round2((contracts ?? []).reduce((sum, c) => sum + (c.arrears_amount ?? 0), 0)),
    recent_transactions: all.slice(0, 8).map((t) => ({
      date: t.transaction_date,
      type: t.type,
      amount_rand: t.cash_effect,
      deal_number: t.deal_number,
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
  {
    name: "vehicle_costs",
    description:
      "Service/repair/maintenance cost history for one vehicle (what was spent on it, when, by whom, at what mileage) — this is running spend on the vehicle, not what it cost to buy or client payments; use vehicle_financials for purchase/sale price and revenue_summary for client revenue. Look up by registration, file number, client name, or make/model/colour/year. Returns the most recent cost rows first and their total.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Registration, file number, client name, or make/model/colour/year words" },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "How many cost rows to return, most recent first (default 15)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: vehicleCosts,
  },
  {
    name: "revenue_summary",
    description:
      'Income/revenue across contracts — net collected (receipts minus reversals) from client payments. Use for questions like "average income per car", "revenue by contract type", "income last 3 months". group_by: "vehicle" (default — ranked list plus the average per vehicle), "contract_type", or "month" (fleet-wide trend, no vehicle breakdown). Optional date_from/date_to (YYYY-MM-DD, inclusive) and a contract_type filter (ignored when group_by is "month"). Requires finance permission.',
    input_schema: {
      type: "object" as const,
      properties: {
        group_by: { type: "string", enum: ["vehicle", "contract_type", "month"] },
        date_from: { type: "string", description: "YYYY-MM-DD, inclusive" },
        date_to: { type: "string", description: "YYYY-MM-DD, inclusive" },
        contract_type: { type: "string", enum: [...contractTypeValues] },
        limit: { type: "integer", minimum: 1, maximum: 25, description: 'Max vehicles returned when group_by is "vehicle" (default 10)' },
      },
      additionalProperties: false,
    },
    run: revenueSummary,
  },
  {
    name: "vehicle_financials",
    description:
      "One vehicle's full money picture: what it cost to buy, its potential sale price, what it actually sold for (if sold), net collected from clients across every contract it's ever been on, current outstanding balance and arrears, and its most recent transactions. Look up by registration, file number, client name, or make/model/colour/year. Requires finance permission.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string", description: "Registration, file number, client name, or make/model/colour/year words" } },
      required: ["query"],
      additionalProperties: false,
    },
    run: vehicleFinancials,
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
