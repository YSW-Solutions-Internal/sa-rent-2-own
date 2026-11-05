"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-ranges";

import { listContractPaymentHistory, type ContractPaymentHistoryEntry } from "./payment-actions";

const TYPE_LABELS = { receipt: "Receipt", debit_note: "Debit note" } as const;

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

export function ContractPaymentHistorySection({ contractId }: { contractId: string }) {
  const [entries, setEntries] = useState<ContractPaymentHistoryEntry[] | null>(null);

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
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        Payment history
      </h3>
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
