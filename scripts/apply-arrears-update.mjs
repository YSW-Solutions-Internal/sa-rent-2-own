// Turns the client's "SAR2O arrears update and follow up and end contracts" workbook into a guarded SQL patch
// (never executes it) plus a review list of everything that didn't match.
// Usage: node --env-file=.env.local scripts/apply-arrears-update.mjs "data/<workbook>.xlsx"
// Output: .import-reports/reload/arrears-update-<date>.sql and .txt
//
// ARREARS sheet  -> per matched contract (by deal number, zero-padding ignored): arrears_amount, installment_amount
//                   (when different), is_paid_up=false when in arrears, and a notes block with status/arrangement/comment.
// ENDED CONTRACTS -> per vehicle (by current plate): odometer, and a notes block on its contract with the extension details.
// Read-only against the database; the SQL it writes is applied by hand after a backup.
import "./guard-prod.mjs";
import { createRequire } from "node:module";
import fs from "node:fs";

const req = createRequire(new URL("../package.json", import.meta.url));
const XLSX = req("xlsx");
const { createClient } = req("@supabase/supabase-js");

const path = process.argv[2];
if (!path) throw new Error('usage: apply-arrears-update.mjs "<workbook>.xlsx"');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const wb = XLSX.readFile(path);
const sheet = (name) =>
  XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: false }).slice(2).filter((r) => r[0]);

const ARREARS_MARK = "[Arrears update Oct 2026]";
const ENDED_MARK = "[Contract end review Oct 2026]";
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const money = (v) => (v == null || String(v).trim() === "" ? null : Number(String(v).replace(/[^0-9.\-]/g, "")));
const rand = (n) => `R${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const normDeal = (x) => {
  const m = String(x).toUpperCase().match(/^MAD0*(\d+)([A-Z])/);
  return m ? `MAD${m[1]}${m[2]}` : String(x).split("_")[0].trim().toUpperCase();
};
const dmy = (s) => {
  const m = String(s ?? "").match(/(\d+)\/(\d+)\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};
const PLAIN_STATUS = new Set(["PAID DEBIT ORDER", "PAID EFT"]);

const { data: contracts } = await db
  .from("contracts")
  .select("id, deal_number, vehicle_id, installment_amount, arrears_amount, notes");
const byDeal = new Map();
for (const c of contracts) if (c.deal_number) byDeal.set(normDeal(c.deal_number), c);

const sql = [];
const review = [];
const unmatched = [];
const blankArrears = [];
let nArrears = 0, nInst = 0, nNotes = 0;

sql.push(`-- Arrears update + ended contracts, from "${path.split("/").pop()}". One transaction; each statement must hit at most 1 row.`);
sql.push(`begin;`);
sql.push(`create function pg_temp.chk(label text, n bigint) returns void language plpgsql as $f$ begin
  if n > 1 then raise exception '% updated % rows (expected at most 1)', label, n; end if;
  if n = 0 then raise notice 'NO MATCH (nothing changed): %', label; end if;
end $f$;`);

const noteSql = (id, mark, text, label) => {
  nNotes++;
  const block = `${mark} ${text}`;
  sql.push(
    `with u as (update public.contracts set notes = coalesce(nullif(notes, '') || E'\\n\\n', '') || ${q(block)} where id = ${q(id)} and (notes is null or notes not like ${q(`%${mark}%`)}) returning 1) select pg_temp.chk(${q(label)}, count(*)) from u;`
  );
};

// ---- ARREARS ----
for (const r of sheet("ARREARS")) {
  const [ref, instRaw, status, arrRaw, arrangement, comment] = r;
  const c = byDeal.get(normDeal(ref));
  if (!c) {
    unmatched.push(`${ref} | ${instRaw} | ${status} | arrears ${arrRaw ?? "(blank)"}`);
    continue;
  }
  const inst = money(instRaw);
  const arrears = money(arrRaw);
  const sets = [];
  if (arrears !== null) {
    sets.push(`arrears_amount = ${arrears}`);
    if (arrears > 0) sets.push(`is_paid_up = false`);
    nArrears++;
  } else blankArrears.push(`${ref} (${status})`);
  if (inst !== null && inst > 0 && Math.abs(inst - Number(c.installment_amount ?? 0)) > 0.5) {
    sets.push(`installment_amount = ${inst}`);
    nInst++;
    review.push(`installment ${ref}: ${c.installment_amount ?? "—"} -> ${inst}`);
  }
  if (sets.length) {
    sql.push(`with u as (update public.contracts set ${sets.join(", ")} where id = ${q(c.id)} returning 1) select pg_temp.chk(${q(ref)}, count(*)) from u;`);
  }
  const parts = [];
  if (status && (!PLAIN_STATUS.has(status.trim().toUpperCase()) || comment)) parts.push(`Status: ${status.trim()}.`);
  if (arrangement && arrangement.trim().toLowerCase() !== "none") parts.push(`Arrangement: ${arrangement.trim()}.`);
  if (arrangement && arrangement.trim().toLowerCase() === "none") parts.push(`No payment arrangement.`);
  if (arrears !== null && arrears > 0) parts.push(`Arrears: ${rand(arrears)}.`);
  if (comment) parts.push(String(comment).trim());
  if (comment || parts.length > 1) noteSql(c.id, ARREARS_MARK, parts.join(" "), `${ref} notes`);
}

// ---- ENDED CONTRACTS ----
const ended = [];
for (const r of sheet("ENDED CONTRACTS")) {
  const [regRaw, location, km, , , instRaw, endRaw, collected, extension, endPay, revised, comment] = r;
  const plate = regRaw.replace(/\s/g, "").toUpperCase();
  const { data: reg } = await db.from("vehicle_registrations").select("vehicle_id").eq("plate_number", plate).is("effective_to", null).maybeSingle();
  const cs = reg ? contracts.filter((c) => c.vehicle_id === reg.vehicle_id) : [];
  if (!reg || cs.length !== 1) {
    ended.push(`${plate}: ${!reg ? "no vehicle" : `${cs.length} contracts`} — skipped`);
    continue;
  }
  const odo = km ? Number(String(km).replace(/[^0-9]/g, "")) : null;
  if (odo) {
    sql.push(`with u as (update public.vehicles set current_mileage = ${odo} where id = ${q(reg.vehicle_id)} returning 1) select pg_temp.chk(${q(`${plate} odometer`)}, count(*)) from u;`);
  }
  const parts = [`Original contract end ${dmy(endRaw) ?? endRaw}.`];
  if (money(collected) != null) parts.push(`Collections over 3 years: ${rand(money(collected))}.`);
  if (extension) parts.push(`Proposed extension: ${extension.trim()}.`);
  if (money(endPay) != null) parts.push(`Expected end payment: ${rand(money(endPay))}.`);
  if (money(revised) != null) parts.push(`Revised expected end payment: ${rand(money(revised))}.`);
  if (comment) parts.push(String(comment).trim());
  noteSql(cs[0].id, ENDED_MARK, parts.join(" "), `${plate} contract-end notes`);
  ended.push(`${plate}: odometer ${odo ?? "—"}, notes added`);
}

sql.push(`commit;`);

const inSheet = new Set(sheet("ARREARS").map((r) => normDeal(r[0])));
const missing = contracts.filter((c) => c.deal_number && !inSheet.has(normDeal(c.deal_number))).map((c) => c.deal_number);
const report = [
  `Arrears amounts set: ${nArrears} | instalments changed: ${nInst} | notes blocks: ${nNotes}`,
  ``, `NOT IN OUR DATABASE (${unmatched.length}) — no changes made:`, ...unmatched,
  ``, `BLANK ARREARS in the sheet (${blankArrears.length}) — arrears left as is:`, ...blankArrears,
  ``, `OUR CONTRACTS NOT IN THE SHEET (${missing.length}):`, missing.join(", "),
  ``, `ENDED CONTRACTS:`, ...ended,
  ``, `INSTALMENT CHANGES:`, ...review,
].join("\n");

fs.mkdirSync(".import-reports/reload", { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(`.import-reports/reload/arrears-update-${stamp}.sql`, sql.join("\n") + "\n");
fs.writeFileSync(`.import-reports/reload/arrears-update-${stamp}.txt`, report + "\n");
console.log(report.split("\n").slice(0, 40).join("\n"));
