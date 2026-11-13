"use client";

import { ClientName } from "@/components/blacklist-flag";
import { useCallback, useRef, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ContractDetailsDialog, DealNumberButton } from "@/components/contract-details-dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RegButton, VehicleDetailsDialog } from "@/components/vehicle-details-dialog";
import { copyNodeAsImage } from "@/lib/copy-as-image";
import type { ExportColumn } from "@/lib/export-to-excel";
import { useRowSelection } from "@/lib/use-row-selection";
import { compareNumbers, compareStrings, useTableControls } from "@/lib/use-table-controls";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/lib/database.types";

import { paymentMethodValues } from "../contracts/schema";
import type { ContractMonthlyReportRow } from "./types";

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  debit_order: "Debit order",
  eft: "EFT",
  cash: "Cash",
  other: "Other",
};

type SortKey = "deal" | "client" | "reg" | "missed" | "outstanding";

// Column widths in rem. The table uses `table-layout: fixed` with a
// <colgroup> built from these so every column is *exactly* this wide — with
// the default auto layout the browser resized columns, so the frozen
// columns' `left` offsets (the sums of the widths before them) drifted,
// leaving a gap after the checkbox column and tucking the first month under
// the frozen pane.
const COL_REM = { select: 5, deal: 7, client: 9, reg: 8, total: 10, month: 7 };

// Frozen left pane (admin view): select/# · Deal · Client · Reg · Total
// outstanding stay put while the month columns scroll. Each `left-*` is the
// sum of the widths before it (5, 12, 21, 29 rem) — change COL_REM and these
// together.
const FROZEN_DEAL = "sticky left-20 z-10 bg-background group-hover:bg-muted";
const FROZEN_CLIENT = "sticky left-48 z-10 truncate bg-background group-hover:bg-muted";
const FROZEN_REG = "sticky left-84 z-10 truncate bg-background group-hover:bg-muted";
const FROZEN_TOTAL = "sticky left-116 z-10 border-r bg-background group-hover:bg-muted";
const FROZEN_HEAD = "z-20 bg-muted";

function formatRand(amount: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function MonthlyReportTable({
  rows,
  monthLabels,
  exportedBy,
  showCash,
  showOutstanding,
  canExport,
}: {
  rows: ContractMonthlyReportRow[];
  monthLabels: string[];
  exportedBy: string;
  /** Fleet Managers never see "Cash" payments — the rows are already dropped server-side, this also hides the filter option. */
  showCash: boolean;
  /** "Total outstanding" column + footer total — admin only (never populated for Fleet Managers). */
  showOutstanding: boolean;
  /** Export to Excel — admin only; Fleet Managers are read-only everywhere else. */
  canExport: boolean;
}) {
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<"all" | PaymentMethod>("all");
  const [missedOnly, setMissedOnly] = useState(false);
  const [openVehicle, setOpenVehicle] = useState<{ id: string; reg: string | null } | null>(null);
  const [openContract, setOpenContract] = useState<{ id: string; dealNumber: string | null } | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  const searchFn = useCallback(
    (row: ContractMonthlyReportRow, query: string) =>
      [row.dealNumber ?? "", row.clientName, row.reg ?? ""].some((value) =>
        value.toLowerCase().includes(query)
      ),
    []
  );

  const sortFns = {
    deal: (a: ContractMonthlyReportRow, b: ContractMonthlyReportRow) => compareStrings(a.dealNumber, b.dealNumber),
    client: (a: ContractMonthlyReportRow, b: ContractMonthlyReportRow) => compareStrings(a.clientName, b.clientName),
    reg: (a: ContractMonthlyReportRow, b: ContractMonthlyReportRow) => compareStrings(a.reg, b.reg),
    // Reversed vs. the other columns — the default (ascending) sort should
    // surface the worst-paying accounts first, since that's the point of
    // this report, not bury them at the bottom of an ascending list.
    missed: (a: ContractMonthlyReportRow, b: ContractMonthlyReportRow) => compareNumbers(b.missedCount, a.missedCount),
    outstanding: (a: ContractMonthlyReportRow, b: ContractMonthlyReportRow) =>
      compareNumbers(a.outstandingBalance, b.outstandingBalance),
  } satisfies Record<SortKey, (a: ContractMonthlyReportRow, b: ContractMonthlyReportRow) => number>;

  const preFiltered = rows
    .filter((r) => paymentTypeFilter === "all" || r.paymentMethod === paymentTypeFilter)
    .filter((r) => !missedOnly || r.missedCount > 0);

  const { search, setSearch, sortKey, sortDir, onSort, filteredRows } = useTableControls<
    ContractMonthlyReportRow,
    SortKey
  >({
    rows: preFiltered,
    searchFn,
    sortFns,
    defaultSortKey: "missed",
    storageKey: "payments-report-sort",
  });

  async function handleExport() {
    const { exportToExcel, summarizeFilters } = await import("@/lib/export-to-excel");
    const columns: ExportColumn<ContractMonthlyReportRow>[] = [
      { header: "Deal number", value: (r) => r.dealNumber ?? "" },
      { header: "Client", value: (r) => (r.clientBlacklisted ? `${r.clientName} (BLACKLISTED)` : r.clientName) },
      { header: "Reg", value: (r) => r.reg ?? "" },
      ...(showOutstanding
        ? [
            {
              header: "Total outstanding",
              value: (r: ContractMonthlyReportRow) => r.outstandingBalance ?? "",
              numberFormat: '"R"#,##0',
              align: "right" as const,
            },
          ]
        : []),
      ...monthLabels.map((label, i) => ({
        header: label,
        value: (r: ContractMonthlyReportRow) => r.months[i].netCollected,
        numberFormat: '"R"#,##0',
        align: "right" as const,
        chip: (r: ContractMonthlyReportRow) => {
          const cell = r.months[i];
          if (cell.beforeCoverage) return null;
          return cell.missed ? { fill: "FFFF5252" } : { fill: "FF2F9E58" };
        },
      })),
    ];

    const exportRows = selectedRows.length > 0 ? selectedRows : filteredRows;

    exportToExcel({
      baseFilename: "payments-report",
      sheetName: "Payments",
      title: "SAR2O Fleet — Payments Report",
      filterSummary: summarizeFilters([
        search && `Search: "${search}"`,
        paymentTypeFilter !== "all" && `Payment type: ${PAYMENT_METHOD_LABELS[paymentTypeFilter]}`,
        missedOnly && "Accounts with a missed payment only",
      ]),
      exportedBy,
      columns,
      rows: exportRows,
      totals: showOutstanding
        ? {
            label: "Total outstanding",
            // Columns are Deal, Client, Reg, Total outstanding, months…
            labelColumn: 2,
            valueColumn: 3,
            value: exportRows.reduce((sum, r) => sum + (r.outstandingBalance ?? 0), 0),
            numberFormat: '"R"#,##0',
          }
        : undefined,
    });
  }

  const {
    selectedIds,
    selectedRows,
    allVisibleSelected,
    someVisibleSelected,
    toggleRow,
    toggleAllVisible,
    clear: clearSelection,
  } = useRowSelection(filteredRows, (r) => r.contractId);

  // One row per contract here, so the total is a plain sum of the filtered rows.
  const tableRem =
    COL_REM.select +
    COL_REM.deal +
    COL_REM.client +
    COL_REM.reg +
    (showOutstanding ? COL_REM.total : 0) +
    monthLabels.length * COL_REM.month;

  const totalOutstanding = filteredRows.reduce((sum, r) => sum + (r.outstandingBalance ?? 0), 0);

  async function handleCopyAsImage() {
    if (!captureRef.current || selectedRows.length === 0) return;
    await copyNodeAsImage(captureRef.current, { count: selectedRows.length, filenamePrefix: "payments-report" });
  }

  function monthCells(row: ContractMonthlyReportRow) {
    return row.months.map((cell) => (
      <TableCell
        key={cell.monthKey}
        className={cn(
          "text-right tabular-nums",
          cell.beforeCoverage && "text-muted-foreground",
          !cell.beforeCoverage && cell.missed && "bg-destructive/10 text-destructive font-semibold",
          !cell.beforeCoverage && !cell.missed && "bg-success/10"
        )}
      >
        {cell.beforeCoverage ? "—" : formatRand(cell.netCollected)}
      </TableCell>
    ));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search deal number, client, or reg…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-background max-w-xs"
        />
        <Select
          value={paymentTypeFilter}
          onValueChange={(v) => setPaymentTypeFilter(v as "all" | PaymentMethod)}
        >
          <SelectTrigger className="bg-background w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payment types</SelectItem>
            {paymentMethodValues
              .filter((method) => showCash || method !== "cash")
              .map((method) => (
                <SelectItem key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={missedOnly} onCheckedChange={(v) => setMissedOnly(Boolean(v))} />
          Only accounts with a missed payment
        </label>
        <div className="ml-auto flex items-center gap-2">
          {canExport && (
            <Button type="button" variant="outline" size="sm" onClick={handleExport}>
              <Download />
              Export
            </Button>
          )}
          <SelectionActions
            selectedCount={selectedRows.length}
            onCopyAsImage={handleCopyAsImage}
            onClear={clearSelection}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table
          containerClassName="overflow-x-visible"
          className="w-auto table-fixed"
          style={{ width: `${tableRem}rem` }}
        >
          <colgroup>
            <col style={{ width: `${COL_REM.select}rem` }} />
            <col style={{ width: `${COL_REM.deal}rem` }} />
            <col style={{ width: `${COL_REM.client}rem` }} />
            <col style={{ width: `${COL_REM.reg}rem` }} />
            {showOutstanding && <col style={{ width: `${COL_REM.total}rem` }} />}
            {monthLabels.map((label) => (
              <col key={label} style={{ width: `${COL_REM.month}rem` }} />
            ))}
          </colgroup>
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
              <SortableHead
                label="Deal number"
                sortKey="deal"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                className={showOutstanding ? cn(FROZEN_DEAL, FROZEN_HEAD) : undefined}
              />
              <SortableHead
                label="Client"
                sortKey="client"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                className={showOutstanding ? cn(FROZEN_CLIENT, FROZEN_HEAD) : undefined}
              />
              <SortableHead
                label="Reg"
                sortKey="reg"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                className={showOutstanding ? cn(FROZEN_REG, FROZEN_HEAD) : undefined}
              />
              {showOutstanding && (
                <SortableHead
                  label="Total outstanding"
                  sortKey="outstanding"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  className={cn(FROZEN_TOTAL, FROZEN_HEAD, "text-right")}
                />
              )}
              {monthLabels.map((label) => (
                <TableHead key={label} className="text-right">
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4 + monthLabels.length + (showOutstanding ? 1 : 0)} className="text-muted-foreground text-center">
                  No accounts match this filter.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row, index) => (
                <TableRow key={row.contractId}>
                  <TableCell className="sticky left-0 z-10 w-20 border-r bg-background group-hover:bg-muted group-data-[state=selected]:bg-muted">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedIds.has(row.contractId)}
                        onCheckedChange={() => toggleRow(row.contractId)}
                        aria-label={`Select ${row.dealNumber ?? row.clientName}`}
                      />
                      <span className="text-muted-foreground flex-1 text-center">{index + 1}</span>
                    </div>
                  </TableCell>
                  <TableCell className={showOutstanding ? FROZEN_DEAL : undefined}>
                    <DealNumberButton
                      dealNumber={row.dealNumber}
                      contractId={row.contractId}
                      onOpen={(id, dealNumber) => setOpenContract({ id, dealNumber })}
                    />
                  </TableCell>
                  <TableCell className={showOutstanding ? FROZEN_CLIENT : undefined} title={row.clientName}>
                    <ClientName name={row.clientName} blacklisted={row.clientBlacklisted} />
                  </TableCell>
                  <TableCell className={showOutstanding ? FROZEN_REG : undefined} title={row.reg ?? undefined}>
                    <RegButton
                      reg={row.reg}
                      vehicleId={row.vehicleId}
                      onOpen={(id, reg) => setOpenVehicle({ id, reg })}
                    />
                  </TableCell>
                  {showOutstanding && (
                    <TableCell className={cn(FROZEN_TOTAL, "text-right font-medium tabular-nums")}>
                      {row.outstandingBalance != null ? formatRand(row.outstandingBalance) : "—"}
                    </TableCell>
                  )}
                  {monthCells(row)}
                </TableRow>
              ))
            )}
          </TableBody>
          {showOutstanding && filteredRows.length > 0 && (
            <TableFooter className="bg-muted sticky bottom-0 z-10">
              <TableRow>
                <TableCell colSpan={4} className="bg-muted sticky left-0 z-10 text-right">
                  Total outstanding
                  <span className="text-muted-foreground ml-1 font-normal">
                    ({filteredRows.length} account{filteredRows.length === 1 ? "" : "s"})
                  </span>
                </TableCell>
                <TableCell className="bg-muted sticky left-116 z-10 border-r text-right tabular-nums">
                  {formatRand(totalOutstanding)}
                </TableCell>
                <TableCell colSpan={monthLabels.length} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <ImageCaptureArea captureRef={captureRef}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Deal number</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Reg</TableHead>
              {showOutstanding && <TableHead className="text-right">Total outstanding</TableHead>}
              {monthLabels.map((label) => (
                <TableHead key={label} className="text-right">
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {selectedRows.map((row) => (
              <TableRow key={row.contractId}>
                <TableCell>{row.dealNumber ?? "—"}</TableCell>
                <TableCell><ClientName name={row.clientName} blacklisted={row.clientBlacklisted} /></TableCell>
                <TableCell>{row.reg ?? "—"}</TableCell>
                {showOutstanding && (
                  <TableCell className="text-right font-medium tabular-nums">
                    {row.outstandingBalance != null ? formatRand(row.outstandingBalance) : "—"}
                  </TableCell>
                )}
                {monthCells(row)}
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
      <ContractDetailsDialog
        contractId={openContract?.id ?? null}
        dealNumber={openContract?.dealNumber ?? null}
        onClose={() => setOpenContract(null)}
      />
    </div>
  );
}
