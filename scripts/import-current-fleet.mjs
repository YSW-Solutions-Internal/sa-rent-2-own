#!/usr/bin/env node
/**
 * One-off importer for the "CURRENT FLEET" sheet of the client's OneDrive
 * workbook, into the live Supabase schema.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-current-fleet.mjs --dry-run
 *   node --env-file=.env.local scripts/import-current-fleet.mjs
 *
 * --dry-run parses everything and prints the summary + review report
 * without writing anything to the database. Always run it first.
 *
 * Policy: rows we're confident about get fully imported (vehicle, current
 * registration, client, and an active contract where applicable). Anything
 * ambiguous still gets the vehicle imported (registration/model/mileage
 * are reliable data), but contract/client-linking is skipped and the row
 * is written to the review report instead of guessed at.
 */

import "./guard-prod.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import xlsx from "xlsx";
import WebSocket from "ws";

const DRY_RUN = process.argv.includes("--dry-run");
const WORKBOOK_PATH = process.argv[2]?.startsWith("--")
  ? "data/SAR2O_FLEET.xlsx"
  : (process.argv[2] ?? "data/SAR2O_FLEET.xlsx");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local."
  );
  process.exit(1);
}

const supabase =
  !DRY_RUN && SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
        // supabase-js eagerly constructs a realtime client, which needs a
        // global WebSocket that Node < 22 doesn't provide. This script
        // never uses realtime features — the polyfill just satisfies the
        // constructor so plain REST inserts below can run.
        realtime: { transport: WebSocket },
      })
    : null;

// ---------------------------------------------------------------------------
// Column positions in the "CURRENT FLEET" sheet (0-indexed). Verified
// directly against the source workbook — header text has quirks (a
// duplicate "WARRANTY" column, a trailing space on "TOTAL COLLECTION ")
// that make name-based lookups unreliable, so we go by position.
// ---------------------------------------------------------------------------
const COL = {
  FILE_NO: 0,
  REG: 1,
  CURRENT_MILEAGE: 2,
  NEXT_SERVICE_KMS: 3,
  NEXT_SERVICE_DATE: 4,
  LAST_SERVICE_BY: 5,
  CURRENT_CLIENT: 6,
  CELL: 7,
  INSTALLMENT: 8,
  // col 9 is an unlabeled, unreliable arrears-like column (mixes numbers
  // with "NO DATA" / "FINE") — deliberately not imported.
  PAST_CLIENTS: 10,
  TRACKER_RUNNING: 11,
  TRACKER_SUPPLIER: 12,
  MODEL: 13,
  STATUS: 14,
  NATIS: 15,
  SPARE: 16,
  FILE_ON_FILE: 17,
  PAYMENT_METHOD: 18,
  POTENTIAL_SALE_PRICE: 19,
  PURCHASE_PRICE: 20,
  PURCHASE_DATE: 21,
  CONTRACT_END_DATE: 22,
  TOTAL_COLLECTION: 24,
  RV: 25,
  PAID: 26,
  WARRANTY: 27,
  LICENSE_DISC_EXPIRY: 28,
  COLOUR: 29,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function excelDateToIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = xlsx.SSF.parse_date_code(value);
    if (!date) return null;
    return new Date(Date.UTC(date.y, date.m - 1, date.d)).toISOString().slice(0, 10);
  }
  // Handle "D/Mon/YY" style strings some rows use.
  const match = String(value).trim().match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})$/);
  if (match) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mon = months[match[2].toLowerCase()];
    if (mon === undefined) return null;
    let year = parseInt(match[3], 10);
    if (year < 100) year += 2000;
    return new Date(Date.UTC(year, mon, parseInt(match[1], 10))).toISOString().slice(0, 10);
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[R,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function isNoiseClientName(name) {
  if (!name) return true;
  const s = name.trim().toUpperCase();
  if (!s) return true;
  if (s.startsWith("STR")) return true;
  if (s.startsWith("LOAN CAR")) return true;
  return false;
}

/** Splits "MZ83XNGP (JWN716EC)" into { primary, secondary }. */
function parseRegistration(raw) {
  const s = cleanText(raw);
  if (!s) return { primary: null, secondary: null };
  const match = s.match(/^(\S+)\s*\(([^)]+)\)\s*$/);
  if (match) {
    return { primary: match[1].trim(), secondary: match[2].trim() };
  }
  return { primary: s, secondary: null };
}

function parseStatus(raw) {
  const original = cleanText(raw);
  const upper = (original ?? "").toUpperCase();
  if (upper === "ON ROAD") return { status: "on_road" };
  if (upper === "PARKED") return { status: "parked" };
  if (upper === "FOR SALE") return { status: "for_sale" };
  if (upper === "COURTESY CAR") {
    return { status: "on_road", flags: [`Courtesy car — imported as on_road, no dedicated status exists yet`] };
  }

  let m;
  if ((m = upper.match(/^REP[AI]+R[\s-]*(.*)$/))) {
    const name = m[1].trim();
    return { status: "in_repair", assignedToName: name || null };
  }
  if ((m = upper.match(/^FOR SALE[\s-]+(.*)$/))) {
    const name = m[1].trim();
    return { status: "for_sale", assignedToName: name || null };
  }
  if ((m = upper.match(/^RENTAL[\s-]+(.*)$/))) {
    const name = m[1].trim();
    return {
      status: "on_road",
      flags: [`Status "${original}" — unclear whether "${name}" is staff or the client; contract not created`],
    };
  }
  if ((m = upper.match(/^STR[\s-]*(.*)$/))) {
    const name = m[1].trim();
    return { status: "on_road", contractType: "short_term_rental", strNameHint: name || null };
  }

  return { status: "available", flags: [`Unrecognized status "${original}" — defaulted to available`] };
}

function resolveClientName(currentClientRaw, strNameHint) {
  const current = cleanText(currentClientRaw);
  const cleanCurrent = current && !isNoiseClientName(current) ? current : null;
  const cleanHint = strNameHint && strNameHint.length > 1 ? strNameHint : null;

  if (cleanCurrent && cleanHint) {
    const a = cleanCurrent.toUpperCase();
    const b = cleanHint.toUpperCase();
    if (a === b || a.includes(b) || b.includes(a)) {
      return { name: cleanCurrent };
    }
    return {
      name: null,
      flag: `Conflicting client names — CURRENT CLIENT="${cleanCurrent}" vs status suffix="${cleanHint}"`,
    };
  }
  if (cleanCurrent) return { name: cleanCurrent };
  if (cleanHint) return { name: cleanHint };
  return { name: null, flag: "No usable client name found" };
}

// ---------------------------------------------------------------------------
// Load workbook
// ---------------------------------------------------------------------------

let rawRows;
try {
  const buf = readFileSync(WORKBOOK_PATH);
  const wb = xlsx.read(buf, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets["CURRENT FLEET"];
  if (!sheet) throw new Error('Sheet "CURRENT FLEET" not found in workbook');
  rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
} catch (err) {
  console.error(`Couldn't read workbook at ${WORKBOOK_PATH}:`, err.message);
  console.error("Place the xlsx file there, or pass its path as the first argument.");
  process.exit(1);
}

const dataRows = rawRows.slice(1); // drop header row

// ---------------------------------------------------------------------------
// Parse every row into a decision
// ---------------------------------------------------------------------------

const parsed = [];
for (const row of dataRows) {
  const fileNo = cleanText(row[COL.FILE_NO]);
  const { primary: regPrimary, secondary: regSecondary } = parseRegistration(row[COL.REG]);
  const model = cleanText(row[COL.MODEL]);

  // Skip blank placeholder rows: a bare FILE NO (or nothing at all) with no
  // registration and no model is not a real vehicle record.
  if (!regPrimary && !model) continue;
  if (!fileNo && !regPrimary) continue;

  const statusInfo = parseStatus(row[COL.STATUS]);
  const flags = [...(statusInfo.flags ?? [])];

  if (regSecondary) {
    flags.push(`Second registration "${regSecondary}" present alongside "${regPrimary}" — not imported, review manually`);
  }

  const yearMatch = model?.match(/^(\d{4})\s+(.*)$/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const makeModel = yearMatch ? yearMatch[2] : model;
  const [make, ...modelRest] = (makeModel ?? "").split(" ");

  const installment = toNumber(row[COL.INSTALLMENT]);
  const clientResolution = resolveClientName(row[COL.CURRENT_CLIENT], statusInfo.strNameHint);
  if (clientResolution.flag) flags.push(clientResolution.flag);

  const isTransactionalStatus = statusInfo.status === "on_road" || statusInfo.status === "parked";
  const wantsContract = Boolean(clientResolution.name) && !statusInfo.flags?.length;
  const contractType = statusInfo.contractType ?? "rent_to_own";
  const shouldCreateContract =
    wantsContract &&
    ((contractType === "short_term_rental") || (isTransactionalStatus && installment && installment > 0));

  if (clientResolution.name && !shouldCreateContract && !statusInfo.flags?.length) {
    flags.push(
      `Client "${clientResolution.name}" present but no contract created (status "${statusInfo.status}" with installment ${installment ?? "blank"})`
    );
  }

  parsed.push({
    fileNo,
    regPrimary,
    regSecondary,
    make: make || null,
    model: modelRest.join(" ") || makeModel || null,
    year,
    colour: cleanText(row[COL.COLOUR]),
    status: statusInfo.status,
    legacyStatusNote: cleanText(row[COL.STATUS]),
    assignedToName: statusInfo.assignedToName ?? null,
    currentMileage: toNumber(row[COL.CURRENT_MILEAGE]),
    nextServiceKm: toNumber(row[COL.NEXT_SERVICE_KMS]),
    nextServiceDate: excelDateToIso(row[COL.NEXT_SERVICE_DATE]),
    lastServicedBy: cleanText(row[COL.LAST_SERVICE_BY]),
    trackerSupplier: cleanText(row[COL.TRACKER_SUPPLIER]),
    trackerRunning: (() => {
      const v = cleanText(row[COL.TRACKER_RUNNING])?.toUpperCase();
      if (v === "YES") return "yes";
      if (v === "NO") return "no";
      return "no_info";
    })(),
    natisOnFile: cleanText(row[COL.NATIS])?.toUpperCase() === "YES",
    licenseDiscExpiry: excelDateToIso(row[COL.LICENSE_DISC_EXPIRY]),
    hasSpareKey: cleanText(row[COL.SPARE])?.toUpperCase() === "YES",
    warrantyActive: ["ACTIVE", "YES"].includes(cleanText(row[COL.WARRANTY])?.toUpperCase()),
    hasContractFile: cleanText(row[COL.FILE_ON_FILE])?.toUpperCase() === "Y",
    cellNumber: cleanText(row[COL.CELL]),
    clientName: clientResolution.name,
    shouldCreateContract,
    contractType,
    paymentMethod: (() => {
      const v = cleanText(row[COL.PAYMENT_METHOD])?.toUpperCase();
      if (v === "EFT") return "eft";
      if (v === "CASH") return "cash";
      return "other";
    })(),
    installmentAmount: installment,
    purchasePrice: toNumber(row[COL.PURCHASE_PRICE]),
    purchaseDate: excelDateToIso(row[COL.PURCHASE_DATE]),
    potentialSalePrice: toNumber(row[COL.POTENTIAL_SALE_PRICE]),
    contractEndDate: excelDateToIso(row[COL.CONTRACT_END_DATE]),
    totalCollected: toNumber(row[COL.TOTAL_COLLECTION]) ?? 0,
    residualValue: toNumber(row[COL.RV]),
    isPaidUp: cleanText(row[COL.PAID])?.toUpperCase() === "YES",
    flags,
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const withFlags = parsed.filter((r) => r.flags.length > 0);
const withContract = parsed.filter((r) => r.shouldCreateContract);

console.log(`Parsed ${parsed.length} real vehicle rows (of ${dataRows.length} sheet rows).`);
console.log(`  ${withContract.length} will get an active contract created.`);
console.log(`  ${withFlags.length} have at least one review flag.`);
console.log(DRY_RUN ? "\nDRY RUN — nothing will be written.\n" : "\nLIVE RUN — writing to Supabase.\n");

// ---------------------------------------------------------------------------
// Write (or simulate) the import
// ---------------------------------------------------------------------------

const clientIdByName = new Map();
let vehiclesCreated = 0;
let contractsCreated = 0;

async function findOrCreateClient(name, cellNumber) {
  const key = name.trim().toUpperCase();
  if (clientIdByName.has(key)) return clientIdByName.get(key);

  if (DRY_RUN) {
    const fakeId = `dry-run-client-${key}`;
    clientIdByName.set(key, fakeId);
    return fakeId;
  }

  const { data: existing } = await supabase
    .from("clients")
    .select("id")
    .ilike("full_name", name)
    .maybeSingle();
  if (existing) {
    clientIdByName.set(key, existing.id);
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from("clients")
    .insert({ full_name: name, cell_number: cellNumber || "0000000000" })
    .select("id")
    .single();
  if (error) throw new Error(`Creating client "${name}": ${error.message}`);
  clientIdByName.set(key, created.id);
  return created.id;
}

for (const row of parsed) {
  if (!DRY_RUN) {
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .insert({
        file_no: row.fileNo ?? row.regPrimary,
        make: row.make,
        model: row.model,
        year: row.year,
        colour: row.colour,
        status: row.status,
        legacy_status_note: row.legacyStatusNote,
        assigned_to_name: row.assignedToName,
        current_mileage: row.currentMileage,
        next_service_km: row.nextServiceKm,
        next_service_date: row.nextServiceDate,
        last_serviced_by: row.lastServicedBy,
        tracker_supplier: row.trackerSupplier,
        tracker_running: row.trackerRunning,
        natis_on_file: row.natisOnFile,
        license_disc_expiry: row.licenseDiscExpiry,
        has_spare_key: row.hasSpareKey,
        warranty_active: row.warrantyActive,
        has_contract_file: row.hasContractFile,
      })
      .select("id")
      .single();

    if (vehicleError) {
      console.error(`✗ Vehicle ${row.fileNo ?? row.regPrimary}: ${vehicleError.message}`);
      continue;
    }
    vehiclesCreated++;

    if (row.regPrimary) {
      await supabase
        .from("vehicle_registrations")
        .insert({ vehicle_id: vehicle.id, plate_number: row.regPrimary });
    }

    if (row.shouldCreateContract && row.clientName) {
      const clientId = await findOrCreateClient(row.clientName, row.cellNumber);
      const { error: contractError } = await supabase.from("contracts").insert({
        vehicle_id: vehicle.id,
        client_id: clientId,
        contract_type: row.contractType,
        status: "active",
        start_date: row.purchaseDate ?? new Date().toISOString().slice(0, 10),
        end_date: row.contractEndDate,
        payment_method: row.paymentMethod,
        installment_amount: row.installmentAmount,
        purchase_price: row.purchasePrice,
        potential_sale_price: row.potentialSalePrice,
        residual_value: row.residualValue,
        total_collected: row.totalCollected,
        is_paid_up: row.isPaidUp,
      });
      if (contractError) {
        console.error(`✗ Contract for ${row.fileNo}: ${contractError.message}`);
      } else {
        contractsCreated++;
      }
    }
  }
}

if (!DRY_RUN) {
  console.log(`\nCreated ${vehiclesCreated} vehicles and ${contractsCreated} contracts.`);
}

// ---------------------------------------------------------------------------
// Review report
// ---------------------------------------------------------------------------

mkdirSync(".import-reports", { recursive: true });
const reportPath = `.import-reports/current-fleet-review-${DRY_RUN ? "dry-run" : "live"}.md`;
const lines = [
  `# CURRENT FLEET import review`,
  ``,
  `Generated ${new Date().toISOString()}. ${parsed.length} rows parsed, ${withFlags.length} flagged for manual review.`,
  ``,
  `Known limitations of this pass, by design (not bugs):`,
  `- Only the *current* client relationship is imported; PAST CLIENTS history is not (no dates to reconstruct it from).`,
  `- Arrears/outstanding balance are not populated (source column was unreliable) — left at 0, reconcile separately.`,
  `- STR billing details (day/direction/frequency) are not set on auto-created STR contracts — that lives in the separate STR DEALS sheet, a later pass.`,
  ``,
  `## Flagged rows`,
  ``,
];
for (const row of withFlags) {
  lines.push(`### ${row.fileNo ?? "(no file no)"} — ${row.regPrimary ?? "no reg"} — ${row.year ?? ""} ${row.make ?? ""} ${row.model ?? ""}`.trim());
  for (const f of row.flags) lines.push(`- ${f}`);
  lines.push("");
}
writeFileSync(reportPath, lines.join("\n"));
console.log(`Review report written to ${reportPath}`);
