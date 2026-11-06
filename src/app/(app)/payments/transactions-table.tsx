"use client";

import { ClientName } from "@/components/blacklist-flag";
import { useCallback, useRef, useState } from "react";
import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageCaptureArea, SelectionActions } from "@/components/ui/selection-actions";
import { SortableHead } from "@/components/ui/sortable-head";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RegButton, VehicleDetailsDialog } from "@/components/vehicle-details-dialog";
import { copyNodeAsImage } from "@/lib/copy-as-image";
import { formatDisplayDate } from "@/lib/date-ranges";
import type { ExportColumn } from "@/lib/export-to-excel";
import { useRowSelection } from "@/lib/use-row-selection";
import { compareNumbers, compareStrings, useTableControls } from "@/lib/use-table-controls";

import type { PaymentTransactionRow } from "./types";

// The ledger holds thousands of rows; rendering every one made the tab
// sluggish to open and to filter. Show a page at a time — search, filters,
// sorting, select-all and export all still work across every matching row.
const PAGE_SIZE = 250;

type SortKey = "date" | "deal" | "client" | "amount";
type TypeFilter = "all" | "receipt" | "debit_note";

const TYPE_LABELS: Record<"receipt" | "debit_note", string> = { receipt: "Receipt", debit_note: "Debit note" };

function formatRand(amount: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);
}

function statusLabel(row: PaymentTransactionRow): string {
  if (row.type === "debit_note") return "Reversal";
  return row.reversed ? "Reversed" : "Cleared";
}

function StatusBadge({ row }: { row: PaymentTransactionRow }) {
  if (row.type === "debit_note") return <Badge variant="outline">Reversal</Badge>;
  return row.reversed ? <Badge variant="destructive">Reversed</Badge> : <Badge variant="success">Cleared</Badge>;
}

export function TransactionsTable({ rows, exportedBy }: { rows: PaymentTransactionRow[]; exportedBy: string }) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openVehicle, setOpenVehicle] = useState<{ id: string; reg: string | null } | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  const searchFn = useCallback(
    (row: PaymentTransactionRow, query: string) =>
      [row.dealNumber ?? "", row.clientName, row.reg ?? "", row.reference].some((value) =>
        value.toLowerCase().includes(query)
      ),
    []
  );

  const sortFns = {
    // Reversed vs. the others — default (ascending) sort should surface
    // the most recent transactions first, like a normal activity log.
    date: (a: PaymentTransactionRow, b: PaymentTransactionRow) =>
      compareStrings(b.transactionDate, a.transactionDate),
    deal: (a: PaymentTransactionRow, b: PaymentTransactionRow) => compareStrings(a.dealNumber, b.dealNumber),
    client: (a: PaymentTransactionRow, b: PaymentTransactionRow) => compareStrings(a.clientName, b.clientName),
    amount: (a: PaymentTransactionRow, b: PaymentTransactionRow) => compareNumbers(a.cashEffect, b.cashEffect),
  } satisfies Record<SortKey, (a: PaymentTransactionRow, b: PaymentTransactionRow) => number>;

  const preFiltered = rows.filter((r) => typeFilter === "all" || r.type === typeFilter);

  const { search, setSearch, sortKey, sortDir, onSort, filteredRows } = useTableControls<
    PaymentTransactionRow,
    SortKey
  >({
    rows: preFiltered,
    searchFn,
    sortFns,
    defaultSortKey: "date",
    storageKey: "payments-transactions-sort",
  });

  function handleSort(key: SortKey) {
    onSort(key);
    setShown(PAGE_SIZE);
  }

  const visibleRows = filteredRows.slice(0, shown);

  const {
    selectedIds,
    selectedRows,
    allVisibleSelected,
    someVisibleSelected,
    toggleRow,
    toggleAllVisible,
    clear: clearSelection,
  } = useRowSelection(filteredRows, (r) => r.id);

  async function handleCopyAsImage() {
    if (!captureRef.current || selectedRows.length === 0) return;
    await copyNodeAsImage(captureRef.current, { count: selectedRows.length, filenamePrefix: "transactions" });
  }

  async function handleExport() {
    const { exportToExcel, summarizeFilters } = await import("@/lib/export-to-excel");
    const columns: ExportColumn<PaymentTransactionRow>[] = [
      { header: "Date", value: (r) => r.transactionDate },
      { header: "Deal number", value: (r) => r.dealNumber ?? "" },
      { header: "Client", value: (r) => (r.clientBlacklisted ? `${r.clientName} (BLACKLISTED)` : r.clientName) },
      { header: "Reg", value: (r) => r.reg ?? "" },
      { header: "Type", value: (r) => TYPE_LABELS[r.type] },
      { header: "Reference", value: (r) => r.reference },
      { header: "Invoice", value: (r) => r.invoiceReference },
      {
        header: "Amount",
        value: (r) => r.cashEffect,
        numberFormat: '"R"#,##0.00',
        align: "right",
        chip: (r) => {
          if (r.type === "debit_note") return { fill: "FFE5E5E5", font: "FF1F1F1F" };
          return r.reversed ? { fill: "FFFF5252" } : { fill: "FF2F9E58" };
        },
      },
    ];

    exportToExcel({
      baseFilename: "payments-transactions",
      sheetName: "Transactions",
      title: "SAR2O Fleet — Payment Transactions",
      filterSummary: summarizeFilters([
        search && `Search: "${search}"`,
        typeFilter !== "all" && `Type: ${TYPE_LABELS[typeFilter]}`,
      ]),
      exportedBy,
      columns,
      rows: filteredRows,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search deal number, client, reg, or reference…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShown(PAGE_SIZE);
          }}
          className="bg-background max-w-xs"
        />
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v as TypeFilter);
            setShown(PAGE_SIZE);
          }}
        >
          <SelectTrigger className="bg-background w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="receipt">Receipt</SelectItem>
            <SelectItem value="debit_note">Debit note</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleExport}>
            <Download />
            Export
          </Button>
          <SelectionActions
            selectedCount={selectedRows.length}
            onCopyAsImage={handleCopyAsImage}
            onClear={clearSelection}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table containerClassName="overflow-x-visible">
          <TableHeader className="bg-background sticky top-0 z-20">
            <TableRow>
              <TableHead className="sticky left-0 z-20 w-20 border-r bg-muted">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAllVisible}
                    aria-label="Select all visible rows"
                  />
                  <span className="text-muted-foreground flex-1 text-center">#</span>
                </div>
              </TableHead>
              <SortableHead label="Date" sortKey="date" activeKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHead label="Deal number" sortKey="deal" activeKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHead label="Client" sortKey="client" activeKey={sortKey} direction={sortDir} onSort={handleSort} />
              <TableHead>Reg</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Invoice</TableHead>
              <SortableHead
                label="Amount"
                sortKey="amount"
                activeKey={sortKey}
                direction={sortDir}
                onSort={handleSort}
                className="text-right"
              />
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-muted-foreground text-center">
                  No transactions match this filter.
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((row, index) => (
                <TableRow key={row.id}>
                  <TableCell className="sticky left-0 z-10 w-20 border-r bg-background group-hover:bg-muted group-data-[state=selected]:bg-muted">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedIds.has(row.id)}
                        onCheckedChange={() => toggleRow(row.id)}
                        aria-label={`Select ${row.reference}`}
                      />
                      <span className="text-muted-foreground flex-1 text-center">{index + 1}</span>
                    </div>
                  </TableCell>
                  <TableCell>{formatDisplayDate(row.transactionDate)}</TableCell>
                  <TableCell>{row.dealNumber ?? "—"}</TableCell>
                  <TableCell><ClientName name={row.clientName} blacklisted={row.clientBlacklisted} /></TableCell>
                  <TableCell>
                    <RegButton
                      reg={row.reg}
                      vehicleId={row.vehicleId}
                      onOpen={(id, reg) => setOpenVehicle({ id, reg })}
                    />
                  </TableCell>
                  <TableCell>{TYPE_LABELS[row.type]}</TableCell>
                  <TableCell>{row.invoiceReference}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRand(row.cashEffect)}</TableCell>
                  <TableCell>
                    <StatusBadge row={row} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {filteredRows.length > shown && (
          <div className="text-muted-foreground flex items-center justify-center gap-3 border-t p-3 text-sm">
            Showing {visibleRows.length.toLocaleString()} of {filteredRows.length.toLocaleString()}
            <Button type="button" variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, filteredRows.length - shown)} more
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShown(filteredRows.length)}>
              Show all
            </Button>
          </div>
        )}
      </div>

      <ImageCaptureArea captureRef={captureRef}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Deal number</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Reg</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selectedRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDisplayDate(row.transactionDate)}</TableCell>
                <TableCell>{row.dealNumber ?? "—"}</TableCell>
                <TableCell><ClientName name={row.clientName} blacklisted={row.clientBlacklisted} /></TableCell>
                <TableCell>{row.reg ?? "—"}</TableCell>
                <TableCell>{TYPE_LABELS[row.type]}</TableCell>
                <TableCell>{row.invoiceReference}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRand(row.cashEffect)}</TableCell>
                <TableCell>{statusLabel(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ImageCaptureArea>

      <VehicleDetailsDialog
        vehicleId={openVehicle?.id ?? null}
        reg={openVehicle?.reg ?? null}
        onClose={() => setOpenVehicle(null)}
      />
    </div>
  );
}
