"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import { addRecordNote, getRecordActivity, type ActivityEntry } from "./actions";
import type { ActivityEntityType } from "./entity-types";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Activity log (SPEC item 39) Phase 3: combined notes + change-history
 * feed, shared by the Vehicle/Client/Contract panels — admin only, same
 * gate as `getRecordActivity`/`addRecordNote` themselves, so the caller
 * only needs to decide *whether* to render this section, not re-check
 * permissions inside it.
 */
export function ActivitySection({ entityType, entityId }: { entityType: ActivityEntityType; entityId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  function load() {
    getRecordActivity(entityType, entityId).then((result) => {
      if (result.error) setError(result.error);
      else {
        setError(null);
        setEntries(result.entries ?? []);
      }
    });
  }

  useEffect(() => {
    let cancelled = false;
    getRecordActivity(entityType, entityId).then((result) => {
      if (cancelled) return;
      if (result.error) setError(result.error);
      else setEntries(result.entries ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  function onAddNote() {
    const text = draft.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await addRecordNote(entityType, entityId, text);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setDraft("");
      load();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Textarea placeholder="Add a note…" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={onAddNote} disabled={isPending || !draft.trim()}>
            {isPending ? "Saving…" : "Add note"}
          </Button>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {!error && !entries && <Skeleton className="h-24 w-full" />}
      {!error && entries && entries.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">No activity recorded yet.</p>
      )}
      {!error && entries && entries.length > 0 && (
        <ul className="flex max-h-96 flex-col divide-y overflow-y-auto rounded-md border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{entry.by}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{formatWhen(entry.at)}</span>
              </div>
              {entry.kind === "note" ? (
                <p className="whitespace-pre-wrap">{entry.note}</p>
              ) : (
                <>
                  <span className="text-muted-foreground">{entry.summary}</span>
                  {entry.changes.length > 0 && (
                    <ul className="flex flex-col gap-0.5 pl-3">
                      {entry.changes.map((change) => (
                        <li key={change.field} className="text-muted-foreground text-xs">
                          {change.label}: {change.before} → {change.after}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
