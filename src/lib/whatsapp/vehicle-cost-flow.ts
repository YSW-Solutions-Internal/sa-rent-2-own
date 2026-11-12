import "server-only";

import { canEdit } from "@/lib/auth/permissions";
import type { Database, UserRole } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

import { downloadTwilioMedia } from "./twilio";
import { parseVehicleCostMessage } from "./vehicle-cost-parse";

/**
 * "Add a repair/car wash/maintenance/other cost" over WhatsApp — sibling of
 * service-flow.ts's "Add a service", but simpler: these cost types never
 * touch the vehicle's own mileage/next-service fields, so there's no km or
 * next-service date/km to ask for. The cost date defaults to the day the
 * message is sent, same as the service flow, unless the message itself names
 * one (common for a cost logged a few days after the fact).
 *
 * Also recognises a structured note with no command wording at all — e.g.
 * one copied straight off an invoice ("HY22CPGP POLO VIVO 1.4\nBATTERY
 * REPLACEMENT - 646D\nALBARAKAH AUTO SPARES JOZINI KZN\n11.11.2026\nR1450")
 * — and parses it in one shot (vehicle-cost-parse.ts, same approach as
 * service-flow.ts's service-parse.ts), asking only for whatever's missing.
 *
 * Deliberately a separate file rather than folded into service-flow.ts: the
 * service flow is live, carefully tuned production code (see its own
 * JF13MRGP/JF53YJGP incident note) — this keeps that one untouched. The two
 * flows share the whatsapp_flows queue table (one row each, discriminated by
 * `flow`), so they can be mid-conversation for the same phone at once, each
 * only recognising its own `flow` value — see loadActiveFlow below.
 */

const FLOW = "add_vehicle_cost";
const FLOW_TTL_MINUTES = 15;
const INVOICE_BUCKET = "vehicle-invoices";
const MAX_INVOICE_BYTES = 10 * 1024 * 1024;
const INVOICE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type CostType = "repair" | "car_wash" | "maintenance" | "other";
type Step = "reg" | "cost_type" | "place" | "amount" | "work" | "invoice" | "confirm";

interface FlowData {
  vehicleId?: string;
  reg?: string;
  vehicle?: string;
  costType?: CostType;
  costDate?: string;
  place?: string;
  amount?: number;
  workDone?: string | null;
  invoicePath?: string | null;
}

export interface FlowUser {
  id: string;
  fullName: string;
  role: UserRole;
}

/**
 * Who may record a non-service vehicle cost over WhatsApp. Admins only for
 * now (same as every other WhatsApp write path) — widen this one function,
 * e.g. to `role === "admin" || role === "manager"`, to open it up later; the
 * DB-side check (whatsapp_save_vehicle_cost) already allows manager too.
 */
function canUseFlow(role: UserRole): boolean {
  return canEdit(role);
}

const COST_TYPE_LABELS: Record<CostType, string> = {
  repair: "Repair",
  car_wash: "Car wash",
  maintenance: "Maintenance",
  other: "Other",
};

const QUESTIONS: Record<Exclude<Step, "confirm">, string> = {
  reg: "What's the registration number of the vehicle?",
  cost_type: "What type of cost is this?\n1. Repair\n2. Car wash\n3. Maintenance\n4. Other",
  place: "Who was it done by / paid to? (supplier or workshop name)",
  amount: "What was the total cost in rand? (e.g. 850 or R850.50)",
  work: "What exactly was done? Type it, or tap No to skip.",
  invoice: "Do you have a photo or copy of the invoice/receipt? Send it now, or tap No to skip.",
};

// Deliberately excludes "service" — that word is service-flow.ts's own
// trigger, kept there so the two flows never both think a message is theirs.
const START_RE = /\b(add|log|record|capture|enter|new)\s+(a\s+|the\s+|new\s+)*(cost|repair|car\s*wash|maintenance)\b/i;

/** The specific cost-type word in the trigger message, if any — "add a cost" alone has none, so cost_type still gets asked. */
function inferCostType(text: string): CostType | null {
  if (/\brepair/i.test(text)) return "repair";
  if (/\bcar\s*wash/i.test(text)) return "car_wash";
  if (/\bmaintenance/i.test(text)) return "maintenance";
  return null;
}

function pickCostType(text: string): CostType | null {
  const t = text.trim().toLowerCase();
  if (/^1\b/.test(t) || /repair/.test(t)) return "repair";
  if (/^2\b/.test(t) || /car\s*wash/.test(t)) return "car_wash";
  if (/^3\b/.test(t) || /maintenance/.test(t)) return "maintenance";
  if (/^4\b/.test(t) || /\bother\b/.test(t)) return "other";
  return null;
}

/** A 5-8 char token mixing letters and digits — loose enough to catch most SA plates without being exact; the real check is the DB lookup in findCurrentVehicle. */
function hasPlateLikeToken(t: string): boolean {
  return t
    .split(/[^a-z0-9]+/i)
    .some((tok) => tok.length >= 5 && tok.length <= 8 && /[a-z]/i.test(tok) && /\d/.test(tok));
}

/**
 * A structured note (not a question) that names a rand amount and something
 * plate-shaped, e.g. a message copied straight off an invoice:
 * "HY22CPGP ... BATTERY REPLACEMENT ... ALBARAKAH AUTO SPARES ... R1450".
 * Treated as an add-cost message only if the parser then finds real fields
 * in it (see startCostFlow) — this is just a cheap pre-filter.
 */
const looksLikeCostDetails = (t: string) => !t.includes("?") && /\br\s?\d/i.test(t) && hasPlateLikeToken(t);

const CANCEL_RE = /^\s*(cancel|stop|quit|exit|abort|nevermind|never mind)\s*[.!]*\s*$/i;
const YES_RE = /^\s*(yes|y|yep|yeah|confirm|ok|okay|correct|save)\s*[.!]*\s*$/i;
const SKIP_RE = /^\s*(skip|no|none|n|nope|no invoice)\s*[.!]*\s*$/i;
const NO_RE = /^\s*(no|n|nope)\s*[.!]*\s*$/i;

export const normaliseReg = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Edit distance between two short strings (registrations), for "did you mean" suggestions. */
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

const SUGGEST_MAX_DISTANCE = 2;
const SUGGEST_MAX_COUNT = 3;

/** "2450", "R2 450.50", "R 2,450" -> 2450.5. Positive, at most 2 decimals, under R10 million. */
function parseAmount(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/^r\s*/, "").replace(/[ ,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n < 10_000_000 ? n : null;
}

const formatRand = (n: number) => `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayZA = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const isoDate = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

/** Accepts 2026-10-27, 27/10/2026, 27-10-26, 27.10.2026, "27 10 2026", "27 Oct 2026". Returns YYYY-MM-DD or null. */
function parseDate(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = s.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4}|\d{2})$/);
  if (m) return isoDate(year(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[-/. ]?([a-z]{3,9})[-/. ]?(\d{4}|\d{2})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3));
    if (mi >= 0) return isoDate(year(m[3]), mi + 1, Number(m[1]));
  }
  return null;
}

const validateCostDate = (iso: string, today = todayZA()) => (iso > today ? "The cost date can't be in the future." : null);

/**
 * Re-checks every field in `d` against the same rules the step-by-step flow
 * applies, dropping any that fail so the default (today) is used instead.
 * Used for values that arrive pre-filled from a free-text message.
 */
function sanitise(d: FlowData): { data: FlowData; dropped: string[] } {
  const data = { ...d };
  const dropped: string[] = [];
  if (data.costDate && validateCostDate(data.costDate)) {
    delete data.costDate;
    dropped.push("cost date (using today)");
  }
  if (data.place && (data.place.length < 2 || data.place.length > 100)) {
    delete data.place;
    dropped.push("who it was done by / paid to");
  }
  if (data.workDone && data.workDone.length > 300) {
    data.workDone = data.workDone.slice(0, 300);
  }
  return { data, dropped };
}

/** First step that still needs an answer. Required: registration, type, who/paid to, cost. Optional (SKIP-able): what was done, invoice. */
function nextStep(d: FlowData): Step {
  if (!d.vehicleId) return "reg";
  if (!d.costType) return "cost_type";
  if (!d.place) return "place";
  if (d.amount == null) return "amount";
  if (d.workDone === undefined) return "work";
  if (d.invoicePath === undefined) return "invoice";
  return "confirm";
}

const didYouMean = (suggestions: string[]) => (suggestions.length ? ` Did you mean ${suggestions.join(" or ")}?` : "");

const introFor = (reg?: string) =>
  reg ? `Let's log a cost for ${reg}. Reply "cancel" at any time to stop.` : `Let's log a vehicle cost. Reply "cancel" at any time to stop.`;

const queueAck = (reg?: string) => (reg ? `Got it — I'll come back to ${reg} once we're done here.` : `Got it — I'll come back to that once we're done here.`);

const describeFilled = (d: FlowData) =>
  [
    d.reg && `Vehicle: ${d.reg} (${d.vehicle})`,
    d.costType && `Type: ${COST_TYPE_LABELS[d.costType]}`,
    // Only shown when a message named a date other than today — the default
    // is silent, same as the service flow's own service date.
    d.costDate && d.costDate !== todayZA() && `Date: ${d.costDate}`,
    d.place && `Done by: ${d.place}`,
    d.amount != null && `Cost: ${formatRand(d.amount)}`,
    d.workDone && `Work done: ${d.workDone}`,
  ]
    .filter(Boolean)
    .join("\n");

function presentFlow(data: FlowData, step: Step, notes: string[] = []): string {
  const got = describeFilled(data);
  return [got ? `${introFor(data.reg)}\n\nFrom your message:\n${got}` : introFor(data.reg), ...notes, step === "confirm" ? "" : QUESTIONS[step]]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- flow state ----------
// Shares the whatsapp_flows queue table with service-flow.ts (see
// 20261109140000_whatsapp_flows_queue.sql) — at most one row per phone is
// "active" at the DB level, regardless of which flow it belongs to, so the
// two flows never clobber each other's row; each just ignores an active row
// that isn't its own (loadActiveFlow's `data.flow !== FLOW` check).

interface ActiveFlow {
  id: string;
  step: Step;
  data: FlowData;
  /** This flow was just promoted from the queue because the previous active one timed out. */
  justPromoted?: boolean;
}

function rowToFlow(
  row: Database["public"]["Tables"]["whatsapp_flows"]["Row"] | null | undefined
): { id: string; step: Step; data: FlowData } | null {
  if (!row?.id) return null;
  return { id: row.id, step: row.step as Step, data: row.data as FlowData };
}

async function loadActiveFlow(phone: string): Promise<ActiveFlow | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("whatsapp_flows")
    .select("id, flow, step, data, updated_at")
    .eq("phone", phone)
    .eq("active", true)
    .maybeSingle();
  if (!data || data.flow !== FLOW) return null;
  if (Date.now() - new Date(data.updated_at).getTime() <= FLOW_TTL_MINUTES * 60_000) {
    return { id: data.id, step: data.step as Step, data: data.data as FlowData };
  }
  const promoted = rowToFlow(await closeAndPromote(data.id));
  return promoted ? { ...promoted, justPromoted: true } : null;
}

async function saveFlow(id: string, step: Step, data: FlowData) {
  const db = createAdminClient();
  const { error } = await db
    .from("whatsapp_flows")
    .update({ step, data: data as never, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function claimFlow(phone: string, step: Step, data: FlowData) {
  const db = createAdminClient();
  const { data: row, error } = await db
    .rpc("whatsapp_flow_claim", { p_phone: phone, p_flow: FLOW, p_step: step, p_data: data as never })
    .maybeSingle();
  if (error) throw error;
  return rowToFlow(row as Database["public"]["Tables"]["whatsapp_flows"]["Row"] | null);
}

async function enqueueFlow(phone: string, step: Step, data: FlowData) {
  const db = createAdminClient();
  const { error } = await db.rpc("whatsapp_flow_enqueue", { p_phone: phone, p_flow: FLOW, p_step: step, p_data: data as never });
  if (error) throw error;
}

async function closeAndPromote(id: string) {
  const db = createAdminClient();
  const { data: row, error } = await db.rpc("whatsapp_flow_close_and_promote", { p_id: id }).maybeSingle();
  if (error) throw error;
  return row as Database["public"]["Tables"]["whatsapp_flows"]["Row"] | null;
}

async function closeWithPromotion(id: string, message: string): Promise<string> {
  const promoted = rowToFlow(await closeAndPromote(id));
  return promoted ? `${message}\n\n${presentFlow(promoted.data, promoted.step)}` : message;
}

// ---------- DB ----------

async function suggestSimilarPlates(reg: string): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db.from("vehicle_registrations").select("plate_number").is("effective_to", null);
  if (!data) return [];
  return data
    .map((r) => ({ plate: r.plate_number, dist: levenshtein(reg, r.plate_number) }))
    .filter((r) => r.dist > 0 && r.dist <= SUGGEST_MAX_DISTANCE)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, SUGGEST_MAX_COUNT)
    .map((r) => r.plate);
}

async function findCurrentVehicle(reg: string) {
  const db = createAdminClient();
  const { data: plate } = await db
    .from("vehicle_registrations")
    .select("vehicle_id")
    .eq("plate_number", reg)
    .is("effective_to", null)
    .maybeSingle();
  if (!plate) return { status: "none" as const, suggestions: await suggestSimilarPlates(reg) };

  const { data: v } = await db.from("vehicles").select("id, make, model, year").eq("id", plate.vehicle_id).maybeSingle();
  if (!v) return { status: "none" as const, suggestions: await suggestSimilarPlates(reg) };
  return { status: "ok" as const, id: v.id, label: [v.year, v.make, v.model].filter(Boolean).join(" ") || "vehicle" };
}

/** Turns a free-text message into pre-filled flow data; null if nothing usable was found. */
async function prefillFromMessage(text: string): Promise<{ data: FlowData; notes: string[] } | null> {
  const parsed = await parseVehicleCostMessage(text);
  if (!parsed) return null;
  const data: FlowData = {};
  const notes: string[] = [];

  if (parsed.reg) {
    const reg = normaliseReg(parsed.reg);
    const v = reg.length >= 3 ? await findCurrentVehicle(reg) : { status: "none" as const, suggestions: [] as string[] };
    if (v.status === "ok") Object.assign(data, { vehicleId: v.id, reg, vehicle: v.label });
    else notes.push(`I didn't find a vehicle in the fleet with the registration ${reg}.${didYouMean(v.suggestions)}`);
  }
  if (parsed.costType) data.costType = parsed.costType;
  const costDate = parsed.costDate ? parseDate(parsed.costDate) : null;
  if (costDate) data.costDate = costDate;
  if (parsed.place && parsed.place.length >= 2 && parsed.place.length <= 100) data.place = parsed.place;
  const amount = parsed.amount != null ? parseAmount(String(parsed.amount)) : null;
  if (amount !== null) data.amount = amount;
  if (parsed.workDone) data.workDone = parsed.workDone.slice(0, 300);

  const clean = sanitise(data);
  if (clean.dropped.length) notes.push(`I couldn't use the ${clean.dropped.join(", ")} from your message.`);
  return Object.keys(clean.data).length ? { data: clean.data, notes } : notes.length ? { data: {}, notes } : null;
}

/** Parses a message that looks like it's starting an add-cost flow; null if it isn't one, after all. */
async function startCostFlow(text: string, explicit: boolean): Promise<{ step: Step; data: FlowData; notes: string[] } | null> {
  // A long message may already contain the details: pull them out, then only ask for what's missing.
  const prefill = (explicit ? text.replace(START_RE, "").trim().length >= 4 : true) ? await prefillFromMessage(text) : null;
  // Without the command wording, only take over if the message really carries several cost fields.
  if (!explicit && (!prefill || Object.keys(prefill.data).length < 2)) return null;
  const inferred = inferCostType(text);
  if (!prefill) {
    const data: FlowData = { costDate: todayZA(), ...(inferred ? { costType: inferred } : {}) };
    return { step: nextStep(data), data, notes: [] };
  }
  // The cost date defaults to the day the message is sent unless the message names one; the
  // keyword-inferred type is a fallback for whatever the parser didn't find.
  const merged: FlowData = { costDate: todayZA(), ...(inferred ? { costType: inferred } : {}), ...prefill.data };
  const { data: filled, dropped } = sanitise(merged);
  if (!filled.costDate) filled.costDate = todayZA();
  const notes = [...prefill.notes];
  if (dropped.length) notes.push(`I couldn't use the ${dropped.join(", ")} from your message.`);
  return { step: nextStep(filled), data: filled, notes };
}

async function saveVehicleCost(user: FlowUser, d: Required<FlowData>): Promise<boolean> {
  // One statement, logged in audit_log against this person's profile with
  // source "whatsapp" — see whatsapp_save_vehicle_cost in migration
  // 20261112180000.
  const { error } = await createAdminClient().rpc("whatsapp_save_vehicle_cost", {
    p_user: user.id,
    p_vehicle: d.vehicleId,
    p_cost_type: d.costType,
    p_cost_date: d.costDate,
    p_supplier: d.place,
    p_amount: d.amount,
    p_work_done: d.workDone,
    p_invoice: d.invoicePath,
  });
  if (error) {
    console.error("whatsapp add-vehicle-cost: save failed", error);
    await discardInvoice(d.invoicePath);
    return false;
  }
  return true;
}

async function discardInvoice(path: string | null | undefined) {
  if (path) await createAdminClient().storage.from(INVOICE_BUCKET).remove([path]);
}

/** Downloads the attachment and stores it where the web app's invoices live. Returns the storage path or an error to show. */
async function storeInvoice(vehicleId: string, media: { url: string; contentType: string }) {
  const ext = INVOICE_TYPES[media.contentType.split(";")[0].trim().toLowerCase()];
  if (!ext) return { error: "I can only attach a PDF or a photo (JPEG/PNG)." };
  const buf = await downloadTwilioMedia(media.url, MAX_INVOICE_BYTES);
  if (!buf) return { error: "That file is too big or couldn't be read (10 MB max)." };
  const path = `${vehicleId}/${Date.now()}-whatsapp-invoice.${ext}`;
  const { error } = await createAdminClient()
    .storage.from(INVOICE_BUCKET)
    .upload(path, buf, { contentType: media.contentType.split(";")[0].trim() });
  if (error) throw error;
  return { path };
}

// ---------- the conversation ----------

const summary = (d: Required<FlowData>) =>
  `${d.reg} (${d.vehicle})\nType: ${COST_TYPE_LABELS[d.costType]}\nDate: ${d.costDate}\nDone by: ${d.place}\nCost: ${formatRand(d.amount)}\nWork done: ${d.workDone ?? "not given"}\nInvoice: ${d.invoicePath ? "attached" : "none"}`;

export interface FlowReply {
  text: string;
  /** The question is optional: send it with a tappable "No" button. */
  skipButton: boolean;
}

/**
 * Returns the reply if this message belongs to the add-vehicle-cost flow
 * (starting it or continuing it), or null to let service-flow.ts / the
 * normal Q&A handle the message.
 */
export async function handleVehicleCostFlow(
  phone: string,
  text: string,
  user: FlowUser,
  media: { url: string; contentType: string } | null = null
): Promise<FlowReply | null> {
  try {
    const reply = await runFlow(phone, text, user, media);
    if (reply === null) return null;
    const flow = await loadActiveFlow(phone);
    return { text: reply, skipButton: flow?.step === "work" || flow?.step === "invoice" };
  } catch (err) {
    console.error("whatsapp add-vehicle-cost flow failed", err);
    return START_RE.test(text) || looksLikeCostDetails(text)
      ? { text: "Logging a cost isn't available right now. Please add it in the web app.", skipButton: false }
      : null;
  }
}

async function runFlow(
  phone: string,
  text: string,
  user: FlowUser,
  media: { url: string; contentType: string } | null
): Promise<string | null> {
  const flow = await loadActiveFlow(phone);

  if (flow?.justPromoted) {
    return `That request timed out, so nothing was saved for it.\n\n${presentFlow(flow.data, flow.step)}`;
  }

  if (!flow) {
    const explicit = START_RE.test(text);
    if (!explicit && !looksLikeCostDetails(text)) return null;
    if (!canUseFlow(user.role)) {
      return explicit ? "Only admins can log a vehicle cost. Ask an admin, or add it in the web app." : null;
    }
    const started = await startCostFlow(text, explicit);
    if (!started) return null;
    const claimed = await claimFlow(phone, started.step, started.data);
    if (claimed) return presentFlow(started.data, started.step, started.notes);
    // Lost the claim to another message for this phone that landed at the same instant: queue instead of clobbering it.
    await enqueueFlow(phone, started.step, started.data);
    return queueAck(started.data.reg);
  }

  // Flow state is only trusted for someone who may still use it.
  if (!canUseFlow(user.role)) {
    await closeAndPromote(flow.id);
    return null;
  }
  if (CANCEL_RE.test(text)) {
    await discardInvoice(flow.data.invoicePath);
    return closeWithPromotion(flow.id, "Cancelled — nothing was saved.");
  }

  // A second cost described while this one's still in progress: queue it
  // rather than letting it clobber or get misread as the answer to this
  // question (same reasoning as service-flow.ts's own handling of a second
  // vehicle). The implicit (no command wording) case only counts once this
  // flow already has its own registration to compare against — otherwise a
  // wordy answer to "who was it done by?" could get mistaken for a
  // different vehicle's cost note.
  const explicitNew = START_RE.test(text);
  if (explicitNew || (flow.data.reg && looksLikeCostDetails(text))) {
    const started = await startCostFlow(text, explicitNew);
    if (started && (explicitNew || started.data.reg !== flow.data.reg)) {
      await enqueueFlow(phone, started.step, started.data);
      return `${queueAck(started.data.reg)}\n\n${flow.step === "confirm" ? "" : QUESTIONS[flow.step]}`.trim();
    }
  }

  const { step, data } = flow;
  const ask = async (d: FlowData, prefix = "") => {
    const next = nextStep(d);
    await saveFlow(flow.id, next, d);
    return `${prefix}${next === "confirm" ? "" : QUESTIONS[next]}`;
  };
  const retry = (error: string) => `${error}\n${step === "confirm" ? "" : QUESTIONS[step]}`.trim();

  switch (step) {
    case "reg": {
      const reg = normaliseReg(text);
      if (reg.length < 3) return retry("That doesn't look like a registration.");
      const v = await findCurrentVehicle(reg);
      if (v.status === "none") {
        return retry(`I didn't find a vehicle in the fleet with that registration.${didYouMean(v.suggestions)}`);
      }
      return ask({ ...data, vehicleId: v.id, reg, vehicle: v.label }, `Found ${reg} — ${v.label}.\n`);
    }
    case "cost_type": {
      const picked = pickCostType(text);
      if (!picked) return retry("Please reply with 1, 2, 3 or 4 (or the word) — Repair, Car wash, Maintenance, Other.");
      return ask({ ...data, costType: picked });
    }
    case "place": {
      const place = text.replace(/\s+/g, " ").trim();
      if (place.length < 2 || place.length > 100) return retry("Please send who it was done by / paid to.");
      return ask({ ...data, place });
    }
    case "amount": {
      const amount = parseAmount(text);
      if (amount === null) return retry("I couldn't read that — send the cost in rand as a number, e.g. 850.");
      return ask({ ...data, amount });
    }
    case "work": {
      const work = text.replace(/\s+/g, " ").trim();
      if (work.length > 300) return retry("That's a bit long — please keep it under 300 characters.");
      return ask({ ...data, workDone: SKIP_RE.test(work) ? null : work });
    }
    case "invoice": {
      let invoicePath: string | null = null;
      if (media) {
        const stored = await storeInvoice(data.vehicleId!, media);
        if (stored.error) return retry(stored.error);
        invoicePath = stored.path!;
      } else if (!SKIP_RE.test(text)) {
        return retry("Send a photo or PDF of the invoice/receipt, or reply No to skip.");
      }
      const full = { ...data, invoicePath };
      await saveFlow(flow.id, "confirm", full);
      return `Please check:\n${summary(full as Required<FlowData>)}\n\nSave this cost? Reply YES to save or NO to cancel.`;
    }
    case "confirm": {
      if (NO_RE.test(text)) {
        await discardInvoice(data.invoicePath);
        return closeWithPromotion(flow.id, "Cancelled — nothing was saved.");
      }
      if (!YES_RE.test(text)) return "Reply YES to save this cost, or NO to cancel.";
      const ok = await saveVehicleCost(user, data as Required<FlowData>);
      if (!ok) return "Sorry, I couldn't save that. Please check the vehicle in the web app, then try again if needed.";
      return closeWithPromotion(flow.id, `Saved. ${COST_TYPE_LABELS[data.costType!]} cost recorded for ${data.reg}.`);
    }
    default:
      // Saved by an older version of the script (a step that no longer exists): drop it and start over.
      await closeAndPromote(flow.id);
      return runFlow(phone, text, user, media);
  }
}
