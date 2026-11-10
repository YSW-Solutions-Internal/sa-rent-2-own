"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { updateVehicleInlineField, type InlineEditableField } from "./actions";

/** How long the inline-edit Undo toast (and its countdown bar) stays up. */
const UNDO_TOAST_DURATION_MS = 8000;

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

  // Saves `next`, showing a toast with an Undo button that writes `previous`
  // straight back — the client wanted a safety net for an accidental edit
  // (e.g. clearing a field) that's already autosaved by the time they notice.
  // `isRevert` is true when this save *is* that Undo running: it skips
  // showing another Undo toast on top (that chained forever — undoing the
  // mistake kept re-arming itself as a new "mistake" to undo).
  function save(next: string, previous: string, isRevert = false) {
    setPendingValue(next);
    startTransition(async () => {
      const result = await updateVehicleInlineField(vehicleId, field, next);
      setPendingValue(null);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (isRevert) {
        toast.success(`${label} reverted`);
        return;
      }
      toast.custom(
        (id) => (
          <div className="relative w-[var(--width)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
            <div className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="flex-1">{`${label} updated`}</span>
              <button
                type="button"
                onClick={() => {
                  toast.dismiss(id);
                  save(previous, next, true);
                }}
                className="shrink-0 rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                Undo
              </button>
            </div>
            {/* Subtle countdown of the Undo window — purely decorative, so
                it's dropped rather than frozen under prefers-reduced-motion. */}
            <div
              className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-destructive motion-reduce:hidden"
              style={{ animation: `toast-countdown ${UNDO_TOAST_DURATION_MS}ms linear forwards` }}
            />
          </div>
        ),
        { duration: UNDO_TOAST_DURATION_MS, position: "bottom-right" }
      );
    });
  }

  function finish(shouldSave: boolean) {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (!shouldSave || draft === current) return;
    save(draft, current);
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
        onFocus={(e) => e.target.select()}
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
