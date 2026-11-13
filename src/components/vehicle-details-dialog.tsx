"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { formatDisplayDate } from "@/lib/date-ranges";
import { VEHICLE_STATUS_LABELS as STATUS_LABELS, VEHICLE_STATUS_VARIANT as STATUS_VARIANT } from "@/lib/vehicle-status";
import { getVehicleDetails, type VehicleDetails } from "@/app/(app)/vehicles/vehicle-details-actions";

const TRACKER_LABELS: Record<string, string> = { yes: "Running", no: "Not running", no_info: "No info" };

const rand = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(n);
const yesNo = (v: boolean) => (v ? "Yes" : "No");
const km = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("en-ZA")} km`);

/** Shared with contract-details-dialog.tsx — the same label/value layout for any read-only summary popup. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children || "—"}</dd>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</dl>
    </section>
  );
}

/** Read-only vehicle summary popup — opened by clicking a reg on the Payments tables. */
export function VehicleDetailsDialog({
  vehicleId,
  reg,
  onClose,
}: {
  vehicleId: string | null;
  reg: string | null;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<{
    vehicleId: string;
    details?: VehicleDetails;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    getVehicleDetails(vehicleId).then((result) => {
      if (!cancelled) setLoaded({ vehicleId, details: result.data, error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  // Derived rather than reset in the effect, so a stale result from the
  // previously opened vehicle never flashes while the next one loads.
  const current = loaded && loaded.vehicleId === vehicleId ? loaded : null;
  const details = current?.details;

  return (
    <Dialog open={vehicleId !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {reg ?? details?.reg ?? "Vehicle"}
            {details && (
              <span className="text-muted-foreground ml-2 text-base font-normal">
                {[details.year, details.make, details.model].filter(Boolean).join(" ")}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {!current && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
        {current?.error && <p className="text-destructive text-sm">{current.error}</p>}

        {details && (
          <div className="flex flex-col gap-5">
            <Section title="Vehicle">
              <Field label="File no">{details.fileNo}</Field>
              <Field label="Status">
                <Badge variant={STATUS_VARIANT[details.status]}>{STATUS_LABELS[details.status]}</Badge>
              </Field>
              <Field label="Colour">{details.colour}</Field>
              <Field label="VIN">{details.vin}</Field>
              <Field label="Engine number">{details.engineNumber}</Field>
              <Field label="Mileage">{km(details.currentMileage)}</Field>
            </Section>

            <Section title="Service &amp; compliance">
              <Field label="Next service">{km(details.nextServiceKm)}</Field>
              <Field label="Next service date">{formatDisplayDate(details.nextServiceDate)}</Field>
              <Field label="Last serviced by">{details.lastServicedBy}</Field>
              <Field label="Licence disc expiry">{formatDisplayDate(details.licenseDiscExpiry)}</Field>
              <Field label="NATIS on file">{yesNo(details.natisOnFile)}</Field>
              <Field label="Spare key">{yesNo(details.hasSpareKey)}</Field>
              <Field label="Warranty">{yesNo(details.warrantyActive)}</Field>
              <Field label="Tracker">
                {[details.trackerSupplier, details.trackerRunning && TRACKER_LABELS[details.trackerRunning]]
                  .filter(Boolean)
                  .join(" · ")}
              </Field>
            </Section>

            <Section title="Current contract">
              <Field label="Client">{details.clientName}</Field>
              <Field label="Start">{formatDisplayDate(details.contractStart)}</Field>
              <Field label="End">{formatDisplayDate(details.contractEnd)}</Field>
              <Field label="Installment">
                {details.installmentAmount != null ? rand(details.installmentAmount) : null}
              </Field>
              {details.purchasePrice != null && <Field label="Purchase price">{rand(details.purchasePrice)}</Field>}
              {details.potentialSalePrice != null && (
                <Field label="Potential sale price">{rand(details.potentialSalePrice)}</Field>
              )}
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A reg shown as a link-styled button that opens the details popup; plain text when there's no vehicle. */
export function RegButton({
  reg,
  vehicleId,
  onOpen,
}: {
  reg: string | null;
  vehicleId: string | null;
  onOpen: (vehicleId: string, reg: string | null) => void;
}) {
  if (!reg) return <>—</>;
  if (!vehicleId) return <>{reg}</>;
  return (
    <button
      type="button"
      onClick={() => onOpen(vehicleId, reg)}
      className="hover:text-primary cursor-pointer font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
    >
      {reg}
    </button>
  );
}
