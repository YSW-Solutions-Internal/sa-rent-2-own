#!/usr/bin/env node
/**
 * One-off backfill for the activity-log feature's Phase 1 (SPEC item 39):
 * migrates every existing free-text `notes` value (clients, contracts,
 * vehicle_costs, insurance_claims — vehicles has no `notes` column) into
 * one `record_notes` row per record, so the old text isn't lost once the
 * UI stops reading the column directly. `created_by` is left null (no
 * real author exists for this historical text) and is rendered as
 * "(imported)" by the Activity feed.
 *
 * The imported entry's timestamp is the *earliest* audit_log row for that
 * record where the notes field first became non-empty (audit_log has
 * logged every contracts/clients/vehicle_costs/insurance_claims write
 * since migration 20261029100000, which predates every notes-writing
 * script this repo has — confirmed against prod: a contract's real
 * arrears-update date, 2026-10-28, only shows up this way, not as
 * row.created_at (the Oct 23 import date) or row.updated_at, which turned
 * out to be contaminated by later, unrelated writes to the same row —
 * both were tried and rejected before this version). Falls back to
 * row.updated_at, then row.created_at, only for a record audit_log has
 * no matching history for at all.
 *
 * Deliberately not split by the `[Arrears update Oct 2026]` /
 * `[Contract end review Oct 2026]` markers some contracts.notes values
 * carry (item 24) — each record's whole notes value becomes one imported
 * entry. Splitting those into separately-dated entries was flagged as a
 * nice-to-have, not required, and there's no real per-block timestamp to
 * split on anyway (the marker is just a text label).
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-record-notes.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-record-notes.mjs
 *
 * Always run --dry-run first. The real run refuses to proceed if
 * record_notes already has any imported (created_by IS NULL) row, so it
 * can't double-insert on a second accidental run.
 */

import "./guard-prod.mjs";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

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
});

const SOURCE_TABLES = ["clients", "contracts", "vehicle_costs", "insurance_claims"];
const HAS_UPDATED_AT = new Set(["clients", "contracts", "insurance_claims"]);

/** A page of audit_log can hold any shape of diff depending on the action
 * that produced it: insert/delete store the row flat (to_jsonb(row)),
 * update stores {before, after}. Either way, pull out whatever `notes`
 * value that row left the record with. */
function notesFromAuditRow(row) {
  const notes = row.action === "update" ? row.diff?.after?.notes : row.diff?.notes;
  return typeof notes === "string" ? notes : null;
}

/** Earliest audit_log timestamp, per (table_name, record_id), where notes
 * first became a non-empty value — paginated since a table's full history
 * can exceed PostgREST's 1,000-row default cap. */
async function earliestNonEmptyNotesDates(tableNames) {
  const earliest = new Map(); // `${table_name}:${record_id}` -> ISO timestamp
  const PAGE_SIZE = 1000;
  let page = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("audit_log")
      .select("table_name, record_id, action, diff, created_at")
      .in("table_name", tableNames)
      .in("action", ["insert", "update"])
      .order("created_at", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (error) {
      console.error(`Failed to read audit_log: ${error.message}`);
      process.exit(1);
    }
    for (const row of data) {
      const notes = notesFromAuditRow(row);
      if (!notes || !notes.trim()) continue;
      const key = `${row.table_name}:${row.record_id}`;
      // Rows are already fetched oldest-first, so the first match per key
      // is the earliest — no comparison needed, just don't overwrite it.
      if (!earliest.has(key)) earliest.set(key, row.created_at);
    }
    if (data.length < PAGE_SIZE) break;
    page += 1;
  }
  return earliest;
}

const earliestNotesDate = await earliestNonEmptyNotesDates(SOURCE_TABLES);

const rowsToInsert = [];
const perTableCounts = {};

for (const table of SOURCE_TABLES) {
  const columns = HAS_UPDATED_AT.has(table) ? "id, notes, created_at, updated_at" : "id, notes, created_at";
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .not("notes", "is", null)
    .neq("notes", "");

  if (error) {
    console.error(`Failed to read ${table}: ${error.message}`);
    process.exit(1);
  }

  perTableCounts[table] = data.length;
  for (const row of data) {
    const auditDate = earliestNotesDate.get(`${table}:${row.id}`);
    rowsToInsert.push({
      entity_type: table,
      entity_id: row.id,
      note: row.notes.trim(),
      created_by: null,
      created_at: auditDate ?? row.updated_at ?? row.created_at ?? new Date().toISOString(),
    });
  }
}

const fromAuditLog = rowsToInsert.filter((r) => earliestNotesDate.has(`${r.entity_type}:${r.entity_id}`)).length;
console.log(`Timestamp source: ${fromAuditLog} from audit_log, ${rowsToInsert.length - fromAuditLog} fell back to updated_at/created_at.\n`);

console.log("Rows with notes to import:");
for (const table of SOURCE_TABLES) {
  console.log(`  ${table}: ${perTableCounts[table]}`);
}
console.log(`  total: ${rowsToInsert.length}`);

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written. First 5 rows:");
  console.log(JSON.stringify(rowsToInsert.slice(0, 5), null, 2));
  process.exit(0);
}

const { count: existingImported, error: countError } = await supabase
  .from("record_notes")
  .select("id", { count: "exact", head: true })
  .is("created_by", null);

if (countError) {
  console.error(`Failed to check for a prior run: ${countError.message}`);
  process.exit(1);
}
if (existingImported && existingImported > 0) {
  console.error(
    `record_notes already has ${existingImported} imported (created_by IS NULL) row(s) — looks like this already ran. Aborting to avoid duplicates.`
  );
  process.exit(1);
}

const { error: insertError } = await supabase.from("record_notes").insert(rowsToInsert);
if (insertError) {
  console.error(`Insert failed: ${insertError.message}`);
  process.exit(1);
}

console.log(`\nInserted ${rowsToInsert.length} row(s) into record_notes.`);
