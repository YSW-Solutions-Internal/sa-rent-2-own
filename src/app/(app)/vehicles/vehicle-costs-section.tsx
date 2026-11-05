"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Paperclip, Plus, Receipt, Trash2, User } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDate } from "@/lib/date-ranges";

import {
  createVehicleCost,
  deleteVehicleCost,
  getInvoiceUrl,
  listVehicleCosts,
} from "./cost-actions";
import { vehicleCostTypeValues, type VehicleCost } from "./costs-schema";

const COST_TYPE_LABELS: Record<(typeof vehicleCostTypeValues)[number], string> = {
  service: "Service",
  repair: "Repair",
  car_wash: "Car wash",
  maintenance: "Maintenance",
  other: "Other",
};

type TabValue = "all" | (typeof vehicleCostTypeValues)[number];

function InvoiceLink({ filePath }: { filePath: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="text-primary focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-xs text-xs underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] disabled:opacity-50"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await getInvoiceUrl(filePath);
          if (result.error || !result.url) {
            toast.error(result.error ?? "Couldn't open invoice");
            return;
          }
          window.open(result.url, "_blank", "noopener,noreferrer");
        })
      }
    >
      <Paperclip className="size-3" />
      Invoice
    </button>
  );
}

/** Official WhatsApp glyph, from the Simple Icons set (simple-icons v13.21.0, CC0). lucide has no brand icons. */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function SourceIcon({ source, by }: { source: VehicleCost["source"]; by: string | null }) {
  const suffix = by ? ` by ${by}` : "";
  return source === "whatsapp" ? (
    <span title={`Logged via WhatsApp${suffix}`} role="img" aria-label={`Logged via WhatsApp${suffix}`} className="shrink-0">
      <WhatsAppIcon className="size-4 text-[#25D366]" />
    </span>
  ) : (
    <span title={`Entered manually${suffix}`} role="img" aria-label={`Entered manually${suffix}`} className="shrink-0">
      <User className="text-muted-foreground size-4" />
    </span>
  );
}

const formatRand = (n: number) =>
  `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function CostsTable({
  costs,
  showType,
  loading,
  canManage,
  isPending,
  onDelete,
}: {
  costs: VehicleCost[];
  showType: boolean;
  loading: boolean;
  canManage: boolean;
  isPending: boolean;
  onDelete: (costId: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (costs.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">No costs logged yet.</p>;
  }

  const total = costs.reduce((sum, c) => sum + c.amount, 0);

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            {showType && <TableHead>Type</TableHead>}
            <TableHead>Done by</TableHead>
            <TableHead>What was done</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="text-right">Mileage</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Logged by</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {costs.map((cost) => (
            <TableRow key={cost.id}>
              <TableCell className="whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <SourceIcon source={cost.source} by={cost.recorded_by_name} />
                  {formatDisplayDate(cost.cost_date)}
                </div>
              </TableCell>
              {showType && <TableCell>{COST_TYPE_LABELS[cost.cost_type]}</TableCell>}
              <TableCell>{cost.supplier || "—"}</TableCell>
              <TableCell className="max-w-64 whitespace-normal">{cost.work_done || "—"}</TableCell>
              <TableCell className="max-w-64 whitespace-normal">{cost.notes || "—"}</TableCell>
              <TableCell className="text-right whitespace-nowrap tabular-nums">
                {cost.mileage_at_time != null ? `${cost.mileage_at_time.toLocaleString("en-ZA")} km` : "—"}
              </TableCell>
              <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                {formatRand(cost.amount)}
              </TableCell>
              <TableCell>
                {cost.invoice_file_path ? (
                  <InvoiceLink filePath={cost.invoice_file_path} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">{cost.recorded_by_name || "—"}</TableCell>
              <TableCell>
                {canManage && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Delete cost"
                        disabled={isPending}
                      >
                        <Trash2 className="text-destructive size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this cost entry?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes the {formatRand(cost.amount)} {COST_TYPE_LABELS[cost.cost_type]} entry from{" "}
                          {formatDisplayDate(cost.cost_date)}. This can&apos;t be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDelete(cost.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={showType ? 6 : 5} className="text-muted-foreground text-right text-xs uppercase">
              Total
            </TableCell>
            <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
              {formatRand(total)}
            </TableCell>
            <TableCell colSpan={3} />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * In the vehicle panel this is just a one-line summary and a button; the cost
 * history and the add form live in a wide centred modal, where the table has
 * room for every column.
 */
export function VehicleCostsSection({
  vehicleId,
  canManage,
}: {
  vehicleId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [costs, setCosts] = useState<VehicleCost[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;
    listVehicleCosts(vehicleId).then((result) => {
      if (!cancelled) setCosts(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  function refresh() {
    listVehicleCosts(vehicleId).then((result) => setCosts(result.data ?? []));
  }

  function onAddSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createVehicleCost(vehicleId, formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Cost added");
      formRef.current?.reset();
      setShowAddForm(false);
      refresh();
    });
  }

  function onDelete(costId: string) {
    startTransition(async () => {
      const result = await deleteVehicleCost(costId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Cost entry deleted");
      refresh();
    });
  }

  const visibleCosts = (costs ?? []).filter(
    (c) => activeTab === "all" || c.cost_type === activeTab
  );
  const total = (costs ?? []).reduce((sum, c) => sum + c.amount, 0);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Transactions</h3>
      <Dialog open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          {costs === null ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <p className="text-sm tabular-nums">
              {costs.length === 0
                ? "No costs logged yet."
                : `${costs.length} ${costs.length === 1 ? "entry" : "entries"} · ${formatRand(total)}`}
            </p>
          )}
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Receipt />
              View costs
            </Button>
          </DialogTrigger>
        </div>
        <DialogContent className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Vehicle costs</DialogTitle>
            <DialogDescription>Services, repairs and other costs logged against this vehicle.</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
              <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value="all">All</TabsTrigger>
                {vehicleCostTypeValues.map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {COST_TYPE_LABELS[t]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {canManage && (
              <Button type="button" size="sm" onClick={() => setShowAddForm((v) => !v)}>
                <Plus />
                Add cost
              </Button>
            )}
          </div>

          {showAddForm && (
            <form ref={formRef} action={onAddSubmit} className="bg-muted/30 flex flex-col gap-3 rounded-md border p-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="costType">Type</Label>
                  <Select name="costType" defaultValue="service">
                    <SelectTrigger id="costType" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicleCostTypeValues.map((t) => (
                        <SelectItem key={t} value={t}>
                          {COST_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="costDate">Date</Label>
                  <Input
                    id="costDate"
                    name="costDate"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="supplier">Done by</Label>
                  <Input id="supplier" name="supplier" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="amount">Amount (R)</Label>
                  <Input id="amount" name="amount" type="number" step="0.01" required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mileageAtTime">Mileage</Label>
                  <Input id="mileageAtTime" name="mileageAtTime" type="number" />
                </div>
                <div className="grid gap-1.5 md:col-span-3">
                  <Label htmlFor="invoice">Invoice (PDF)</Label>
                  <Input id="invoice" name="invoice" type="file" accept="application/pdf" />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="workDone">What was done</Label>
                  <Textarea id="workDone" name="workDone" rows={2} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" name="notes" rows={2} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving…" : "Save cost"}
                </Button>
              </div>
            </form>
          )}

          <CostsTable
            costs={visibleCosts}
            showType={activeTab === "all"}
            loading={costs === null}
            canManage={canManage}
            isPending={isPending}
            onDelete={onDelete}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
