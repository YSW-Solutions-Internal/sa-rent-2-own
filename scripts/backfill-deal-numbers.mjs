#!/usr/bin/env node
/**
 * One-off backfill: matches existing contracts to the client's deal numbers
 * (the "MAD..." reference) from an accounts export, and — where available —
 * the statement tag embedded in a bank debit-order batch sample.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-deal-numbers.mjs <accounts.txt> [bank-batch.txt] [--dry-run]
 *
 * accounts.txt: pipe-delimited, header "Deal|workstate|Customer|Customer
 * name|File number|Vehicle" — this is the primary matching source.
 *
 * bank-batch.txt (optional): pipe-delimited bank debit-order batch sample,
 * whose "my statement description" column embeds "{dealNumber}_{tag}" —
 * used only to recover the client's own curated statement tag where one
 * exists. Deals not present in this file still get an auto-generated tag
 * (surname + collision counter), matching the app's own rule for new
 * contracts, so every successfully matched contract ends up with a tag.
 *
 * Matching policy (vehicle registration, then file number; never guess):
 *   1. Normalize the deal row's vehicle plate and look for exactly one
 *      contract on a vehicle with that current plate.
 *   2. If no plate match, normalize the file number and look for exactly
 *      one contract on a vehicle with that file number.
 *   3. Zero matches after both steps -> written to the "unmatched" Excel.
 *   4. More than one candidate *contract* for a single deal row -> written
 *      to the "conflicts" Excel (genuinely can't tell which contract this
 *      deal is about).
 *   5. More than one deal row claiming the *same* contract (a vehicle's
 *      file/reg gets reused across successive historical deals) -> if
 *      exactly one of them has workstate "Deal signed and Vehicle
 *      delivered to Customer", that's the live one: it's accepted, the
 *      rest go to "unmatched" (not conflicts — there's nothing ambiguous
 *      left once the live row is identified). If zero or more than one
 *      claim to be delivered, all of them go to "conflicts" instead —
 *      never guess between two live-looking rows.
 *   6. The contract already has a *different* deal number set -> written
 *      to the "conflicts" Excel, nothing is imported for it.
 *   7. Exactly one accepted row, uncontested -> deal_number (+
 *      statement_tag) written to that contract.
 *
 * --dry-run parses and matches everything, prints the summary, and writes
 * both Excel files, without writing anything to the database. Always run
 * it first.
 */

import "./guard-prod.mjs";
import { readFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import WebSocket from "ws";

const DRY_RUN = process.argv.includes("--dry-run");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ACCOUNTS_PATH = positional[0];
const BATCH_PATH = positional[1];

if (!ACCOUNTS_PATH) {
  console.error(
    "Usage: node --env-file=.env.local scripts/backfill-deal-numbers.mjs <accounts.txt> [bank-batch.txt] [--dry-run]"
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

// ---------------------------------------------------------------------------
// Normalization — both source files mix zero-padded and short deal/file
// number styles (e.g. "MAD8264S" and "MAD0004833S" are the same deal), so
// everything is compared in a stripped-of-leading-zeros canonical form.
// ---------------------------------------------------------------------------

function normalizePlate(raw) {
  if (!raw) return null;
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!v || v === "NOCAR") return null;
  return v;
}

function normalizeFileNo(raw) {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  const m = v.match(/^([A-Z]*)0*(\d+)$/);
  if (!m) return v || null;
  return `${m[1]}${m[2]}`;
}

function normalizeDealNumber(raw) {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  const m = v.match(/^MAD0*(\d+)([A-Z]*)$/);
  if (!m) return v || null;
  return `MAD${m[1]}${m[2]}`;
}

function extractSurnameTag(fullName) {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? fullName ?? "";
  const letters = last.toUpperCase().replace(/[^A-Z]/g, "");
  return letters || "DEAL";
}

// ---------------------------------------------------------------------------
// Parsing — positional, not header-name-based: both files' headers have
// inconsistent quoting/dagger marks that make name lookups unreliable.
// ---------------------------------------------------------------------------

function parsePipeFile(path) {
  const text = readFileSync(path, "utf-8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(1) // header
    .map((line) => line.split("|"));
}

const ACCOUNTS_COL = { DEAL: 0, WORKSTATE: 1, CUSTOMER_ID: 2, CUSTOMER_NAME: 3, FILE_NO: 4, VEHICLE: 5 };
const BATCH_COL = { STATEMENT_DESC: 2 };

const accountRows = parsePipeFile(ACCOUNTS_PATH).map((cells) => ({
  dealNumberRaw: (cells[ACCOUNTS_COL.DEAL] ?? "").trim(),
  dealNumber: normalizeDealNumber(cells[ACCOUNTS_COL.DEAL]),
  workstate: (cells[ACCOUNTS_COL.WORKSTATE] ?? "").trim(),
  customerName: (cells[ACCOUNTS_COL.CUSTOMER_NAME] ?? "").trim(),
  fileNo: normalizeFileNo(cells[ACCOUNTS_COL.FILE_NO]),
  fileNoRaw: (cells[ACCOUNTS_COL.FILE_NO] ?? "").trim(),
  plate: normalizePlate(cells[ACCOUNTS_COL.VEHICLE]),
  plateRaw: (cells[ACCOUNTS_COL.VEHICLE] ?? "").trim(),
}));

// deal number (normalized) -> statement tag, recovered from the bank batch
// sample where available.
const tagByDealNumber = new Map();
if (BATCH_PATH) {
  for (const cells of parsePipeFile(BATCH_PATH)) {
    const raw = (cells[BATCH_COL.STATEMENT_DESC] ?? "").trim();
    const underscoreIdx = raw.indexOf("_");
    if (underscoreIdx === -1) continue;
    const dealNumber = normalizeDealNumber(raw.slice(0, underscoreIdx));
    const tag = raw.slice(underscoreIdx + 1).trim();
    if (dealNumber && tag) tagByDealNumber.set(dealNumber, tag);
  }
}

console.log(`Parsed ${accountRows.length} deal rows from ${ACCOUNTS_PATH}.`);
if (BATCH_PATH) console.log(`Recovered ${tagByDealNumber.size} statement tags from ${BATCH_PATH}.`);

// ---------------------------------------------------------------------------
// Load existing contracts + vehicles (current plate, file number) + clients.
// ---------------------------------------------------------------------------

const [{ data: contracts, error: contractsError }, { data: vehicles, error: vehiclesError }, { data: registrations, error: regError }, { data: clients, error: clientsError }] =
  await Promise.all([
    supabase.from("contracts").select("id, vehicle_id, client_id, deal_number, statement_tag"),
    supabase.from("vehicles").select("id, file_no"),
    supabase.from("vehicle_registrations").select("vehicle_id, plate_number").is("effective_to", null),
    supabase.from("clients").select("id, full_name"),
  ]);

for (const [name, err] of [
  ["contracts", contractsError],
  ["vehicles", vehiclesError],
  ["vehicle_registrations", regError],
  ["clients", clientsError],
]) {
  if (err) {
    console.error(`Failed to load ${name}:`, err.message);
    process.exit(1);
  }
}

const plateByVehicleId = new Map(
  (registrations ?? []).map((r) => [r.vehicle_id, normalizePlate(r.plate_number)])
);
const fileNoByVehicleId = new Map((vehicles ?? []).map((v) => [v.id, normalizeFileNo(v.file_no)]));
const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.full_name]));

const contractsByPlate = new Map(); // normalized plate -> contract[]
const contractsByFileNo = new Map(); // normalized file no -> contract[]
for (const c of contracts ?? []) {
  const plate = plateByVehicleId.get(c.vehicle_id);
  if (plate) {
    if (!contractsByPlate.has(plate)) contractsByPlate.set(plate, []);
    contractsByPlate.get(plate).push(c);
  }
  const fileNo = fileNoByVehicleId.get(c.vehicle_id);
  if (fileNo) {
    if (!contractsByFileNo.has(fileNo)) contractsByFileNo.set(fileNo, []);
    contractsByFileNo.get(fileNo).push(c);
  }
}

// ---------------------------------------------------------------------------
// Match each deal row to at most one contract — two passes.
//
// Pass 1: find each row's candidate contract(s) by vehicle reg, then file
// number. Zero -> unmatched. More than one -> conflict (genuinely can't
// tell which contract this deal is about). Exactly one -> grouped by that
// contract, since several deal rows commonly land on the same contract
// (a vehicle's slot gets reused across successive historical deals).
//
// Pass 2: for a contract claimed by more than one deal row, the one whose
// workstate is "Deal signed and Vehicle delivered to Customer" is the row
// that's actually live right now — the others are past deals on that same
// vehicle slot with nothing left to attach to. If exactly one row has that
// workstate, accept it and move the rest to unmatched (not conflicts —
// there's nothing ambiguous about them once the live one is identified).
// If zero or more than one row claims to be delivered, it's still a real
// conflict — never guess between two live-looking rows.
// ---------------------------------------------------------------------------

const DELIVERED_WORKSTATE = "Deal signed and Vehicle delivered to Customer";

const rowsByContractId = new Map(); // contract id -> { contract, rows: [{row, matchedVia}] }
const unmatched = [];
const conflicts = [];

for (const row of accountRows) {
  let candidates = row.plate ? (contractsByPlate.get(row.plate) ?? []) : [];
  let matchedVia = "vehicle reg";
  if (candidates.length === 0) {
    candidates = row.fileNo ? (contractsByFileNo.get(row.fileNo) ?? []) : [];
    matchedVia = "file number";
  }

  if (candidates.length === 0) {
    unmatched.push({ ...row, reason: "No contract found by vehicle reg or file number" });
    continue;
  }
  if (candidates.length > 1) {
    conflicts.push({
      ...row,
      reason: `${candidates.length} contracts matched by ${matchedVia} — can't tell which one`,
    });
    continue;
  }

  const contract = candidates[0];
  if (!rowsByContractId.has(contract.id)) {
    rowsByContractId.set(contract.id, { contract, rows: [] });
  }
  rowsByContractId.get(contract.id).rows.push({ row, matchedVia });
}

const matchedByContractId = new Map(); // contract id -> accepted deal row

for (const { contract, rows } of rowsByContractId.values()) {
  let accepted;
  let rest = [];

  if (rows.length === 1) {
    accepted = rows[0];
  } else {
    const delivered = rows.filter(({ row }) => row.workstate === DELIVERED_WORKSTATE);
    if (delivered.length === 1) {
      accepted = delivered[0];
      rest = rows.filter((r) => r !== accepted);
    } else {
      const reason =
        delivered.length === 0
          ? `${rows.length} deal rows matched the same contract, none show as currently delivered`
          : `${delivered.length} deal rows matched the same contract and all show as currently delivered`;
      for (const { row } of rows) conflicts.push({ ...row, reason });
      continue;
    }
  }

  if (contract.deal_number && normalizeDealNumber(contract.deal_number) !== accepted.row.dealNumber) {
    conflicts.push({
      ...accepted.row,
      reason: `Contract already has a different deal number (${contract.deal_number})`,
    });
    for (const { row } of rest) {
      unmatched.push({ ...row, reason: `Vehicle's current contract is already deal ${contract.deal_number}` });
    }
    continue;
  }

  matchedByContractId.set(contract.id, { row: accepted.row, contract, matchedVia: accepted.matchedVia });
  for (const { row } of rest) {
    unmatched.push({
      ...row,
      reason: `Vehicle later moved to deal ${accepted.row.dealNumberRaw} (currently on this contract)`,
    });
  }
}

// ---------------------------------------------------------------------------
// Assign statement tags: the bank batch's curated tag where we have one,
// else the app's own surname + collision-counter rule, checked against
// every tag already taken (existing contracts + tags assigned so far).
// ---------------------------------------------------------------------------

const takenTags = new Set(
  (contracts ?? [])
    .map((c) => c.statement_tag?.toUpperCase())
    .filter((t) => !!t)
);

// The curated tag isn't guaranteed unique even within the bank batch
// sample itself — the same tag legitimately gets reused across different
// historical deals for the same surname in the client's old system (only
// one was ever active at a time there), so it still needs the same
// collision check/counter as an auto-generated tag, not a blind pass-through.
function claimTag(base) {
  if (!takenTags.has(base)) {
    takenTags.add(base);
    return base;
  }
  let n = 2;
  while (takenTags.has(`${base}${n}`)) n++;
  const tag = `${base}${n}`;
  takenTags.add(tag);
  return tag;
}

function assignTag(dealNumber, clientId) {
  const curated = dealNumber ? tagByDealNumber.get(dealNumber) : undefined;
  if (curated) return claimTag(curated.toUpperCase());
  return claimTag(extractSurnameTag(clientNameById.get(clientId)));
}

const updates = [];
for (const { row, contract } of matchedByContractId.values()) {
  const statementTag = contract.statement_tag ?? assignTag(row.dealNumber, contract.client_id);
  updates.push({ contractId: contract.id, dealNumber: row.dealNumber, statementTag, row });
}

// ---------------------------------------------------------------------------
// Report + write.
// ---------------------------------------------------------------------------

console.log(`\nMatched:   ${updates.length}`);
console.log(`Unmatched: ${unmatched.length} (-> unmatched Excel)`);
console.log(`Conflicts: ${conflicts.length} (-> conflicts Excel)`);

const failedWrites = [];

if (!DRY_RUN) {
  let written = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("contracts")
      .update({ deal_number: u.dealNumber, statement_tag: u.statementTag })
      .eq("id", u.contractId);
    if (error) {
      console.error(`Failed to update contract ${u.contractId} (deal ${u.dealNumber}):`, error.message);
      failedWrites.push({ ...u.row, reason: `Write failed: ${error.message}` });
    } else {
      written++;
    }
  }
  console.log(`\nWrote ${written} of ${updates.length} matched contracts.`);
  if (failedWrites.length > 0) {
    console.log(`${failedWrites.length} failed to write (-> failed-writes Excel) — re-run to retry them.`);
  }
} else {
  console.log("\n--dry-run — nothing written to the database.");
}

async function writeReportExcel(path, title, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Review");
  sheet.addRow([title]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([]);
  const headerRow = sheet.addRow(["Deal", "Workstate", "Customer name", "File number", "Vehicle", "Reason"]);
  headerRow.font = { bold: true };
  for (const r of rows) {
    sheet.addRow([r.dealNumberRaw, r.workstate, r.customerName, r.fileNoRaw, r.plateRaw, r.reason]);
  }
  sheet.columns.forEach((col) => {
    col.width = Math.min(
      40,
      Math.max(12, ...col.values.filter((v) => v != null).map((v) => String(v).length))
    );
  });
  await workbook.xlsx.writeFile(path);
  console.log(`Wrote ${rows.length} rows to ${path}`);
}

if (unmatched.length > 0 || conflicts.length > 0 || failedWrites.length > 0) {
  mkdirSync(".import-reports", { recursive: true });
}
if (failedWrites.length > 0) {
  await writeReportExcel(
    ".import-reports/deal-number-backfill-failed-writes.xlsx",
    "Matched, but the database write itself failed — re-run to retry",
    failedWrites
  );
}
if (unmatched.length > 0) {
  await writeReportExcel(
    ".import-reports/deal-number-backfill-unmatched.xlsx",
    "Deals with no matching contract (by vehicle reg or file number)",
    unmatched
  );
}
if (conflicts.length > 0) {
  await writeReportExcel(
    ".import-reports/deal-number-backfill-conflicts.xlsx",
    "Deals not imported — ambiguous or conflicting match",
    conflicts
  );
}
