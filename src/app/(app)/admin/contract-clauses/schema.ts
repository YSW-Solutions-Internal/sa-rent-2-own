import { z } from "zod";

export const editClauseFormSchema = z.object({
  heading: z.string().trim().min(1, "Heading is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(10_000),
});

export type EditClauseFormValues = z.infer<typeof editClauseFormSchema>;
