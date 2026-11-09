import { z } from "zod";

import { END_OF_CONTRACT_STATUSES, FLEET_STATUSES } from "@/lib/vehicle-status";

export const vehicleStatusValues = [...FLEET_STATUSES, ...END_OF_CONTRACT_STATUSES] as const;

export const trackerStatusValues = ["yes", "no", "no_info"] as const;

// Deliberately no .transform()/.coerce() here — react-hook-form + zodResolver
// need the form's input and output shapes to match. Numeric string -> number
// coercion happens once, server-side, in actions.ts's toVehicleRow().
export const vehicleFormSchema = z.object({
  fileNo: z.string().min(1, "File number is required"),
  plateNumber: z.string().min(1, "Registration is required"),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.string().optional(),
  colour: z.string().optional(),
  vin: z.string().optional(),
  engineNumber: z.string().optional(),
  status: z.enum(vehicleStatusValues),
  currentMileage: z.string().optional(),
  nextServiceKm: z.string().optional(),
  nextServiceDate: z.string().optional(),
  lastServicedBy: z.string().optional(),
  trackerSupplier: z.string().optional(),
  trackerRunning: z.enum(trackerStatusValues),
  natisOnFile: z.boolean().optional(),
  licenseDiscExpiry: z.string().optional(),
  hasSpareKey: z.boolean().optional(),
  warrantyActive: z.boolean().optional(),
  warrantyNotes: z.string().optional(),
  hasContractFile: z.boolean().optional(),
  purchasePrice: z.string().optional(),
  potentialSalePrice: z.string().optional(),
  salePrice: z.string().optional(),
});

export type VehicleFormValues = z.infer<typeof vehicleFormSchema>;
