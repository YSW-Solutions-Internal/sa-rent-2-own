import { after } from "next/server";

import { answerQuestion } from "@/lib/whatsapp/bot";
import { handleServiceFlow } from "@/lib/whatsapp/service-flow";
import { handleVehicleCostFlow } from "@/lib/whatsapp/vehicle-cost-flow";
import {
  LIMIT_PER_DAY,
  LIMIT_PER_HOUR,
  markInbound,
  noticeSentRecently,
  recentConversation,
  recentInboundCounts,
  recordInbound,
  recordOutbound,
} from "@/lib/whatsapp/log";
import { isValidTwilioSignature, phoneFromWhatsAppAddress, sendWhatsAppMessage } from "@/lib/whatsapp/twilio";
import { createAdminClient } from "@/lib/supabase/admin";

// The reply is sent after the response (see after()), and a lookup can take a
// few model round-trips.
export const maxDuration = 60;

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
const MAX_QUESTION_CHARS = 500;

const NOT_APPROVED =
  "This number isn't set up for the SA Rent 2 Own assistant. Ask an admin to approve your access in the web app.";
const RATE_LIMITED = "You've reached the message limit for now. Please try again later.";

async function handleInbound(params: Record<string, string>) {
  const from = params.From ?? "";
  const phone = phoneFromWhatsAppAddress(from);
  // Log under the E.164 number, or the raw sender if it isn't a SA number.
  const key = phone ?? from;
  const question = (params.Body ?? "").trim().slice(0, MAX_QUESTION_CHARS);

  const inboundId = await recordInbound({ phone: key, body: question, sid: params.MessageSid || null });
  if (!inboundId) return; // Twilio retried a message we already handled

  // Rejections and limit notices are sent once per hour per number, then we
  // go quiet, so a stranger (or a loop) can't make us pay for endless replies.
  const notice = async (text: string, profileId?: string) => {
    if (await noticeSentRecently(key)) return;
    await sendWhatsAppMessage(from, text);
    await recordOutbound({ phone: key, profileId, body: text, kind: "notice" });
  };

  try {
    const db = createAdminClient();
    const { data: profile } = phone
      ? await db
          .from("profiles")
          .select("id, full_name, role, is_active, whatsapp_enabled, whatsapp_finance_enabled")
          // profiles.phone is stored without the leading "+" (27...), so accept both forms.
          .in("phone", [phone, phone.replace(/^\+/, "")])
          .maybeSingle()
      : { data: null };

    // An admin must have switched WhatsApp access on for this person; the
    // technician role is retired and never gets the bot.
    if (!profile || !profile.is_active || !profile.whatsapp_enabled || profile.role === "technician") {
      await markInbound(inboundId, "rejected");
      await notice(NOT_APPROVED);
      return;
    }

    const counts = await recentInboundCounts(key);
    if (counts.hour > LIMIT_PER_HOUR || counts.day > LIMIT_PER_DAY) {
      await markInbound(inboundId, "rate_limited", profile.id);
      await notice(RATE_LIMITED, profile.id);
      return;
    }

    // Guided "Add a service" / "Add a vehicle cost" conversations: scripted,
    // not the model, because they write data. Each only recognises its own
    // flow (see loadActiveFlow in either module), so checking both in order
    // correctly reaches whichever one actually owns this phone's active row.
    const media =
      Number(params.NumMedia ?? "0") > 0 && params.MediaUrl0
        ? { url: params.MediaUrl0, contentType: params.MediaContentType0 ?? "" }
        : null;
    const flowUser = { id: profile.id, fullName: profile.full_name, role: profile.role };
    const flowReply =
      (await handleServiceFlow(key, question, flowUser, media)) ??
      (await handleVehicleCostFlow(key, question, flowUser, media));
    if (flowReply !== null) {
      await sendWhatsAppMessage(from, flowReply.text, { skipButton: flowReply.skipButton });
      await recordOutbound({ phone: key, profileId: profile.id, body: flowReply.text, kind: "answer" });
      await markInbound(inboundId, "answered", profile.id);
      return;
    }

    if (!question) {
      await markInbound(inboundId, "answered", profile.id);
      if (Number(params.NumMedia ?? "0") > 0) await notice("I can only read text messages for now.", profile.id);
      return;
    }

    const history = await recentConversation(key, inboundId);
    const reply = await answerQuestion(
      question,
      { fullName: profile.full_name },
      { role: profile.role, financeEnabled: profile.whatsapp_finance_enabled },
      history
    );
    await sendWhatsAppMessage(from, reply);
    await recordOutbound({ phone: key, profileId: profile.id, body: reply, kind: "answer" });
    await markInbound(inboundId, "answered", profile.id);
  } catch (err) {
    await markInbound(inboundId, "error").catch(() => {});
    throw err;
  }
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("whatsapp: TWILIO_AUTH_TOKEN is not set");
    return new Response("Not configured", { status: 503 });
  }

  const raw = await request.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const url = process.env.WHATSAPP_WEBHOOK_URL || request.url;

  if (!isValidTwilioSignature(url, params, request.headers.get("x-twilio-signature"), authToken)) {
    return new Response("Invalid signature", { status: 403 });
  }

  after(async () => {
    try {
      await handleInbound(params);
    } catch (err) {
      console.error("whatsapp: failed to handle message", err);
      try {
        await sendWhatsAppMessage(params.From ?? "", "Sorry, something went wrong on my side. Please try again in a moment.");
      } catch {
        // Nothing more we can do; the failure is already logged above.
      }
    }
  });

  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
