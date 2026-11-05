"use client";

import { ClientName } from "@/components/blacklist-flag";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ClientPanel } from "../clients/client-panel";
import { VehiclePanel } from "../vehicles/vehicle-panel";
import { Textarea } from "@/components/ui/textarea";
import { useControllableOpen } from "@/lib/use-controllable-open";

import { createContract, updateContract } from "./actions";
import {
  billingDirectionValues,
  billingFrequencyValues,
  billingStatusValues,
  contractFormSchema,
  contractStatusValues,
  contractTypeValues,
  paymentMethodValues,
  type ContractFormValues,
} from "./schema";
import type { ContractWithDetails, SelectableClient, SelectableVehicle } from "./types";
import { ContractVehicleHistorySection } from "./contract-vehicle-history-section";
import { ContractPaymentHistorySection } from "./contract-payment-history-section";

const CONTRACT_TYPE_LABELS: Record<(typeof contractTypeValues)[number], string> = {
  rent_to_own: "Rent-to-own",
  short_term_rental: "Short-term rental",
  rental: "Rental",
  other: "Other",
};

const STATUS_LABELS: Record<(typeof contractStatusValues)[number], string> = {
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  defaulted: "Defaulted",
  repossessed: "Repossessed",
};

const PAYMENT_METHOD_LABELS: Record<(typeof paymentMethodValues)[number], string> = {
  debit_order: "Debit order",
  eft: "EFT",
  cash: "Cash",
  other: "Other",
};

const BILLING_STATUS_LABELS: Record<(typeof billingStatusValues)[number], string> = {
  active: "Active",
  paused: "Paused",
  stopped: "Stopped",
};

function toFormValues(contract?: ContractWithDetails): ContractFormValues {
  if (!contract) {
    return {
      vehicleId: "",
      clientId: "",
      contractType: "rent_to_own",
      status: "active",
      startDate: new Date().toISOString().slice(0, 10),
      paymentMethod: "debit_order",
      billingDirection: "arrears",
      billingFrequency: "monthly",
      billingStatus: "active",
    };
  }

  return {
    vehicleId: contract.vehicle_id,
    clientId: contract.client_id,
    contractType: contract.contract_type,
    status: contract.status,
    startDate: contract.start_date,
    endDate: contract.end_date ?? undefined,
    paymentMethod: contract.payment_method,
    installmentAmount: contract.installment_amount?.toString() ?? undefined,
    purchasePrice: contract.purchase_price?.toString() ?? undefined,
    potentialSalePrice: contract.potential_sale_price?.toString() ?? undefined,
    salePrice: contract.sale_price?.toString() ?? undefined,
    residualValue: contract.residual_value?.toString() ?? undefined,
    totalCollected: contract.total_collected?.toString() ?? undefined,
    outstandingBalance: contract.outstanding_balance?.toString() ?? undefined,
    arrearsAmount: contract.arrears_amount?.toString() ?? undefined,
    isPaidUp: contract.is_paid_up,
    notes: contract.notes ?? undefined,
    dealNumber: contract.deal_number ?? undefined,
    statementTag: contract.statement_tag ?? undefined,
    billingDay: contract.billing_day?.toString() ?? undefined,
    billingDirection: contract.billing_direction,
    billingFrequency: contract.billing_frequency,
    billingStatus: contract.billing_status,
  };
}

export function ContractPanel({
  contract,
  vehicles,
  clients,
  readOnly = false,
  showPrices = true,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  contract?: ContractWithDetails;
  vehicles: SelectableVehicle[];
  clients: SelectableClient[];
  /** View-only (Fleet Manager): fields disabled, no Save. */
  readOnly?: boolean;
  /** Purchase / potential sale price inputs — hidden from Fleet Managers. */
  showPrices?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { open, setOpen, isControlled } = useControllableOpen(openProp, onOpenChangeProp);
  const [isPending, startTransition] = useTransition();
  const isEditing = Boolean(contract);

  // "Add new vehicle / client" open their normal forms on top of this one.
  // What gets created is added to the lists here straight away and selected,
  // without waiting for the page data to refresh.
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false);
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [newVehicles, setNewVehicles] = useState<SelectableVehicle[]>([]);
  const [newClients, setNewClients] = useState<SelectableClient[]>([]);

  const form = useForm<ContractFormValues>({
    resolver: zodResolver(contractFormSchema),
    defaultValues: toFormValues(contract),
  });

  function onSubmit(values: ContractFormValues) {
    startTransition(async () => {
      const result = isEditing
        ? await updateContract(contract!.id, values)
        : await createContract(values);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(isEditing ? "Contract updated" : "Contract created");
      setOpen(false);
      form.reset(toFormValues(undefined));
    });
  }

  // When editing, the vehicle/client already on this contract might not be
  // in the "available" list passed in — make sure they still show up.
  const allVehicles = [...newVehicles.filter((n) => !vehicles.some((v) => v.id === n.id)), ...vehicles];
  const allClients = [...newClients.filter((n) => !clients.some((c) => c.id === n.id)), ...clients];
  const vehicleOptions =
    isEditing && !allVehicles.some((v) => v.id === contract!.vehicle_id)
      ? [{ id: contract!.vehicle_id, label: "(current vehicle)" }, ...allVehicles]
      : allVehicles;
  const clientOptions = (
    isEditing && !allClients.some((c) => c.id === contract!.client_id)
      ? [{ id: contract!.client_id, label: "(current client)" }, ...allClients]
      : allClients
  ).map((c) => ({
    id: c.id,
    label: c.label,
    node: <ClientName name={c.label} blacklisted={c.blacklisted} />,
    keywords: c.blacklisted ? "blacklisted" : undefined,
  }));

  return (
    <>
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(toFormValues(contract));
      }}
    >
      {!isControlled && (
        <SheetTrigger asChild>
          {isEditing ? (
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          ) : (
            <Button variant="destructive">
              <Plus />
              Add contract
            </Button>
          )}
        </SheetTrigger>
      )}
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{readOnly ? "Contract details" : isEditing ? "Edit contract" : "Add contract"}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <Form {...form}>
            <form id="contract-form" onSubmit={form.handleSubmit(onSubmit)} className="contents">
            <fieldset disabled={readOnly} className="contents">
            <section className="grid gap-4 sm:grid-cols-2">
              <h3 className="text-muted-foreground col-span-full text-xs font-semibold tracking-wide uppercase">
                Deal
              </h3>
              <FormField
                control={form.control}
                name="vehicleId"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Vehicle</FormLabel>
                      {!readOnly && (
                        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setVehicleFormOpen(true)}>
                          <Plus />
                          Add new vehicle
                        </Button>
                      )}
                    </div>
                    <SearchableSelect
                      value={field.value}
                      onChange={field.onChange}
                      options={vehicleOptions}
                      placeholder="Select vehicle"
                      searchPlaceholder="Search reg, file no, make, model…"
                      emptyText="No available vehicle matches"
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Client</FormLabel>
                      {!readOnly && (
                        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setClientFormOpen(true)}>
                          <Plus />
                          Add new customer
                        </Button>
                      )}
                    </div>
                    <SearchableSelect
                      value={field.value}
                      onChange={field.onChange}
                      options={clientOptions}
                      placeholder="Select client"
                      searchPlaceholder="Search client name…"
                      emptyText="No client matches"
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contractType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contract type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contractTypeValues.map((t) => (
                          <SelectItem key={t} value={t}>
                            {CONTRACT_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contractStatusValues.map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contract end date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>

            <Separator />

            <section className="grid gap-4 sm:grid-cols-3">
              <h3 className="text-muted-foreground col-span-full text-xs font-semibold tracking-wide uppercase">
                Billing
              </h3>
              <FormField
                control={form.control}
                name="dealNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deal number</FormLabel>
                    <FormControl>
                      <Input placeholder="MAD..." {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="statementTag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Statement tag</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Auto-generated from surname if left blank"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="billingStatus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Debit order status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {billingStatusValues.map((s) => (
                          <SelectItem key={s} value={s}>
                            {BILLING_STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="billingDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billing day</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="billingDirection"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Direction</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {billingDirectionValues.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d === "advance" ? "Pays ahead" : "Pays in arrears"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="billingFrequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequency</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {billingFrequencyValues.map((f) => (
                          <SelectItem key={f} value={f}>
                            {f === "weekly" ? "Weekly" : "Monthly"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>

            <Separator />

            <section className="grid gap-4 sm:grid-cols-3">
              <h3 className="text-muted-foreground col-span-full text-xs font-semibold tracking-wide uppercase">
                Financials
              </h3>
              <FormField
                control={form.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment method</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {paymentMethodValues.map((m) => (
                          <SelectItem key={m} value={m}>
                            {PAYMENT_METHOD_LABELS[m]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="installmentAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Installment</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="residualValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Residual value (RV)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {showPrices && (
              <FormField
                control={form.control}
                name="purchasePrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase price</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              )}
              {showPrices && (
              <FormField
                control={form.control}
                name="potentialSalePrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Potential sale price</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              )}
              <FormField
                control={form.control}
                name="salePrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale price (if sold)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="totalCollected"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total collected</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="outstandingBalance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Outstanding balance</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="arrearsAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Arrears</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isPaidUp"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 self-end pb-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="font-normal">Paid up</FormLabel>
                  </FormItem>
                )}
              />
            </section>

            <Separator />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            </fieldset>
            </form>
          </Form>

          {isEditing && (
            <>
              <Separator />
              <ContractVehicleHistorySection contractId={contract!.id} />
              <Separator />
              <ContractPaymentHistorySection contractId={contract!.id} />
            </>
          )}
        </SheetBody>
        {!readOnly && (
          <SheetFooter>
            <Button type="submit" form="contract-form" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
    {/* Outside the contract's <form>: React submit events bubble through portals. */}
    {!readOnly && (
      <>
        <VehiclePanel
          open={vehicleFormOpen}
          onOpenChange={setVehicleFormOpen}
          onCreated={(id, v) => {
            const reg = v.plateNumber.trim().toUpperCase();
            const label = [v.fileNo, reg, [v.year, v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
            setNewVehicles((prev) => [{ id, label }, ...prev]);
            form.setValue("vehicleId", id, { shouldValidate: true, shouldDirty: true });
          }}
        />
        <ClientPanel
          open={clientFormOpen}
          onOpenChange={setClientFormOpen}
          onCreated={(id, v) => {
            setNewClients((prev) => [{ id, label: v.fullName, blacklisted: v.blacklisted }, ...prev]);
            form.setValue("clientId", id, { shouldValidate: true, shouldDirty: true });
          }}
        />
      </>
    )}
    </>
  );
}
