"use client";

import { useTransition } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeDollarSign, Car, ClipboardList, DollarSign, FileText, History, Plus, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
  PanelModalContent,
  PanelModalFooter,
  PanelModalHeader,
  PanelModalSection,
  PanelModalSections,
  scrollToPanelSection,
} from "@/components/ui/panel-modal";
import { useControllableOpen } from "@/lib/use-controllable-open";

import { VEHICLE_STATUS_LABELS as STATUS_LABELS } from "@/lib/vehicle-status";

import { ActivitySection } from "@/lib/activity-log/activity-section";

import { createVehicle, updateVehicle } from "./actions";
import { DeleteVehicleButton } from "./delete-vehicle-button";
import {
  trackerStatusValues,
  vehicleFormSchema,
  vehicleStatusValues,
  type VehicleFormValues,
} from "./schema";
import type { VehicleWithRegistration } from "./types";
import { VehicleCostsSection } from "./vehicle-costs-section";
import { VehicleTotalCollectedCard } from "./vehicle-total-collected-card";
import { VehicleContractHistorySection } from "./vehicle-contract-history-section";

function toFormValues(vehicle?: VehicleWithRegistration): VehicleFormValues {
  if (!vehicle) {
    return {
      fileNo: "",
      plateNumber: "",
      status: "parked",
      trackerRunning: "no_info",
    };
  }

  return {
    fileNo: vehicle.file_no,
    plateNumber: vehicle.current_plate ?? "",
    make: vehicle.make ?? undefined,
    model: vehicle.model ?? undefined,
    year: vehicle.year?.toString() ?? undefined,
    colour: vehicle.colour ?? undefined,
    vin: vehicle.vin ?? undefined,
    engineNumber: vehicle.engine_number ?? undefined,
    status: vehicle.status,
    currentMileage: vehicle.current_mileage?.toString() ?? undefined,
    nextServiceKm: vehicle.next_service_km?.toString() ?? undefined,
    nextServiceDate: vehicle.next_service_date ?? undefined,
    lastServicedBy: vehicle.last_serviced_by ?? undefined,
    trackerSupplier: vehicle.tracker_supplier ?? undefined,
    trackerNumber: vehicle.tracker_number ?? undefined,
    trackerRunning: vehicle.tracker_running,
    natisOnFile: vehicle.natis_on_file,
    licenseDiscExpiry: vehicle.license_disc_expiry ?? undefined,
    hasSpareKey: vehicle.has_spare_key,
    warrantyActive: vehicle.warranty_active,
    warrantyNotes: vehicle.warranty_notes ?? undefined,
    hasContractFile: vehicle.has_contract_file,
    purchasePrice: vehicle.purchase_price?.toString() ?? undefined,
    potentialSalePrice: vehicle.potential_sale_price?.toString() ?? undefined,
    salePrice: vehicle.sale_price?.toString() ?? undefined,
  };
}

type VehicleSection = "vehicle" | "service" | "compliance" | "financials";

/** Which section each form field lives in (anything not listed is in Vehicle). */
const FIELD_SECTION: Record<string, VehicleSection> = {
  currentMileage: "service",
  nextServiceKm: "service",
  nextServiceDate: "service",
  lastServicedBy: "service",
  trackerSupplier: "service",
  trackerNumber: "service",
  trackerRunning: "service",
  licenseDiscExpiry: "compliance",
  warrantyNotes: "compliance",
  natisOnFile: "compliance",
  hasSpareKey: "compliance",
  warrantyActive: "compliance",
  hasContractFile: "compliance",
  purchasePrice: "financials",
  potentialSalePrice: "financials",
  salePrice: "financials",
};

export function VehiclePanel({
  vehicle,
  canManage = true,
  showPrices = true,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  onCreated,
}: {
  vehicle?: VehicleWithRegistration;
  canManage?: boolean;
  /** Purchase / potential sale / sale price inputs — hidden from Fleet Managers. */
  showPrices?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called after a new vehicle is saved (not on edits), e.g. to select it in another form. */
  onCreated?: (id: string, values: VehicleFormValues) => void;
}) {
  const { open, setOpen, isControlled } = useControllableOpen(openProp, onOpenChangeProp);
  const [isPending, startTransition] = useTransition();
  const isEditing = Boolean(vehicle);

  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: toFormValues(vehicle),
  });

  // A save blocked by validation scrolls to the section holding the first bad field.
  function onInvalid(errors: FieldErrors<VehicleFormValues>) {
    const first = Object.keys(errors)[0];
    scrollToPanelSection(FIELD_SECTION[first] ?? "vehicle");
  }

  function onSubmit(values: VehicleFormValues) {
    startTransition(async () => {
      const result = isEditing
        ? await updateVehicle(vehicle!.id, values)
        : await createVehicle(values);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(isEditing ? "Vehicle updated" : "Vehicle added");
      if (!isEditing && result.id) onCreated?.(result.id, values);
      setOpen(false);
      form.reset(toFormValues(undefined));
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          form.reset(toFormValues(vehicle));
        }
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          {isEditing ? (
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          ) : (
            <Button variant="destructive">
              <Plus />
              Add vehicle
            </Button>
          )}
        </DialogTrigger>
      )}
      <PanelModalContent>
        <PanelModalHeader
          title={
            isEditing
              ? `Edit vehicle – ${[vehicle!.file_no, vehicle!.current_plate].filter(Boolean).join(" · ")}`
              : "Add vehicle"
          }
        />
        <PanelModalSections
          sections={[
            { id: "vehicle", label: "Vehicle", icon: Car },
            { id: "service", label: "Service & Tracking", icon: Wrench },
            { id: "compliance", label: "Compliance", icon: ClipboardList },
            { id: "financials", label: "Financials", icon: BadgeDollarSign },
            ...(isEditing
              ? [
                  { id: "transactions", label: "Transactions", icon: DollarSign },
                  { id: "history", label: "Contract History", icon: FileText },
                  { id: "activity", label: "Activity", icon: History },
                ]
              : []),
          ]}
        >
          <Form {...form}>
            <form id="vehicle-form" onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="contents">
              <PanelModalSection id="vehicle" title="Vehicle">
              {isEditing && <VehicleTotalCollectedCard vehicleId={vehicle!.id} />}
              <section className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="fileNo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>File no</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="plateNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Registration</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="make"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Make</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
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
                  name="colour"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Colour</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>VIN</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="engineNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Engine number</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
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
                          {vehicleStatusValues.map((status) => (
                            <SelectItem key={status} value={status}>
                              {STATUS_LABELS[status]}
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

              <PanelModalSection id="service" title="Service &amp; Tracking">
              <section className="grid gap-4 sm:grid-cols-2">
<FormField
                  control={form.control}
                  name="currentMileage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current mileage</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
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
                  name="nextServiceKm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Next service (km)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
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
                  name="nextServiceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Next service date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastServicedBy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last serviced by</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="trackerSupplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tracker supplier</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="trackerNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tracker number</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="trackerRunning"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tracker running</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {trackerStatusValues.map((v) => (
                            <SelectItem key={v} value={v}>
                              {v === "no_info" ? "No info" : v.toUpperCase()}
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

              <PanelModalSection id="compliance" title="Compliance">
              <section className="grid gap-4 sm:grid-cols-2">
<FormField
                  control={form.control}
                  name="licenseDiscExpiry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>License disc expiry</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="warrantyNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Warranty notes</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="col-span-full flex flex-wrap gap-6">
                  <FormField
                    control={form.control}
                    name="natisOnFile"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-2">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="font-normal">NATIS on file</FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="hasSpareKey"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-2">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="font-normal">Spare key</FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="warrantyActive"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-2">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="font-normal">Warranty active</FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="hasContractFile"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-2">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="font-normal">Contract on file</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
              </section>
              </PanelModalSection>

              <PanelModalSection id="financials" title="Financials">
              <section className="grid gap-4 sm:grid-cols-2">
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
              </section>
              </PanelModalSection>
            </form>
          </Form>

          {isEditing && (
            <>
              <PanelModalSection id="transactions" title="Transactions">
                <VehicleCostsSection vehicleId={vehicle!.id} canManage={canManage} />
              </PanelModalSection>
              <PanelModalSection id="history" title="Contract History">
                <VehicleContractHistorySection vehicleId={vehicle!.id} />
              </PanelModalSection>
              <PanelModalSection id="activity" title="Activity">
                <ActivitySection entityType="vehicles" entityId={vehicle!.id} />
              </PanelModalSection>
            </>
          )}
        </PanelModalSections>
        <PanelModalFooter>
          <div className="flex w-full items-center justify-between">
            {isEditing ? (
              <DeleteVehicleButton
                vehicleId={vehicle!.id}
                label={vehicle!.current_plate ?? vehicle!.file_no}
                onDeleted={() => setOpen(false)}
              />
            ) : (
              <span />
            )}
            <Button type="submit" form="vehicle-form" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </PanelModalFooter>
      </PanelModalContent>
    </Dialog>
  );
}
