import { z } from "zod";

export const contractTypeValues = ["rent_to_own", "short_term_rental", "rental", "other"] as const;
export const contractStatusValues = [
  "active",
  "completed",
  "cancelled",
  "defaulted",
  "repossessed",
] as const;
export const paymentMethodValues = ["debit_order", "eft", "cash", "other"] as const;
export const billingDirectionValues = ["advance", "arrears"] as const;
export const billingFrequencyValues = ["weekly", "monthly"] as const;
export const billingStatusValues = ["active", "paused", "stopped"] as const;

export const contractFormSchema = z.object({
  vehicleId: z.string().min(1, "Select a vehicle"),
  clientId: z.string().min(1, "Select a client"),
  contractType: z.enum(contractTypeValues),
  status: z.enum(contractStatusValues),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  paymentMethod: z.enum(paymentMethodValues),
  installmentAmount: z.string().optional(),
  purchasePrice: z.string().optional(),
  potentialSalePrice: z.string().optional(),
  salePrice: z.string().optional(),
  residualValue: z.string().optional(),
  totalCollected: z.string().optional(),
  outstandingBalance: z.string().optional(),
  arrearsAmount: z.string().optional(),
  isPaidUp: z.boolean().optional(),
  notes: z.string().optional(),
  dealNumber: z.string().optional(),
  statementTag: z.string().optional(),
  billingDay: z.string().optional(),
  billingDirection: z.enum(billingDirectionValues).optional(),
  billingFrequency: z.enum(billingFrequencyValues).optional(),
  billingStatus: z.enum(billingStatusValues).optional(),
  // Only used when an existing contract's vehicle is swapped for another.
  vehicleChangeDate: z.string().optional(),
  vehicleChangeReason: z.string().optional(),
});

export type ContractFormValues = z.infer<typeof contractFormSchema>;
