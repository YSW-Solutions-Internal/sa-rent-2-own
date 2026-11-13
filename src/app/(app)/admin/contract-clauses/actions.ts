"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";

import { editClauseFormSchema } from "./schema";

export interface ActionResult {
  error?: string;
}

export interface ClauseTemplate {
  id: string;
  category: "rent_to_own" | "rental";
  clauseKey: string;
  sortOrder: number;
  heading: string;
  body: string;
}

export async function listClauseTemplates(): Promise<{ data?: ClauseTemplate[]; error?: string }> {
  await requireAdmin();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_clause_templates")
    .select("id, category, clause_key, sort_order, heading, body")
    .order("category")
    .order("sort_order");

  if (error) return { error: "Couldn't load the contract clauses" };

  return {
    data: (data ?? []).map((row) => ({
      id: row.id,
      category: row.category as ClauseTemplate["category"],
      clauseKey: row.clause_key,
      sortOrder: row.sort_order,
      heading: row.heading,
      body: row.body,
    })),
  };
}

/**
 * Edits a clause's wording only — category, clause_key, sort_order and
 * is_active are fixed by the seed migration and not exposed here. These are
 * the narrative T&C paragraphs rendered into the generated contract PDFs
 * (src/lib/contracts/pdf/fetch-agreement-data.ts); the structured sections
 * (parties, vehicle, fee tables) render from contracts/clients/vehicles
 * columns and aren't touched by this editor.
 */
export async function updateClauseTemplate(id: string, raw: unknown): Promise<ActionResult> {
  await requireAdmin();

  const parsed = editClauseFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("contract_clause_templates")
    .update({ heading: parsed.data.heading, body: parsed.data.body })
    .eq("id", id);

  if (error) return { error: "Couldn't save the clause" };

  revalidatePath("/admin/contract-clauses");
  return {};
}
