"use client";

import { ClientName } from "@/components/blacklist-flag";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeDollarSign, CircleDollarSign, FileText, History, Plus, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  PanelModalContent,
  PanelModalFooter,
  PanelModalSection,
  PanelModalSections,
  scrollToPanelSection,
  PanelModalHeader,
} from "@/components/ui/panel-modal";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ActivitySection } from "@/lib/activity-log/activity-section";
import { ClientPanel } from "../clients/client-panel";
import { VehiclePanel } from "../vehicles/vehicle-panel";
import { Textarea } from "@/components/ui/textarea";
import { useControllableOpen } from "@/lib/use-controllable-open";

import { createContract, previewDealNumber, updateContract } from "./actions";
import { generateContractAgreement, getStoredAgreementUrl, regenerateAgreementPreview } from "./agreement-actions";
import { AgreementViewerDialog } from "./agreement-viewer-dialog";
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

/** Labels for the "new contract" type picker and the form title that
 * follows it specifically -- plainer wording (no hyphens, "Long Term
 * Rental" spelled out) than CONTRACT_TYPE_LABELS above, which stays as
 * it is for the edit-mode Contract type dropdown and everywhere else
 * that shows a contract type. */
const NEW_CONTRACT_TYPE_LABELS: Record<(typeof contractTypeValues)[number], string> = {
  rent_to_own: "Rent to own",
  short_term_rental: "Short term rental",
  rental: "Long Term Rental",
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
    vehicleId: contract.vehicle_id ?? "",
    clientId: contract.client_id,
    contractType: contract.contract_type,
    status: contract.status,
    startDate: contract.start_date,
    endDate: contract.end_date ?? undefined,
    paymentMethod: contract.payment_method,
    installmentAmount: contract.installment_amount?.toString() ?? undefined,
    residualValue: contract.residual_value?.toString() ?? undefined,
    isPaidUp: contract.is_paid_up,
    notes: contract.notes ?? undefined,
    dealNumber: contract.deal_number ?? undefined,
    statementTag: contract.statement_tag ?? undefined,
    billingDay: contract.billing_day?.toString() ?? undefined,
    billingDirection: contract.billing_direction,
    billingFrequency: contract.billing_frequency,
    billingStatus: contract.billing_status,
    vehicleChangeDate: new Date().toISOString().slice(0, 10),
  };
}

type ContractSection = "deal" | "billing" | "financials" | "notes";

/** Which section each field lives in (anything not listed is in Deal). */
const FIELD_SECTION: Record<string, ContractSection> = {
  dealNumber: "billing",
  billingDay: "billing",
  billingDirection: "billing",
  billingFrequency: "billing",
  billingStatus: "billing",
  paymentMethod: "financials",
  installmentAmount: "financials",
  residualValue: "financials",
  isPaidUp: "financials",
  notes: "notes",
};

export function ContractPanel({
  contract,
  vehicles,
  clients,
  readOnly = false,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  contract?: ContractWithDetails;
  vehicles: SelectableVehicle[];
  clients: SelectableClient[];
  /** View-only (Fleet Manager): fields disabled, no Save. */
  readOnly?: boolean;
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

  // "Add contract" asks which type first (a mini modal), rather than
  // leaving it as just another field inside the full form.
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  // Best-effort preview of the deal number a new contract would get,
  // fetched once the type is chosen (see previewDealNumber's own note on
  // why it's a preview, not a guarantee).
  const [previewedDealNumber, setPreviewedDealNumber] = useState<string | null>(null);
  const [dealNumberPreviewFailed, setDealNumberPreviewFailed] = useState(false);

  // Agreement PDF: generated automatically on contract creation (see
  // createContract), but may still be missing (an old contract from
  // before this feature, or a first attempt that failed) - in which case
  // the same button generates it instead of downloading it.
  const [storedAgreementPath, setStoredAgreementPath] = useState(contract?.agreement_file_path ?? null);
  const [agreementBusy, setAgreementBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  // Both buttons show the resulting PDF in the same in-app viewer rather
  // than a new browser tab; the viewer itself offers a "Download" link
  // as the actual save-to-disk path, named "SAR2O Contract - <deal
  // number>.pdf" server-side (see agreement-actions.ts).
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerDownloadUrl, setViewerDownloadUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState("Agreement");
  const [viewerOpen, setViewerOpen] = useState(false);

  function showPdf(url: string, downloadUrl: string | undefined, title: string) {
    setViewerUrl(url);
    setViewerDownloadUrl(downloadUrl ?? url);
    setViewerTitle(title);
    setViewerOpen(true);
  }

  async function handleAgreementButton() {
    if (!contract) return;
    setAgreementBusy(true);
    try {
      let path = storedAgreementPath;
      if (!path) {
        const generated = await generateContractAgreement(contract.id);
        if (generated.error) {
          toast.error(generated.error);
          return;
        }
        path = `${contract.id}/agreement.pdf`;
        setStoredAgreementPath(path);
      }
      const result = await getStoredAgreementUrl(path, contract.deal_number);
      if (result.error || !result.url) {
        toast.error(result.error ?? "Couldn't open the agreement");
        return;
      }
      showPdf(result.url, result.downloadUrl, `Agreement – ${contract.deal_number ?? contract.vehicleLabel ?? "contract"}`);
    } catch {
      toast.error("Couldn't open the agreement");
    } finally {
      setAgreementBusy(false);
    }
  }

  async function handlePreviewAgreement() {
    if (!contract) return;
    setPreviewBusy(true);
    try {
      const result = await regenerateAgreementPreview(contract.id);
      if (result.error || !result.url) {
        toast.error(result.error ?? "Couldn't render a preview");
        return;
      }
      showPdf(result.url, result.downloadUrl, `Preview – ${contract.deal_number ?? contract.vehicleLabel ?? "contract"}`);
    } catch {
      toast.error("Couldn't render a preview");
    } finally {
      setPreviewBusy(false);
    }
  }

  const form = useForm<ContractFormValues>({
    resolver: zodResolver(contractFormSchema),
    defaultValues: toFormValues(contract),
  });

  // Existing contract: the vehicle shows as plain text until "Change vehicle" (pick another),
  // "Add vehicle" (contract has none) or "Remove vehicle" (leave it with none) is pressed.
  const originalVehicleId = contract?.vehicle_id ?? "";
  const hadVehicle = originalVehicleId !== "";
  const [vehicleMode, setVehicleMode] = useState<"keep" | "change" | "remove">("keep");
  const chosenVehicleId = useWatch({ control: form.control, name: "vehicleId" });
  const chosenContractType = useWatch({ control: form.control, name: "contractType" });
  // The vehicle on this existing contract will be different once saved.
  const vehicleChanging =
    isEditing &&
    ((vehicleMode === "remove" && hadVehicle) ||
      (vehicleMode === "change" && chosenVehicleId !== "" && chosenVehicleId !== originalVehicleId));

  function cancelVehicleChange() {
    setVehicleMode("keep");
    form.setValue("vehicleId", originalVehicleId, { shouldDirty: false });
    form.setValue("vehicleChangeDate", new Date().toISOString().slice(0, 10));
    form.setValue("vehicleChangeReason", "");
  }
  function removeVehicle() {
    setVehicleMode("remove");
    form.setValue("vehicleId", "", { shouldDirty: true });
  }
  // The type picker's answer becomes the new form's starting contractType,
  // then opens the real form.
  function startNewContract(type: (typeof contractTypeValues)[number]) {
    form.reset({ ...toFormValues(undefined), contractType: type });
    setVehicleMode("keep");
    setTypePickerOpen(false);
    setPreviewedDealNumber(null);
    setDealNumberPreviewFailed(false);
    setOpen(true);
    previewDealNumber(type)
      .then((result) => setPreviewedDealNumber(result.dealNumber))
      .catch(() => setDealNumberPreviewFailed(true));
  }
  // A save blocked by validation scrolls to the section holding the first bad field.
  function onInvalid(errors: FieldErrors<ContractFormValues>) {
    const first = Object.keys(errors)[0];
    scrollToPanelSection(FIELD_SECTION[first] ?? "deal");
  }

  function onSubmit(values: ContractFormValues) {
    if (!isEditing && !values.vehicleId) {
      form.setError("vehicleId", { message: "Select a vehicle" });
      scrollToPanelSection("deal");
      return;
    }
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
  const currentVehicleLabel = contract?.vehicleLabel ?? "(current vehicle)";
  // When picking a replacement the current car isn't offered.
  const vehicleOptions = allVehicles.filter((v) => v.id !== contract?.vehicle_id);
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          form.reset(toFormValues(contract));
          setVehicleMode("keep");
        }
      }}
    >
      {!isControlled &&
        (isEditing ? (
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          </DialogTrigger>
        ) : (
          <Button variant="destructive" onClick={() => setTypePickerOpen(true)}>
            <Plus />
            Add contract
          </Button>
        ))}
      <PanelModalContent>
        <PanelModalHeader
          title={
            isEditing
              ? `${readOnly ? "Contract details" : "Edit contract"} – ${contract!.deal_number ?? contract!.vehicleLabel ?? "no deal number"}`
              : `Add New ${NEW_CONTRACT_TYPE_LABELS[chosenContractType]} Contract`
          }
        />
        <PanelModalSections
          sections={[
            { id: "deal", label: "Deal", icon: FileText },
            { id: "billing", label: "Billing", icon: CircleDollarSign },
            { id: "financials", label: "Financials", icon: BadgeDollarSign },
            { id: "notes", label: "Notes", icon: StickyNote },
            ...(isEditing && !readOnly ? [{ id: "activity", label: "Activity", icon: History }] : []),
          ]}
        >
          <Form {...form}>
            <form id="contract-form" onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="contents">
            <fieldset disabled={readOnly} className="contents">
            <PanelModalSection id="deal" title="Deal">
            {!isEditing && (
              <p className="text-muted-foreground -mt-1 text-sm">
                Deal number:{" "}
                <span className="text-foreground font-medium">
                  {dealNumberPreviewFailed ? "—" : (previewedDealNumber ?? "Generating…")}
                </span>
                {" "}(assigned when you save)
              </p>
            )}
            {isEditing && (
              <div className="-mt-1 flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={agreementBusy} onClick={handleAgreementButton}>
                  {agreementBusy ? "Working…" : storedAgreementPath ? "Download agreement" : "Generate agreement"}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={previewBusy} onClick={handlePreviewAgreement}>
                  {previewBusy ? "Rendering…" : "Preview with current data"}
                </Button>
              </div>
            )}
            <section className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="vehicleId"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Vehicle</FormLabel>
                      {!readOnly && (!isEditing || vehicleMode === "change") && (
                        <div className="flex items-center gap-3">
                          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setVehicleFormOpen(true)}>
                            <Plus />
                            Add new vehicle
                          </Button>
                          {isEditing && (
                            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={cancelVehicleChange}>
                              Cancel change
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    {isEditing && vehicleMode !== "change" ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
                        {vehicleMode === "remove" ? (
                          <>
                            <span className="text-muted-foreground">No vehicle — {currentVehicleLabel} comes off when you save</span>
                            <Button type="button" variant="outline" size="sm" onClick={cancelVehicleChange}>
                              Undo
                            </Button>
                          </>
                        ) : (
                          <>
                            {hadVehicle ? (
                              <Link
                                href={`/vehicles?open=${originalVehicleId}`}
                                className="text-primary font-medium underline-offset-4 hover:underline"
                                title="Open this vehicle"
                              >
                                {currentVehicleLabel}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">No vehicle on this contract</span>
                            )}
                            {!readOnly && (
                              <span className="flex items-center gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => setVehicleMode("change")}>
                                  {hadVehicle ? "Change vehicle" : "Add vehicle"}
                                </Button>
                                {hadVehicle && (
                                  <Button type="button" variant="outline" size="sm" onClick={removeVehicle}>
                                    Remove vehicle
                                  </Button>
                                )}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <SearchableSelect
                        value={field.value}
                        onChange={field.onChange}
                        options={vehicleOptions.map((v) => ({
                          id: v.id,
                          label: v.label,
                          keywords: v.warning,
                          node: v.warning ? (
                            <span className="inline-flex items-center gap-2">
                              {v.label}
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                                ⚠ {v.warning}
                              </span>
                            </span>
                          ) : undefined,
                        }))}
                        placeholder={isEditing && hadVehicle ? "Select the replacement vehicle" : "Select vehicle"}
                        searchPlaceholder="Search reg, file no, make, model…"
                        emptyText="No available vehicle matches"
                      />
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              {vehicleChanging && (
                <div className="bg-muted/30 col-span-full grid gap-4 rounded-md border p-3 sm:grid-cols-2">
                  <p className="text-muted-foreground col-span-full text-sm">
                    {vehicleMode === "remove"
                      ? `${currentVehicleLabel} comes off this contract, which will have no vehicle until you add one.`
                      : hadVehicle
                        ? `${currentVehicleLabel} comes off this contract and the vehicle chosen above goes on.`
                        : "The vehicle chosen above goes on this contract."}{" "}
                    {hadVehicle && "The old vehicle stays in the history and is free to put on another contract."}
                  </p>
                  <FormField
                    control={form.control}
                    name="vehicleChangeDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Change effective from</FormLabel>
                        <FormControl>
                          <Input type="date" max={new Date().toISOString().slice(0, 10)} {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="vehicleChangeReason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reason (optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. accident, replaced under warranty" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
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
              {isEditing && (
                <FormField
                  control={form.control}
                  name="contractType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract type</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(v) => {
                          field.onChange(v);
                          // Residual value only applies to rent-to-own — drop a
                          // stale number rather than silently keep saving it
                          // once the field itself is hidden.
                          if (v !== "rent_to_own") form.setValue("residualValue", undefined);
                        }}
                      >
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
              )}
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
            {isEditing && <ContractVehicleHistorySection contractId={contract!.id} />}
            </PanelModalSection>

            <PanelModalSection id="billing" title="Billing">
            <section className="grid gap-4 sm:grid-cols-3">
              {isEditing && (
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
              )}
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
            </PanelModalSection>

            <PanelModalSection id="financials" title="Financials">
            <section className="grid gap-4 sm:grid-cols-3">
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
              {chosenContractType === "rent_to_own" && (
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
              )}
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
            {isEditing && (
              <ContractPaymentHistorySection contractId={contract!.id} canManage={!readOnly} />
            )}
            </PanelModalSection>

            <PanelModalSection id="notes" title="Notes">
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

            </PanelModalSection>
            </fieldset>
            </form>
          </Form>
          {isEditing && !readOnly && (
            <PanelModalSection id="activity" title="Activity">
              <ActivitySection entityType="contracts" entityId={contract!.id} />
            </PanelModalSection>
          )}
        </PanelModalSections>
        {!readOnly && (
          <PanelModalFooter>
            <Button type="submit" form="contract-form" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </PanelModalFooter>
        )}
      </PanelModalContent>
    </Dialog>
    {!isControlled && !isEditing && (
      <Dialog open={typePickerOpen} onOpenChange={setTypePickerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New contract</DialogTitle>
            <DialogDescription>What type of contract is this?</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {contractTypeValues
              .filter((t) => t !== "other")
              .map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant="outline"
                  className="justify-start"
                  onClick={() => startNewContract(t)}
                >
                  {NEW_CONTRACT_TYPE_LABELS[t]}
                </Button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    )}
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
    <AgreementViewerDialog
      open={viewerOpen}
      onOpenChange={setViewerOpen}
      url={viewerUrl}
      downloadUrl={viewerDownloadUrl}
      title={viewerTitle}
    />
    </>
  );
}
