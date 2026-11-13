"use client";

import { useEffect, useState } from "react";

import { ClientName } from "@/components/blacklist-flag";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Field, Section } from "@/components/vehicle-details-dialog";
import { formatDisplayDate } from "@/lib/date-ranges";
import type { ContractStatus, ContractType } from "@/lib/database.types";
import { getContractDetails, type ContractDetails } from "@/app/(app)/contracts/contract-details-actions";

const STATUS_VARIANT: Record<
  ContractStatus,
  "default" | "secondary" | "destructive" | "warning" | "success" | "outline"
> = {
  active: "success",
  completed: "secondary",
  cancelled: "outline",
  defaulted: "destructive",
  repossessed: "destructive",
};

const STATUS_LABELS: Record<ContractStatus, string> = {
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  defaulted: "Defaulted",
  repossessed: "Repossessed",
};

const TYPE_LABELS: Record<ContractType, string> = {
  rent_to_own: "Rent-to-own",
  short_term_rental: "Short-term rental",
  rental: "Rental",
  other: "Other",
};

const rand = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(n);

/** Read-only contract summary popup — opened by clicking a deal number on the Payments tables. */
export function ContractDetailsDialog({
  contractId,
  dealNumber,
  onClose,
}: {
  contractId: string | null;
  dealNumber: string | null;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<{
    contractId: string;
    details?: ContractDetails;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!contractId) return;
    let cancelled = false;
    getContractDetails(contractId).then((result) => {
      if (!cancelled) setLoaded({ contractId, details: result.data, error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  // Derived rather than reset in the effect, so a stale result from the
  // previously opened contract never flashes while the next one loads.
  const current = loaded && loaded.contractId === contractId ? loaded : null;
  const details = current?.details;

  return (
    <Dialog open={contractId !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {dealNumber ?? details?.dealNumber ?? "Contract"}
            {details && <span className="text-muted-foreground ml-2 text-base font-normal">{TYPE_LABELS[details.contractType]}</span>}
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
            <Section title="Contract">
              <Field label="Status">
                <Badge variant={STATUS_VARIANT[details.status]}>{STATUS_LABELS[details.status]}</Badge>
              </Field>
              <Field label="Client">
                {details.clientName ? <ClientName name={details.clientName} blacklisted={details.clientBlacklisted} /> : null}
              </Field>
              <Field label="Vehicle">{[details.reg, details.vehicle].filter(Boolean).join(" — ")}</Field>
              <Field label="Start">{formatDisplayDate(details.startDate)}</Field>
              <Field label="End">{formatDisplayDate(details.endDate)}</Field>
              <Field label="Installment">{details.installmentAmount != null ? rand(details.installmentAmount) : null}</Field>
            </Section>

            <Section title="Payments">
              <Field label="Total collected">{rand(details.totalCollected)}</Field>
              <Field label="Outstanding balance">{rand(details.outstandingBalance)}</Field>
              <Field label="Arrears">{rand(details.arrearsAmount)}</Field>
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A deal number shown as a link-styled button that opens the contract details popup. */
export function DealNumberButton({
  dealNumber,
  contractId,
  onOpen,
}: {
  dealNumber: string | null;
  contractId: string;
  onOpen: (contractId: string, dealNumber: string | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(contractId, dealNumber)}
      className="hover:text-primary cursor-pointer font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
    >
      {dealNumber ?? "—"}
    </button>
  );
}
