"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
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
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useControllableOpen } from "@/lib/use-controllable-open";

import { VEHICLE_STATUS_LABELS as STATUS_LABELS } from "@/lib/vehicle-status";

import { createVehicle, updateVehicle } from "./actions";
import {
  trackerStatusValues,
  vehicleFormSchema,
  vehicleStatusValues,
  type VehicleFormValues,
} from "./schema";
import type { VehicleWithRegistration } from "./types";
import { VehicleCostsSection } from "./vehicle-costs-section";
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
    trackerRunning: vehicle.tracker_running,
    natisOnFile: vehicle.natis_on_file,
    licenseDiscExpiry: vehicle.license_disc_expiry ?? undefined,
    hasSpareKey: vehicle.has_spare_key,
    warrantyActive: vehicle.warranty_active,
    warrantyNotes: vehicle.warranty_notes ?? undefined,
    hasContractFile: vehicle.has_contract_file,
  };
}

export function VehiclePanel({
  vehicle,
  canManage = true,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  vehicle?: VehicleWithRegistration;
  canManage?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { open, setOpen, isControlled } = useControllableOpen(openProp, onOpenChangeProp);
  const [isPending, startTransition] = useTransition();
  const isEditing = Boolean(vehicle);

  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: toFormValues(vehicle),
  });

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
      setOpen(false);
      form.reset(toFormValues(undefined));
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(toFormValues(vehicle));
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
              Add vehicle
            </Button>
          )}
        </SheetTrigger>
      )}
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isEditing ? "Edit vehicle" : "Add vehicle"}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <Form {...form}>
            <form
              id="vehicle-form"
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-6"
            >
              <section className="grid gap-4 sm:grid-cols-2">
                <h3 className="text-muted-foreground col-span-full text-xs font-semibold tracking-wide uppercase">
                  Vehicle
                </h3>
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

              <Separator />

              <section className="grid gap-4 sm:grid-cols-2">
                <h3 className="text-muted-foreground col-span-full text-xs font-semibold tracking-wide uppercase">
                  Service &amp; tracking
                </h3>
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

              <Separator />

              <section className="grid gap-4 sm:grid-cols-2">
                <h3 className="text-muted-foreground col-span-full text-xs font-semibold tracking-wide uppercase">
                  Compliance
                </h3>
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

            </form>
          </Form>

          {isEditing && (
            <>
              <Separator />
              <VehicleCostsSection vehicleId={vehicle!.id} canManage={canManage} />
              <Separator />
              <VehicleContractHistorySection vehicleId={vehicle!.id} />
            </>
          )}
        </SheetBody>
        <SheetFooter>
          <Button type="submit" form="vehicle-form" disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
