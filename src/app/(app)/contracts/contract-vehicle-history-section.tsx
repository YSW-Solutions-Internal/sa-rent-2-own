"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-ranges";

import { listContractVehicleHistory, type ContractVehicleHistoryEntry } from "./assignment-actions";

export function ContractVehicleHistorySection({ contractId }: { contractId: string }) {
  const [entries, setEntries] = useState<ContractVehicleHistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listContractVehicleHistory(contractId).then((result) => {
      if (!cancelled) setEntries(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        Vehicle history
      </h3>
      {entries === null ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No vehicle recorded for this contract yet.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File no</TableHead>
                <TableHead>Reg</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.file_no}</TableCell>
                  <TableCell>{entry.plate ?? "—"}</TableCell>
                  <TableCell>{formatDisplayDate(entry.effective_from)}</TableCell>
                  <TableCell>
                    {entry.effective_to ? (
                      formatDisplayDate(entry.effective_to)
                    ) : (
                      <Badge variant="success">Current</Badge>
                    )}
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
