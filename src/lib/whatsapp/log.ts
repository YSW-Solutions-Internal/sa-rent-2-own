import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/** Message log, rate limits and conversation memory — all backed by public.whatsapp_messages. */

// Limits per phone number. Generous for real use, tight enough that a runaway
// loop or a stranger can't run up the Claude / Twilio bill.
export const LIMIT_PER_HOUR = 30;
export const LIMIT_PER_DAY = 150;

const MEMORY_WINDOW_MINUTES = 30;
const MEMORY_MAX_MESSAGES = 8;

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Logs an inbound message. Returns its id, or null if Twilio already delivered this MessageSid (a retry). */
export async function recordInbound(msg: { phone: string; body: string; sid: string | null }): Promise<string | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("whatsapp_messages")
    .insert({ phone: msg.phone, direction: "in", status: "received", body: msg.body, twilio_sid: msg.sid })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return null; // unique violation: duplicate delivery
    throw error;
  }
  return data.id;
}

export async function markInbound(id: string, status: string, profileId?: string) {
  const db = createAdminClient();
  await db
    .from("whatsapp_messages")
    .update({ status, ...(profileId ? { profile_id: profileId } : {}) })
    .eq("id", id);
}

export async function recordOutbound(msg: { phone: string; profileId?: string; body: string; kind: "answer" | "notice" }) {
  const db = createAdminClient();
  await db.from("whatsapp_messages").insert({
    phone: msg.phone,
    profile_id: msg.profileId ?? null,
    direction: "out",
    status: msg.kind,
    body: msg.body,
  });
}

/** Inbound messages from this number in the last hour and day (including the one being handled). */
export async function recentInboundCounts(phone: string): Promise<{ hour: number; day: number }> {
  const db = createAdminClient();
  const count = async (since: string) => {
    const { count: n } = await db
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone)
      .eq("direction", "in")
      .gte("created_at", since);
    return n ?? 0;
  };
  return { hour: await count(ago(60)), day: await count(ago(24 * 60)) };
}

/** Has this number already been sent a notice (rejection / limit message) in the last hour? Used to stay silent after the first. */
export async function noticeSentRecently(phone: string): Promise<boolean> {
  const db = createAdminClient();
  const { count } = await db
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .eq("direction", "out")
    .eq("status", "notice")
    .gte("created_at", ago(60));
  return (count ?? 0) > 0;
}

/**
 * The recent question/answer pairs with this number (last 30 minutes), oldest
 * first, so a follow-up like "and its service date?" has context. Only
 * answered questions and the answers to them; notices and errors are left
 * out — as is a blank body (e.g. a captionless media message logged before
 * it had anything to say, or one that got no reply at all): Claude's API
 * rejects a message with empty content outright, and an empty turn carries
 * no context anyway.
 */
export async function recentConversation(phone: string, excludeId: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("whatsapp_messages")
    .select("id, direction, status, body")
    .eq("phone", phone)
    .in("status", ["answered", "answer"])
    .neq("id", excludeId)
    .gte("created_at", ago(MEMORY_WINDOW_MINUTES))
    .order("created_at", { ascending: false })
    .limit(MEMORY_MAX_MESSAGES);

  const rows = (data ?? []).filter((r) => r.body.trim()).reverse();
  while (rows.length && rows[0].direction !== "in") rows.shift(); // must start with a user turn
  return rows.map((r) => ({ role: r.direction === "in" ? ("user" as const) : ("assistant" as const), content: r.body }));
}
