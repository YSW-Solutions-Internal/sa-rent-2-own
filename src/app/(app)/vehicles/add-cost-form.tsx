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

import { createVehicleCost } from "./cost-actions";
import { vehicleCostTypeValues } from "./costs-schema";

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

/** The "capture a cost" form, shared by the vehicle modal's Transactions section and the row's quick-add dialog. */
export function AddCostForm({
  vehicleId,
  onSaved,
  onCancel,
  className,
}: {
  vehicleId: string;
  onSaved: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedWork, setSelectedWork] = useState<string[]>([]);

  function toggleWork(item: string) {
    setSelectedWork((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]));
  }

  function onSubmit(formData: FormData) {
    // The chips and the free text are saved together in the one "What was done" field.
    const typed = String(formData.get("workDone") ?? "").trim();
    const picked = WORK_DONE_OPTIONS.filter((o) => selectedWork.includes(o)).join(", ");
    formData.set("workDone", [picked, typed].filter(Boolean).join(" – "));
    startTransition(async () => {
      const result = await createVehicleCost(vehicleId, formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Cost added");
      formRef.current?.reset();
      setSelectedWork([]);
      onSaved();
    });
  }

  return (
    <form ref={formRef} action={onSubmit} className={className ?? "flex flex-col gap-3"}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="costType">Type</Label>
          <Select name="costType" defaultValue="service">
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
          <Input id="costDate" name="costDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="supplier">Done by</Label>
          <Input id="supplier" name="supplier" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="amount">Amount (R)</Label>
          <Input id="amount" name="amount" type="number" step="0.01" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="mileageAtTime">Mileage</Label>
          <Input id="mileageAtTime" name="mileageAtTime" type="number" />
        </div>
        <div className="grid gap-1.5 md:col-span-3">
          <Label htmlFor="invoice">Invoice (PDF)</Label>
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
          <Textarea id="workDone" name="workDone" rows={2} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" rows={2} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save cost"}
        </Button>
      </div>
    </form>
  );
}
