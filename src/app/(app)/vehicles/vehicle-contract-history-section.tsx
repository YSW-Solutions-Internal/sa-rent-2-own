"use client";

import { ClientName } from "@/components/blacklist-flag";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-ranges";

import { listVehicleContractHistory, type VehicleContractHistoryEntry } from "./assignment-actions";

export function VehicleContractHistorySection({ vehicleId }: { vehicleId: string }) {
  const [entries, setEntries] = useState<VehicleContractHistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listVehicleContractHistory(vehicleId).then((result) => {
      if (!cancelled) setEntries(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        Contract history
      </h3>
      {entries === null ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No contracts recorded for this vehicle yet.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deal number</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.deal_number ?? "—"}</TableCell>
                  <TableCell><ClientName name={entry.client_name} blacklisted={entry.client_blacklisted} /></TableCell>
                  <TableCell>
                    <Badge variant={entry.effective_to ? "outline" : "success"}>
                      {entry.contract_status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDisplayDate(entry.effective_from)}</TableCell>
                  <TableCell>
                    {entry.effective_to ? formatDisplayDate(entry.effective_to) : "Current"}
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
