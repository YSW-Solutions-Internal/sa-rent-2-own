"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-ranges";

import { AddPaymentForm } from "./add-payment-form";
import { listContractPaymentHistory, type ContractPaymentHistoryEntry } from "./payment-actions";
import { paymentMethodValues } from "./schema";

const TYPE_LABELS = { receipt: "Receipt", debit_note: "Debit note" } as const;

const PAYMENT_METHOD_LABELS: Record<(typeof paymentMethodValues)[number], string> = {
  debit_order: "Debit order",
  eft: "EFT",
  cash: "Cash",
  other: "Other",
};

function formatRand(amount: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);
}

function StatusBadge({ entry }: { entry: ContractPaymentHistoryEntry }) {
  if (entry.type === "debit_note") {
    return <Badge variant="outline">Reversal</Badge>;
  }
  return entry.reversed ? (
    <Badge variant="destructive">Reversed</Badge>
  ) : (
    <Badge variant="success">Cleared</Badge>
  );
}

export function ContractPaymentHistorySection({
  contractId,
  canManage = false,
}: {
  contractId: string;
  /** Shows "Add payment" — admin only, same as every other contract edit. */
  canManage?: boolean;
}) {
  const [entries, setEntries] = useState<ContractPaymentHistoryEntry[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  function refresh() {
    listContractPaymentHistory(contractId).then((result) => setEntries(result.data ?? []));
  }

  useEffect(() => {
    let cancelled = false;
    listContractPaymentHistory(contractId).then((result) => {
      if (!cancelled) setEntries(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Payment history
        </h3>
        {canManage && (
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAddForm((v) => !v)}>
            <Plus />
            Add payment
          </Button>
        )}
      </div>
      {showAddForm && (
        <AddPaymentForm
          contractId={contractId}
          onSaved={() => {
            setShowAddForm(false);
            refresh();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}
      {entries === null ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No payment history on file for this contract yet.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDisplayDate(entry.transaction_date)}</TableCell>
                  <TableCell>{TYPE_LABELS[entry.type]}</TableCell>
                  <TableCell>
                    {entry.payment_method ? PAYMENT_METHOD_LABELS[entry.payment_method] : "—"}
                  </TableCell>
                  <TableCell>{entry.invoice_reference}</TableCell>
                  <TableCell className="tabular-nums">{formatRand(entry.amount)}</TableCell>
                  <TableCell>
                    <StatusBadge entry={entry} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
