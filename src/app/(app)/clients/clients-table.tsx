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
import type { ExportColumn } from "@/lib/export-to-excel";
import { copyNodeAsImage } from "@/lib/copy-as-image";
import { formatSaPhoneForDisplay } from "@/lib/phone";
import { useRowSelection } from "@/lib/use-row-selection";
import { compareStrings, useTableControls } from "@/lib/use-table-controls";
import { useColumnWidths } from "@/lib/use-column-widths";
import { useColumnResize } from "@/lib/use-column-resize";

import { DeleteClientButton } from "./delete-client-button";
import { ClientPanel } from "./client-panel";
import type { ClientWithBanking } from "./types";

type BankingFilter = "all" | "has" | "none";
type SortKey = "name" | "cell" | "idNumber";

function bankingLabel(client: ClientWithBanking): string {
  return client.banking
    ? `${client.banking.bank_name} •••• ${client.banking.account_number_last4}`
    : "None on file";
}

const BANKING_CHIP_COLORS = {
  has: { fill: "FF2F9E58" },
  none: { fill: "FFE5E5E5", font: "FF1F1F1F" },
};

export function ClientsTable({
  rows,
  exportedBy,
  canEdit,
}: {
  rows: ClientWithBanking[];
  exportedBy: string;
  canEdit: boolean;
}) {
  const [bankingFilter, setBankingFilter] = useState<BankingFilter>("all");
  // One shared edit panel instead of one per row; keyed per open so its form
  // starts from the client's current values, and kept mounted after closing
  // so the sheet can finish its close animation.
  const [panel, setPanel] = useState<{ clientId: string; open: boolean; openCount: number } | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  const panelClient = panel ? rows.find((r) => r.id === panel.clientId) : undefined;

  const searchFn = useCallback(
    (row: ClientWithBanking, query: string) =>
      [row.full_name, row.cell_number, row.id_number]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    []
  );

  const sortFns = {
    name: (a: ClientWithBanking, b: ClientWithBanking) => compareStrings(a.full_name, b.full_name),
    cell: (a: ClientWithBanking, b: ClientWithBanking) => compareStrings(a.cell_number, b.cell_number),
    idNumber: (a: ClientWithBanking, b: ClientWithBanking) => compareStrings(a.id_number, b.id_number),
  } satisfies Record<SortKey, (a: ClientWithBanking, b: ClientWithBanking) => number>;

  const filteredByBanking =
    bankingFilter === "all"
      ? rows
      : rows.filter((r) => (bankingFilter === "has" ? Boolean(r.banking) : !r.banking));

  const { search, setSearch, sortKey, sortDir, onSort, filteredRows } = useTableControls<
    ClientWithBanking,
    SortKey
  >({
    rows: filteredByBanking,
    searchFn,
    sortFns,
    defaultSortKey: "name",
  });

  const { widths, setWidths, commitWidths } = useColumnWidths("sar2o:clients-columns");
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
    await copyNodeAsImage(captureRef.current, { count: selectedRows.length, filenamePrefix: "clients" });
  }

  async function handleExport() {
    const { exportToExcel, summarizeFilters } = await import("@/lib/export-to-excel");
    const columns: ExportColumn<ClientWithBanking>[] = [
      { header: "Name", value: (c) => c.full_name },
      { header: "Blacklisted", value: (c) => (c.blacklisted ? "Yes" : "") },
      { header: "Cell number", value: (c) => formatSaPhoneForDisplay(c.cell_number) },
      { header: "ID number", value: (c) => c.id_number ?? "" },
      {
        header: "Banking",
        value: (c) => bankingLabel(c),
        chip: (c) => (c.banking ? BANKING_CHIP_COLORS.has : BANKING_CHIP_COLORS.none),
      },
    ];

    exportToExcel({
      baseFilename: "clients",
      sheetName: "Clients",
      title: "SAR2O Fleet — Clients Export",
      filterSummary: summarizeFilters([
        search && `Search: "${search}"`,
        bankingFilter === "has" && "Has banking on file",
        bankingFilter === "none" && "No banking on file",
      ]),
      exportedBy,
      columns,
      rows: selectedRows.length > 0 ? selectedRows : filteredRows,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search name, cell, ID number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-background max-w-xs"
        />
        <Select value={bankingFilter} onValueChange={(v) => setBankingFilter(v as BankingFilter)}>
          <SelectTrigger className="bg-background w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            <SelectItem value="has">Has banking on file</SelectItem>
            <SelectItem value="none">No banking on file</SelectItem>
          </SelectContent>
        </Select>
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
                label="Name"
                sortKey="name"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.name}
                onResizeStart={startResize("name")}
              />
              <SortableHead
                label="Cell number"
                sortKey="cell"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.cell}
                onResizeStart={startResize("cell")}
              />
              <SortableHead
                label="ID number"
                sortKey="idNumber"
                activeKey={sortKey}
                direction={sortDir}
                onSort={onSort}
                width={widths.idNumber}
                onResizeStart={startResize("idNumber")}
              />
              <TableHead data-column-id="banking">Banking</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((client, index) => (
              <TableRow
                key={client.id}
                className="cursor-pointer"
                onClick={() => setPanel((prev) => ({ clientId: client.id, open: true, openCount: (prev?.openCount ?? 0) + 1 }))}
              >
                <TableCell
                  className="sticky left-0 z-10 w-20 border-r bg-background group-hover:bg-muted group-data-[state=selected]:bg-muted"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedIds.has(client.id)}
                      onCheckedChange={() => toggleRow(client.id)}
                      aria-label={`Select ${client.full_name}`}
                    />
                    <span className="text-muted-foreground flex-1 text-center">{index + 1}</span>
                  </div>
                </TableCell>
                <TableCell className="font-medium"><ClientName name={client.full_name} blacklisted={client.blacklisted} /></TableCell>
                <TableCell>{formatSaPhoneForDisplay(client.cell_number)}</TableCell>
                <TableCell>{client.id_number ?? "—"}</TableCell>
                <TableCell>
                  {client.banking ? (
                    <Badge variant="secondary">{bankingLabel(client)}</Badge>
                  ) : (
                    <span className="text-muted-foreground">{bankingLabel(client)}</span>
                  )}
                </TableCell>
                <TableCell
                  className="flex items-center justify-end gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canEdit && <DeleteClientButton clientId={client.id} label={client.full_name} />}
                </TableCell>
              </TableRow>
            ))}
            {filteredRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center py-8">
                  No clients match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {panelClient && panel && (
        <ClientPanel
          key={`${panel.clientId}:${panel.openCount}`}
          client={panelClient}
          readOnly={!canEdit}
          open={panel.open}
          onOpenChange={(next) => setPanel((prev) => (prev ? { ...prev, open: next } : prev))}
        />
      )}

      <ImageCaptureArea captureRef={captureRef}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Cell number</TableHead>
              <TableHead>ID number</TableHead>
              <TableHead>Banking</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selectedRows.map((client) => (
              <TableRow key={client.id}>
                <TableCell className="font-medium"><ClientName name={client.full_name} blacklisted={client.blacklisted} /></TableCell>
                <TableCell>{formatSaPhoneForDisplay(client.cell_number)}</TableCell>
                <TableCell>{client.id_number ?? "—"}</TableCell>
                <TableCell>{bankingLabel(client)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ImageCaptureArea>
    </div>
  );
}
