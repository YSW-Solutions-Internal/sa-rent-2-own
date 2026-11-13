#!/usr/bin/env node
/**
 * One-off backfill: populates client_banking_details from a bank
 * debit-order batch file, matched to contracts via deal_number (already
 * backfilled onto contracts by scripts/backfill-deal-numbers.mjs).
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-client-banking.mjs <bank-batch.txt> [--dry-run]
 *
 * bank-batch.txt: pipe-delimited bank debit-order batch sample. Its "my
 * statement description" column embeds "{dealNumber}_{tag}"; "collectee
 * account number" / "bank name" / "collectee account branch code" /
 * "collectee name" are the client's real banking details.
 *
 * Matching policy:
 *   1. Extract the deal number from each row's statement description and
 *      look up the one contract with that deal_number. No match -> written
 *      to the "unmatched" Excel.
 *   2. A client can have more than one deal (contract); if the batch gives
 *      different banking details across that client's deals, it's a
 *      genuine conflict (can't tell which is current) -> written to the
 *      "conflicts" Excel, nothing written for that client. Identical
 *      details across deals collapse to a single write.
 *   3. Overwrite policy: this script OVERWRITES bank_name, branch_code,
 *      and the encrypted account number/holder name on any existing
 *      client_banking_details row (client-confirmed). account_type isn't
 *      present in the batch file and is never touched here — it keeps
 *      its existing value on an overwrite, and the schema's 'other'
 *      default applies on first insert.
 *
 * --dry-run parses and matches everything, prints the summary, and writes
 * both Excel files, without writing anything to the database or requiring
 * BANKING_ENCRYPTION_KEY. Always run it first. Review Excels never contain
 * full account numbers — masked to last 4 digits, same as the app's UI.
 */

import "./guard-prod.mjs";
import { readFileSync, mkdirSync } from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import WebSocket from "ws";

const DRY_RUN = process.argv.includes("--dry-run");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const BATCH_PATH = positional[0];

if (!BATCH_PATH) {
  console.error(
    "Usage: node --env-file=.env.local scripts/backfill-client-banking.mjs <bank-batch.txt> [--dry-run]"
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
// Encryption — mirrors src/lib/crypto.ts's encryptField exactly (same
// algorithm, IV length, and ciphertext-then-authTag base64 packing), so the
// app's existing decrypt path reads these rows with no special-casing.
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const CURRENT_KEY_VERSION = 1;

function getEncryptionKey() {
  const base64Key = process.env.BANKING_ENCRYPTION_KEY;
  if (!base64Key) {
    console.error("Missing BANKING_ENCRYPTION_KEY. Run with --env-file=.env.local.");
    process.exit(1);
  }
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    console.error(`BANKING_ENCRYPTION_KEY must decode to 32 bytes for AES-256 (got ${key.length}).`);
    process.exit(1);
  }
  return key;
}

function encryptField(key, plaintext) {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

function lastFour(accountNumber) {
  const digits = accountNumber.replace(/\D/g, "");
  return digits.slice(-4);
}

// ---------------------------------------------------------------------------
// Normalization — same canonical form as scripts/backfill-deal-numbers.mjs,
// since contracts.deal_number is already stored normalized by that script.
// ---------------------------------------------------------------------------

function normalizeDealNumber(raw) {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  const m = v.match(/^MAD0*(\d+)([A-Z]*)$/);
  if (!m) return v || null;
  return `MAD${m[1]}${m[2]}`;
}

// ---------------------------------------------------------------------------
// Parsing — positional, not header-name-based: the header has inconsistent
// quoting/dagger marks that make name lookups unreliable (see
// backfill-deal-numbers.mjs, which hit the same issue with this file).
// ---------------------------------------------------------------------------

function parsePipeFile(path) {
  const text = readFileSync(path, "utf-8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(1) // header
    .map((line) => line.split("|"));
}

const BATCH_COL = {
  STATEMENT_DESC: 2,
  ACCOUNT_NUMBER: 3,
  BANK_NAME: 5,
  BRANCH_CODE: 6,
  ACCOUNT_HOLDER_NAME: 7,
};

const bankRows = parsePipeFile(BATCH_PATH).map((cells) => {
  const statementDescRaw = (cells[BATCH_COL.STATEMENT_DESC] ?? "").trim();
  const underscoreIdx = statementDescRaw.indexOf("_");
  const dealNumberRaw = underscoreIdx === -1 ? statementDescRaw : statementDescRaw.slice(0, underscoreIdx);
  return {
    statementDescRaw,
    dealNumberRaw,
    dealNumber: normalizeDealNumber(dealNumberRaw),
    accountNumber: (cells[BATCH_COL.ACCOUNT_NUMBER] ?? "").trim(),
    bankName: (cells[BATCH_COL.BANK_NAME] ?? "").trim(),
    branchCode: (cells[BATCH_COL.BRANCH_CODE] ?? "").trim(),
    holderName: (cells[BATCH_COL.ACCOUNT_HOLDER_NAME] ?? "").trim(),
  };
});

console.log(`Parsed ${bankRows.length} bank batch rows from ${BATCH_PATH}.`);

// ---------------------------------------------------------------------------
// Load contracts that already have a deal_number (from the prior backfill)
// and existing client_banking_details, to know which clients already have
// a row (so we can report create vs. overwrite counts before writing).
// ---------------------------------------------------------------------------

const [{ data: contracts, error: contractsError }, { data: existingBanking, error: bankingError }] =
  await Promise.all([
    supabase.from("contracts").select("id, client_id, deal_number").not("deal_number", "is", null),
    supabase.from("client_banking_details").select("client_id"),
  ]);

for (const [name, err] of [
  ["contracts", contractsError],
  ["client_banking_details", bankingError],
]) {
  if (err) {
    console.error(`Failed to load ${name}:`, err.message);
    process.exit(1);
  }
}

const contractByDealNumber = new Map();
for (const c of contracts ?? []) {
  const norm = normalizeDealNumber(c.deal_number);
  if (contractByDealNumber.has(norm)) {
    console.warn(`Warning: more than one contract has deal_number ${norm} — keeping the first.`);
    continue;
  }
  contractByDealNumber.set(norm, c);
}

const existingClientIds = new Set((existingBanking ?? []).map((r) => r.client_id));

// ---------------------------------------------------------------------------
// Match each bank row to a contract/client, then group by client — a
// client can have more than one deal, and the batch must agree on their
// banking details across all of them to be written.
// ---------------------------------------------------------------------------

const unmatched = [];
const conflicts = [];
const rowsByClientId = new Map(); // client_id -> [{ bankRow, contract }]

for (const bankRow of bankRows) {
  const contract = bankRow.dealNumber ? contractByDealNumber.get(bankRow.dealNumber) : undefined;
  if (!contract) {
    unmatched.push({ ...bankRow, reason: "No contract with this deal number" });
    continue;
  }
  if (!bankRow.accountNumber || !bankRow.bankName || !bankRow.holderName) {
    unmatched.push({ ...bankRow, reason: "Missing bank name, account number, or account holder name" });
    continue;
  }
  if (!rowsByClientId.has(contract.client_id)) rowsByClientId.set(contract.client_id, []);
  rowsByClientId.get(contract.client_id).push({ bankRow, contract });
}

const signature = (bankRow) =>
  `${bankRow.bankName}|${bankRow.branchCode}|${bankRow.accountNumber}|${bankRow.holderName}`;

const toWrite = []; // { clientId, dealNumbers, bankName, branchCode, accountNumber, holderName }

for (const [clientId, entries] of rowsByClientId) {
  const distinctSignatures = new Set(entries.map((e) => signature(e.bankRow)));
  if (distinctSignatures.size > 1) {
    const dealNumbers = entries.map((e) => e.bankRow.dealNumberRaw).join(", ");
    for (const { bankRow } of entries) {
      conflicts.push({
        ...bankRow,
        reason: `Client has ${distinctSignatures.size} different banking entries across their deals (${dealNumbers}) — can't tell which is current`,
      });
    }
    continue;
  }
  const { bankRow } = entries[0];
  toWrite.push({
    clientId,
    dealNumbers: entries.map((e) => e.bankRow.dealNumberRaw),
    bankName: bankRow.bankName,
    branchCode: bankRow.branchCode || null,
    accountNumber: bankRow.accountNumber,
    holderName: bankRow.holderName,
  });
}

// ---------------------------------------------------------------------------
// Report + write.
// ---------------------------------------------------------------------------

const toCreate = toWrite.filter((w) => !existingClientIds.has(w.clientId)).length;
const toOverwrite = toWrite.filter((w) => existingClientIds.has(w.clientId)).length;

console.log(`\nMatched:   ${toWrite.length} (${toCreate} new, ${toOverwrite} will overwrite an existing row)`);
console.log(`Unmatched: ${unmatched.length} (-> unmatched Excel)`);
console.log(`Conflicts: ${conflicts.length} (-> conflicts Excel)`);

const failedWrites = [];

if (!DRY_RUN) {
  const key = getEncryptionKey();
  let written = 0;
  for (const w of toWrite) {
    const accountEnc = encryptField(key, w.accountNumber);
    const holderEnc = encryptField(key, w.holderName);
    const { error } = await supabase.from("client_banking_details").upsert(
      {
        client_id: w.clientId,
        bank_name: w.bankName,
        branch_code: w.branchCode,
        account_holder_name_encrypted: holderEnc.ciphertext,
        account_holder_name_iv: holderEnc.iv,
        account_number_encrypted: accountEnc.ciphertext,
        account_number_iv: accountEnc.iv,
        account_number_last4: lastFour(w.accountNumber),
        key_version: CURRENT_KEY_VERSION,
      },
      { onConflict: "client_id" }
    );
    if (error) {
      console.error(`Failed to write banking details for client ${w.clientId} (deals ${w.dealNumbers.join(", ")}):`, error.message);
      failedWrites.push({ ...w, reason: `Write failed: ${error.message}` });
    } else {
      written++;
    }
  }
  console.log(`\nWrote ${written} of ${toWrite.length} client banking records.`);
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
  const headerRow = sheet.addRow(["Deal", "Bank name", "Branch code", "Account (last 4)", "Account holder", "Reason"]);
  headerRow.font = { bold: true };
  for (const r of rows) {
    sheet.addRow([
      r.dealNumberRaw,
      r.bankName,
      r.branchCode,
      r.accountNumber ? lastFour(r.accountNumber) : "",
      r.holderName,
      r.reason,
    ]);
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

async function writeFailedWritesExcel(path, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Review");
  sheet.addRow(["Matched, but the database write itself failed — re-run to retry"]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([]);
  const headerRow = sheet.addRow(["Client ID", "Deals", "Bank name", "Branch code", "Account (last 4)", "Reason"]);
  headerRow.font = { bold: true };
  for (const r of rows) {
    sheet.addRow([r.clientId, r.dealNumbers.join(", "), r.bankName, r.branchCode, lastFour(r.accountNumber), r.reason]);
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
  await writeFailedWritesExcel(".import-reports/client-banking-backfill-failed-writes.xlsx", failedWrites);
}
if (unmatched.length > 0) {
  await writeReportExcel(
    ".import-reports/client-banking-backfill-unmatched.xlsx",
    "Bank batch rows with no matching contract deal_number",
    unmatched
  );
}
if (conflicts.length > 0) {
  await writeReportExcel(
    ".import-reports/client-banking-backfill-conflicts.xlsx",
    "Not written — a client's deals disagree on banking details",
    conflicts
  );
}
