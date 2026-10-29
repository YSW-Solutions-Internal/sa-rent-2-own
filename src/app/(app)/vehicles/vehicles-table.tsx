"use client";

import { ClientName } from "@/components/blacklist-flag";
import { memo, useCallback, useMemo, useRef, useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { ChevronDown, Download, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImageCaptureArea, SelectionActions } from "@/components/ui/selection-actions";
import { ColumnVisibilityMenu } from "@/components/ui/column-visibility-menu";
import { DraggableTableHead } from "@/components/ui/draggable-table-head";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatButtonPill } from "@/components/dashboard/stat-pill";
import { daysUntil, formatDayCount, formatDisplayDate, isoDaysFromNow } from "@/lib/date-ranges";
import { dueDateColorScale, dueDateExcelChip } from "@/lib/due-date-color";
import { exportToExcel, summarizeFilters, type ExportColumn } from "@/lib/export-to-excel";
import { useColumnOrder } from "@/lib/use-column-order";
import { copyNodeAsImage } from "@/lib/copy-as-image";
import {
  FLEET_STATUSES,
  VEHICLE_STATUS_CHIP_COLORS as STATUS_CHIP_COLORS,
  VEHICLE_STATUS_LABELS as STATUS_LABELS,
  VEHICLE_STATUS_VARIANT as STATUS_VARIANT,
  isFleetStatus,
} from "@/lib/vehicle-status";
import { useRowSelection } from "@/lib/use-row-selection";
import { compareNumbers, compareStrings, useTableControls } from "@/lib/use-table-controls";
import { formatSaPhoneForDisplay } from "@/lib/phone";
import {
  VEHICLE_COLOUR_OPTIONS,
  readableTextColor,
  resolveVehicleColourHex,
  toArgb,
} from "@/lib/vehicle-colours";
import type { PaymentMethod, TrackerStatus, VehicleStatus } from "@/lib/database.types";

import { vehicleStatusValues } from "./schema";
import { updateVehicleColour, updateVehicleStatus } from "./actions";
import { InlineEditCell } from "./inline-edit-cell";
import { DeleteVehicleButton } from "./delete-vehicle-button";
import { VehiclePanel } from "./vehicle-panel";
import type { VehicleWithRegistration } from "./types";

const TRACKER_LABELS: Record<TrackerStatus, string> = {
  yes: "Yes",
  no: "No",
  no_info: "No info",
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  debit_order: "Debit order",
  eft: "EFT",
  cash: "Cash",
  other: "Other",
};

const PAID_CHIP_COLORS = {
  yes: { fill: "FF2F9E58" },
  no: { fill: "FFFF5252" },
};

function formatMoney(amount: number | null): string {
  return amount != null ? `R${amount.toLocaleString()}` : "—";
}

function formatYesNo(value: boolean | null): string {
  if (value === null) return "—";
  return value ? "Yes" : "No";
}

function formatServiceCountdown(date: string | null): string {
  if (!date) return "—";
  const diff = daysUntil(date);
  if (diff === 0) return "Due today";
  return formatDayCount(Math.abs(diff));
}

function ServiceCountdown({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const overdue = daysUntil(date) < 0;
  return (
    <span className={overdue ? "text-destructive font-medium" : undefined}>
      {formatServiceCountdown(date)}
    </span>
  );
}

/** Plain date display that turns red when the date has already passed —
 * same "text-destructive font-medium" treatment as the countdown columns,
 * for date columns where being in the past is itself the problem (a
 * service date that's come and gone, a license disc that's expired). */
function PastDueDate({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const overdue = daysUntil(date) < 0;
  return (
    <span className={overdue ? "text-destructive font-medium" : undefined}>
      {formatDisplayDate(date)}
    </span>
  );
}

/** Date chip with a red -> amber -> green cell-fill colour scale based on
 * how far out the date is, matching the client's spreadsheet's conditional
 * formatting. */
function DueDateGradient({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const days = daysUntil(date);
  const { background, foreground } = dueDateColorScale(days);
  return (
    <Badge
      variant="outline"
      style={{ backgroundColor: background, color: foreground, borderColor: "rgba(0,0,0,0.15)" }}
    >
      {formatDisplayDate(date)}
    </Badge>
  );
}

function ColourChip({ name }: { name: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  const hex = resolveVehicleColourHex(name);
  if (!hex) return <Badge variant="outline">{name}</Badge>;
  return (
    <Badge
      variant="outline"
      style={{ backgroundColor: hex, color: readableTextColor(hex), borderColor: "rgba(0,0,0,0.15)" }}
    >
      {name}
    </Badge>
  );
}

/** A compact, borderless Select styled to look like its trigger content
 * (a Badge) rather than a form control, so it reads as the same chip the
 * read-only cell renders, just clickable. */
const INLINE_SELECT_TRIGGER_CLASS =
  "h-auto w-fit gap-1 border-none bg-transparent p-0 shadow-none hover:opacity-80 focus-visible:ring-1 data-[state=open]:opacity-80 [&_svg]:size-3 [&_svg]:opacity-40";

/** Looks like the closed inline dropdown (value + faint chevron). The real
 * Radix <Select> is only mounted once it's clicked — mounting two of them
 * (each carrying every option) on every one of ~200 rows made every filter
 * click and tab switch re-render thousands of components. */
function InlineSelectButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex items-center gap-1 hover:opacity-80 focus-visible:ring-1 focus-visible:outline-none"
    >
      {children}
      <ChevronDown className="size-3 opacity-40" />
    </button>
  );
}

function StatusCell({
  vehicle,
  canManage,
}: {
  vehicle: VehicleWithRegistration;
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const badge = <Badge variant={STATUS_VARIANT[vehicle.status]}>{STATUS_LABELS[vehicle.status]}</Badge>;

  if (!canManage) return badge;
  if (!editing) {
    return (
      <InlineSelectButton label="Change status" onClick={() => setEditing(true)}>
        {badge}
      </InlineSelectButton>
    );
  }

  return (
    <Select
      open
      onOpenChange={(next) => {
        if (!next) setEditing(false);
      }}
      value={vehicle.status}
      disabled={isPending}
      onValueChange={(value) => {
        const status = value as VehicleStatus;
        if (status === vehicle.status) return;
        startTransition(async () => {
          const result = await updateVehicleStatus(vehicle.id, status);
          if (result.error) toast.error(result.error);
          else if (isFleetStatus(vehicle.status) && !isFleetStatus(status)) {
            toast.success("Moved to the End of Contract tab");
          } else if (!isFleetStatus(vehicle.status) && isFleetStatus(status)) {
            toast.success("Moved back to the Fleet tab");
          }
        });
      }}
    >
      <SelectTrigger size="sm" className={INLINE_SELECT_TRIGGER_CLASS} onClick={(e) => e.stopPropagation()}>
        {badge}
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        {vehicleStatusValues.map((status) => (
          <SelectItem key={status} value={status}>
            {STATUS_LABELS[status]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ColourCell({
  vehicle,
  canManage,
}: {
  vehicle: VehicleWithRegistration;
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  if (!canManage) {
    return <ColourChip name={vehicle.colour} />;
  }
  if (!editing) {
    return (
      <InlineSelectButton label="Change colour" onClick={() => setEditing(true)}>
        <ColourChip name={vehicle.colour} />
      </InlineSelectButton>
    );
  }

  const current = vehicle.colour;

  return (
    <Select
      open
      onOpenChange={(next) => {
        if (!next) setEditing(false);
      }}
      value={current ?? undefined}
      disabled={isPending}
      onValueChange={(value) => {
        if (value === current) return;
        startTransition(async () => {
          const result = await updateVehicleColour(vehicle.id, value);
          if (result.error) toast.error(result.error);
        });
      }}
    >
      <SelectTrigger size="sm" className={INLINE_SELECT_TRIGGER_CLASS} onClick={(e) => e.stopPropagation()}>
        <ColourChip name={current} />
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        {VEHICLE_COLOUR_OPTIONS.map((option) => {
          const hex = resolveVehicleColourHex(option);
          return (
            <SelectItem key={option} value={option}>
              <span className="flex items-center gap-2">
                {hex && (
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full border border-black/15"
                    style={{ backgroundColor: hex }}
                  />
                )}
                {option}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function formatContractCountdown(date: string | null): string {
  if (!date) return "—";
  const diff = daysUntil(date);
  return diff < 0 ? "Ended" : formatDayCount(diff);
}

function ContractCountdown({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const overdue = daysUntil(date) < 0;
  return (
    <span className={overdue ? "text-destructive font-medium" : undefined}>
      {formatContractCountdown(date)}
    </span>
  );
}

type ColumnId =
  | "reg"
  | "fileNo"
  | "make"
  | "model"
  | "year"
  | "colour"
  | "vin"
  | "engineNumber"
  | "status"
  | "legacyStatusNote"
  | "client"
  | "nextService"
  | "nextServiceDate"
  | "monthsLeft"
  | "contractEndDate"
  | "currentMileage"
  | "nextServiceKm"
  | "lastServicedBy"
  | "trackerRunning"
  | "trackerSupplier"
  | "natis"
  | "spareKey"
  | "contractFile"
  | "warranty"
  | "licenseDiscExpiry"
  | "clientCell"
  | "pastClients"
  | "installment"
  | "paymentMethod"
  | "potentialSalePrice"
  | "purchasePrice"
  | "purchaseDate"
  | "totalCollected"
  | "residualValue"
  | "paidUp";

const DEFAULT_COLUMN_ORDER: ColumnId[] = [
  "reg",
  "fileNo",
  "make",
  "model",
  "year",
  "colour",
  "vin",
  "engineNumber",
  "status",
  "legacyStatusNote",
  "client",
  "nextService",
  "nextServiceDate",
  "monthsLeft",
  "contractEndDate",
  "currentMileage",
  "nextServiceKm",
  "lastServicedBy",
  "trackerRunning",
  "trackerSupplier",
  "natis",
  "spareKey",
  "contractFile",
  "warranty",
  "licenseDiscExpiry",
  "clientCell",
  "pastClients",
  "installment",
  "paymentMethod",
  "potentialSalePrice",
  "purchasePrice",
  "purchaseDate",
  "totalCollected",
  "residualValue",
  "paidUp",
];

// New columns default to hidden (still toggleable via the Columns menu) so
// the existing default view doesn't suddenly balloon to 30+ columns.
const DEFAULT_HIDDEN_COLUMNS: ColumnId[] = [
  "legacyStatusNote",
  "currentMileage",
  "nextServiceKm",
  "lastServicedBy",
  "trackerRunning",
  "trackerSupplier",
  "natis",
  "spareKey",
  "contractFile",
  "warranty",
  "licenseDiscExpiry",
  "clientCell",
  "pastClients",
  "installment",
  "paymentMethod",
  "potentialSalePrice",
  "purchasePrice",
  "purchaseDate",
  "totalCollected",
  "residualValue",
  "paidUp",
];

const COLUMN_LABELS: Record<ColumnId, string> = {
  reg: "Reg",
  fileNo: "File no",
  make: "Make",
  model: "Model",
  year: "Year",
  colour: "Colour",
  vin: "VIN",
  engineNumber: "Engine no",
  status: "Status",
  legacyStatusNote: "Status/location note",
  client: "Client",
  nextService: "Next service in:",
  nextServiceDate: "Next service date",
  monthsLeft: "Months left",
  contractEndDate: "Contract end date",
  currentMileage: "Current mileage",
  nextServiceKm: "Next service km",
  lastServicedBy: "Last serviced by",
  trackerRunning: "Tracker running",
  trackerSupplier: "Tracker supplier",
  natis: "NATIS",
  spareKey: "Spare key",
  contractFile: "Contract on file",
  warranty: "Warranty",
  licenseDiscExpiry: "License disc expiry",
  clientCell: "Client cell",
  pastClients: "Past clients",
  installment: "Installment",
  paymentMethod: "Payment method",
  potentialSalePrice: "Potential sale price",
  purchasePrice: "Purchase price",
  purchaseDate: "Purchase date",
  totalCollected: "Total collected",
  residualValue: "RV",
  paidUp: "Paid",
};

/** Hidden from everyone but admins — also stripped server-side in page.tsx. */
const PRICE_COLUMNS = new Set<ColumnId>(["potentialSalePrice", "purchasePrice"]);

const MANAGER_ONLY_COLUMNS = new Set<ColumnId>([
  "client",
  "monthsLeft",
  "contractEndDate",
  "clientCell",
  "pastClients",
  "installment",
  "paymentMethod",
  "potentialSalePrice",
  "purchasePrice",
  "purchaseDate",
  "totalCollected",
  "residualValue",
  "paidUp",
]);

function renderCell(column: ColumnId, vehicle: VehicleWithRegistration, canManage: boolean) {
  switch (column) {
    case "reg":
      return vehicle.current_plate ?? "—";
    case "fileNo":
      return vehicle.file_no;
    case "make":
      return vehicle.make ?? "—";
    case "model":
      return vehicle.model ?? "—";
    case "year":
      return vehicle.year ?? "—";
    case "colour":
      return <ColourCell vehicle={vehicle} canManage={canManage} />;
    case "vin":
      return vehicle.vin ?? "—";
    case "engineNumber":
      return vehicle.engine_number ?? "—";
    case "status":
      return <StatusCell vehicle={vehicle} canManage={canManage} />;
    case "legacyStatusNote":
      return vehicle.legacy_status_note ?? "—";
    case "client":
      return vehicle.current_client_name ? (
        <ClientName name={vehicle.current_client_name} blacklisted={vehicle.current_client_blacklisted} />
      ) : (
        "—"
      );
    case "nextService":
      return <ServiceCountdown date={vehicle.next_service_date} />;
    case "nextServiceDate":
      return canManage ? (
        <InlineEditCell
          vehicleId={vehicle.id}
          field="next_service_date"
          kind="date"
          label="next service date"
          value={vehicle.next_service_date}
          display={<DueDateGradient date={vehicle.next_service_date} />}
          renderPending={(draft) => <DueDateGradient date={draft} />}
        />
      ) : (
        <DueDateGradient date={vehicle.next_service_date} />
      );
    case "monthsLeft":
      return <ContractCountdown date={vehicle.current_contract_end_date} />;
    case "contractEndDate":
      return <PastDueDate date={vehicle.current_contract_end_date} />;
    case "currentMileage":
      return canManage ? (
        <InlineEditCell
          vehicleId={vehicle.id}
          field="current_mileage"
          kind="number"
          label="current mileage"
          value={vehicle.current_mileage}
          display={vehicle.current_mileage?.toLocaleString() ?? "—"}
          renderPending={(draft) => Number(draft).toLocaleString()}
        />
      ) : (
        (vehicle.current_mileage?.toLocaleString() ?? "—")
      );
    case "nextServiceKm":
      return canManage ? (
        <InlineEditCell
          vehicleId={vehicle.id}
          field="next_service_km"
          kind="number"
          label="next service km"
          value={vehicle.next_service_km}
          display={vehicle.next_service_km?.toLocaleString() ?? "—"}
          renderPending={(draft) => Number(draft).toLocaleString()}
        />
      ) : (
        (vehicle.next_service_km?.toLocaleString() ?? "—")
      );
    case "lastServicedBy":
      return vehicle.last_serviced_by ?? "—";
    case "trackerRunning":
      return TRACKER_LABELS[vehicle.tracker_running];
    case "trackerSupplier":
      return vehicle.tracker_supplier ?? "—";
    case "natis":
      return vehicle.natis_on_file ? "On file" : "Missing";
    case "spareKey":
      return formatYesNo(vehicle.has_spare_key);
    case "contractFile":
      return formatYesNo(vehicle.has_contract_file);
    case "warranty":
      return vehicle.warranty_active ? "Active" : "Inactive";
    case "licenseDiscExpiry":
      return <PastDueDate date={vehicle.license_disc_expiry} />;
    case "clientCell":
      return vehicle.current_client_cell
        ? formatSaPhoneForDisplay(vehicle.current_client_cell)
        : "—";
    case "pastClients":
      return vehicle.past_client_names ?? "—";
    case "installment":
      return formatMoney(vehicle.current_installment_amount);
    case "paymentMethod":
      return vehicle.current_payment_method ? PAYMENT_METHOD_LABELS[vehicle.current_payment_method] : "—";
    case "potentialSalePrice":
      return formatMoney(vehicle.current_potential_sale_price);
    case "purchasePrice":
      return formatMoney(vehicle.current_purchase_price);
    case "purchaseDate":
      return formatDisplayDate(vehicle.current_contract_start_date);
    case "totalCollected":
      return formatMoney(vehicle.current_total_collected);
    case "residualValue":
      return formatMoney(vehicle.current_residual_value);
    case "paidUp":
      return formatYesNo(vehicle.current_is_paid_up);
  }
}

function exportValue(column: ColumnId, vehicle: VehicleWithRegistration): string | number {
  switch (column) {
    case "reg":
      return vehicle.current_plate ?? "";
    case "fileNo":
      return vehicle.file_no;
    case "make":
      return vehicle.make ?? "";
    case "model":
      return vehicle.model ?? "";
    case "year":
      return vehicle.year ?? "";
    case "colour":
      return vehicle.colour ?? "";
    case "vin":
      return vehicle.vin ?? "";
    case "engineNumber":
      return vehicle.engine_number ?? "";
    case "status":
      return STATUS_LABELS[vehicle.status];
    case "legacyStatusNote":
      return vehicle.legacy_status_note ?? "";
    case "client":
      return vehicle.current_client_name ?? "";
    case "nextService":
      return formatServiceCountdown(vehicle.next_service_date);
    case "nextServiceDate":
      return vehicle.next_service_date ?? "";
    case "monthsLeft":
      return formatContractCountdown(vehicle.current_contract_end_date);
    case "contractEndDate":
      return vehicle.current_contract_end_date ?? "";
    case "currentMileage":
      return vehicle.current_mileage ?? "";
    case "nextServiceKm":
      return vehicle.next_service_km ?? "";
    case "lastServicedBy":
      return vehicle.last_serviced_by ?? "";
    case "trackerRunning":
      return TRACKER_LABELS[vehicle.tracker_running];
    case "trackerSupplier":
      return vehicle.tracker_supplier ?? "";
    case "natis":
      return vehicle.natis_on_file ? "On file" : "Missing";
    case "spareKey":
      return formatYesNo(vehicle.has_spare_key);
    case "contractFile":
      return formatYesNo(vehicle.has_contract_file);
    case "warranty":
      return vehicle.warranty_active ? "Active" : "Inactive";
    case "licenseDiscExpiry":
      return vehicle.license_disc_expiry ?? "";
    case "clientCell":
      return vehicle.current_client_cell ? formatSaPhoneForDisplay(vehicle.current_client_cell) : "";
    case "pastClients":
      return vehicle.past_client_names ?? "";
    case "installment":
      return vehicle.current_installment_amount ?? "";
    case "paymentMethod":
      return vehicle.current_payment_method ? PAYMENT_METHOD_LABELS[vehicle.current_payment_method] : "";
    case "potentialSalePrice":
      return vehicle.current_potential_sale_price ?? "";
    case "purchasePrice":
      return vehicle.current_purchase_price ?? "";
    case "purchaseDate":
      return vehicle.current_contract_start_date ?? "";
    case "totalCollected":
      return vehicle.current_total_collected ?? "";
    case "residualValue":
      return vehicle.current_residual_value ?? "";
    case "paidUp":
      return formatYesNo(vehicle.current_is_paid_up);
  }
}

/**
 * One table row. Memoised: a filter click or tab switch only re-renders rows
 * whose own props changed, instead of every cell of every row. `columnsKey`
 * is the visible columns joined into a string so the memo compares by value.
 */
const VehicleRow = memo(function VehicleRow({
  vehicle,
  index,
  columnsKey,
  canManage,
  isSelected,
  onToggleSelected,
  onEdit,
}: {
  vehicle: VehicleWithRegistration;
  index: number;
  columnsKey: string;
  canManage: boolean;
  isSelected: boolean;
  onToggleSelected: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const columns = useMemo(() => columnsKey.split("|") as ColumnId[], [columnsKey]);

  return (
    <TableRow>
      <TableCell className="sticky left-0 z-10 w-20 border-r bg-background group-hover:bg-muted group-data-[state=selected]:bg-muted">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelected(vehicle.id)}
            aria-label={`Select ${vehicle.current_plate ?? vehicle.file_no}`}
          />
          <span className="text-muted-foreground flex-1 text-center">{index + 1}</span>
        </div>
      </TableCell>
      {columns.map((column) => (
        <TableCell key={column} className={column === "reg" ? "font-medium" : undefined}>
          {renderCell(column, vehicle, canManage)}
        </TableCell>
      ))}
      {canManage && (
        <TableCell className="flex items-center justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Edit vehicle"
            onClick={() => onEdit(vehicle.id)}
          >
            <Pencil className="size-3" />
          </Button>
          <DeleteVehicleButton vehicleId={vehicle.id} label={vehicle.current_plate ?? vehicle.file_no} />
        </TableCell>
      )}
    </TableRow>
  );
});

export function VehiclesTable({
  rows,
  canManage,
  canViewContracts,
  canSeePrices,
  initialStatus,
  initialServiceDueSoon,
  initialContractEndingSoon,
  exportedBy,
}: {
  rows: VehicleWithRegistration[];
  /** Create/edit/delete (admin only). */
  canManage: boolean;
  /** See the client/contract columns (admin + Fleet Manager). */
  canViewContracts: boolean;
  /** See purchase / potential sale price (admin only). */
  canSeePrices: boolean;
  initialStatus?: VehicleStatus;
  initialServiceDueSoon?: boolean;
  initialContractEndingSoon?: boolean;
  exportedBy: string;
}) {
  // Vehicles that have left the fleet (Sold / Written Off / End of Deal)
  // live on their own "End of Contract" tab and are excluded from the Fleet
  // tab, its cards and its filters.
  const [view, setView] = useState<"fleet" | "ended">(
    initialStatus && !isFleetStatus(initialStatus) ? "ended" : "fleet"
  );
  // Status cards are multi-select toggles; empty = no status filter.
  const [statusFilter, setStatusFilter] = useState<VehicleStatus[]>(
    initialStatus && isFleetStatus(initialStatus) ? [initialStatus] : []
  );
  // Split from a single combined "due for service" filter into overdue vs.
  // upcoming, since those call for different urgency when staff are
  // triaging the fleet.
  const [serviceOverdue, setServiceOverdue] = useState(false);
  const [serviceUpcoming, setServiceUpcoming] = useState(initialServiceDueSoon ?? false);
  const [contractEndingSoon, setContractEndingSoon] = useState(initialContractEndingSoon ?? false);
  // One shared edit panel for the whole table, not one per row (each panel
  // carries its own form + sheet). It's keyed per open so the form always
  // starts from the vehicle's current values, and stays mounted after
  // closing so the sheet can finish its close animation.
  const [panel, setPanel] = useState<{ vehicleId: string; open: boolean; openCount: number } | null>(null);
  const openPanel = useCallback(
    (vehicleId: string) => setPanel((prev) => ({ vehicleId, open: true, openCount: (prev?.openCount ?? 0) + 1 })),
    []
  );
  const panelVehicle = panel ? rows.find((r) => r.id === panel.vehicleId) : undefined;
  const captureRef = useRef<HTMLDivElement>(null);

  function toggleStatus(status: VehicleStatus) {
    setStatusFilter((prev) => (prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]));
  }
  // The Fleet card: back to the whole fleet, with every quick filter off.
  function resetFilters() {
    setStatusFilter([]);
    setServiceOverdue(false);
    setServiceUpcoming(false);
    setContractEndingSoon(false);
  }
  function changeView(next: "fleet" | "ended") {
    setView(next);
    resetFilters();
  }
  // Overdue / Upcoming / Contract ending are alternatives to each other
  // (picking one clears the other two) but combine freely with the status
  // cards, e.g. On Road + Overdue.
  function toggleServiceOverdue() {
    setServiceOverdue((was) => {
      const next = !was;
      if (next) {
        setServiceUpcoming(false);
        setContractEndingSoon(false);
      }
      return next;
    });
  }
  function toggleServiceUpcoming() {
    setServiceUpcoming((was) => {
      const next = !was;
      if (next) {
        setServiceOverdue(false);
        setContractEndingSoon(false);
      }
      return next;
    });
  }
  function toggleContractEndingSoon() {
    setContractEndingSoon((was) => {
      const next = !was;
      if (next) {
        setServiceOverdue(false);
        setServiceUpcoming(false);
      }
      return next;
    });
  }

  const { order, isHidden, reorder, toggleHidden, reset } = useColumnOrder(
    "sar2o:vehicles-columns",
    DEFAULT_COLUMN_ORDER,
    DEFAULT_HIDDEN_COLUMNS
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorder(active.id as ColumnId, over.id as ColumnId);
    }
  }

  const isColumnAllowed = (id: ColumnId) =>
    (!MANAGER_ONLY_COLUMNS.has(id) || canViewContracts) && (!PRICE_COLUMNS.has(id) || canSeePrices);

  const visibleColumns = order.filter(
    (id) => !isHidden(id) && isColumnAllowed(id)
  );
  const columnsKey = visibleColumns.join("|");
  const toggleableColumns = DEFAULT_COLUMN_ORDER.filter(isColumnAllowed).map((id) => ({ id, label: COLUMN_LABELS[id] }));

  const searchFn = useCallback(
    (row: VehicleWithRegistration, query: string) =>
      [
        row.current_plate,
        row.file_no,
        row.make,
        row.model,
        row.vin,
        row.current_client_name,
        row.current_client_cell,
        row.past_client_names,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    []
  );

  const sortFns: Record<ColumnId, (a: VehicleWithRegistration, b: VehicleWithRegistration) => number> = {
    reg: (a, b) => compareStrings(a.current_plate, b.current_plate),
    fileNo: (a, b) => compareStrings(a.file_no, b.file_no),
    make: (a, b) => compareStrings(a.make, b.make),
    model: (a, b) => compareStrings(a.model, b.model),
    year: (a, b) => compareNumbers(a.year, b.year),
    colour: (a, b) => compareStrings(a.colour, b.colour),
    vin: (a, b) => compareStrings(a.vin, b.vin),
    engineNumber: (a, b) => compareStrings(a.engine_number, b.engine_number),
    status: (a, b) => compareStrings(a.status, b.status),
    legacyStatusNote: (a, b) => compareStrings(a.legacy_status_note, b.legacy_status_note),
    client: (a, b) => compareStrings(a.current_client_name, b.current_client_name),
    nextService: (a, b) =>
      compareNumbers(
        a.next_service_date ? Date.parse(a.next_service_date) : null,
        b.next_service_date ? Date.parse(b.next_service_date) : null
      ),
    nextServiceDate: (a, b) =>
      compareNumbers(
        a.next_service_date ? Date.parse(a.next_service_date) : null,
        b.next_service_date ? Date.parse(b.next_service_date) : null
      ),
    monthsLeft: (a, b) =>
      compareNumbers(
        a.current_contract_end_date ? Date.parse(a.current_contract_end_date) : null,
        b.current_contract_end_date ? Date.parse(b.current_contract_end_date) : null
      ),
    contractEndDate: (a, b) =>
      compareNumbers(
        a.current_contract_end_date ? Date.parse(a.current_contract_end_date) : null,
        b.current_contract_end_date ? Date.parse(b.current_contract_end_date) : null
      ),
    currentMileage: (a, b) => compareNumbers(a.current_mileage, b.current_mileage),
    nextServiceKm: (a, b) => compareNumbers(a.next_service_km, b.next_service_km),
    lastServicedBy: (a, b) => compareStrings(a.last_serviced_by, b.last_serviced_by),
    trackerRunning: (a, b) => compareStrings(a.tracker_running, b.tracker_running),
    trackerSupplier: (a, b) => compareStrings(a.tracker_supplier, b.tracker_supplier),
    natis: (a, b) => compareNumbers(Number(a.natis_on_file), Number(b.natis_on_file)),
    spareKey: (a, b) => compareNumbers(Number(a.has_spare_key), Number(b.has_spare_key)),
    contractFile: (a, b) => compareNumbers(Number(a.has_contract_file), Number(b.has_contract_file)),
    warranty: (a, b) => compareNumbers(Number(a.warranty_active), Number(b.warranty_active)),
    licenseDiscExpiry: (a, b) =>
      compareNumbers(
        a.license_disc_expiry ? Date.parse(a.license_disc_expiry) : null,
        b.license_disc_expiry ? Date.parse(b.license_disc_expiry) : null
      ),
    clientCell: (a, b) => compareStrings(a.current_client_cell, b.current_client_cell),
    pastClients: (a, b) => compareStrings(a.past_client_names, b.past_client_names),
    installment: (a, b) => compareNumbers(a.current_installment_amount, b.current_installment_amount),
    paymentMethod: (a, b) => compareStrings(a.current_payment_method, b.current_payment_method),
    potentialSalePrice: (a, b) =>
      compareNumbers(a.current_potential_sale_price, b.current_potential_sale_price),
    purchasePrice: (a, b) => compareNumbers(a.current_purchase_price, b.current_purchase_price),
    purchaseDate: (a, b) =>
      compareNumbers(
        a.current_contract_start_date ? Date.parse(a.current_contract_start_date) : null,
        b.current_contract_start_date ? Date.parse(b.current_contract_start_date) : null
      ),
    totalCollected: (a, b) => compareNumbers(a.current_total_collected, b.current_total_collected),
    residualValue: (a, b) => compareNumbers(a.current_residual_value, b.current_residual_value),
    paidUp: (a, b) =>
      compareNumbers(
        a.current_is_paid_up === null ? null : Number(a.current_is_paid_up),
        b.current_is_paid_up === null ? null : Number(b.current_is_paid_up)
      ),
  };

  const today = isoDaysFromNow(0);
  const serviceDueCutoff = isoDaysFromNow(30);
  const contractEndingCutoff = isoDaysFromNow(30);

  // Quick-filter pill counts — always against the full dataset, not
  // preFiltered/filteredRows, so they read as stable totals rather than
  // shrinking as other filters narrow the table.
  const fleetRows = rows.filter((r) => isFleetStatus(r.status));
  const endedRows = rows.filter((r) => !isFleetStatus(r.status));
  const viewRows = view === "ended" ? endedRows : fleetRows;

  const statusCounts = Object.fromEntries(
    FLEET_STATUSES.map((status) => [status, fleetRows.filter((r) => r.status === status).length])
  ) as Record<(typeof FLEET_STATUSES)[number], number>;
  const serviceOverdueCount = fleetRows.filter(
    (r) => r.next_service_date && r.next_service_date < today
  ).length;
  const serviceUpcomingCount = fleetRows.filter(
    (r) => r.next_service_date && r.next_service_date >= today && r.next_service_date <= serviceDueCutoff
  ).length;

  const preFiltered = viewRows
    .filter((r) => statusFilter.length === 0 || statusFilter.includes(r.status))
    .filter((r) => !serviceOverdue || (r.next_service_date && r.next_service_date < today))
    .filter(
      (r) =>
        !serviceUpcoming ||
        (r.next_service_date && r.next_service_date >= today && r.next_service_date <= serviceDueCutoff)
    )
    .filter(
      (r) =>
        !contractEndingSoon ||
        (r.current_contract_end_date && r.current_contract_end_date <= contractEndingCutoff)
    );

  const { search, setSearch, sortKey, sortDir, onSort, filteredRows } = useTableControls<
    VehicleWithRegistration,
    ColumnId
  >({
    rows: preFiltered,
    searchFn,
    sortFns,
    defaultSortKey: "nextService",
    storageKey: "sar2o:vehicles-sort",
  });

  const MONEY_COLUMNS = new Set<ColumnId>([
    "installment",
    "potentialSalePrice",
    "purchasePrice",
    "totalCollected",
    "residualValue",
  ]);
  const NUMBER_COLUMNS = new Set<ColumnId>(["currentMileage", "nextServiceKm"]);

  const {
    selectedIds,
    selectedRows,
    allVisibleSelected,
    someVisibleSelected,
    toggleRow: toggleRowSelected,
    toggleAllVisible: toggleSelectAllVisible,
    clear: clearSelection,
  } = useRowSelection(filteredRows, (r) => r.id);

  async function handleCopyAsImage() {
    if (!captureRef.current || selectedRows.length === 0) return;
    await copyNodeAsImage(captureRef.current, { count: selectedRows.length, filenamePrefix: "vehicles" });
  }

  function handleExport() {
    const columns: ExportColumn<VehicleWithRegistration>[] = visibleColumns.map((column) => ({
      header: COLUMN_LABELS[column],
      value: (vehicle) => exportValue(column, vehicle),
      align: column === "year" || MONEY_COLUMNS.has(column) || NUMBER_COLUMNS.has(column) ? "right" : undefined,
      numberFormat: MONEY_COLUMNS.has(column) ? '"R"#,##0.00' : undefined,
      chip:
        column === "status"
          ? (vehicle) => STATUS_CHIP_COLORS[vehicle.status]
          : column === "paidUp"
            ? (vehicle) =>
                vehicle.current_is_paid_up === null
                  ? undefined
                  : vehicle.current_is_paid_up
                    ? PAID_CHIP_COLORS.yes
                    : PAID_CHIP_COLORS.no
            : column === "nextServiceDate"
              ? (vehicle) =>
                  vehicle.next_service_date
                    ? dueDateExcelChip(daysUntil(vehicle.next_service_date))
                    : undefined
              : column === "colour"
                ? (vehicle) => {
                    if (!vehicle.colour) return undefined;
                    const hex = resolveVehicleColourHex(vehicle.colour);
                    if (!hex) return undefined;
                    return { fill: toArgb(hex), font: toArgb(readableTextColor(hex)) };
                  }
                : undefined,
    }));

    exportToExcel({
      baseFilename: "vehicles",
      sheetName: "Vehicles",
      title: "SAR2O Fleet — Vehicles Export",
      filterSummary: summarizeFilters([
        view === "ended" && "Tab: End of Contract",
        search && `Search: "${search}"`,
        statusFilter.length > 0 && `Status: ${statusFilter.map((s) => STATUS_LABELS[s]).join(", ")}`,
        serviceOverdue && "Services overdue",
        serviceUpcoming && "Upcoming services",
        contractEndingSoon && "Contract ending",
      ]),
      exportedBy,
      columns,
      rows: filteredRows,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>
          <Tabs value={view} onValueChange={(v) => changeView(v as "fleet" | "ended")}>
            <TabsList>
              <TabsTrigger value="fleet">Fleet ({fleetRows.length})</TabsTrigger>
              <TabsTrigger value="ended">End of Contract ({endedRows.length})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === "fleet" && (
            <>
              <StatButtonPill
                label="Fleet"
                value={fleetRows.length}
                subtitle="Show the whole fleet (clears all filters)"
                tone="brand"
                onClick={resetFilters}
              />
              {FLEET_STATUSES.map((status) => (
                <StatButtonPill
                  key={status}
                  label={STATUS_LABELS[status]}
                  value={statusCounts[status]}
                  subtitle={`Show ${STATUS_LABELS[status]} vehicles — click several to combine`}
                  isActive={statusFilter.includes(status)}
                  onClick={() => toggleStatus(status)}
                />
              ))}
            </>
          )}
          {canManage && <VehiclePanel />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search reg, model, client…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-background max-w-xs"
        />
        {view === "fleet" && (
          <>
            <Button
              type="button"
              variant={serviceOverdue ? "default" : "outline"}
              size="sm"
              title="Services overdue"
              onClick={toggleServiceOverdue}
            >
              Overdue ({serviceOverdueCount})
            </Button>
            <Button
              type="button"
              variant={serviceUpcoming ? "default" : "outline"}
              size="sm"
              title="Upcoming services (next 30 days)"
              onClick={toggleServiceUpcoming}
            >
              Upcoming ({serviceUpcomingCount})
            </Button>
            {canViewContracts && (
              <Button
                type="button"
                variant={contractEndingSoon ? "default" : "outline"}
                size="sm"
                onClick={toggleContractEndingSoon}
              >
                Contract ending
              </Button>
            )}
          </>
        )}
        <ColumnVisibilityMenu
          columns={toggleableColumns}
          isHidden={isHidden}
          onToggle={toggleHidden}
          onReset={reset}
        />
        <Button type="button" variant="outline" size="sm" onClick={handleExport}>
          <Download />
          Export
        </Button>
        <SelectionActions
          selectedCount={selectedRows.length}
          onCopyAsImage={handleCopyAsImage}
          onClear={clearSelection}
        />
        <p className="text-muted-foreground text-sm">
          {filteredRows.length === viewRows.length
            ? `${viewRows.length} ${view === "ended" ? "ended" : "in the fleet"}`
            : `${filteredRows.length} of ${viewRows.length}`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background">
        <DndContext
          id="vehicles-table-columns"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <Table containerClassName="overflow-x-visible">
            <TableHeader className="bg-background sticky top-0 z-20">
              <TableRow>
                <TableHead className="sticky left-0 z-20 w-20 border-r bg-muted">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                      onCheckedChange={toggleSelectAllVisible}
                      aria-label="Select all visible rows"
                    />
                    <span className="text-muted-foreground flex-1 text-center">#</span>
                  </div>
                </TableHead>
                <SortableContext items={visibleColumns} strategy={horizontalListSortingStrategy}>
                  {visibleColumns.map((column) => (
                    <DraggableTableHead
                      key={column}
                      id={column}
                      label={COLUMN_LABELS[column]}
                      sortKey={column}
                      activeKey={sortKey}
                      direction={sortDir}
                      onSort={onSort}
                    />
                  ))}
                </SortableContext>
                {canManage && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((vehicle, index) => (
                <VehicleRow
                  key={vehicle.id}
                  vehicle={vehicle}
                  index={index}
                  columnsKey={columnsKey}
                  canManage={canManage}
                  isSelected={selectedIds.has(vehicle.id)}
                  onToggleSelected={toggleRowSelected}
                  onEdit={openPanel}
                />
              ))}
              {filteredRows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumns.length + (canManage ? 1 : 0) + 1}
                    className="text-muted-foreground text-center py-8"
                  >
                    No vehicles match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </DndContext>
      </div>

      {canManage && panel && panelVehicle && (
        <VehiclePanel
          key={`${panel.vehicleId}:${panel.openCount}`}
          vehicle={panelVehicle}
          canManage={canManage}
          open={panel.open}
          onOpenChange={(next) => setPanel((prev) => (prev ? { ...prev, open: next } : prev))}
        />
      )}

      <ImageCaptureArea captureRef={captureRef}>
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.map((column) => (
                  <TableHead key={column}>{COLUMN_LABELS[column]}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedRows.map((vehicle) => (
                <TableRow key={vehicle.id}>
                  {visibleColumns.map((column) => (
                    <TableCell key={column} className={column === "reg" ? "font-medium" : undefined}>
                      {renderCell(column, vehicle, false)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </ImageCaptureArea>
    </div>
  );
}
