"use client";

import { Check } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { cn } from "@/lib/utils";

import { createVehicleCost, updateVehicleCost } from "./cost-actions";
import { vehicleCostTypeValues, type VehicleCost } from "./costs-schema";

export const COST_TYPE_LABELS: Record<(typeof vehicleCostTypeValues)[number], string> = {
  service: "Service",
  repair: "Repair",
  car_wash: "Car wash",
  maintenance: "Maintenance",
  other: "Other",
};

/** Common jobs, offered as tap-to-select chips above the free-text "What was done" box. */
const WORK_DONE_OPTIONS = [
  "Clutch Kit",
  "Clutch Master",
  "Wheel Alignment / Balancing",
  "Tyres",
  "Battery",
  "Wiper Blades",
] as const;

/** Splits a saved "What was done" back into the chips and the free text (see onSubmit below). */
function parseWorkDone(workDone: string | null): { chips: string[]; text: string } {
  if (!workDone) return { chips: [], text: "" };
  const known = WORK_DONE_OPTIONS as readonly string[];
  const [head, ...rest] = workDone.split(" – ");
  const headItems = head.split(", ");
  if (headItems.every((i) => known.includes(i))) return { chips: headItems, text: rest.join(" – ") };
  return { chips: [], text: workDone };
}

/**
 * The cost form: "capture a cost" (the vehicle modal's Transactions section and the row's
 * + dialog), or - when `cost` is given - edit that existing cost.
 */
export function AddCostForm({
  vehicleId,
  cost,
  onSaved,
  onCancel,
  className,
}: {
  vehicleId: string;
  cost?: VehicleCost;
  onSaved: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const initialWork = parseWorkDone(cost?.work_done ?? null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedWork, setSelectedWork] = useState<string[]>(initialWork.chips);

  function toggleWork(item: string) {
    setSelectedWork((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]));
  }

  function onSubmit(formData: FormData) {
    // The chips and the free text are saved together in the one "What was done" field.
    const typed = String(formData.get("workDone") ?? "").trim();
    const picked = WORK_DONE_OPTIONS.filter((o) => selectedWork.includes(o)).join(", ");
    formData.set("workDone", [picked, typed].filter(Boolean).join(" – "));
    startTransition(async () => {
      const result = cost ? await updateVehicleCost(cost.id, formData) : await createVehicleCost(vehicleId, formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(cost ? "Cost updated" : "Cost added");
      if (!cost) {
        formRef.current?.reset();
        setSelectedWork([]);
      }
      onSaved();
    });
  }

  return (
    <form ref={formRef} action={onSubmit} className={className ?? "flex flex-col gap-3"}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="costType">Type</Label>
          <Select name="costType" defaultValue={cost?.cost_type ?? "service"}>
            <SelectTrigger id="costType" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {vehicleCostTypeValues.map((t) => (
                <SelectItem key={t} value={t}>
                  {COST_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="costDate">Date</Label>
          <Input id="costDate" name="costDate" type="date" defaultValue={cost?.cost_date ?? new Date().toISOString().slice(0, 10)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="supplier">Done by</Label>
          <Input id="supplier" name="supplier" defaultValue={cost?.supplier ?? ""} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="amount">Amount (R)</Label>
          <Input id="amount" name="amount" type="number" step="0.01" defaultValue={cost?.amount} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="mileageAtTime">Mileage</Label>
          <Input id="mileageAtTime" name="mileageAtTime" type="number" defaultValue={cost?.mileage_at_time ?? undefined} />
        </div>
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="invoice">{cost?.invoice_file_path ? "Replace invoice (PDF)" : "Invoice (PDF)"}</Label>
          <Input id="invoice" name="invoice" type="file" accept="application/pdf" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label id="workDoneLabel">What was done</Label>
        <div role="group" aria-labelledby="workDoneLabel" className="flex flex-wrap gap-2">
          {WORK_DONE_OPTIONS.map((item) => {
            const selected = selectedWork.includes(item);
            return (
              <button
                key={item}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleWork(item)}
                className={cn(
                  "focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px]",
                  selected
                    ? "border-[var(--brand-blue-dark)] bg-[var(--brand-blue-dark)] text-white dark:border-[var(--brand-blue)] dark:bg-[var(--brand-blue)]"
                    : "bg-background hover:bg-muted"
                )}
              >
                {selected && <Check className="size-3.5" />}
                {item}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="workDone">Other work done</Label>
          <Textarea id="workDone" name="workDone" rows={2} defaultValue={initialWork.text} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" rows={2} defaultValue={cost?.notes ?? ""} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : cost ? "Save changes" : "Save cost"}
        </Button>
      </div>
    </form>
  );
}
