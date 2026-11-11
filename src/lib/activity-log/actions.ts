"use server";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import { describeAuditEntry, type FieldChange } from "./describe-change";
import { ACTIVITY_ENTITY_TYPES, type ActivityEntityType } from "./entity-types";

/**
 * Activity log (SPEC item 39) Phase 3: the per-record feed, shared by the
 * Vehicle/Client/Contract panels — admin only (same decision as
 * record_notes' own RLS), one query pair keyed by (entityType, entityId)
 * rather than a separate implementation per panel.
 */

export interface ActivityEntry {
  id: string;
  at: string;
  by: string;
  kind: "audit" | "note";
  summary: string;
  changes: FieldChange[];
  note?: string;
}

function isActivityEntityType(value: string): value is ActivityEntityType {
  return (ACTIVITY_ENTITY_TYPES as readonly string[]).includes(value);
}

export async function getRecordActivity(
  entityType: ActivityEntityType,
  entityId: string
): Promise<{ error?: string; entries?: ActivityEntry[] }> {
  await requireAdmin();
  if (!isActivityEntityType(entityType)) return { error: "Invalid entity type" };

  const supabase = await createSupabaseServerClient();
  const [audit, notes] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, action, diff, changed_by, created_at")
      .eq("table_name", entityType)
      .eq("record_id", entityId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("record_notes")
      .select("id, note, created_by, created_at")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (audit.error || notes.error) return { error: "Couldn't load the activity log" };

  const userIds = new Set<string>();
  for (const row of audit.data ?? []) if (row.changed_by) userIds.add(row.changed_by);
  for (const row of notes.data ?? []) if (row.created_by) userIds.add(row.created_by);

  const { data: profiles } = userIds.size
    ? await supabase.from("profiles").select("id, full_name").in("id", [...userIds])
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const auditEntries: ActivityEntry[] = (audit.data ?? []).map((row) => {
    const described = describeAuditEntry(entityType, row.action, row.diff);
    return {
      id: `a-${row.id}`,
      at: row.created_at,
      by: row.changed_by ? nameById.get(row.changed_by) ?? "Unknown" : "System",
      kind: "audit",
      summary: described.summary,
      changes: described.changes,
    };
  });

  // created_by is null only for notes backfilled from a record's old
  // free-text `notes` field (migration 20261109090000) — a real note
  // written through the app always has an author.
  const noteEntries: ActivityEntry[] = (notes.data ?? []).map((row) => ({
    id: `n-${row.id}`,
    at: row.created_at,
    by: row.created_by ? nameById.get(row.created_by) ?? "Unknown" : "Imported",
    kind: "note",
    summary: "Note added",
    changes: [],
    note: row.note,
  }));

  const entries = [...auditEntries, ...noteEntries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { entries };
}

export async function addRecordNote(
  entityType: ActivityEntityType,
  entityId: string,
  note: string
): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  if (!isActivityEntityType(entityType)) return { error: "Invalid entity type" };
  const trimmed = note.trim();
  if (!trimmed) return { error: "Note can't be empty" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("record_notes").insert({
    entity_type: entityType,
    entity_id: entityId,
    note: trimmed,
    created_by: profile.id,
  });

  if (error) return { error: "Couldn't save the note" };
  return {};
}
