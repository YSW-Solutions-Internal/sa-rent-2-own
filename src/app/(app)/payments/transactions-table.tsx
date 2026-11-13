"use client";

import { ClientName } from "@/components/blacklist-flag";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RegButton, VehicleDetailsDialog } from "@/components/vehicle-details-dialog";
import { copyNodeAsImage } from "@/lib/copy-as-image";
import { formatDisplayDate } from "@/lib/date-ranges";
import type { ExportColumn } from "@/lib/export-to-excel";
import { useRowSelection } from "@/lib/use-row-selection";
import { useColumnWidths } from "@/lib/use-column-widths";
import { useColumnResize } from "@/lib/use-column-resize";

import { exportTransactions } from "./actions";
import {
  TRANSACTIONS_PAGE_SIZE,
  type PaymentTransactionRow,
  type TransactionsFilters,
  type TransactionsSortKey,
  type TransactionsTypeFilter,
} from "./types";

const TYPE_LABELS: Record<"receipt" | "debit_note", string> = { receipt: "Receipt", debit_note: "Debit note" };
const LOADING_TOAST_ID = "payments-transactions-loading";

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

export function TransactionsTable({
  rows,
  total,
  filters,
  exportedBy,
  canExport,
}: {
  /** The current page's rows, straight from the server query. */
  rows: PaymentTransactionRow[];
  /** Every row matching the current filters, not just this page. */
  total: number;
  filters: TransactionsFilters;
  exportedBy: string;
  /** Export to Excel — admin only; Fleet Managers are read-only everywhere else. */
  canExport: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [isExporting, setIsExporting] = useState(false);
  const [openVehicle, setOpenVehicle] = useState<{ id: string; reg: string | null } | null>(null);
  const [openContract, setOpenContract] = useState<{ id: string; dealNumber: string | null } | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const { widths, setWidths, commitWidths } = useColumnWidths("sar2o:transactions-columns");
  const { headerRowRef, startResize } = useColumnResize(widths, setWidths, commitWidths);

  // Rows loaded so far across "Show more" clicks — search/filter/sort
  // changes always start a fresh page 1, so a new page-1 result replaces
  // this instead of appending to it; a page >1 result (from "Show more")
  // appends. Adjusted during render rather than in an effect (React's
  // own pattern for "state derived from a prop that changed") so a new
  // server result never flashes the old page in before correcting.
  const [accumulated, setAccumulated] = useState<PaymentTransactionRow[]>(rows);
  const [lastRows, setLastRows] = useState(rows);
  if (rows !== lastRows) {
    setLastRows(rows);
    setAccumulated(filters.page > 1 && !filters.all ? [...accumulated, ...rows] : rows);
  }

  // A classy "still loading" cue during the URL-driven refetch (see
  // navigate() below) instead of the route's whole-page spinner, which
  // would otherwise flash over the table on every keystroke/filter click.
  useEffect(() => {
    if (isPending) {
      toast.loading("Updating…", { id: LOADING_TOAST_ID });
    } else {
      toast.dismiss(LOADING_TOAST_ID);
    }
  }, [isPending]);

  function navigate(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "transactions");
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  // Local, so the input feels instant while typing; synced to the URL
  // (the source of truth) after a short pause, and re-synced from the
  // URL if it changes from elsewhere (e.g. the back button) — again
  // adjusted during render, not in an effect (see `accumulated` above).
  const [searchInput, setSearchInput] = useState(filters.q);
  const [lastQ, setLastQ] = useState(filters.q);
  if (filters.q !== lastQ) {
    setLastQ(filters.q);
    setSearchInput(filters.q);
  }
  useEffect(() => {
    if (searchInput === filters.q) return;
    const timer = setTimeout(() => {
      navigate({ tx_q: searchInput || undefined, tx_page: undefined });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function handleTypeChange(value: TransactionsTypeFilter) {
    navigate({ tx_type: value === "all" ? undefined : value, tx_page: undefined });
  }

  function handleSort(key: TransactionsSortKey) {
    if (key === filters.sort) {
      navigate({ tx_dir: filters.dir === "asc" ? "desc" : "asc", tx_page: undefined });
    } else {
      navigate({ tx_sort: key, tx_dir: key === "date" ? "desc" : "asc", tx_page: undefined });
    }
  }

  function handleShowMore() {
    navigate({ tx_page: String(filters.page + 1) });
  }

  function handleShowAll() {
    navigate({ tx_page: "all" });
  }

  const {
    selectedIds,
    selectedRows,
    allVisibleSelected,
    someVisibleSelected,
    toggleRow,
    toggleAllVisible,
    clear: clearSelection,
  } = useRowSelection(accumulated, (r) => r.id);

  async function handleCopyAsImage() {
    if (!captureRef.current || selectedRows.length === 0) return;
    await copyNodeAsImage(captureRef.current, { count: selectedRows.length, filenamePrefix: "transactions" });
  }

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    toast.loading("Preparing export…", { id: "payments-tx-export" });
    try {
      // A selection exports just those rows (already loaded, no re-query needed).
      // With nothing selected, re-query every matching row, not just the loaded page.
      let exportRows: PaymentTransactionRow[];
      if (selectedRows.length > 0) {
        exportRows = selectedRows;
      } else {
        const result = await exportTransactions({
          q: filters.q,
          type: filters.type,
          sort: filters.sort,
          dir: filters.dir,
        });
        if ("error" in result) {
          toast.error(result.error, { id: "payments-tx-export" });
          return;
        }
        exportRows = result.rows;
      }

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
          filters.q && `Search: "${filters.q}"`,
          filters.type !== "all" && `Type: ${TYPE_LABELS[filters.type]}`,
        ]),
        exportedBy,
        columns,
        rows: exportRows,
      });
      toast.success(`Exported ${exportRows.length.toLocaleString()} transactions`, { id: "payments-tx-export" });
    } finally {
      setIsExporting(false);
    }
  }, [filters.q, filters.type, filters.sort, filters.dir, exportedBy, selectedRows]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search deal number, client, reg, or reference…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="bg-background max-w-xs"
        />
        <Select value={filters.type} onValueChange={(v) => handleTypeChange(v as TransactionsTypeFilter)}>
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
          {canExport && (
            <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={isExporting}>
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
        <Table containerClassName="overflow-x-visible" className={Object.keys(widths).length > 0 ? "table-fixed" : undefined}>
          <TableHeader className="bg-background sticky top-0 z-20">
            <TableRow ref={headerRowRef}>
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
                label="Date"
                sortKey="date"
                activeKey={filters.sort}
                direction={filters.dir}
                onSort={handleSort}
                width={widths.date}
                onResizeStart={startResize("date")}
              />
              <SortableHead
                label="Deal number"
                sortKey="deal"
                activeKey={filters.sort}
                direction={filters.dir}
                onSort={handleSort}
                width={widths.deal}
                onResizeStart={startResize("deal")}
              />
              <SortableHead
                label="Client"
                sortKey="client"
                activeKey={filters.sort}
                direction={filters.dir}
                onSort={handleSort}
                width={widths.client}
                onResizeStart={startResize("client")}
              />
              <TableHead data-column-id="reg">Reg</TableHead>
              <TableHead data-column-id="type">Type</TableHead>
              <TableHead data-column-id="invoice">Invoice</TableHead>
              <SortableHead
                label="Amount"
                sortKey="amount"
                activeKey={filters.sort}
                direction={filters.dir}
                onSort={handleSort}
                className="text-right"
                width={widths.amount}
                onResizeStart={startResize("amount")}
              />
              <TableHead data-column-id="status">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accumulated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-muted-foreground text-center">
                  No transactions match this filter.
                </TableCell>
              </TableRow>
            ) : (
              accumulated.map((row, index) => (
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
                  <TableCell>
                    {row.contractId ? (
                      <DealNumberButton
                        dealNumber={row.dealNumber}
                        contractId={row.contractId}
                        onOpen={(id, dealNumber) => setOpenContract({ id, dealNumber })}
                      />
                    ) : (
                      (row.dealNumber ?? "—")
                    )}
                  </TableCell>
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
        {accumulated.length < total && (
          <div className="text-muted-foreground flex items-center justify-center gap-3 border-t p-3 text-sm">
            Showing {accumulated.length.toLocaleString()} of {total.toLocaleString()}
            <Button type="button" variant="outline" size="sm" onClick={handleShowMore} disabled={isPending}>
              Show {Math.min(TRANSACTIONS_PAGE_SIZE, total - accumulated.length)} more
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleShowAll} disabled={isPending}>
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
      <ContractDetailsDialog
        contractId={openContract?.id ?? null}
        dealNumber={openContract?.dealNumber ?? null}
        onClose={() => setOpenContract(null)}
      />
    </div>
  );
}
