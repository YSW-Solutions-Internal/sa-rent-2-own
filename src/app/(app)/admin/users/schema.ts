import { z } from "zod";

import { ASSIGNABLE_ROLES } from "@/lib/auth/permissions";

export const MIN_PASSWORD_LENGTH = 8;

export const newStaffFormSchema = z.object({
  fullName: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Cell number is required"),
  role: z.enum(ASSIGNABLE_ROLES),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
});

export type NewStaffFormValues = z.infer<typeof newStaffFormSchema>;

export const editStaffFormSchema = z.object({
  firstName: z.string().trim().min(1, "Name is required"),
  surname: z.string().trim(),
  phone: z.string().min(1, "Cell number is required"),
  role: z.enum(["admin", "manager", "technician"]),
  whatsappEnabled: z.boolean(),
  whatsappFinanceEnabled: z.boolean(),
});

export type EditStaffFormValues = z.infer<typeof editStaffFormSchema>;

/** profiles only stores `full_name`; the form splits it on the first space. */
export function splitFullName(fullName: string): { firstName: string; surname: string } {
  const trimmed = fullName.trim();
  const index = trimmed.indexOf(" ");
  if (index === -1) return { firstName: trimmed, surname: "" };
  return { firstName: trimmed.slice(0, index), surname: trimmed.slice(index + 1).trim() };
}
