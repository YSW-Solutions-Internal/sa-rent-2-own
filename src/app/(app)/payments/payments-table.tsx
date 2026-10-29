"use client";

import { ClientName } from "@/components/blacklist-flag";
import { useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SortableHead } from "@/components/ui/sortable-head";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-ranges";
import { compareNumbers, compareStrings, useTableControls } from "@/lib/use-table-controls";

import type { ContractPaymentSummaryRow } from "./types";

type SortKey = "deal" | "client" | "lastDate" | "netCollected" | "reversals" | "outstanding";

function formatRand(amount: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);
}

export function PaymentsTable({ rows }: { rows: ContractPaymentSummaryRow[] }) {
  const searchFn = useCallback(
    (row: ContractPaymentSummaryRow, query: string) =>
      [row.dealNumber ?? "", row.clientName].some((value) => value.toLowerCase().includes(query)),
    []
  );

  const sortFns = {
    deal: (a: ContractPaymentSummaryRow, b: ContractPaymentSummaryRow) =>
      compareStrings(a.dealNumber, b.dealNumber),
    client: (a: ContractPaymentSummaryRow, b: ContractPaymentSummaryRow) =>
      compareStrings(a.clientName, b.clientName),
    lastDate: (a: ContractPaymentSummaryRow, b: ContractPaymentSummaryRow) =>
      compareStrings(a.lastTransactionDate, b.lastTransactionDate),
    netCollected: (a: ContractPaymentSummaryRow, b: ContractPaymentSummaryRow) =>
      compareNumbers(a.netCollected, b.netCollected),
    reversals: (a: ContractPaymentSummaryRow, b: ContractPaymentSummaryRow) =>
      compareNumbers(a.reversalCount, b.reversalCount),
    outstanding: (a: ContractPaymentSummaryRow, b: ContractPaymentSummaryRow) =>
      compareNumbers(a.outstandingBalance, b.outstandingBalance),
  } satisfies Record<SortKey, (a: ContractPaymentSummaryRow, b: ContractPaymentSummaryRow) => number>;

  const { search, setSearch, sortKey, sortDir, onSort, filteredRows } = useTableControls<
    ContractPaymentSummaryRow,
    SortKey
  >({
    rows,
    searchFn,
    sortFns,
    defaultSortKey: "lastDate",
    storageKey: "payments-table-sort",
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Input
        placeholder="Search deal number or client…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="bg-background max-w-xs"
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table containerClassName="overflow-x-visible">
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow>
              <SortableHead label="Deal number" sortKey="deal" activeKey={sortKey} direction={sortDir} onSort={onSort} />
              <SortableHead label="Client" sortKey="client" activeKey={sortKey} direction={sortDir} onSort={onSort} />
              <SortableHead
                label="Last transaction"
                sortKey="lastDate"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
              />
              <TableHead>Status</TableHead>
              <SortableHead
                label="Net collected"
                sortKey="netCollected"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                className="text-right"
              />
              <SortableHead
                label="Reversals"
                sortKey="reversals"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                className="text-right"
              />
              <SortableHead
                label="Outstanding"
                sortKey="outstanding"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                className="text-right"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-center">
                  No payment history matches this search.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => (
                <TableRow key={row.contractId}>
                  <TableCell>{row.dealNumber ?? "—"}</TableCell>
                  <TableCell><ClientName name={row.clientName} blacklisted={row.clientBlacklisted} /></TableCell>
                  <TableCell>{formatDisplayDate(row.lastTransactionDate)}</TableCell>
                  <TableCell>
                    {row.lastStatus === "cleared" ? (
                      <Badge variant="success">Cleared</Badge>
                    ) : (
                      <Badge variant="destructive">Reversed</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatRand(row.netCollected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.reversalCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.outstandingBalance != null ? formatRand(row.outstandingBalance) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
