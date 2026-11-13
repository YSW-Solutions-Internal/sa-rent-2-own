import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { downloadTwilioMedia } from "./twilio";
import { RECORD_VEHICLE_COST_TOOL, toParsedVehicleCost, type ParsedVehicleCost } from "./vehicle-cost-parse";

/**
 * Classifies a bare attachment (no accompanying question, not claimed by any
 * scripted flow) sent to the WhatsApp bot — e.g. someone photographs an
 * invoice to log a cost, or photographs a vehicle to ask about it. A single
 * forced tool call offers both outcomes (plus a "can't tell" escape hatch) so
 * exactly one is always chosen; the caller routes to the add-vehicle-cost
 * flow, the ordinary read-only Q&A, or a clarifying message accordingly.
 */

const MODEL = process.env.WHATSAPP_PARSE_MODEL || "claude-sonnet-5-5";
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const client = new Anthropic();

const IDENTIFY_VEHICLE_TOOL: Anthropic.Tool = {
  name: "identify_vehicle_in_photo",
  description:
    "The attachment is a photo of a vehicle (not an invoice, receipt or document) — sent so staff can ask about that vehicle. Give the best short search text to find it in the fleet system.",
  input_schema: {
    type: "object",
    properties: {
      vehicle_query: {
        type: "string",
        description:
          "The registration plate exactly as written, if legible anywhere in the photo. Otherwise a short make/model/colour description (e.g. \"white VW Polo\").",
      },
    },
    required: ["vehicle_query"],
  },
};

const CANNOT_DETERMINE_TOOL: Anthropic.Tool = {
  name: "cannot_determine",
  description:
    "The attachment is not clearly an invoice/receipt for a vehicle cost, nor a usable photo of a vehicle — e.g. unrelated, unreadable, or genuinely ambiguous.",
  input_schema: { type: "object", properties: { reason: { type: "string" } } },
};

export type MediaIntakeResult =
  | { kind: "invoice"; data: ParsedVehicleCost }
  | { kind: "vehicle_photo"; query: string }
  | { kind: "unclear" };

type Base64Block =
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp"; data: string } };

const SUPPORTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

function buildBlock(contentType: string, data: string): Base64Block | null {
  if (contentType === "application/pdf") return { type: "document", source: { type: "base64", media_type: contentType, data } };
  if (contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp") {
    return { type: "image", source: { type: "base64", media_type: contentType, data } };
  }
  return null;
}

/**
 * Returns null for an attachment type we don't handle here at all (caller
 * falls back to its existing "I can only read text messages" behaviour), or
 * on a download/model failure — never for a genuinely ambiguous attachment,
 * which comes back as `{ kind: "unclear" }` instead.
 */
export async function classifyMedia(media: { url: string; contentType: string }): Promise<MediaIntakeResult | null> {
  const contentType = media.contentType.split(";")[0].trim().toLowerCase();
  if (!(SUPPORTED_TYPES as readonly string[]).includes(contentType)) return null;

  try {
    const buf = await downloadTwilioMedia(media.url, MAX_MEDIA_BYTES);
    if (!buf) return null;
    const withData = buildBlock(contentType, buf.toString("base64"))!;

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: `A fleet-staff member in South Africa sent this file to the SA Rent 2 Own WhatsApp assistant with no other message. Today is ${today}. It is exactly one of: (1) an invoice, receipt or quote for a non-service vehicle cost — a repair, car wash, maintenance item or other one-off cost, never a scheduled/routine service — call record_vehicle_cost_details; (2) a photo of a vehicle (on the road, in a yard, a close-up of its registration plate, etc.) sent so staff can ask about it — call identify_vehicle_in_photo; (3) anything else, unreadable, or genuinely ambiguous — call cannot_determine. Always call exactly one of these tools, and never guess a field you can't actually read.`,
      tools: [RECORD_VEHICLE_COST_TOOL, IDENTIFY_VEHICLE_TOOL, CANNOT_DETERMINE_TOOL],
      tool_choice: { type: "any", disable_parallel_tool_use: true },
      messages: [{ role: "user", content: [withData, { type: "text", text: "Classify this attachment." }] }],
    });

    const use = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!use) return { kind: "unclear" };
    const input = use.input as Record<string, unknown>;
    if (use.name === "record_vehicle_cost_details") return { kind: "invoice", data: toParsedVehicleCost(input) };
    if (use.name === "identify_vehicle_in_photo") {
      const q = input.vehicle_query;
      return typeof q === "string" && q.trim() ? { kind: "vehicle_photo", query: q.trim() } : { kind: "unclear" };
    }
    return { kind: "unclear" };
  } catch (err) {
    console.error("whatsapp media intake: classification failed", err);
    return null;
  }
}
