"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { AddCostForm } from "./add-cost-form";

/** Quick "capture a cost" modal opened from a vehicle row's + button. */
export function AddCostDialog({
  vehicleId,
  vehicleLabel,
  onOpenChange,
}: {
  vehicleId: string | null;
  vehicleLabel: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={vehicleId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add cost – {vehicleLabel}</DialogTitle>
          <DialogDescription>Log a service, repair or other cost against this vehicle.</DialogDescription>
        </DialogHeader>
        {vehicleId && (
          <AddCostForm vehicleId={vehicleId} onSaved={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
