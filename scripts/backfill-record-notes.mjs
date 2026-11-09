#!/usr/bin/env node
/**
 * One-off backfill for the activity-log feature's Phase 1 (SPEC item 39):
 * migrates every existing free-text `notes` value (clients, contracts,
 * vehicle_costs, insurance_claims — vehicles has no `notes` column) into
 * one `record_notes` row per record, so the old text isn't lost once the
 * UI stops reading the column directly. `created_by` is left null (no
 * real author exists for this historical text) and is rendered as
 * "(imported)" by the Activity feed. The imported entry's timestamp uses
 * `updated_at` where the source table has one (clients, contracts,
 * insurance_claims — bumped on every write, so it reflects the last time
 * the notes text actually changed), falling back to `created_at` only
 * for vehicle_costs, which has neither.
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

// Tables with an `updated_at` bumped by an unconditional `set_updated_at()`
// trigger on every write — a far better proxy for "when was this note
// text actually written" than `created_at` (a row's creation time, e.g.
// the Oct 23 fleet reload import, is unrelated to a later UPDATE that
// only touched `notes`, like the Oct 28 arrears-update script).
// vehicle_costs has neither trigger nor column, so falls back to
// created_at there.
const HAS_UPDATED_AT = new Set(["clients", "contracts", "insurance_claims"]);

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
    rowsToInsert.push({
      entity_type: table,
      entity_id: row.id,
      note: row.notes.trim(),
      created_by: null,
      created_at: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    });
  }
}

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
