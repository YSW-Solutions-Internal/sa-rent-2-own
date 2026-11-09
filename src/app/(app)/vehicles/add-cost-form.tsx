"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { createVehicleCost } from "./cost-actions";
import { vehicleCostTypeValues } from "./costs-schema";

export const COST_TYPE_LABELS: Record<(typeof vehicleCostTypeValues)[number], string> = {
  service: "Service",
  repair: "Repair",
  car_wash: "Car wash",
  maintenance: "Maintenance",
  other: "Other",
};

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

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createVehicleCost(vehicleId, formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Cost added");
      formRef.current?.reset();
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
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="workDone">What was done</Label>
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
