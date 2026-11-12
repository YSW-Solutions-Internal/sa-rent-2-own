#!/usr/bin/env node
/**
 * One-off bulk update: VIN, tracker device number and license disc expiry
 * for existing vehicles, from a client-supplied spreadsheet extract.
 *
 * Usage:
 *   node --env-file=.env.local scripts/update-vehicle-vin-tracker-disc.mjs <data.txt> [--dry-run]
 *
 * data.txt: pipe-delimited, header "Vehicle|VIN|Tracker|Licence disc expiry"
 * (scripts/data/vehicle-vin-tracker-disc-2026-11-12.txt is the file this was
 * written for). "Vehicle" is the registration; "Licence disc expiry" is an
 * Excel serial date number (e.g. "46234"), converted to an ISO date here.
 *
 * Matching: by the vehicle's *current* registration (vehicle_registrations
 * where effective_to is null) — never by file number or anything fuzzy,
 * since a plate typo here would silently relabel the wrong car.
 *
 * Blank-field policy: a blank VIN/Tracker/Licence-disc-expiry cell in the
 * source leaves that column untouched on the matching vehicle — this never
 * clears an existing value, it only fills in what the source actually has.
 *
 * --dry-run parses and matches everything, prints the summary, and writes
 * the unmatched-rows report (if any), without writing anything to the
 * database. Always run it first.
 */

import { mkdirSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import WebSocket from "ws";

const DRY_RUN = process.argv.includes("--dry-run");
const DATA_PATH = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (!DATA_PATH) {
  console.error(
    "Usage: node --env-file=.env.local scripts/update-vehicle-vin-tracker-disc.mjs <data.txt> [--dry-run]"
  );
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  // supabase-js eagerly constructs a realtime client, which needs a global
  // WebSocket that Node < 22 doesn't provide. This script never uses
  // realtime features — the polyfill just satisfies the constructor.
  realtime: { transport: WebSocket },
});

function normalizePlate(raw) {
  if (!raw) return null;
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  return v || null;
}

// Excel/Lotus serial date -> ISO (YYYY-MM-DD). Epoch 1899-12-30, which
// already accounts for Excel's fake 1900-02-29 for any date this far past
// it. None of these source dates are early enough for the leap-year bug to
// matter, so the plain epoch offset is exact.
function excelSerialToIso(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const serial = Number(trimmed);
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + serial * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function parsePipeFile(path) {
  const text = readFileSync(path, "utf-8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(1) // header
    .map((line) => line.split("|"));
}

const COL = { VEHICLE: 0, VIN: 1, TRACKER: 2, DISC_EXPIRY: 3 };

const rows = parsePipeFile(DATA_PATH).map((cells) => ({
  plateRaw: (cells[COL.VEHICLE] ?? "").trim(),
  plate: normalizePlate(cells[COL.VEHICLE]),
  vin: (cells[COL.VIN] ?? "").trim() || null,
  tracker: (cells[COL.TRACKER] ?? "").trim() || null,
  licenseDiscExpiryRaw: (cells[COL.DISC_EXPIRY] ?? "").trim(),
  licenseDiscExpiry: excelSerialToIso(cells[COL.DISC_EXPIRY]),
}));

console.log(`Parsed ${rows.length} rows from ${DATA_PATH}.`);

const { data: registrations, error: regError } = await supabase
  .from("vehicle_registrations")
  .select("vehicle_id, plate_number")
  .is("effective_to", null);

if (regError) {
  console.error("Failed to load vehicle_registrations:", regError.message);
  process.exit(1);
}

const vehicleIdsByPlate = new Map(); // normalized plate -> vehicle_id[]
for (const r of registrations ?? []) {
  const plate = normalizePlate(r.plate_number);
  if (!plate) continue;
  if (!vehicleIdsByPlate.has(plate)) vehicleIdsByPlate.set(plate, []);
  vehicleIdsByPlate.get(plate).push(r.vehicle_id);
}

const updates = [];
const unmatched = [];

for (const row of rows) {
  const candidates = row.plate ? (vehicleIdsByPlate.get(row.plate) ?? []) : [];

  if (candidates.length === 0) {
    unmatched.push({ ...row, reason: "No vehicle currently registered under this plate" });
    continue;
  }
  if (candidates.length > 1) {
    unmatched.push({ ...row, reason: `${candidates.length} vehicles share this current plate — can't tell which one` });
    continue;
  }

  const patch = {};
  if (row.vin) patch.vin = row.vin;
  if (row.tracker) patch.tracker_number = row.tracker;
  if (row.licenseDiscExpiry) patch.license_disc_expiry = row.licenseDiscExpiry;

  if (Object.keys(patch).length === 0) {
    unmatched.push({ ...row, reason: "Matched, but every source column was blank — nothing to update" });
    continue;
  }

  updates.push({ vehicleId: candidates[0], patch, row });
}

console.log(`Matched:   ${updates.length}`);
console.log(`Unmatched: ${unmatched.length} (-> unmatched Excel if any)`);

const failedWrites = [];

if (!DRY_RUN) {
  let written = 0;
  for (const u of updates) {
    const { error } = await supabase.from("vehicles").update(u.patch).eq("id", u.vehicleId);
    if (error) {
      console.error(`Failed to update vehicle for ${u.row.plateRaw}:`, error.message);
      failedWrites.push({ ...u.row, reason: `Write failed: ${error.message}` });
    } else {
      written++;
    }
  }
  console.log(`\nWrote ${written} of ${updates.length} matched vehicles.`);
  if (failedWrites.length > 0) {
    console.log(`${failedWrites.length} failed to write (-> failed-writes Excel) — re-run to retry them.`);
  }
} else {
  console.log("\n--dry-run — nothing written to the database.");
}

async function writeReportExcel(path, title, reportRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Review");
  sheet.addRow([title]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([]);
  const headerRow = sheet.addRow(["Vehicle", "VIN", "Tracker", "Licence disc expiry (raw)", "Reason"]);
  headerRow.font = { bold: true };
  for (const r of reportRows) {
    sheet.addRow([r.plateRaw, r.vin, r.tracker, r.licenseDiscExpiryRaw, r.reason]);
  }
  sheet.columns.forEach((col) => {
    col.width = Math.min(40, Math.max(12, ...col.values.filter((v) => v != null).map((v) => String(v).length)));
  });
  await workbook.xlsx.writeFile(path);
  console.log(`Wrote ${reportRows.length} rows to ${path}`);
}

if (unmatched.length > 0 || failedWrites.length > 0) {
  mkdirSync(".import-reports", { recursive: true });
}
if (failedWrites.length > 0) {
  await writeReportExcel(
    ".import-reports/vehicle-vin-tracker-disc-failed-writes.xlsx",
    "Matched, but the database write itself failed — re-run to retry",
    failedWrites
  );
}
if (unmatched.length > 0) {
  await writeReportExcel(
    ".import-reports/vehicle-vin-tracker-disc-unmatched.xlsx",
    "Rows not applied — no matching current vehicle, or nothing to update",
    unmatched
  );
}
