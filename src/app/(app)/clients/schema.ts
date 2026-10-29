import { z } from "zod";

export const bankAccountTypeValues = ["cheque", "savings", "other"] as const;

export const clientFormSchema = z.object({
  fullName: z.string().min(1, "Name is required"),
  idNumber: z.string().optional(),
  cellNumber: z.string().min(1, "Cell number is required"),
  altCellNumber: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  blacklisted: z.boolean().optional(),
  blacklistReason: z.string().optional(),

  // Banking — all optional. Leave account holder/number blank on an edit
  // to keep whatever's already on file; fill them in to add or replace it.
  bankName: z.string().optional(),
  accountType: z.enum(bankAccountTypeValues).optional(),
  branchCode: z.string().optional(),
  accountHolderName: z.string().optional(),
  accountNumber: z.string().optional(),
});

export type ClientFormValues = z.infer<typeof clientFormSchema>;
