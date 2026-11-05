"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-ranges";
import type { ContractStatus } from "@/lib/database.types";

import { listClientContracts, type ClientContractEntry } from "./contract-links-actions";

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

export function ClientContractsSection({ clientId }: { clientId: string }) {
  const [entries, setEntries] = useState<ClientContractEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listClientContracts(clientId).then((result) => {
      if (!cancelled) setEntries(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        Linked contracts
      </h3>
      {entries === null ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No contracts linked to this client yet.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deal number</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start date</TableHead>
                <TableHead>End date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.deal_number ?? "—"}</TableCell>
                  <TableCell>
                    {entry.file_no}
                    {entry.plate ? ` (${entry.plate})` : ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[entry.status]}>{STATUS_LABELS[entry.status]}</Badge>
                  </TableCell>
                  <TableCell>{formatDisplayDate(entry.start_date)}</TableCell>
                  <TableCell>{entry.end_date ? formatDisplayDate(entry.end_date) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
