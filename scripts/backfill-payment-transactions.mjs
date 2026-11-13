#!/usr/bin/env node
/**
 * One-off backfill: imports the legacy system's full debit-order payment
 * ledger into payment_transactions, matched to contracts by deal_number
 * (already backfilled — see scripts/backfill-deal-numbers.mjs).
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-payment-transactions.mjs <payment_history.txt> [--dry-run]
 *
 * payment_history.txt: pipe-delimited, header
 * "Date|Account|Client|Type|Ref|Invoice|Amount|Cash effect|Reverses / reversed by".
 * Two row types:
 *   - RECEIPT: a debit-order collection recorded against an invoice
 *     (positive cash effect).
 *   - DEBIT NOTE: a reversal of an earlier receipt — the debit order
 *     bounced (negative cash effect). Always paired with a receipt via the
 *     "Reverses / reversed by" column, which names the other row's own Ref.
 * A receipt with no later debit note = the payment cleared. A receipt
 * followed by a debit note, then a fresh receipt against the *same*
 * invoice = a re-presented debit order.
 *
 * Matching policy:
 *   1. Normalize Account the same way deal numbers are normalized
 *      elsewhere (strip leading zeros, keep trailing letter suffix; also
 *      strips a stray trailing " Old"/" old" seen on a handful of rows)
 *      and look up the one contract with that deal_number. No match ->
 *      written to the "unmatched-accounts" Excel (grouped by account, not
 *      one row per transaction, since a whole account is either matched or
 *      not).
 *   2. (reference, invoice) is the natural key, not reference alone — the
 *      same debit-order reference can legitimately apply to two different
 *      invoices (confirmed in the real export). A handful of rows are
 *      exact full-row duplicates in the source file (silently
 *      deduplicated) or share a (reference, invoice) pair with
 *      conflicting field values (written to the "conflicting-rows" Excel,
 *      neither row imported).
 *
 * Import is two passes: insert every matched row first (reversed_
 * transaction_id left null), then a second pass resolves each row's
 * "Reverses / reversed by" text to the matching row's real id via the
 * same (reference, invoice) key and updates reversed_transaction_id —
 * can't be done in one pass since the target row might not exist yet.
 *
 * --dry-run parses, matches, and reports without writing to the database.
 * Always run it first. This file contains no banking/financial-account
 * data (just dates/amounts/references), so no masking is needed in the
 * review Excels.
 */

import "./guard-prod.mjs";
import { readFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import WebSocket from "ws";

const DRY_RUN = process.argv.includes("--dry-run");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const LEDGER_PATH = positional[0];

if (!LEDGER_PATH) {
  console.error(
    "Usage: node --env-file=.env.local scripts/backfill-payment-transactions.mjs <payment_history.txt> [--dry-run]"
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
// Normalization — same canonical form as the other backfill scripts, since
// contracts.deal_number is already stored normalized.
// ---------------------------------------------------------------------------

function normalizeDealNumber(raw) {
  if (!raw) return null;
  const v = raw.trim().toUpperCase().replace(/\s+OLD$/, "");
  const m = v.match(/^MAD0*(\d+)([A-Z]*)$/);
  if (!m) return v || null;
  return `MAD${m[1]}${m[2]}`;
}

function toIsoDate(ddmmyyyy) {
  const m = ddmmyyyy.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Parsing.
// ---------------------------------------------------------------------------

function parsePipeFile(path) {
  const text = readFileSync(path, "utf-8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(1) // header
    .map((line) => line.split("|"));
}

const COL = {
  DATE: 0,
  ACCOUNT: 1,
  CLIENT: 2,
  TYPE: 3,
  REF: 4,
  INVOICE: 5,
  AMOUNT: 6,
  CASH_EFFECT: 7,
  REVERSES: 8,
};

const TYPE_MAP = { RECEIPT: "receipt", "DEBIT NOTE": "debit_note" };

const parsedRows = parsePipeFile(LEDGER_PATH).map((cells) => ({
  dateRaw: (cells[COL.DATE] ?? "").trim(),
  transactionDate: toIsoDate(cells[COL.DATE] ?? ""),
  accountRaw: (cells[COL.ACCOUNT] ?? "").trim(),
  dealNumber: normalizeDealNumber(cells[COL.ACCOUNT]),
  client: (cells[COL.CLIENT] ?? "").trim(),
  typeRaw: (cells[COL.TYPE] ?? "").trim(),
  type: TYPE_MAP[(cells[COL.TYPE] ?? "").trim()],
  reference: (cells[COL.REF] ?? "").trim(),
  invoiceReference: (cells[COL.INVOICE] ?? "").trim(),
  amount: Number(cells[COL.AMOUNT]),
  cashEffect: Number(cells[COL.CASH_EFFECT]),
  reversalReference: (cells[COL.REVERSES] ?? "").trim() || null,
}));

console.log(`Parsed ${parsedRows.length} ledger rows from ${LEDGER_PATH}.`);

// ---------------------------------------------------------------------------
// Dedupe exact full-row duplicates (a handful exist in the source file);
// flag (reference, invoice) pairs that disagree on anything else as
// conflicting — never guess which version is right.
// ---------------------------------------------------------------------------

const rowSignature = (r) =>
  `${r.dateRaw}|${r.accountRaw}|${r.typeRaw}|${r.reference}|${r.invoiceReference}|${r.amount}|${r.cashEffect}|${r.reversalReference ?? ""}`;

const byKey = new Map(); // "reference||invoice" -> row[]
for (const row of parsedRows) {
  const key = `${row.reference}||${row.invoiceReference}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(row);
}

const rows = [];
const conflictingRows = [];
for (const group of byKey.values()) {
  const distinctSignatures = new Set(group.map(rowSignature));
  if (distinctSignatures.size === 1) {
    rows.push(group[0]); // exact duplicates collapse to one
    continue;
  }
  for (const row of group) {
    conflictingRows.push({ ...row, reason: "Same (reference, invoice) pair has conflicting field values across rows" });
  }
}

console.log(`${parsedRows.length - rows.length - conflictingRows.length} exact-duplicate rows collapsed.`);
if (conflictingRows.length > 0) {
  console.log(`${conflictingRows.length} rows withheld as conflicting (-> conflicting-rows Excel).`);
}

// ---------------------------------------------------------------------------
// Load contracts with a deal_number and match each row's account to one.
// ---------------------------------------------------------------------------

const { data: contracts, error: contractsError } = await supabase
  .from("contracts")
  .select("id, deal_number")
  .not("deal_number", "is", null);

if (contractsError) {
  console.error("Failed to load contracts:", contractsError.message);
  process.exit(1);
}

const contractIdByDealNumber = new Map();
for (const c of contracts ?? []) {
  contractIdByDealNumber.set(normalizeDealNumber(c.deal_number), c.id);
}

const matchedByAccount = new Map(); // dealNumber -> contractId, for rows actually used
const unmatchedAccounts = new Map(); // dealNumber|accountRaw -> { accountRaw, client, count }
const matchedRows = [];

for (const row of rows) {
  const contractId = row.dealNumber ? contractIdByDealNumber.get(row.dealNumber) : undefined;
  if (!contractId) {
    const key = row.dealNumber ?? row.accountRaw;
    if (!unmatchedAccounts.has(key)) {
      unmatchedAccounts.set(key, { accountRaw: row.accountRaw, client: row.client, count: 0 });
    }
    unmatchedAccounts.get(key).count++;
    continue;
  }
  matchedByAccount.set(row.dealNumber, contractId);
  matchedRows.push({ ...row, contractId });
}

console.log(`\nMatched accounts:   ${matchedByAccount.size} (${matchedRows.length} transaction rows)`);
console.log(`Unmatched accounts: ${unmatchedAccounts.size} (-> unmatched-accounts Excel)`);

// ---------------------------------------------------------------------------
// Pass 1: upsert every matched row (reversed_transaction_id left null).
// Pass 2: resolve reversal pairs via (reference, invoice) and update
// reversed_transaction_id — the target row might not have existed yet
// during pass 1.
// ---------------------------------------------------------------------------

const failedWrites = [];

if (!DRY_RUN) {
  const BATCH_SIZE = 500;
  let written = 0;
  // Built from each batch's own upsert response — not a separate re-query,
  // which would silently cap at PostgREST's default row limit (bit us on
  // the first run: only 360 of 1204 links resolved with 3610 rows written).
  const idByRefInvoice = new Map();
  for (let i = 0; i < matchedRows.length; i += BATCH_SIZE) {
    const batch = matchedRows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("payment_transactions")
      .upsert(
        batch.map((r) => ({
          contract_id: r.contractId,
          transaction_date: r.transactionDate,
          type: r.type,
          reference: r.reference,
          invoice_reference: r.invoiceReference,
          amount: r.amount,
          cash_effect: r.cashEffect,
          reversal_reference: r.reversalReference,
        })),
        { onConflict: "reference,invoice_reference" }
      )
      .select("id, reference, invoice_reference");
    if (error) {
      console.error(`Failed to write batch ${i}-${i + batch.length}:`, error.message);
      failedWrites.push(...batch.map((r) => ({ ...r, reason: `Write failed: ${error.message}` })));
    } else {
      written += batch.length;
      for (const t of data ?? []) {
        idByRefInvoice.set(`${t.reference}||${t.invoice_reference}`, t.id);
      }
    }
  }
  console.log(`\nWrote ${written} of ${matchedRows.length} payment transactions.`);
  if (failedWrites.length > 0) {
    console.log(`${failedWrites.length} failed to write (-> failed-writes Excel) — re-run to retry them.`);
  }

  // Pass 2: resolve reversal links using the ids captured above.
  const toResolve = matchedRows.filter((r) => r.reversalReference);
  console.log(`\nResolving ${toResolve.length} reversal links...`);

  let linked = 0;
  let linkFailed = 0;
  for (const r of toResolve) {
    const selfId = idByRefInvoice.get(`${r.reference}||${r.invoiceReference}`);
    const targetId = idByRefInvoice.get(`${r.reversalReference}||${r.invoiceReference}`);
    if (!selfId || !targetId) continue; // target wasn't matched/written — leave reversal_reference as the only record
    const { error } = await supabase
      .from("payment_transactions")
      .update({ reversed_transaction_id: targetId })
      .eq("id", selfId);
    if (error) {
      linkFailed++;
    } else {
      linked++;
    }
  }
  console.log(`Linked ${linked} reversal pairs.${linkFailed > 0 ? ` ${linkFailed} link updates failed.` : ""}`);
} else {
  console.log("\n--dry-run — nothing written to the database.");
}

// ---------------------------------------------------------------------------
// Reports.
// ---------------------------------------------------------------------------

async function writeUnmatchedAccountsExcel(path) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Review");
  sheet.addRow(["Ledger accounts with no matching contract deal_number"]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([]);
  const headerRow = sheet.addRow(["Account", "Client (as seen in ledger)", "Transaction rows affected"]);
  headerRow.font = { bold: true };
  for (const { accountRaw, client, count } of unmatchedAccounts.values()) {
    sheet.addRow([accountRaw, client, count]);
  }
  sheet.columns.forEach((col) => {
    col.width = Math.min(50, Math.max(14, ...col.values.filter((v) => v != null).map((v) => String(v).length)));
  });
  await workbook.xlsx.writeFile(path);
  console.log(`Wrote ${unmatchedAccounts.size} rows to ${path}`);
}

async function writeRowsExcel(path, title, rowsToWrite) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Review");
  sheet.addRow([title]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([]);
  const headerRow = sheet.addRow(["Date", "Account", "Client", "Type", "Ref", "Invoice", "Amount", "Cash effect", "Reverses", "Reason"]);
  headerRow.font = { bold: true };
  for (const r of rowsToWrite) {
    sheet.addRow([
      r.dateRaw,
      r.accountRaw,
      r.client,
      r.typeRaw,
      r.reference,
      r.invoiceReference,
      r.amount,
      r.cashEffect,
      r.reversalReference ?? "",
      r.reason,
    ]);
  }
  sheet.columns.forEach((col) => {
    col.width = Math.min(45, Math.max(10, ...col.values.filter((v) => v != null).map((v) => String(v).length)));
  });
  await workbook.xlsx.writeFile(path);
  console.log(`Wrote ${rowsToWrite.length} rows to ${path}`);
}

if (unmatchedAccounts.size > 0 || conflictingRows.length > 0 || failedWrites.length > 0) {
  mkdirSync(".import-reports", { recursive: true });
}
if (failedWrites.length > 0) {
  await writeRowsExcel(
    ".import-reports/payment-transactions-backfill-failed-writes.xlsx",
    "Matched, but the database write itself failed — re-run to retry",
    failedWrites
  );
}
if (unmatchedAccounts.size > 0) {
  await writeUnmatchedAccountsExcel(".import-reports/payment-transactions-backfill-unmatched-accounts.xlsx");
}
if (conflictingRows.length > 0) {
  await writeRowsExcel(
    ".import-reports/payment-transactions-backfill-conflicting-rows.xlsx",
    "Not written — conflicting duplicate rows in the source ledger",
    conflictingRows
  );
}
