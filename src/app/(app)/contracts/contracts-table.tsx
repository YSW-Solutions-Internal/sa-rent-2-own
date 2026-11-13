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
import { StatButtonPill } from "@/components/dashboard/stat-pill";
import { formatDisplayDate, isoDaysFromNow } from "@/lib/date-ranges";
import type { ExportColumn } from "@/lib/export-to-excel";
import { copyNodeAsImage } from "@/lib/copy-as-image";
import { cn } from "@/lib/utils";
import { useRowSelection } from "@/lib/use-row-selection";
import { compareNumbers, compareStrings, useTableControls } from "@/lib/use-table-controls";
import { useColumnWidths } from "@/lib/use-column-widths";
import { useColumnResize } from "@/lib/use-column-resize";
import type { ContractStatus, ContractType } from "@/lib/database.types";

import { contractStatusValues } from "./schema";
import { ContractPanel } from "./contract-panel";
import { DeleteContractButton } from "./delete-contract-button";
import type { ContractRow, SelectableClient, SelectableVehicle } from "./types";

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

/** Cards across the top: each toggles a contract type (several can be on). */
const TYPE_CARDS: { type: ContractType; label: string; subtitle: string }[] = [
  { type: "rent_to_own", label: "Contracts", subtitle: "Rent-to-own contracts" },
  { type: "rental", label: "Rentals", subtitle: "Rental contracts" },
  { type: "short_term_rental", label: "STR", subtitle: "Short-term rental contracts" },
];

const STATUS_CHIP_COLORS: Record<ContractStatus, { fill: string; font?: string }> = {
  active: { fill: "FF2F9E58" },
  completed: { fill: "FFE5E5E5", font: "FF1F1F1F" },
  cancelled: { fill: "FFFFFFFF", font: "FF1F1F1F" },
  defaulted: { fill: "FFFF5252" },
  repossessed: { fill: "FFFF5252" },
};

const ARREARS_CHIP = { fill: "FFFF5252" };

type SortKey = "deal" | "vehicle" | "client" | "type" | "status" | "installment" | "arrears" | "endDate";

export function ContractsTable({
  rows,
  vehicles,
  clients,
  initialEndingSoon,
  initialOpenContractId,
  exportedBy,
  canEdit,
}: {
  rows: ContractRow[];
  vehicles: SelectableVehicle[];
  clients: SelectableClient[];
  initialEndingSoon?: boolean;
  initialOpenContractId?: string | null;
  exportedBy: string;
  canEdit: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | ContractStatus>("all");
  // Type cards are multi-select toggles; empty = every type.
  const [typeFilter, setTypeFilter] = useState<ContractType[]>([]);
  const [endingSoon, setEndingSoon] = useState(initialEndingSoon ?? false);
  // One shared edit panel instead of one per row; keyed per open so its form
  // starts from the contract's current values, and kept mounted after
  // closing so the sheet can finish its close animation.
  const [panel, setPanel] = useState<{ contractId: string; open: boolean; openCount: number } | null>(
    initialOpenContractId ? { contractId: initialOpenContractId, open: true, openCount: 1 } : null
  );
  const captureRef = useRef<HTMLDivElement>(null);

  const panelContract = panel ? rows.find((r) => r.id === panel.contractId) : undefined;

  const searchFn = useCallback(
    (row: ContractRow, query: string) =>
      [row.vehicleLabel, row.clientName, row.deal_number ?? ""].some((value) =>
        value.toLowerCase().includes(query)
      ),
    []
  );

  const sortFns = {
    deal: (a: ContractRow, b: ContractRow) => compareStrings(a.deal_number, b.deal_number),
    vehicle: (a: ContractRow, b: ContractRow) => compareStrings(a.vehicleLabel, b.vehicleLabel),
    client: (a: ContractRow, b: ContractRow) => compareStrings(a.clientName, b.clientName),
    type: (a: ContractRow, b: ContractRow) => compareStrings(a.contract_type, b.contract_type),
    status: (a: ContractRow, b: ContractRow) => compareStrings(a.status, b.status),
    installment: (a: ContractRow, b: ContractRow) =>
      compareNumbers(a.installment_amount, b.installment_amount),
    arrears: (a: ContractRow, b: ContractRow) => compareNumbers(a.arrears_amount, b.arrears_amount),
    endDate: (a: ContractRow, b: ContractRow) =>
      compareStrings(a.end_date, b.end_date),
  } satisfies Record<SortKey, (a: ContractRow, b: ContractRow) => number>;

  function toggleType(type: ContractType) {
    setTypeFilter((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }
  const typeCounts = Object.fromEntries(
    TYPE_CARDS.map((card) => [card.type, rows.filter((r) => r.contract_type === card.type).length])
  ) as Record<ContractType, number>;

  const endingSoonCutoff = isoDaysFromNow(90);
  // Matches the preFiltered predicate below exactly, so the pill's count is
  // always what clicking it actually shows.
  const endingSoonCount = rows.filter((r) => r.end_date && r.end_date <= endingSoonCutoff).length;
  const preFiltered = rows
    .filter((r) => statusFilter === "all" || r.status === statusFilter)
    .filter((r) => typeFilter.length === 0 || typeFilter.includes(r.contract_type))
    .filter((r) => !endingSoon || (r.end_date && r.end_date <= endingSoonCutoff));

  const { search, setSearch, sortKey, sortDir, onSort, filteredRows } = useTableControls<
    ContractRow,
    SortKey
  >({
    rows: preFiltered,
    searchFn,
    sortFns,
    defaultSortKey: "endDate",
  });

  const { widths, setWidths, commitWidths } = useColumnWidths("sar2o:contracts-columns");
  const { headerRowRef, startResize } = useColumnResize(widths, setWidths, commitWidths);

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
    await copyNodeAsImage(captureRef.current, { count: selectedRows.length, filenamePrefix: "contracts" });
  }

  async function handleExport() {
    const { exportToExcel, summarizeFilters } = await import("@/lib/export-to-excel");
    const columns: ExportColumn<ContractRow>[] = [
      { header: "Deal number", value: (r) => r.deal_number ?? "" },
      { header: "Vehicle", value: (r) => r.vehicleLabel },
      { header: "Client", value: (r) => (r.clientBlacklisted ? `${r.clientName} (BLACKLISTED)` : r.clientName) },
      { header: "Type", value: (r) => TYPE_LABELS[r.contract_type] },
      {
        header: "Status",
        value: (r) => STATUS_LABELS[r.status],
        chip: (r) => STATUS_CHIP_COLORS[r.status],
      },
      {
        header: "Installment",
        value: (r) => r.installment_amount ?? "",
        numberFormat: '"R"#,##0.00',
        align: "right",
      },
      {
        header: "Arrears",
        value: (r) => r.arrears_amount,
        numberFormat: '"R"#,##0.00',
        align: "right",
        chip: (r) => (r.arrears_amount > 0 ? ARREARS_CHIP : null),
      },
      { header: "End date", value: (r) => r.end_date ?? "" },
    ];

    exportToExcel({
      baseFilename: "contracts",
      sheetName: "Contracts",
      title: "SAR2O Fleet — Contracts Export",
      filterSummary: summarizeFilters([
        search && `Search: "${search}"`,
        statusFilter !== "all" && `Status: ${STATUS_LABELS[statusFilter]}`,
        typeFilter.length > 0 && `Type: ${typeFilter.map((t) => TYPE_LABELS[t]).join(", ")}`,
        endingSoon && "Ending within 3 months",
      ]),
      exportedBy,
      columns,
      rows: selectedRows.length > 0 ? selectedRows : filteredRows,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Contracts</h1>
        <div className="flex flex-wrap items-center gap-2">
          {TYPE_CARDS.map((card) => (
            <StatButtonPill
              key={card.type}
              label={card.label}
              value={typeCounts[card.type]}
              subtitle={`${card.subtitle} — click several to combine`}
              isActive={typeFilter.includes(card.type)}
              onClick={() => toggleType(card.type)}
            />
          ))}
          {canEdit && <ContractPanel vehicles={vehicles} clients={clients} />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search vehicle or client…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-background max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | ContractStatus)}>
          <SelectTrigger className="bg-background w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {contractStatusValues.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={endingSoon ? "default" : "outline"}
          size="sm"
          title="Contracts ending within 3 months"
          onClick={() => setEndingSoon((v) => !v)}
        >
          Ending soon ({endingSoonCount})
        </Button>
        {/* Export is gated the same as edit rights (admin only) — Fleet Managers are
            read-only everywhere else, exporting is a way to take data out. */}
        {canEdit && (
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
        <p className="text-muted-foreground text-sm">
          {filteredRows.length === rows.length
            ? `${rows.length} on record`
            : `${filteredRows.length} of ${rows.length}`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background">
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
                label="Deal number"
                sortKey="deal"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.deal}
                onResizeStart={startResize("deal")}
              />
              <SortableHead
                label="Vehicle"
                sortKey="vehicle"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.vehicle}
                onResizeStart={startResize("vehicle")}
              />
              <SortableHead
                label="Client"
                sortKey="client"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.client}
                onResizeStart={startResize("client")}
              />
              <SortableHead
                label="Type"
                sortKey="type"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.type}
                onResizeStart={startResize("type")}
              />
              <SortableHead
                label="Status"
                sortKey="status"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.status}
                onResizeStart={startResize("status")}
              />
              <SortableHead
                label="Installment"
                sortKey="installment"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.installment}
                onResizeStart={startResize("installment")}
              />
              <SortableHead
                label="Arrears"
                sortKey="arrears"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.arrears}
                onResizeStart={startResize("arrears")}
              />
              <SortableHead
                label="End date"
                sortKey="endDate"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.endDate}
                onResizeStart={startResize("endDate")}
              />
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((row, index) => {
              const isStr = row.contract_type === "short_term_rental";
              return (
                <TableRow
                  key={row.id}
                  className={cn("cursor-pointer", isStr && "bg-muted/70")}
                  onClick={() => setPanel((prev) => ({ contractId: row.id, open: true, openCount: (prev?.openCount ?? 0) + 1 }))}
                >
                  <TableCell
                    className={cn(
                      "sticky left-0 z-10 w-20 border-r group-hover:bg-muted group-data-[state=selected]:bg-muted",
                      isStr ? "bg-muted/70" : "bg-background"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedIds.has(row.id)}
                        onCheckedChange={() => toggleRow(row.id)}
                        aria-label={`Select ${row.deal_number ?? row.vehicleLabel}`}
                      />
                      <span className="text-muted-foreground flex-1 text-center">{index + 1}</span>
                    </div>
                  </TableCell>
                  <TableCell>{row.deal_number ?? "—"}</TableCell>
                  <TableCell className="font-medium">{row.vehicleLabel}</TableCell>
                  <TableCell><ClientName name={row.clientName} blacklisted={row.clientBlacklisted} /></TableCell>
                  <TableCell className="capitalize">{row.contract_type.replace(/_/g, " ")}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    {row.installment_amount ? `R${row.installment_amount.toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell>
                    {row.arrears_amount > 0 ? (
                      <Badge variant="destructive">R{Math.round(row.arrears_amount).toLocaleString()}</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{formatDisplayDate(row.end_date)}</TableCell>
                  <TableCell
                    className="flex items-center justify-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit && <DeleteContractButton contractId={row.id} label={row.vehicleLabel} />}
                  </TableCell>
                </TableRow>
              );
            })}
            {filteredRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-muted-foreground text-center py-8">
                  No contracts match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {panelContract && panel && (
        <ContractPanel
          key={`${panel.contractId}:${panel.openCount}`}
          contract={panelContract}
          vehicles={vehicles}
          clients={clients}
          readOnly={!canEdit}
          open={panel.open}
          onOpenChange={(next) => {
            setPanel((prev) => (prev ? { ...prev, open: next } : prev));
            // Drop ?open=… from the address once the panel is closed.
            if (!next && initialOpenContractId) {
              const url = new URL(window.location.href);
              url.searchParams.delete("open");
              window.history.replaceState(null, "", url);
            }
          }}
        />
      )}

      <ImageCaptureArea captureRef={captureRef}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Deal number</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Installment</TableHead>
              <TableHead>Arrears</TableHead>
              <TableHead>End date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selectedRows.map((row) => (
              <TableRow key={row.id} className={row.contract_type === "short_term_rental" ? "bg-muted/70" : undefined}>
                <TableCell>{row.deal_number ?? "—"}</TableCell>
                <TableCell className="font-medium">{row.vehicleLabel}</TableCell>
                <TableCell><ClientName name={row.clientName} blacklisted={row.clientBlacklisted} /></TableCell>
                <TableCell className="capitalize">{row.contract_type.replace(/_/g, " ")}</TableCell>
                <TableCell>{STATUS_LABELS[row.status]}</TableCell>
                <TableCell>
                  {row.installment_amount ? `R${row.installment_amount.toLocaleString()}` : "—"}
                </TableCell>
                <TableCell>{row.arrears_amount > 0 ? `R${Math.round(row.arrears_amount).toLocaleString()}` : "—"}</TableCell>
                <TableCell>{formatDisplayDate(row.end_date)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ImageCaptureArea>
    </div>
  );
}
