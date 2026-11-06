"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { updateVehicleInlineField, type InlineEditableField } from "./actions";

/**
 * A table cell whose value is edited in place: click the value, type, then
 * Enter or click away to save (Escape cancels). `display` is what's shown
 * when not editing (so the date column keeps its due-date colouring);
 * `value` is the raw value that seeds the input. The saved value shows
 * immediately while the server round-trip refreshes the table.
 */
export function InlineEditCell({
  vehicleId,
  field,
  kind,
  value,
  display,
  renderPending,
  label,
}: {
  vehicleId: string;
  field: InlineEditableField;
  kind: "number" | "date" | "text";
  value: string | number | null;
  display: ReactNode;
  /** How to show a just-saved value before the refreshed row arrives. */
  renderPending: (draft: string) => ReactNode;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Enter commits and then unmounts the input, which fires a blur — this
  // stops that blur committing a second time.
  const done = useRef(false);

  const current = value == null ? "" : String(value);

  function begin() {
    done.current = false;
    setDraft(current);
    setEditing(true);
  }

  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (!save || draft === current) return;

    setPendingValue(draft);
    startTransition(async () => {
      const result = await updateVehicleInlineField(vehicleId, field, draft);
      if (result.error) toast.error(result.error);
      setPendingValue(null);
    });
  }

  if (editing) {
    return (
      <Input
        autoFocus
        type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
        min={kind === "number" ? 0 : undefined}
        step={kind === "number" ? 1 : undefined}
        inputMode={kind === "number" ? "numeric" : undefined}
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        }}
        className={cn("h-7 px-2 text-sm", kind === "text" ? "w-44" : "w-36")}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={begin}
      title="Click to edit"
      aria-label={`Edit ${label}`}
      className={cn(
        "-mx-1 min-w-8 cursor-text rounded px-1 text-left hover:bg-muted focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none",
        isPending && "opacity-60"
      )}
    >
      {pendingValue !== null ? (pendingValue === "" ? "—" : renderPending(pendingValue)) : display}
    </button>
  );
}
